CREATE TABLE "override_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"month" text NOT NULL,
	"text" text,
	"status" text DEFAULT 'empty' NOT NULL,
	"source" text,
	"ai_usage_log_id" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	CONSTRAINT "override_summaries_month_check" CHECK ("override_summaries"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "override_summaries_status_check" CHECK ("override_summaries"."status" in ('empty', 'accepted', 'edited', 'manual', 'rejected')),
	CONSTRAINT "override_summaries_source_check" CHECK ("override_summaries"."source" is null or "override_summaries"."source" in ('ai', 'manual')),
	CONSTRAINT "override_summaries_text_check" CHECK ("override_summaries"."text" is null or (length(btrim("override_summaries"."text")) > 0 and length("override_summaries"."text") <= 2000)),
	CONSTRAINT "override_summaries_status_text_check" CHECK (("override_summaries"."status" in ('accepted', 'edited', 'manual')) = ("override_summaries"."text" is not null)),
	CONSTRAINT "override_summaries_status_source_check" CHECK (("override_summaries"."status" = 'empty' and "override_summaries"."source" is null and "override_summaries"."ai_usage_log_id" is null) or ("override_summaries"."status" = 'manual' and "override_summaries"."source" is not distinct from 'manual' and "override_summaries"."ai_usage_log_id" is null) or ("override_summaries"."status" in ('accepted', 'edited', 'rejected') and "override_summaries"."source" is not distinct from 'ai' and "override_summaries"."ai_usage_log_id" is not null)),
	CONSTRAINT "override_summaries_decided_check" CHECK (("override_summaries"."status" = 'empty' and "override_summaries"."decided_by" is null and "override_summaries"."decided_at" is null) or ("override_summaries"."status" <> 'empty' and "override_summaries"."decided_by" is not null and "override_summaries"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "checkpoint_key" text;--> statement-breakpoint
ALTER TABLE "override_summaries" ADD CONSTRAINT "override_summaries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "override_summaries" ADD CONSTRAINT "override_summaries_ai_usage_log_fk" FOREIGN KEY ("organization_id","ai_usage_log_id") REFERENCES "public"."ai_usage_log"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "override_summaries" ADD CONSTRAINT "override_summaries_decided_by_fk" FOREIGN KEY ("organization_id","decided_by") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "override_summaries_organization_id_month_idx" ON "override_summaries" USING btree ("organization_id","month") WHERE "override_summaries"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_checkpoint_key_check" CHECK ("claims"."checkpoint_key" is null or "claims"."checkpoint_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');--> statement-breakpoint
ALTER TABLE "ai_usage_log" DROP CONSTRAINT "ai_usage_log_error_code_check";--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_error_code_check" CHECK ("ai_usage_log"."error_code" is null or ("ai_usage_log"."outcome" = 'error' and "ai_usage_log"."error_code" in ('timeout', 'rate_limited', 'unavailable', 'rejected', 'unknown')) or ("ai_usage_log"."outcome" = 'stopped' and "ai_usage_log"."error_code" in ('tg_guard', 'coverage_guard', 'number_guard', 'placeholder_guard', 'guess_guard', 'name_guard')));
