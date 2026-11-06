CREATE TABLE "client_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"firm_id" uuid NOT NULL,
	"name" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"premise_text" text,
	"report_profile_code" text,
	CONSTRAINT "client_agreements_valid_range_check" CHECK ("client_agreements"."valid_to" is null or "client_agreements"."valid_to" >= "client_agreements"."valid_from")
);
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "client_agreement_id" uuid;--> statement-breakpoint
ALTER TABLE "client_agreements" ADD CONSTRAINT "client_agreements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_agreements" ADD CONSTRAINT "client_agreements_firm_fk" FOREIGN KEY ("organization_id","firm_id") REFERENCES "public"."firms"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_agreements_organization_id_id_idx" ON "client_agreements" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "client_agreements_organization_id_firm_id_idx" ON "client_agreements" USING btree ("organization_id","firm_id") WHERE "client_agreements"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_client_agreement_fk" FOREIGN KEY ("organization_id","client_agreement_id") REFERENCES "public"."client_agreements"("organization_id","id") ON DELETE no action ON UPDATE no action;