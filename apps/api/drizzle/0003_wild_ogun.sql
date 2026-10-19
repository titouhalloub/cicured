ALTER TABLE "llm_calls" ADD COLUMN "finding_id" text;--> statement-breakpoint
CREATE INDEX "llm_calls_finding_idx" ON "llm_calls" USING btree ("finding_id");