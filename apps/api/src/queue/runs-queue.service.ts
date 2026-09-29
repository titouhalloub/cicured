import { Inject, Injectable } from "@nestjs/common";
import type { Queue } from "bullmq";
import { RUNS_QUEUE } from "./queue.module";

export const RUN_JOB_NAME = "run";

/** Job payload carries ids only - never tokens or code (Spec §8). */
export interface RunJobData {
  runId: string;
  projectId: string;
}

/** Thin wrapper so services and tests never touch BullMQ directly. */
@Injectable()
export class RunsQueue {
  constructor(@Inject(RUNS_QUEUE) private readonly queue: Queue<RunJobData>) {}

  /** `jobId = runId` makes the enqueue idempotent per run. */
  async enqueueRun(data: RunJobData): Promise<void> {
    await this.queue.add(RUN_JOB_NAME, data, { jobId: data.runId });
  }

  /** Used by the M1 acceptance test to prove the job exists. */
  async hasJob(runId: string): Promise<boolean> {
    const job = await this.queue.getJob(runId);
    return job !== undefined && job !== null;
  }
}
