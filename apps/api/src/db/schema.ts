import {
  FAILURE_KINDS,
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  RUN_STATUSES,
  RUN_TRIGGERS,
} from "@sft/schemas";
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * drizzle's pgEnum requires a non-empty tuple literal; the enum *values* stay
 * sourced from @sft/schemas (Spec §5 / .clinerules: one source of truth).
 */
const asTuple = <T extends string>(values: readonly T[]): [T, ...T[]] =>
  values as unknown as [T, ...T[]];

export const providerEnum = pgEnum("provider", ["github"]);
export const runStatusEnum = pgEnum("run_status", asTuple(RUN_STATUSES));
export const failureKindEnum = pgEnum("failure_kind", asTuple(FAILURE_KINDS));
export const runTriggerEnum = pgEnum("run_trigger", asTuple(RUN_TRIGGERS));
export const findingCategoryEnum = pgEnum("finding_category", asTuple(FINDING_CATEGORIES));
export const findingSeverityEnum = pgEnum("finding_severity", asTuple(FINDING_SEVERITIES));
export const logStreamEnum = pgEnum("log_stream", ["stdout", "stderr"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").unique(),
    provider: providerEnum("provider").notNull().default("github"),
    /** Provider-side identity (additive vs §5 sketch: required to upsert logins). */
    providerUserId: text("provider_user_id").notNull(),
    /** Plan tiers are post-MVP (§13); keep it free-form text until billing exists. */
    plan: text("plan").notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_provider_identity_uq").on(table.provider, table.providerUserId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: providerEnum("provider").notNull().default("github"),
    repoFullName: text("repo_full_name").notNull(),
    /** GitHub App installation id, AES-256-GCM encrypted (Spec §5 `installation_id(enc)`). */
    installationIdEnc: text("installation_id_enc").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    /** Set when webhook registration lands in M2/M5. */
    webhookId: bigint("webhook_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("projects_provider_repo_uq").on(table.provider, table.repoFullName),
    index("projects_user_idx").on(table.userId),
  ],
);

export const projectEnvVars = pgTable(
  "project_env_vars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** AES-256-GCM encrypted value; never stored or logged in plaintext. */
    valueEnc: text("value_enc").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("project_env_vars_project_key_uq").on(table.projectId, table.key)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: providerEnum("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    payloadSha256: text("payload_sha256").notNull(),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_provider_delivery_uq").on(
      table.provider,
      table.deliveryId,
    ),
  ],
);
