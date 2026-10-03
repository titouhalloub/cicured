import { z } from "zod";
import { RunStatus } from "./run";

/**
 * Live log streaming envelope (Spec §0 "Log streaming", §6 `GET /runs/:id/logs`).
 *
 * The worker publishes these to Redis pub/sub and the API fans them out over
 * SSE. Payload text is attacker-controlled (build output), so `data` is capped
 * at the 64 KiB chunk limit - Docker's stream protocol delivers <= 32 KiB
 * frames, so this is headroom rather than a truncation policy.
 */
export const LOG_CHUNK_MAX_BYTES = 64 * 1024;

/** Which container stream a chunk came from. */
export const LogStream = z.enum(["stdout", "stderr"]);
export type LogStream = z.infer<typeof LogStream>;

/** A slice of container output. `seq` is monotonic across both streams. */
export const LogChunk = z.object({
  type: z.literal("chunk"),
  runId: z.string().uuid(),
  stream: LogStream,
  seq: z.number().int().nonnegative(),
  ts: z.string().datetime(),
  data: z.string().max(LOG_CHUNK_MAX_BYTES),
});
export type LogChunk = z.infer<typeof LogChunk>;

/**
 * Terminal event. Carries the final status so an SSE client can leave its
 * "streaming" state without a follow-up request (Spec §4 step 10).
 */
export const LogEnd = z.object({
  type: z.literal("end"),
  runId: z.string().uuid(),
  exitCode: z.number().int().nullable(),
  status: RunStatus,
});
export type LogEnd = z.infer<typeof LogEnd>;

export const LogEvent = z.discriminatedUnion("type", [LogChunk, LogEnd]);
export type LogEvent = z.infer<typeof LogEvent>;