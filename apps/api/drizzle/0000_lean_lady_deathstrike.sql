CREATE TYPE "public"."failure_kind" AS ENUM('task_failure', 'runner_crash', 'timeout', 'cancelled', 'oom');--> statement-breakpoint
CREATE TYPE "public"."finding_category" AS ENUM('build', 'typecheck', 'lint', 'test');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('error', 'warning', 'info');--> statement-breakpoint
CREATE TYPE "public"."log_stream" AS ENUM('stdout', 'stderr');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('github');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'success', 'failed', 'runner_crash', 'timeout', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('push', 'manual', 'pr');--> statement-breakpoint
CREATE TABLE "project_env_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider" DEFAULT 'github' NOT NULL,
	"repo_full_name" text NOT NULL,
	"installation_id_enc" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"webhook_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"provider" "provider" DEFAULT 'github' NOT NULL,
	"provider_user_id" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "provider" NOT NULL,
	"delivery_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload_sha256" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"category" "finding_category" NOT NULL,
	"rule_id" text NOT NULL,
	"file" text NOT NULL,
	"line" integer NOT NULL,
	"col" integer NOT NULL,
	"message" text NOT NULL,
	"fingerprint" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"stream" "log_stream" NOT NULL,
	"sequence" integer NOT NULL,
	"s3_key" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"sha" text,
	"branch" text NOT NULL,
	"trigger" "run_trigger" NOT NULL,
	"status" "run_status" DEFAULT 'queued' NOT NULL,
	"exit_code" integer,
	"failure_kind" "failure_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"build_minutes" integer,
	"s3_log_key" text,
	"s3_report_key" text
);
--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"finding_id" uuid NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"patch_diff" text NOT NULL,
	"explanation" text NOT NULL,
	"confidence" real NOT NULL,
	"accepted" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_env_vars" ADD CONSTRAINT "project_env_vars_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logs" ADD CONSTRAINT "logs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_env_vars_project_key_uq" ON "project_env_vars" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_provider_repo_uq" ON "projects" USING btree ("provider","repo_full_name");--> statement-breakpoint
CREATE INDEX "projects_user_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_identity_uq" ON "users" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_provider_delivery_uq" ON "webhook_deliveries" USING btree ("provider","delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "findings_run_fingerprint_uq" ON "findings" USING btree ("run_id","fingerprint");--> statement-breakpoint
CREATE INDEX "findings_fingerprint_idx" ON "findings" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "logs_run_stream_seq_uq" ON "logs" USING btree ("run_id","stream","sequence");--> statement-breakpoint
CREATE INDEX "runs_project_created_idx" ON "runs" USING btree ("project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "suggestions_finding_idx" ON "suggestions" USING btree ("finding_id");