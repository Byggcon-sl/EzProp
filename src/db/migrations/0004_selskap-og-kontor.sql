CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"legal_name" text NOT NULL,
	"org_number" text,
	"vat_registered" boolean DEFAULT true NOT NULL,
	"address" text,
	"postal_code" text,
	"city" text,
	"company_text" text,
	"liability_insurer" text,
	"liability_policy_number" text,
	"liability_valid_to" date,
	CONSTRAINT "companies_org_number_format_check" CHECK ("companies"."org_number" is null or "companies"."org_number" ~ '^[0-9]{9}$')
);
--> statement-breakpoint
CREATE TABLE "offices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "company_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "office_id" uuid;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_organization_id_id_idx" ON "companies" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_organization_id_org_number_idx" ON "companies" USING btree ("organization_id","org_number") WHERE "companies"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "offices_organization_id_id_idx" ON "offices" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "offices_organization_id_name_idx" ON "offices" USING btree ("organization_id","name") WHERE "offices"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_fk" FOREIGN KEY ("organization_id","company_id") REFERENCES "public"."companies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_office_fk" FOREIGN KEY ("organization_id","office_id") REFERENCES "public"."offices"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_or_deactivated_check" CHECK ("employees"."user_id" is not null or "employees"."deactivated_at" is not null);