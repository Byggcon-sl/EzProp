CREATE TABLE "certifications" (
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
	"area" text NOT NULL,
	"issuer" text,
	"certificate_number" text,
	"valid_from" date,
	"valid_to" date NOT NULL,
	CONSTRAINT "certifications_valid_from_before_valid_to_check" CHECK ("certifications"."valid_from" is null or "certifications"."valid_from" <= "certifications"."valid_to")
);
--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certifications" ADD CONSTRAINT "certifications_employee_fk" FOREIGN KEY ("organization_id","employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certifications_organization_id_employee_id_idx" ON "certifications" USING btree ("organization_id","employee_id");