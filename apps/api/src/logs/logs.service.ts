import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Client } from "@aws-sdk/client-s3";
import { Inject, Injectable, Logger } from "@nestjs/common";
import IORedis from "ioredis";
import { LogEvent } from "@sft/schemas";
// Value import, not `import type`: Nest resolves `AppConfig` through
// design:paramtypes, so a type-only import would erase the class reference.
import { AppConfig } from "../config/app-config.service";
import type { UserRow } from "../db";
import { RunsService } from "../runs/runs.service";

type Listener = (event: LogEvent) => void;

interface Room {
  channel: string;
  listeners: Set<Listener>;
  /** True between SUBSCRIBE and UNSUBSCRIBE on the shared client. */
  subscribed: boolean;
  /** Redis channel handler, kept so it can be detached exactly once. */
  onMessage: (channel: string, message: string) => void;
}

/**
 * Fan-out for live run logs (Spec §0 "Log streaming", §6 `GET /runs/:id/logs`).
 *
 * Transport is Redis pub/sub, which is fire-and-forget: a client that connects
 * after chunks were published sees nothing (M2b-1 is live-only; replay and the
 * 30-day archive are M2b-2). Several SSE clients on one run share a single
 * subscription, refcounted so the last one out unsubscribes.
 */
@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private client: IORedis | null = null;
  private readonly rooms = new Map<string, Room>();

  constructor(
    @Inject("S3_CLIENT") private readonly s3: S3Client,
    private readonly config: AppConfig,
    private readonly runs: RunsService,
  ) {}

  private channelFor(runId: string): string {
    return `${this.config.logChannelPrefix}${runId}`;
  }

  /**
   * A connection in subscriber mode cannot issue other commands, so this is a
   * dedicated client - never the BullMQ connection.
   */
  private subscriber(): IORedis {
    if (this.client) return this.client;
    const client = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });
    client.on("error", (error: unknown) => {
      this.logger.error(`log subscriber error: ${error instanceof Error ? error.message : error}`);
    });
    this.client = client;
    return client;
  }

  private room(runId: string): Room {
    const existing = this.rooms.get(runId);
    if (existing) return existing;

    const channel = this.channelFor(runId);
    const listeners = new Set<Listener>();
    const room: Room = {
      channel,
      listeners,
      subscribed: false,
      onMessage: (_channel, message) => {
        const parsed = LogEvent.safeParse(safeJson(message));
        // Untrusted input crossing a trust boundary (Spec §8): anything that
        // is not a valid envelope is dropped, never forwarded.
        if (!parsed.success) {
          this.logger.warn(`dropping malformed log event on ${channel}`);
          return;
        }
        for (const listener of listeners) listener(parsed.data);
      },
    };
    this.rooms.set(runId, room);
    return room;
  }

  private async acquire(runId: string): Promise<Room> {
    const room = this.room(runId);
    // The flag is set synchronously, before the await: two clients attaching in
    // the same tick must not both issue SUBSCRIBE for one channel.
    if (!room.subscribed) {
      room.subscribed = true;
      const client = this.subscriber();
      await client.subscribe(room.channel);
      client.on("message", room.onMessage);
    }
    return room;
  }

  private async release(runId: string, room: Room): Promise<void> {
    if (room.listeners.size > 0 || !room.subscribed) return;
    room.subscribed = false;
    this.rooms.delete(runId);
    const client = this.client;
    if (!client) return;
    client.off("message", room.onMessage);
    try {
      await client.unsubscribe(room.channel);
    } catch {
      // The connection is going away anyway; teardown must not throw.
    }
  }

  /**
   * Yields log events for one run until the consumer stops or an `end` event
   * arrives.
   *
   * `signal` is required for a clean disconnect: an async generator parked on
   * `await` cannot be interrupted by `return()` (the call queues until the
   * pending await settles), so without it an idle subscriber would pin its
   * Redis subscription forever. Aborting wakes the generator, which then runs
   * its `finally` and releases.
   */
  async *subscribe(
    runId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<LogEvent, void, void> {
    const room = await this.acquire(runId);
    const queue: LogEvent[] = [];
    // Read and written only from these two helpers: a variable assigned inside
    // an async callback narrows to `never` by the time control returns to the
    // generator body, so `wake?.()` in the finally block would not typecheck.
    let wake: (() => void) | undefined;

    const wait = async (): Promise<void> => {
      if (signal?.aborted) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      wake = undefined;
    };
    const signalWake = (): void => {
      wake?.();
    };

    const listener: Listener = (event) => {
      queue.push(event);
      signalWake();
    };
    room.listeners.add(listener);

    try {
      for (;;) {
        if (signal?.aborted) return;
        if (queue.length === 0) {
          await wait();
          continue;
        }
        const event = queue.shift()!;
        yield event;
        // The run is over: stop streaming on the terminal event.
        if (event.type === "end") return;
      }
    } finally {
      room.listeners.delete(listener);
      signalWake();
      await this.release(runId, room);
    }
  }

  /** Test/observability helper: how many clients are attached to a run. */
  refCount(runId: string): number {
    return this.rooms.get(runId)?.listeners.size ?? 0;
  }

  /**
   * Returns a presigned GET URL for the combined log archive of a run,
   * or null if the run has no archived logs.
   *
   * runs.s3_log_key is a prefix; the actual object is:
   *   <s3_log_key>/combined.log
   */
  async getPresignedLogUrl(
    user: UserRow,
    runId: string,
    ttlSeconds = 900,
  ): Promise<string | null> {
    // Ownership check first: a foreign or unknown run yields null, never a URL.
    let run;
    try {
      run = await this.runs.getOwnedRun(user, runId);
    } catch {
      return null;
    }
    if (!run.s3LogKey) return null;

    const command = new GetObjectCommand({
      Bucket: this.config.env.S3_BUCKET,
      Key: `${run.s3LogKey}/combined.log`,
      ResponseContentDisposition: `attachment; filename="${runId}-combined.log"`,
    });

    return getSignedUrl(this.s3, command, { expiresIn: ttlSeconds });
  }

  async onModuleDestroy(): Promise<void> {
    this.rooms.clear();
    const client = this.client;
    this.client = null;
    if (client) await client.quit().catch(() => client.disconnect());
  }
}

function safeJson(message: string): unknown {
  try {
    return JSON.parse(message);
  } catch {
    return null;
  }
}