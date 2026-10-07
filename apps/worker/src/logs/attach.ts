import type { Readable } from "node:stream";
import type { LogStream } from "@sft/schemas";
import type { WorkerLogger } from "../common/secrets";
import type { DockerLike } from "../sandbox/launcher";
import type { LogPublisher } from "./publisher";
import type { LogArchiver } from "./archiver";

/**
 * Docker's multiplexed stream framing: an 8-byte header per frame -
 * [stream_type(1)][0,0,0][size(4, big-endian)] - followed by the payload.
 * The sandbox is non-TTY, so stdout and stderr arrive interleaved on one
 * connection and must be demultiplexed by hand. (dockerode delegates this to
 * docker-modem, which is only a transitive dependency and untyped.)
 */
const HEADER_BYTES = 8;
const STREAM_STDOUT = 1;
const STREAM_STDERR = 2;

/** Docker only closes the log stream when the container exits. */
const STOP_GRACE_MS = 5_000;

export interface DemuxHandlers {
  onFrame: (stream: LogStream, payload: Buffer) => void;
  /**
   * Called once per attach for the first unknown stream_type. Malformed or
   * hostile framing must never kill the log stream (D-adition 1).
   */
  onUnknownStream: (streamType: number) => void;
}

/**
 * Incremental demuxer: feed it arbitrary byte chunks (network boundaries do
 * not align with frame boundaries) and it emits whole frames.
 */
export interface FrameDemuxer {
  write(chunk: Buffer): void;
}

export function createFrameDemuxer(handlers: DemuxHandlers): FrameDemuxer {
  let pending: Buffer = Buffer.alloc(0);

  return {
    write(chunk: Buffer): void {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= HEADER_BYTES) {
        const streamType = pending[0]!;
        const size = pending.readUInt32BE(4);
        if (pending.length < HEADER_BYTES + size) return; // wait for the rest
        const payload = pending.subarray(HEADER_BYTES, HEADER_BYTES + size);
        pending = pending.subarray(HEADER_BYTES + size);

        if (streamType === STREAM_STDOUT) {
          handlers.onFrame("stdout", payload);
        } else if (streamType === STREAM_STDERR) {
          handlers.onFrame("stderr", payload);
        } else {
          handlers.onUnknownStream(streamType);
        }
      }
    },
  };
}

export interface LogStreamHandle {
  /** Resolves once the log stream has ended (or after the grace period). */
  stop(): Promise<void>;
}

/**
 * Taps a running container's stdout/stderr and republishes it as LogChunks.
 *
 * Never throws: a broken log stream degrades to "no live logs", never to a
 * failed run (M2b-1 is best-effort observability, not part of the contract).
 *
 * If an archiver is provided, chunks are also buffered for S3 upload.
 */
export async function attachAndStream(
  docker: DockerLike,
  containerId: string,
  runId: string,
  publisher: LogPublisher,
  logger: WorkerLogger,
  archiver?: LogArchiver,
): Promise<LogStreamHandle> {
  const log = logger.child({ containerId });

  // dockerode returns a real Node Readable here; its typings say the looser
  // NodeJS.ReadableStream, which lacks the events we need.
  const raw = (await docker
    .getContainer(containerId)
    .logs({ follow: true, stdout: true, stderr: true })) as Readable;

  // One counter across both streams so clients see a total order.
  let seq = 0;
  let warnedUnknown = false;
  let streamEnded = false;
  let stopPromise: Promise<void> | null = null;

  const demuxer = createFrameDemuxer({
    onFrame: (stream, payload) => {
      seq += 1;
      const event = {
        type: "chunk" as const,
        runId,
        stream,
        seq,
        ts: new Date().toISOString(),
        // Logs are diagnostics: invalid UTF-8 bytes become U+FFFD.
        data: payload.toString("utf8"),
      };
      publisher.publish(runId, event).catch((error: unknown) => {
        log.error("could not publish log chunk", error);
      });
      // Also archive if we have an archiver
      archiver?.append(stream, payload, seq);
    },
    onUnknownStream: (streamType) => {
      if (warnedUnknown) return;
      warnedUnknown = true;
      log.warn(`ignoring frames with unknown stream_type=${streamType}`);
    },
  });

  raw.on("data", (chunk: Buffer) => demuxer.write(chunk));
  raw.on("end", () => {
    streamEnded = true;
  });
  raw.on("error", (error: unknown) => {
    streamEnded = true;
    log.error("container log stream failed", error);
  });

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopPromise = new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined = setTimeout(() => {
        timer = undefined;
        raw.destroy();
        resolve();
      }, STOP_GRACE_MS);
      const finish = (): void => {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        resolve();
      };
      if (streamEnded) finish();
      else raw.once("end", finish);
    });
    return stopPromise;
  };

  return { stop };
}