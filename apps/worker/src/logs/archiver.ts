import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { LogStream } from "@sft/schemas";
import type { WorkerLogger } from "../common/secrets";

/** Per-stream cap: past this, head+tail are kept and the middle is dropped. */
export const ARCHIVER_TRUNCATE_THRESHOLD = 10 * 1024 * 1024; // 10 MB
/** Bytes kept on each side when a stream is truncated. */
export const ARCHIVER_KEEP_BYTES = 5 * 1024 * 1024; // 5 MB

/** A buffered chunk; seq orders combined.log, index preserves arrival order. */
interface ChunkEntry {
  stream: LogStream;
  chunk: Buffer;
  seq: number | undefined;
  index: number;
}

export interface FlushResult {
  /** The S3 prefix `logs/<runId>` — null when the upload failed. */
  s3Key: string | null;
  stdoutBytes: number;
  stderrBytes: number;
}

/**
 * Buffers log chunks per stream, applies the 10 MB cap with truncation, and
 * flushes three objects: stdout.log, stderr.log, combined.log (merged by
 * arrival order via LogChunk.seq).
 *
 * Combined.log reconstruction requires the monotonically increasing seq that
 * LogChunk carries on every frame — so append() accepts an optional seq and
 * keeps chunk entries rather than raw buffers. When seq is missing (tests,
 * future callers), arrival order is used instead.
 *
 * flush() is idempotent: the first call uploads, later calls return the
 * recorded result without re-uploading.
 */
export interface LogArchiver {
  /** Append a chunk to a stream buffer. Pass seq when known (for combined.log). */
  append(stream: LogStream, chunk: Buffer, seq?: number): void;
  /** Flush all buffered streams to S3. Never throws — returns null key on error. */
  flush(): Promise<FlushResult>;
}

/**
 * Factory for a run-scoped archiver.
 * - Each run gets its own buffers (stdout/stderr)
 * - S3 client + bucket + runId are fixed per archiver
 */
export function createLogArchiver({
  s3Client,
  bucket,
  runId,
  logger,
}: {
  s3Client: S3Client;
  bucket: string;
  runId: string;
  logger: WorkerLogger;
}): LogArchiver {
  const entries: ChunkEntry[] = [];
  const sizes: Record<LogStream, number> = { stdout: 0, stderr: 0 };
  let nextIndex = 0;
  let flushed: FlushResult | null = null;
  let flushing: Promise<FlushResult> | null = null;

  const markerFor = (stream: LogStream, dropped: number): Buffer =>
    Buffer.from(
      `\n[sft-dev] ${stream} truncated: dropped ${dropped} bytes ` +
        `(kept first/last ${ARCHIVER_KEEP_BYTES} bytes)\n`,
      "utf8",
    );

  return {
    append(stream, chunk, seq) {
      if (chunk.length === 0) return;
      if (flushed ?? flushing) return;
      entries.push({ stream, chunk, seq, index: nextIndex++ });
      sizes[stream] += chunk.length;
    },

    async flush(): Promise<FlushResult> {
      if (flushed) return flushed;
      if (flushing) return flushing;
      flushing = (async (): Promise<FlushResult> => {
        try {
          const prefix = `logs/${runId}`;

          // Apply the per-stream cap: keep head + marker + tail, drop the middle.
          // Per-stream assembly stays in arrival order (entries are appended in
          // seq order by attachAndStream).
          const kept: Record<LogStream, Buffer[]> = { stdout: [], stderr: [] };
          for (const stream of ["stdout", "stderr"] as const) {
            const chunks = entries
              .filter((entry) => entry.stream === stream)
              .map((entry) => entry.chunk);
            const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            if (total <= ARCHIVER_TRUNCATE_THRESHOLD) {
              kept[stream] = chunks;
              continue;
            }
            const full = Buffer.concat(chunks, total);
            const head = full.subarray(0, ARCHIVER_KEEP_BYTES);
            const tail = full.subarray(total - ARCHIVER_KEEP_BYTES);
            const marker = markerFor(stream, total - head.length - tail.length);
            kept[stream] = [head, marker, tail];
            logger.warn(
              `log stream ${stream} exceeded ${ARCHIVER_TRUNCATE_THRESHOLD} bytes; ` +
                `truncated ${total - head.length - tail.length} bytes ` +
                `(kept first/last ${ARCHIVER_KEEP_BYTES})`,
            );
          }

          const stdoutBuffer = Buffer.concat(kept.stdout);
          const stderrBuffer = Buffer.concat(kept.stderr);

          if (stdoutBuffer.length > 0) {
            await s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: `${prefix}/stdout.log`,
                Body: stdoutBuffer,
                ContentType: "text/plain; charset=utf-8",
              }),
            );
          }

          if (stderrBuffer.length > 0) {
            await s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: `${prefix}/stderr.log`,
                Body: stderrBuffer,
                ContentType: "text/plain; charset=utf-8",
              }),
            );
          }

          // Combined.log: same kept stream bytes, merged in seq (arrival) order
          // without a stream prefix — it reads like the original terminal.
          // Truncated streams contribute their kept head+tail slices: walk the
          // ordered entries and take at most KEEP head bytes plus the tail.
          const ordered = [...entries].sort((a, b) =>
            a.seq !== undefined && b.seq !== undefined ? a.seq - b.seq : a.index - b.index,
          );
          const combinedParts: Buffer[] = [];
          const consumed: Record<LogStream, number> = { stdout: 0, stderr: 0 };
          for (const entry of ordered) {
            const streamTotal = sizes[entry.stream];
            if (streamTotal <= ARCHIVER_TRUNCATE_THRESHOLD) {
              combinedParts.push(entry.chunk);
              continue;
            }
            // Truncated stream: first KEEP bytes (head) then the marker+tail.
            // Track consumption across entries to slice head vs tail correctly.
            const start = consumed[entry.stream];
            consumed[entry.stream] += entry.chunk.length;
            const end = consumed[entry.stream];
            if (start < ARCHIVER_KEEP_BYTES) {
              combinedParts.push(
                entry.chunk.subarray(0, Math.min(entry.chunk.length, ARCHIVER_KEEP_BYTES - start)),
              );
            }
            if (end > streamTotal - ARCHIVER_KEEP_BYTES) {
              const tailStart = Math.max(0, streamTotal - ARCHIVER_KEEP_BYTES - start);
              if (tailStart < entry.chunk.length) {
                combinedParts.push(entry.chunk.subarray(tailStart));
              }
            }
          }
          // Insert one marker per truncated stream at its first dropped byte.
          // TODO(M3): interleave truncation markers at the drop point
          const markers: Buffer[] = [];
          for (const stream of ["stdout", "stderr"] as const) {
            if (sizes[stream] > ARCHIVER_TRUNCATE_THRESHOLD) {
              markers.push(markerFor(stream, sizes[stream] - 2 * ARCHIVER_KEEP_BYTES));
            }
          }
          const combinedBody = Buffer.concat([...combinedParts, ...markers]);
          if (combinedBody.length > 0) {
            await s3Client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: `${prefix}/combined.log`,
                Body: combinedBody,
                ContentType: "text/plain; charset=utf-8",
              }),
            );
          }

          flushed = {
            s3Key: prefix,
            stdoutBytes: stdoutBuffer.length,
            stderrBytes: stderrBuffer.length,
          };
          return flushed;
        } catch (error) {
          // S3 upload failure is non-fatal: report extraction continues.
          logger.error("failed to flush logs to S3", error);
          flushed = { s3Key: null, stdoutBytes: 0, stderrBytes: 0 };
          return flushed;
        } finally {
          flushing = null;
        }
      })();
      return flushing;
    },
  };
}