CREATE TABLE "ai_usage_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"employee_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"assignment_id" uuid,
	"report_id" uuid,
	"target_ref" jsonb NOT NULL,
	"source_fields" jsonb NOT NULL,
	"input_summary" jsonb NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"output_text" text,
	"status" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"cost" numeric(12, 4) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'NOK' NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_usage_log_outcome_check" CHECK ("ai_usage_log"."outcome" in ('ok', 'no_match', 'error')),
	CONSTRAINT "ai_usage_log_status_check" CHECK ("ai_usage_log"."status" is null or "ai_usage_log"."status" in ('suggested', 'accepted', 'edited', 'rejected')),
	CONSTRAINT "ai_usage_log_error_code_check" CHECK ("ai_usage_log"."error_code" is null or ("ai_usage_log"."outcome" = 'error' and "ai_usage_log"."error_code" in ('timeout', 'rate_limited', 'unavailable', 'rejected', 'unknown'))),
	CONSTRAINT "ai_usage_log_outcome_status_check" CHECK (("ai_usage_log"."outcome" = 'ok' and "ai_usage_log"."status" is not null) or ("ai_usage_log"."outcome" <> 'ok' and "ai_usage_log"."status" is null and "ai_usage_log"."output_text" is null)),
	CONSTRAINT "ai_usage_log_tokens_check" CHECK ("ai_usage_log"."tokens_in" >= 0 and "ai_usage_log"."tokens_out" >= 0 and "ai_usage_log"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_employee_fk" FOREIGN KEY ("organization_id","employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_decided_by_fk" FOREIGN KEY ("organization_id","decided_by") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_log_organization_id_idx" ON "ai_usage_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_usage_log_open_target_idx" ON "ai_usage_log" USING btree ("organization_id","feature","target_ref") WHERE "ai_usage_log"."status" = 'suggested' and "ai_usage_log"."deleted_at" is null;