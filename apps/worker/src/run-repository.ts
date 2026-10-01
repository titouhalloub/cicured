import type { FailureKind, RunStatus } from "@sft/schemas";
import { and, eq } from "drizzle-orm";
import type { Database } from "./db";
import {
  projects,
  runs,
  type WorkerProjectRow,
  type WorkerRunRow,
} from "./tables";

export interface RunWithProject {
  run: WorkerRunRow;
  project: WorkerProjectRow;
}

export interface FinalizeRunInput {
  status: RunStatus;
  exitCode: number | null;
  failureKind: FailureKind | null;
  finishedAt: Date;
  buildMinutes: number;
}

/**
 * The narrow slice of the database the run job needs. Keeping it an interface
 * lets the exit-code matrix be unit-tested without a Postgres double, while
 * the drizzle implementation below is the only place that knows SQL shapes.
 */
export interface RunRepository {
  loadRunWithProject(runId: string): Promise<RunWithProject | null>;
  /** `queued -> running` guarded update; false when another worker claimed it. */
  claimRun(runId: string, startedAt: Date): Promise<boolean>;
  finalizeRun(runId: string, input: FinalizeRunInput): Promise<void>;
}

export function createRunRepository(db: Database): RunRepository {
  return {
    async loadRunWithProject(runId: string): Promise<RunWithProject | null> {
      const [row] = await db
        .select({ run: runs, project: projects })
        .from(runs)
        .innerJoin(projects, eq(runs.projectId, projects.id))
        .where(eq(runs.id, runId))
        .limit(1);
      return row ?? null;
    },

    async claimRun(runId: string, startedAt: Date): Promise<boolean> {
      // The `status = 'queued'` predicate is the claim: jobId = runId makes
      // enqueue idempotent (apps/api/src/queue/runs-queue.service.ts) but a job
      // can still be redelivered after a worker crash.
      const claimed = await db
        .update(runs)
        .set({ status: "running", startedAt })
        .where(and(eq(runs.id, runId), eq(runs.status, "queued")))
        .returning({ id: runs.id });
      return claimed.length > 0;
    },

    async finalizeRun(runId: string, input: FinalizeRunInput): Promise<void> {
      const updated = await db
        .update(runs)
        .set({
          status: input.status,
          exitCode: input.exitCode,
          failureKind: input.failureKind,
          finishedAt: input.finishedAt,
          buildMinutes: input.buildMinutes,
        })
        .where(eq(runs.id, runId))
        .returning({ id: runs.id });
      if (updated.length === 0) {
        throw new Error(`run ${runId} disappeared while finalizing`);
      }
    },
  };
}