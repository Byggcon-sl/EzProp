-- Vask før KI (docs/funksjoner/fase2a-vask-for-ki.md): nytt utfall «blocked» og antall vaskede
-- treff. Bare ny kolonne og sjekker; ingen rader slettes, gamle rader får 0.
ALTER TABLE "ai_usage_log" DROP CONSTRAINT "ai_usage_log_outcome_check";--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD COLUMN "redacted_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_redacted_count_check" CHECK ("ai_usage_log"."redacted_count" >= 0);--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_outcome_check" CHECK ("ai_usage_log"."outcome" in ('ok', 'no_match', 'error', 'blocked'));