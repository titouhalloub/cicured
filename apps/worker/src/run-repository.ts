import type { FailureKind, RunStatus } from "@sft/schemas";
import { and, eq } from "drizzle-orm";
import type { Database } from "./db";
import {
  logs,
  projects,
  runs,
  type WorkerProjectRow,
  type WorkerRunRow,
} from "./tables";

export interface RunWithProject {
  run: WorkerRunRow;
  project: WorkerProjectRow;
}

export interface LogArchiveSizes {
  stdoutBytes: number;
  stderrBytes: number;
}

export interface FinalizeRunInput {
  status: RunStatus;
  exitCode: number | null;
  failureKind: FailureKind | null;
  finishedAt: Date;
  buildMinutes: number;
  /**
   * M2b-2: the S3 prefix `logs/<runId>` the archiver uploaded to, or null
   * when the upload failed. When present (even null), `runs.s3_log_key` is
   * set; when undefined the column is left untouched (M2a callers).
   */
  s3LogKey?: string | null;
  /**
   * M2b-2: per-stream byte sizes for the `logs` segment rows. Null/undefined
   * skips the insert; a stream with 0 bytes produces no row.
   */
  logArchive?: LogArchiveSizes | null;
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
          // M2a callers omit s3LogKey; only touch the column when provided.
          ...(input.s3LogKey !== undefined ? { s3_log_key: input.s3LogKey } : {}),
        })
        .where(eq(runs.id, runId))
        .returning({ id: runs.id });
      if (updated.length === 0) {
        throw new Error(`run ${runId} disappeared while finalizing`);
      }

      // Segment metadata so TTL purges and SSE replays can find the S3
      // objects. One row per non-empty stream, sequence 0 (whole-stream
      // archive, not chunked segments). Idempotent on redelivery.
      const archive = input.logArchive;
      if (archive && input.s3LogKey) {
        const rows = (
          [
            { stream: "stdout" as const, bytes: archive.stdoutBytes },
            { stream: "stderr" as const, bytes: archive.stderrBytes },
          ] as const
        ).filter((row) => row.bytes > 0);
        for (const row of rows) {
          await db
            .insert(logs)
            .values({
              runId,
              stream: row.stream,
              sequence: 0,
              s3Key: `${input.s3LogKey}/${row.stream}.log`,
              byteSize: row.bytes,
            })
            .onConflictDoNothing();
        }
      }
    },
  };
}