CREATE TABLE "work_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"assignment_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	CONSTRAINT "work_sessions_phase_check" CHECK ("work_sessions"."phase" in ('preparation', 'inspection', 'office', 'delivery')),
	CONSTRAINT "work_sessions_period_check" CHECK ("work_sessions"."ended_at" >= "work_sessions"."started_at")
);
--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_employee_fk" FOREIGN KEY ("organization_id","employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_sessions_organization_id_assignment_id_employee_id_ended_at_idx" ON "work_sessions" USING btree ("organization_id","assignment_id","employee_id","ended_at");