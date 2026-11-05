-- Indeksene lages før fremmednøklene: den sammensatte nøkkelen trenger den unike indeksen
-- (organization_id, id) på firms.
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text,
	"phone" text,
	"firm_id" uuid,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "contacts_source_check" CHECK ("contacts"."source" in ('manual', 'order'))
);
--> statement-breakpoint
CREATE TABLE "firms" (
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
	"org_number" text,
	"firm_type" text DEFAULT 'broker_firm' NOT NULL,
	"notes" text,
	CONSTRAINT "firms_firm_type_check" CHECK ("firms"."firm_type" in ('broker_firm', 'insurer', 'housing_association', 'other')),
	CONSTRAINT "firms_org_number_check" CHECK ("firms"."org_number" is null or "firms"."org_number" ~ '^[0-9]{9}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_organization_id_id_idx" ON "contacts" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE INDEX "contacts_organization_id_name_idx" ON "contacts" USING btree ("organization_id","last_name","first_name");
--> statement-breakpoint
CREATE UNIQUE INDEX "firms_organization_id_id_idx" ON "firms" USING btree ("organization_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "firms_organization_id_org_number_idx" ON "firms" USING btree ("organization_id","org_number") WHERE "firms"."org_number" is not null and "firms"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX "firms_organization_id_name_idx" ON "firms" USING btree ("organization_id","name");
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_firm_fk" FOREIGN KEY ("organization_id","firm_id") REFERENCES "public"."firms"("organization_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "firms" ADD CONSTRAINT "firms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;