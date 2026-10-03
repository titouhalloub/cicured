import type { LogEvent } from "@sft/schemas";
import type IORedis from "ioredis";

/**
 * Publishes live log envelopes to Redis pub/sub (Spec §0 "Log streaming").
 *
 * Ownership: the publisher borrows the caller's ioredis client and never owns
 * it. PUBLISH is an ordinary command, not a subscriber operation, so the
 * BullMQ connection can safely carry these - only the API side needs a
 * dedicated subscriber client.
 */
export interface LogPublisher {
  publish(runId: string, event: LogEvent): Promise<void>;
  /** Symmetry hook only - the worker closes its own client on SIGTERM. */
  close(): Promise<void>;
}

/** `sft:logs:<runId>` by default; the prefix comes from SFT_LOG_CHANNEL_PREFIX. */
export function logChannelFor(prefix: string, runId: string): string {
  return `${prefix}${runId}`;
}

export function createLogPublisher(redis: IORedis, prefix: string): LogPublisher {
  return {
    async publish(runId: string, event: LogEvent): Promise<void> {
      await redis.publish(logChannelFor(prefix, runId), JSON.stringify(event));
    },
    async close(): Promise<void> {
      // Intentionally empty: the worker created the client, so it closes it.
    },
  };
}