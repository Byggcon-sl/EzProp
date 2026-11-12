ALTER TABLE "outcomes" ADD COLUMN "default_cause_text" text;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "text_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "standard_measures" ADD COLUMN "text_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_text_status_check" CHECK ("outcomes"."text_status" in ('draft', 'approved'));--> statement-breakpoint
ALTER TABLE "standard_measures" ADD CONSTRAINT "standard_measures_text_status_check" CHECK ("standard_measures"."text_status" in ('draft', 'approved'));