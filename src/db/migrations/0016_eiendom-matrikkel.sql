CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"address" text NOT NULL,
	"postal_code" text,
	"city" text,
	"municipality_number" text,
	"municipality_name" text,
	"housing_type" text NOT NULL,
	"ownership_form" text NOT NULL,
	"data_source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "properties_housing_type_check" CHECK ("properties"."housing_type" in ('detached', 'semi_detached', 'terraced', 'apartment', 'apartment_in_house', 'holiday_home', 'farm', 'other')),
	CONSTRAINT "properties_ownership_form_check" CHECK ("properties"."ownership_form" in ('freehold', 'section', 'cooperative', 'share')),
	CONSTRAINT "properties_data_source_check" CHECK ("properties"."data_source" in ('manual'))
);
--> statement-breakpoint
CREATE TABLE "cadastral_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"property_id" uuid NOT NULL,
	"gnr" text NOT NULL,
	"bnr" text NOT NULL,
	"fnr" text,
	"snr" text,
	"association_name" text,
	"association_org_number" text,
	"share_number" text
);
--> statement-breakpoint
CREATE TABLE "common_areas" (
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
	"managing_agent" text,
	"condition_report_status" text DEFAULT 'unknown' NOT NULL,
	"maintenance_plan_status" text DEFAULT 'unknown' NOT NULL,
	"notes" text,
	CONSTRAINT "common_areas_condition_report_status_check" CHECK ("common_areas"."condition_report_status" in ('yes', 'no', 'unknown')),
	CONSTRAINT "common_areas_maintenance_plan_status_check" CHECK ("common_areas"."maintenance_plan_status" in ('yes', 'no', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "property_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "properties_organization_id_id_idx" ON "properties" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadastral_units" ADD CONSTRAINT "cadastral_units_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadastral_units" ADD CONSTRAINT "cadastral_units_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_areas" ADD CONSTRAINT "common_areas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "common_areas" ADD CONSTRAINT "common_areas_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cadastral_units_organization_id_property_id_idx" ON "cadastral_units" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "common_areas_active_assignment_idx" ON "common_areas" USING btree ("organization_id","assignment_id") WHERE "common_areas"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_property_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE no action ON UPDATE no action;