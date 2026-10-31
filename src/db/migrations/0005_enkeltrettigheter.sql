CREATE UNIQUE INDEX "employees_organization_id_id_idx" ON "employees" USING btree ("organization_id","id");--> statement-breakpoint
CREATE TABLE "employee_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"employee_id" uuid NOT NULL,
	"permission" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_permissions" ADD CONSTRAINT "employee_permissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_permissions" ADD CONSTRAINT "employee_permissions_employee_fk" FOREIGN KEY ("organization_id","employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_permissions_employee_id_permission_idx" ON "employee_permissions" USING btree ("employee_id","permission") WHERE "employee_permissions"."deleted_at" is null;