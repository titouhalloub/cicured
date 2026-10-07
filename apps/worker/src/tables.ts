import { FAILURE_KINDS, RUN_STATUSES, RUN_TRIGGERS } from "@sft/schemas";
import {
  bigint,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The worker only ever reads/updates two tables, so it declares the columns it
 * touches instead of importing the whole API app (D1). The definitions mirror
 * apps/api/src/db/{schema,tables}.ts one-for-one; `test/schema-parity.spec.ts`
 * fails if the two ever drift. Extracting a shared `@sft/db` package is a
 * post-M2a cleanup.
 *
 * Enum *values* still come from @sft/schemas (.clinerules: one source of truth).
 */
const asTuple = <T extends string>(values: readonly T[]): [T, ...T[]] =>
  values as unknown as [T, ...T[]];

export const runStatusEnum = pgEnum("run_status", asTuple(RUN_STATUSES));
export const failureKindEnum = pgEnum("failure_kind", asTuple(FAILURE_KINDS));
export const runTriggerEnum = pgEnum("run_trigger", asTuple(RUN_TRIGGERS));

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(),
  repoFullName: text("repo_full_name").notNull(),
  /** AES-256-GCM ciphertext of the GitHub App installation id (Spec §5/§8). */
  installationIdEnc: text("installation_id_enc").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  branch: text("branch").notNull(),
  trigger: runTriggerEnum("trigger").notNull(),
  status: runStatusEnum("status").notNull().default("queued"),
  exitCode: integer("exit_code"),
  failureKind: failureKindEnum("failure_kind"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  buildMinutes: integer("build_minutes"),
  s3_log_key: text("s3_log_key"),
});

/**
 * Log archive segment metadata (mirrors apps/api/src/db/tables.ts `logs`).
 * Postgres never stores log bodies — this table exists so TTL purges and SSE
 * replays can find the S3 segments. The worker inserts one row per non-empty
 * stream (sequence 0) when it finalizes a run.
 */
export const logStreamEnum = pgEnum("log_stream", ["stdout", "stderr"]);

export const logs = pgTable("logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  stream: logStreamEnum("stream").notNull(),
  sequence: integer("sequence").notNull(),
  s3Key: text("s3_key").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkerProjectRow = typeof projects.$inferSelect;
export type WorkerRunRow = typeof runs.$inferSelect;
export type WorkerLogRow = typeof logs.$inferSelect;