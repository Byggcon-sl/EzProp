CREATE TABLE "assignment_team_members" (
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
	"team_role" text NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone,
	"handed_over_reason" text,
	CONSTRAINT "assignment_team_members_team_role_check" CHECK ("assignment_team_members"."team_role" in ('responsible', 'co_responsible', 'inspector', 'peer_reviewer', 'office')),
	CONSTRAINT "assignment_team_members_period_check" CHECK ("assignment_team_members"."to_at" is null or "assignment_team_members"."to_at" >= "assignment_team_members"."from_at"),
	CONSTRAINT "assignment_team_members_reason_length_check" CHECK ("assignment_team_members"."handed_over_reason" is null or length("assignment_team_members"."handed_over_reason") <= 300)
);
--> statement-breakpoint
CREATE TABLE "assignment_parties" (
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
	"role" text NOT NULL,
	"name" text NOT NULL,
	"firm_name" text,
	"email" text,
	"phone" text,
	"receives_report" boolean DEFAULT false NOT NULL,
	"receives_invoice" boolean DEFAULT false NOT NULL,
	"receives_messages" boolean DEFAULT false NOT NULL,
	CONSTRAINT "assignment_parties_role_check" CHECK ("assignment_parties"."role" in ('broker', 'seller', 'buyer', 'seller_representative', 'invoice_recipient'))
);
--> statement-breakpoint
ALTER TABLE "assignment_team_members" ADD CONSTRAINT "assignment_team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_team_members" ADD CONSTRAINT "assignment_team_members_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_team_members" ADD CONSTRAINT "assignment_team_members_employee_fk" FOREIGN KEY ("organization_id","employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_parties" ADD CONSTRAINT "assignment_parties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment_parties" ADD CONSTRAINT "assignment_parties_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_team_members_organization_id_assignment_id_idx" ON "assignment_team_members" USING btree ("organization_id","assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignment_team_members_active_role_idx" ON "assignment_team_members" USING btree ("organization_id","assignment_id","team_role") WHERE "assignment_team_members"."to_at" is null and "assignment_team_members"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "assignment_parties_organization_id_assignment_id_idx" ON "assignment_parties" USING btree ("organization_id","assignment_id");