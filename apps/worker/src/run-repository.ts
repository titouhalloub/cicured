import type { FindingsWithFingerprint } from "@sft/parser";
import { FINDING_CATEGORIES, FINDING_SEVERITIES } from "@sft/schemas";
import type { FailureKind, RunStatus } from "@sft/schemas";
import { and, eq, inArray } from "drizzle-orm";
import { integer, pgEnum, pgTable, real, text, timestamp, boolean, uuid } from "drizzle-orm/pg-core";
import type { Database } from "./db";
import { createLogger } from "./common/secrets";
import type { GeneratedSuggestion } from "./ai/generate";
import {
  logs,
  projects,
  runs,
  type WorkerProjectRow,
  type WorkerRunRow,
} from "./tables";

/** Drizzle's pgEnum needs a non-empty tuple literal (mirrors the API's schema). */
const asTuple = <T extends string>(values: readonly T[]): [T, ...T[]] =>
  values as unknown as [T, ...T[]];

export const findingSeverityEnum = pgEnum("finding_severity", asTuple(FINDING_SEVERITIES));
export const findingCategoryEnum = pgEnum("finding_category", asTuple(FINDING_CATEGORIES));

/**
 * Mirrors apps/api/src/db/schema.ts `findings` — declared here because this
 * module owns its own inserts (the worker table registry in ./tables is out
 * of scope for M3b). The DB-side unique index on (run_id, fingerprint) is
 * what makes `insertFindings` idempotent.
 */
export const findings = pgTable("findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  severity: findingSeverityEnum("severity").notNull(),
  category: findingCategoryEnum("category").notNull(),
  ruleId: text("rule_id").notNull(),
  file: text("file").notNull(),
  line: integer("line").notNull(),
  col: integer("col").notNull(),
  message: text("message").notNull(),
  fingerprint: text("fingerprint").notNull(),
});

/** M4a: per-finding LLM suggestions, mirroring the shared storage schema. */
export const suggestions = pgTable("suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  findingId: uuid("finding_id").references(() => findings.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  patchDiff: text("patch_diff").notNull(),
  explanation: text("explanation").notNull(),
  confidence: real("confidence").notNull(),
  accepted: boolean("accepted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Findings persisted per run (Spec آ§5: parser output capped per run). */
const MAX_FINDINGS_PER_RUN = 500;

const repositoryLogger = createLogger("run-repository");

export interface RunWithProject {
  run: WorkerRunRow;
  project: WorkerProjectRow;
}

export interface LogArchiveSizes {
  stdoutBytes: number;
  stderrBytes: number;
}

export interface FinalizeRunInput {
  s3ReportKey?: string | null;
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
   * M4b: S3 key of the archived report (`reports/<runId>/sft-report.json`),
   * or null when archival failed/skipped.
   */
  s3ReportKey?: string | null;
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
  /**
   * M3b: persist parsed findings for a run. Idempotent on the unique
   * (run_id, fingerprint) index; at most 500 rows per run.
   */
  insertFindings(runId: string, findings: FindingsWithFingerprint[]): Promise<void>;
  /** M4a: persist generated suggestions for a run. */
  insertSuggestions(runId: string, suggestions: GeneratedSuggestion[]): Promise<void>;
  /** M4a: fetch persisted findings by fingerprint so the AI stage can attach IDs. */
  getFindingsByFingerprints(runId: string, fingerprints: string[]): Promise<(FindingsWithFingerprint & { id: string })[]>;
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
          // M4b: only touch s3_report_key when provided.
          ...(input.s3ReportKey !== undefined ? { s3_report_key: input.s3ReportKey } : {}),
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

    async insertFindings(
      runId: string,
      parsed: FindingsWithFingerprint[],
    ): Promise<void> {
      if (parsed.length > MAX_FINDINGS_PER_RUN) {
        repositoryLogger.warn(
          `capping findings for run ${runId}: ${parsed.length} parsed, inserting first ${MAX_FINDINGS_PER_RUN}`,
        );
      }
      const rows = parsed.slice(0, MAX_FINDINGS_PER_RUN);
      if (rows.length === 0) return;
      await db
        .insert(findings)
        .values(
          rows.map((finding) => ({
            runId,
            severity: finding.severity,
            category: finding.category,
            ruleId: finding.ruleId,
            file: finding.file,
            line: finding.line,
            col: finding.col,
            message: finding.message,
            fingerprint: finding.fingerprint,
          })),
        )
        // Idempotent: redelivered jobs never double-insert a fingerprint.
        .onConflictDoNothing({ target: [findings.runId, findings.fingerprint] });
    },

    async getFindingsByFingerprints(
      runId: string,
      fingerprints: string[],
    ): Promise<(FindingsWithFingerprint & { id: string })[]> {
      if (fingerprints.length === 0) return [];
      const rows = await db
        .select({
          id: findings.id,
          severity: findings.severity,
          category: findings.category,
          ruleId: findings.ruleId,
          file: findings.file,
          line: findings.line,
          col: findings.col,
          message: findings.message,
          fingerprint: findings.fingerprint,
        })
        .from(findings)
        .where(
          and(eq(findings.runId, runId), inArray(findings.fingerprint, fingerprints)),
        );
      return rows as (FindingsWithFingerprint & { id: string })[];
    },

    async insertSuggestions(
      runId: string,
      newSuggestions: GeneratedSuggestion[],
    ): Promise<void> {
      if (newSuggestions.length === 0) return;
      // The `suggestions` table has no run_id column: rows are scoped to a run
      // through findings (FK on finding_id). `runId` stays in the signature for
      // call-site symmetry with insertFindings.
      await db
        .insert(suggestions)
        .values(
          newSuggestions.map((suggestion) => ({
            findingId: suggestion.findingId,
            model: suggestion.model,
            promptVersion: suggestion.promptVersion,
            patchDiff: suggestion.patchDiff,
            explanation: suggestion.explanation,
            confidence: suggestion.confidence,
            accepted: null,
          })),
        );
    },
  };
}
