ALTER TABLE "llm_calls" ADD COLUMN "rule_id" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD COLUMN "estimated_tokens_avoided" integer;