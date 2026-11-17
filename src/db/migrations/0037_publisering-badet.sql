-- Publisering av badet (docs/funksjoner/fase2a-publisering-badet.md, docs/adr/0015-publisering-og-utgivelser.md).
-- To nye tabeller: `report_releases` (utgivelser, låst for alltid) og `publish_check_results`
-- (funnene fra sjekken før publisering, bare nye rader), og en unik indeks på
-- `certifications (organization_id, id)` som mål for fremmednøkkelen fra utgivelsen.
-- Endrer ingen eksisterende rader. Rapporter som alt har status `published`, røres ikke.
-- Rekkefølgen er rettet for hånd: de unike indeksene lages før fremmednøklene som peker på dem.
CREATE TABLE "report_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"report_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"released_at" timestamp with time zone NOT NULL,
	"released_by" uuid NOT NULL,
	"signed_by_employee_id" uuid NOT NULL,
	"certification_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"original_release_date" date NOT NULL,
	"valid_until" date,
	"snapshot" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	CONSTRAINT "report_releases_version_number_check" CHECK ("report_releases"."version_number" >= 1),
	CONSTRAINT "report_releases_snapshot_check" CHECK (jsonb_typeof("report_releases"."snapshot") = 'object' and jsonb_typeof("report_releases"."snapshot"->'schema_version') = 'number'),
	CONSTRAINT "report_releases_content_hash_check" CHECK ("report_releases"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "report_releases_retain_until_check" CHECK ("report_releases"."retain_until" > "report_releases"."released_at")
);
--> statement-breakpoint
CREATE TABLE "publish_check_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"report_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"check_code" text NOT NULL,
	"severity" text NOT NULL,
	"source" text DEFAULT 'rule' NOT NULL,
	"target_ref" jsonb NOT NULL,
	"overridden" boolean DEFAULT false NOT NULL,
	"overridden_by" uuid,
	"overridden_at" timestamp with time zone,
	"override_reason_code" text,
	"override_reason" text,
	CONSTRAINT "publish_check_results_check_code_check" CHECK ("publish_check_results"."check_code" in ('mandatory_without_tg', 'tg2_tg3_missing_cause_or_consequence', 'tg3_missing_cost', 'wet_or_below_ground_missing_hole', 'bra_missing', 'electrical_missing', 'inspection_date_missing', 'tg2_tg3_missing_measure', 'cost_amount_not_rounded', 'hms_missing_consequence_or_measure', 'tgiu_details_missing', 'tgiu_suggested_not_set', 'no_findings_with_reading_over_limit', 'suggestion_no_longer_applies', 'texts_written_for_other_tg', 'tg3_on_age_only', 'ai_suggestion_pending', 'hole_reading_missing')),
	CONSTRAINT "publish_check_results_severity_check" CHECK ("publish_check_results"."severity" in ('blocker', 'warning')),
	CONSTRAINT "publish_check_results_source_check" CHECK ("publish_check_results"."source" in ('rule', 'ai')),
	CONSTRAINT "publish_check_results_severity_code_check" CHECK (("publish_check_results"."severity" = 'blocker') = ("publish_check_results"."check_code" in ('mandatory_without_tg', 'tg2_tg3_missing_cause_or_consequence', 'tg3_missing_cost', 'wet_or_below_ground_missing_hole', 'bra_missing', 'electrical_missing', 'inspection_date_missing'))),
	CONSTRAINT "publish_check_results_ai_warning_only_check" CHECK ("publish_check_results"."source" <> 'ai' or "publish_check_results"."severity" = 'warning'),
	CONSTRAINT "publish_check_results_target_ref_check" CHECK (jsonb_typeof("publish_check_results"."target_ref") = 'object'),
	CONSTRAINT "publish_check_results_overridden_check" CHECK ("publish_check_results"."overridden" = ("publish_check_results"."severity" = 'blocker')),
	CONSTRAINT "publish_check_results_override_fields_check" CHECK (("publish_check_results"."overridden" and "publish_check_results"."overridden_by" is not null and "publish_check_results"."overridden_at" is not null and "publish_check_results"."override_reason_code" is not null) or (not "publish_check_results"."overridden" and "publish_check_results"."overridden_by" is null and "publish_check_results"."overridden_at" is null and "publish_check_results"."override_reason_code" is null and "publish_check_results"."override_reason" is null)),
	CONSTRAINT "publish_check_results_override_reason_code_check" CHECK ("publish_check_results"."override_reason_code" is null or "publish_check_results"."override_reason_code" in ('no_access_or_refused', 'not_applicable_to_room', 'described_elsewhere', 'other')),
	CONSTRAINT "publish_check_results_override_reason_check" CHECK (("publish_check_results"."override_reason_code" is distinct from 'other' or "publish_check_results"."override_reason" is not null) and ("publish_check_results"."override_reason" is null or (length(btrim("publish_check_results"."override_reason")) > 0 and length("publish_check_results"."override_reason") <= 1000)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "report_releases_organization_id_report_id_id_idx" ON "report_releases" USING btree ("organization_id","report_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_releases_organization_id_report_id_version_number_idx" ON "report_releases" USING btree ("organization_id","report_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "certifications_organization_id_id_idx" ON "certifications" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "publish_check_results" ADD CONSTRAINT "publish_check_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_check_results" ADD CONSTRAINT "publish_check_results_release_fk" FOREIGN KEY ("organization_id","report_id","release_id") REFERENCES "public"."report_releases"("organization_id","report_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_check_results" ADD CONSTRAINT "publish_check_results_overridden_by_fk" FOREIGN KEY ("organization_id","overridden_by") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_releases" ADD CONSTRAINT "report_releases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_releases" ADD CONSTRAINT "report_releases_report_fk" FOREIGN KEY ("organization_id","report_id") REFERENCES "public"."reports"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_releases" ADD CONSTRAINT "report_releases_released_by_fk" FOREIGN KEY ("organization_id","released_by") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_releases" ADD CONSTRAINT "report_releases_signed_by_employee_fk" FOREIGN KEY ("organization_id","signed_by_employee_id") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_releases" ADD CONSTRAINT "report_releases_certification_fk" FOREIGN KEY ("organization_id","certification_id") REFERENCES "public"."certifications"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_releases" ADD CONSTRAINT "report_releases_company_fk" FOREIGN KEY ("organization_id","company_id") REFERENCES "public"."companies"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publish_check_results_organization_id_report_id_release_id_idx" ON "publish_check_results" USING btree ("organization_id","report_id","release_id");--> statement-breakpoint
CREATE INDEX "publish_check_results_overridden_idx" ON "publish_check_results" USING btree ("organization_id","created_at") WHERE "publish_check_results"."overridden";
