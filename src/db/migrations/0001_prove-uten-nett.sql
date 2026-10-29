CREATE TABLE "trial_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"trial_form_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" jsonb,
	"text_state" text,
	"device_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"trial_form_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text,
	"storage_path" text,
	"uploaded_at" timestamp with time zone,
	"device_id" text
);
--> statement-breakpoint
ALTER TABLE "trial_answers" ADD CONSTRAINT "trial_answers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_answers" ADD CONSTRAINT "trial_answers_trial_form_id_trial_forms_id_fk" FOREIGN KEY ("trial_form_id") REFERENCES "public"."trial_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_forms" ADD CONSTRAINT "trial_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_photos" ADD CONSTRAINT "trial_photos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_photos" ADD CONSTRAINT "trial_photos_trial_form_id_trial_forms_id_fk" FOREIGN KEY ("trial_form_id") REFERENCES "public"."trial_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trial_answers_organization_id_idx" ON "trial_answers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_answers_trial_form_id_field_key_idx" ON "trial_answers" USING btree ("trial_form_id","field_key");--> statement-breakpoint
CREATE INDEX "trial_forms_organization_id_idx" ON "trial_forms" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "trial_photos_organization_id_idx" ON "trial_photos" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "trial_photos_trial_form_id_field_key_idx" ON "trial_photos" USING btree ("trial_form_id","field_key");--> statement-breakpoint
-- Publikasjon for synktjenesten (PowerSync, prøve fase 1). Bare de tre trial-tabellene, aldri
-- FOR ALL TABLES: da ville brukere, sesjoner og engangskoder gått til synktjenesten.
-- drizzle-kit sporer ikke publikasjoner, så denne linjen holdes for hånd. Krever ikke
-- wal_level=logical, så den går også i testdatabasen og i Azure før parameteren er satt.
CREATE PUBLICATION "powersync" FOR TABLE "trial_forms", "trial_answers", "trial_photos";
