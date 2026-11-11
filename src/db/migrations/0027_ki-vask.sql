ALTER TABLE "ai_usage_log" DROP CONSTRAINT "ai_usage_log_outcome_check";--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN "redacted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_redacted_count_check" CHECK ("ai_usage_log"."redacted_count" >= 0);--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_blocked_check" CHECK ("ai_usage_log"."outcome" <> 'blocked' or ("ai_usage_log"."status" is null and "ai_usage_log"."output_text" is null and "ai_usage_log"."error_code" is null));--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_outcome_check" CHECK ("ai_usage_log"."outcome" in ('ok', 'no_match', 'error', 'blocked'));