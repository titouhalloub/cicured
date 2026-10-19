import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { webhookDeliveries } from "./schema";
import {
  failureKindEnum,
  findingCategoryEnum,
  findingSeverityEnum,
  logStreamEnum,
  projects,
  runStatusEnum,
  runTriggerEnum,
  users,
} from "./schema";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null until the worker resolves HEAD (M2). */
    sha: text("sha"),
    branch: text("branch").notNull(),
    trigger: runTriggerEnum("trigger").notNull(),
    status: runStatusEnum("status").notNull().default("queued"),
    exitCode: integer("exit_code"),
    failureKind: failureKindEnum("failure_kind"),
    /** Additive vs §5 sketch: queue ordering for the runs list. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    buildMinutes: integer("build_minutes"),
    s3LogKey: text("s3_log_key"),
    s3ReportKey: text("s3_report_key"),
  },
  (table) => [
    index("runs_project_created_idx").on(table.projectId, table.createdAt.desc()),
    index("runs_status_idx").on(table.status),
  ],
);

export const findings = pgTable(
  "findings",
  {
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
    /** sha256(rule_id ‖ file ‖ line-bucket ‖ message-normalized) — Spec §5. */
    fingerprint: text("fingerprint").notNull(),
  },
  (table) => [
    uniqueIndex("findings_run_fingerprint_uq").on(table.runId, table.fingerprint),
    index("findings_fingerprint_idx").on(table.fingerprint),
  ],
);

export const suggestions = pgTable(
  "suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    patchDiff: text("patch_diff").notNull(),
    explanation: text("explanation").notNull(),
    confidence: real("confidence").notNull(),
    /** Null until the user accepts/rejects (feedback loop, Spec §4 step 11). */
    accepted: boolean("accepted"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("suggestions_finding_idx").on(table.findingId)],
);

/**
 * Log archive segment metadata (kickoff §14 deliverable 3). Postgres never
 * stores log bodies - full streams live in S3 with a 30-day TTL (Spec §2/§8);
 * this table exists so TTL purges and SSE replays can find the segments.
 */
export const logs = pgTable(
  "logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    stream: logStreamEnum("stream").notNull(),
    sequence: integer("sequence").notNull(),
    s3Key: text("s3_key").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("logs_run_stream_seq_uq").on(table.runId, table.stream, table.sequence)],
);

/**
 * Local CLI LLM usage ledger uploaded by `sft sync` (POST /usage/llm-calls,
 * open-core Phase 3). One row per LLM call the CLI recorded in
 * `.sft/llm-calls.jsonl` — this is what powers the per-user spend view.
 *
 * `runId` is advisory: it is NULL when the local record carried no run id, an
 * unknown/placeholder uuid, or a run the user no longer owns.
 */
export const llmCalls = pgTable("llm_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  mode: text("mode").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  totalCostUsd: numeric("total_cost_usd", { precision: 12, scale: 6 }).notNull(),
  durationMs: integer("duration_ms").notNull(),
  // Finding context from the CLI ledger — nullable so older ledgers still sync.
  ruleId: text("rule_id"),
  category: text("category"),
  estimatedTokensAvoided: integer("estimated_tokens_avoided"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;
export type ProjectRow = typeof projects.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type SuggestionRow = typeof suggestions.$inferSelect;
export type LogRow = typeof logs.$inferSelect;
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect;
export type LlmCallRow = typeof llmCalls.$inferSelect;
