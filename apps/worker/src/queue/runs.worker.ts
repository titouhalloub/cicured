import { UUID_PATTERN } from "@sft/schemas";
import { Worker } from "bullmq";
import type IORedis from "ioredis";
import { z } from "zod";
import type { WorkerLogger } from "../common/secrets";
import type { WorkerEnv } from "../env";

/** Same job name the API produces (apps/api/src/queue/runs-queue.service.ts). */
export const RUN_JOB_NAME = "run";

/**
 * Job payloads carry ids only - never tokens or code (Spec §8).
 *
 * M1's API sends `{ runId, projectId }`; the worker resolves the project from
 * the run row and only warns, so the M1 producer and its tests stay untouched
 * until the post-M2a cleanup drops `projectId`.
 */
export const RunJobDataSchema = z.object({
  runId: z.string().regex(UUID_PATTERN, "runId must be a uuid"),
  projectId: z.string().regex(UUID_PATTERN).optional(),
  /** Present for pull_request-triggered runs: post the diagnosis comment back to the PR. */
  prNumber: z.number().int().positive().optional(),
});

export type RunJobData = z.infer<typeof RunJobDataSchema>;

export const DEPRECATED_PROJECT_ID_WARNING =
  "deprecated projectId in queue payload (M1 compatibility)";

export interface RunsWorkerOptions {
  env: WorkerEnv;
  connection: IORedis;
  logger: WorkerLogger;
  handle: (data: RunJobData) => Promise<unknown>;
}

/**
 * The BullMQ consumer. Concurrency is 1 for M2a: one sandbox at a time, and
 * build minutes are the unit cost being metered (Spec §9).
 */
export const WORKER_CONCURRENCY = 1;

/**
 * BullMQ's default lock is 30 seconds. A sandbox run is wall-clock capped at
 * SFT_DEADLINE_BUDGET_MS (30 minutes), and a busy event loop — spawning Docker
 * containers, parsing heavy reports — can delay the renewal timer past the
 * 30s window. BullMQ then assumes the worker died and fails the job with
 * `could not renew lock`, dropping a run that is still alive.
 *
 * The lock is therefore set to the full run budget: a healthy run can never
 * outlive its lock, no matter how long the event loop stalls.
 *
 * Trade-off: a worker that is genuinely killed holds its job for up to this
 * long before the stalled check re-queues it (the stall counter is bumped then
 * and the job moves back to `wait`).
 */
export const RUNS_WORKER_LOCK_DURATION_MS = 1_800_000;

/**
 * Renew far more often than the expiry. The default would be half of
 * lockDuration (15 minutes); every 30s keeps the lock fresh across moderate
 * stalls while the 30-minute lockDuration absorbs anything longer.
 */
export const RUNS_WORKER_LOCK_RENEW_TIME_MS = 30_000;

/** Stalled-check cadence: notice a dead worker's job within a minute of expiry. */
export const RUNS_WORKER_STALLED_INTERVAL_MS = 60_000;

export function createRunsWorker(options: RunsWorkerOptions): Worker<RunJobData> {
  const { env, connection, logger, handle } = options;

  const worker = new Worker<RunJobData>(
    env.SFT_QUEUE_NAME,
    async (job) => {
      const parsed = RunJobDataSchema.safeParse(job.data);
      if (!parsed.success) {
        logger.error(`rejecting job ${job.id ?? "unknown"}: invalid payload`);
        return;
      }
      if (parsed.data.projectId !== undefined) {
        logger.warn(DEPRECATED_PROJECT_ID_WARNING);
      }
      await handle(parsed.data);
    },
    {
      connection,
      concurrency: WORKER_CONCURRENCY,
      lockDuration: RUNS_WORKER_LOCK_DURATION_MS,
      lockRenewTime: RUNS_WORKER_LOCK_RENEW_TIME_MS,
      stalledInterval: RUNS_WORKER_STALLED_INTERVAL_MS,
    },
  );

  worker.on("failed", (job, error) => {
    logger.error(`job ${job?.id ?? "unknown"} failed`, error);
  });
  worker.on("error", (error) => {
    logger.error("worker error", error);
  });

  return worker;
}