-- Badet på PC (docs/funksjoner/fase2a-badet-pc.md, docs/adr/0011-rapportens-datamodell.md).
-- Sju nye tabeller for rapporten, `standard_measures.applies_to_tg` (T-0060) og fremmednøkkel på
-- `ai_usage_log.report_id` (A158).
-- Rekkefølgen er rettet for hånd: de unike indeksene lages før fremmednøklene som peker på dem.
CREATE TABLE "checkpoint_results" (
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
	"checkpoint_id" uuid NOT NULL,
	"report_building_id" uuid,
	"room_id" uuid,
	"tg_direct" text,
	"description_text" text,
	"done" boolean DEFAULT false NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	CONSTRAINT "checkpoint_results_tg_direct_check" CHECK ("checkpoint_results"."tg_direct" is null or "checkpoint_results"."tg_direct" in ('0', '1', 'IU')),
	CONSTRAINT "checkpoint_results_place_check" CHECK (num_nonnulls("checkpoint_results"."report_building_id", "checkpoint_results"."room_id") = 1),
	CONSTRAINT "checkpoint_results_done_check" CHECK (("checkpoint_results"."done" and "checkpoint_results"."done_by" is not null and "checkpoint_results"."done_at" is not null) or (not "checkpoint_results"."done" and "checkpoint_results"."done_by" is null and "checkpoint_results"."done_at" is null))
);--> statement-breakpoint
CREATE TABLE "deviation_measures" (
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
	"deviation_id" uuid NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"text_source" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "deviation_measures_text_source_check" CHECK ("deviation_measures"."text_source" in ('template', 'edited', 'free'))
);--> statement-breakpoint
CREATE TABLE "deviations" (
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
	"checkpoint_result_id" uuid NOT NULL,
	"deviation_question_id" uuid,
	"outcome_id" uuid,
	"kind" text NOT NULL,
	"tg" integer,
	"deviation_text" text,
	"cause_criterion" text,
	"cause_text" text,
	"consequence_text" text,
	"cost_type" text DEFAULT 'none' NOT NULL,
	"cost_band_key" text,
	"cost_amount" integer,
	"cost_text" text,
	"measurement_value" numeric,
	"measurement_unit" text,
	"text_source" text NOT NULL,
	"suggested_by_rule_id" uuid,
	"ai_usage_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "deviations_kind_check" CHECK ("deviations"."kind" in ('tg', 'hms')),
	CONSTRAINT "deviations_tg_check" CHECK (("deviations"."kind" = 'hms' and "deviations"."tg" is null) or ("deviations"."kind" = 'tg' and ("deviations"."tg" is null or "deviations"."tg" in (2, 3)))),
	CONSTRAINT "deviations_outcome_question_check" CHECK ("deviations"."outcome_id" is null or "deviations"."deviation_question_id" is not null),
	CONSTRAINT "deviations_cause_criterion_check" CHECK ("deviations"."cause_criterion" is null or "deviations"."cause_criterion" in ('symptom_of_damage', 'age_uncertain_function', 'significant_deviation', 'functional_failure', 'danger_to_life_health', 'missing_documentation', 'other')),
	CONSTRAINT "deviations_cost_type_check" CHECK ("deviations"."cost_type" in ('band', 'approx', 'none')),
	CONSTRAINT "deviations_cost_check" CHECK (("deviations"."cost_type" = 'band' and "deviations"."cost_band_key" is not null and "deviations"."cost_amount" is null) or ("deviations"."cost_type" = 'approx' and "deviations"."cost_amount" is not null and "deviations"."cost_amount" > 0 and "deviations"."cost_band_key" is null) or ("deviations"."cost_type" = 'none' and "deviations"."cost_band_key" is null and "deviations"."cost_amount" is null)),
	CONSTRAINT "deviations_cost_band_key_check" CHECK ("deviations"."cost_band_key" is null or "deviations"."cost_band_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "deviations_measurement_unit_check" CHECK ("deviations"."measurement_unit" is null or "deviations"."measurement_unit" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "deviations_text_source_check" CHECK ("deviations"."text_source" in ('template', 'edited', 'free'))
);--> statement-breakpoint
CREATE TABLE "field_answers" (
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
	"element_id" uuid NOT NULL,
	"report_building_id" uuid,
	"room_id" uuid,
	"checkpoint_result_id" uuid,
	"repeat_index" integer DEFAULT 0 NOT NULL,
	"value_text" text,
	"value_number" numeric,
	"value_option_keys" text[],
	"ai_usage_id" uuid,
	CONSTRAINT "field_answers_repeat_index_check" CHECK ("field_answers"."repeat_index" >= 0)
);--> statement-breakpoint
CREATE TABLE "reports" (
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
	"template_version_id" uuid NOT NULL,
	"report_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "reports_report_type_check" CHECK ("reports"."report_type" in ('condition_report')),
	CONSTRAINT "reports_status_check" CHECK ("reports"."status" in ('draft', 'published', 'superseded'))
);--> statement-breakpoint
CREATE TABLE "rule_suggestion_decisions" (
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
	"checkpoint_result_id" uuid NOT NULL,
	"rule_key" text NOT NULL,
	"suggestion" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"lifespan_set_key" text,
	"threshold_set_key" text,
	"inspection_year" integer NOT NULL,
	"decision" text NOT NULL,
	"chosen_tg" text,
	"chosen_outcome_key" text,
	"override_reason" text,
	"deviation_id" uuid,
	"decided_by" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_suggestion_decisions_rule_key_check" CHECK ("rule_suggestion_decisions"."rule_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "rule_suggestion_decisions_suggestion_check" CHECK (jsonb_typeof("rule_suggestion_decisions"."suggestion") = 'object' and "rule_suggestion_decisions"."suggestion"->>'kind' in ('outcome', 'tgiu', 'tg0')),
	CONSTRAINT "rule_suggestion_decisions_reasons_check" CHECK (jsonb_typeof("rule_suggestion_decisions"."reasons") = 'array' and length("rule_suggestion_decisions"."reasons"::text) <= 16000),
	CONSTRAINT "rule_suggestion_decisions_inspection_year_check" CHECK ("rule_suggestion_decisions"."inspection_year" between 1900 and 2200),
	CONSTRAINT "rule_suggestion_decisions_decision_check" CHECK ("rule_suggestion_decisions"."decision" in ('accepted', 'changed', 'rejected')),
	CONSTRAINT "rule_suggestion_decisions_chosen_tg_check" CHECK ("rule_suggestion_decisions"."chosen_tg" is null or "rule_suggestion_decisions"."chosen_tg" in ('0', '1', '2', '3', 'IU')),
	CONSTRAINT "rule_suggestion_decisions_chosen_outcome_key_check" CHECK ("rule_suggestion_decisions"."chosen_outcome_key" is null or "rule_suggestion_decisions"."chosen_outcome_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "rule_suggestion_decisions_lifespan_set_key_check" CHECK ("rule_suggestion_decisions"."lifespan_set_key" is null or "rule_suggestion_decisions"."lifespan_set_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "rule_suggestion_decisions_threshold_set_key_check" CHECK ("rule_suggestion_decisions"."threshold_set_key" is null or "rule_suggestion_decisions"."threshold_set_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "rule_suggestion_decisions_override_reason_check" CHECK ("rule_suggestion_decisions"."decision" = 'accepted' or length(btrim(coalesce("rule_suggestion_decisions"."override_reason", ''))) > 0),
	CONSTRAINT "rule_suggestion_decisions_rejected_check" CHECK ("rule_suggestion_decisions"."decision" <> 'rejected' or ("rule_suggestion_decisions"."chosen_tg" is null and "rule_suggestion_decisions"."chosen_outcome_key" is null and "rule_suggestion_decisions"."deviation_id" is null))
);--> statement-breakpoint
CREATE TABLE "tgiu_details" (
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
	"checkpoint_result_id" uuid NOT NULL,
	"reason" text,
	"owner_informed" boolean,
	"owner_informed_at" timestamp with time zone,
	"alternative_check_method" text,
	"alternative_check_result" text,
	"risk_assessment" text,
	"construction_vulnerable" text,
	"how_to_examine" text,
	CONSTRAINT "tgiu_details_construction_vulnerable_check" CHECK ("tgiu_details"."construction_vulnerable" is null or "tgiu_details"."construction_vulnerable" in ('yes', 'no', 'unknown')),
	CONSTRAINT "tgiu_details_owner_informed_at_check" CHECK ("tgiu_details"."owner_informed_at" is null or "tgiu_details"."owner_informed" is true)
);--> statement-breakpoint
ALTER TABLE "standard_measures" ADD COLUMN "applies_to_tg" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoint_results_organization_id_report_id_id_idx" ON "checkpoint_results" USING btree ("organization_id","report_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoint_results_place_idx" ON "checkpoint_results" USING btree ("organization_id","report_id","checkpoint_id",coalesce("report_building_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("room_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "checkpoint_results"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "checkpoint_results_organization_id_room_id_idx" ON "checkpoint_results" USING btree ("organization_id","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deviation_measures_organization_id_report_id_id_idx" ON "deviation_measures" USING btree ("organization_id","report_id","id");--> statement-breakpoint
CREATE INDEX "deviation_measures_organization_id_deviation_id_idx" ON "deviation_measures" USING btree ("organization_id","deviation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deviations_organization_id_report_id_id_idx" ON "deviations" USING btree ("organization_id","report_id","id");--> statement-breakpoint
CREATE INDEX "deviations_organization_id_checkpoint_result_id_idx" ON "deviations" USING btree ("organization_id","checkpoint_result_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_answers_organization_id_report_id_id_idx" ON "field_answers" USING btree ("organization_id","report_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_answers_place_idx" ON "field_answers" USING btree ("organization_id","report_id","element_id",coalesce("report_building_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("room_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("checkpoint_result_id", '00000000-0000-0000-0000-000000000000'::uuid),"repeat_index") WHERE "field_answers"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "field_answers_organization_id_room_id_idx" ON "field_answers" USING btree ("organization_id","room_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_organization_id_id_idx" ON "reports" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_one_current_per_assignment_idx" ON "reports" USING btree ("organization_id","assignment_id") WHERE "reports"."deleted_at" is null and "reports"."status" <> 'superseded';--> statement-breakpoint
CREATE UNIQUE INDEX "rule_suggestion_decisions_organization_id_report_id_id_idx" ON "rule_suggestion_decisions" USING btree ("organization_id","report_id","id");--> statement-breakpoint
CREATE INDEX "rule_suggestion_decisions_checkpoint_result_rule_idx" ON "rule_suggestion_decisions" USING btree ("organization_id","checkpoint_result_id","rule_key","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tgiu_details_organization_id_report_id_id_idx" ON "tgiu_details" USING btree ("organization_id","report_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tgiu_details_one_per_checkpoint_result_idx" ON "tgiu_details" USING btree ("organization_id","checkpoint_result_id") WHERE "tgiu_details"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_log_organization_id_id_idx" ON "ai_usage_log" USING btree ("organization_id","id");--> statement-breakpoint
-- `ai_usage_log.report_id` har stått uten fremmednøkkel (A158), og KI-modulen har avvist alle
-- forespørsler med rapport-id. En verdi som likevel står der, kan ikke peke på en rapport
-- (tabellen er ny), og tømmes før nøkkelen legges på.
UPDATE "ai_usage_log" SET "report_id" = NULL WHERE "report_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "checkpoint_results" ADD CONSTRAINT "checkpoint_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoint_results" ADD CONSTRAINT "checkpoint_results_report_fk" FOREIGN KEY ("organization_id","report_id") REFERENCES "public"."reports"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoint_results" ADD CONSTRAINT "checkpoint_results_checkpoint_fk" FOREIGN KEY ("organization_id","checkpoint_id") REFERENCES "public"."checkpoints"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoint_results" ADD CONSTRAINT "checkpoint_results_report_building_fk" FOREIGN KEY ("organization_id","report_building_id") REFERENCES "public"."report_buildings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoint_results" ADD CONSTRAINT "checkpoint_results_room_fk" FOREIGN KEY ("organization_id","room_id") REFERENCES "public"."rooms"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoint_results" ADD CONSTRAINT "checkpoint_results_done_by_fk" FOREIGN KEY ("organization_id","done_by") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_measures" ADD CONSTRAINT "deviation_measures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_measures" ADD CONSTRAINT "deviation_measures_report_fk" FOREIGN KEY ("organization_id","report_id") REFERENCES "public"."reports"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_measures" ADD CONSTRAINT "deviation_measures_deviation_fk" FOREIGN KEY ("organization_id","report_id","deviation_id") REFERENCES "public"."deviations"("organization_id","report_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_report_fk" FOREIGN KEY ("organization_id","report_id") REFERENCES "public"."reports"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_checkpoint_result_fk" FOREIGN KEY ("organization_id","report_id","checkpoint_result_id") REFERENCES "public"."checkpoint_results"("organization_id","report_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_deviation_question_fk" FOREIGN KEY ("organization_id","deviation_question_id") REFERENCES "public"."deviation_questions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_outcome_fk" FOREIGN KEY ("organization_id","outcome_id") REFERENCES "public"."outcomes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_suggested_by_rule_fk" FOREIGN KEY ("organization_id","suggested_by_rule_id") REFERENCES "public"."rules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviations" ADD CONSTRAINT "deviations_ai_usage_fk" FOREIGN KEY ("organization_id","ai_usage_id") REFERENCES "public"."ai_usage_log"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_answers" ADD CONSTRAINT "field_answers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_answers" ADD CONSTRAINT "field_answers_report_fk" FOREIGN KEY ("organization_id","report_id") REFERENCES "public"."reports"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_answers" ADD CONSTRAINT "field_answers_element_fk" FOREIGN KEY ("organization_id","element_id") REFERENCES "public"."template_elements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_answers" ADD CONSTRAINT "field_answers_report_building_fk" FOREIGN KEY ("organization_id","report_building_id") REFERENCES "public"."report_buildings"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_answers" ADD CONSTRAINT "field_answers_room_fk" FOREIGN KEY ("organization_id","room_id") REFERENCES "public"."rooms"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_answers" ADD CONSTRAINT "field_answers_checkpoint_result_fk" FOREIGN KEY ("organization_id","report_id","checkpoint_result_id") REFERENCES "public"."checkpoint_results"("organization_id","report_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_answers" ADD CONSTRAINT "field_answers_ai_usage_fk" FOREIGN KEY ("organization_id","ai_usage_id") REFERENCES "public"."ai_usage_log"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_template_version_fk" FOREIGN KEY ("organization_id","template_version_id") REFERENCES "public"."template_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suggestion_decisions" ADD CONSTRAINT "rule_suggestion_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suggestion_decisions" ADD CONSTRAINT "rule_suggestion_decisions_report_fk" FOREIGN KEY ("organization_id","report_id") REFERENCES "public"."reports"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suggestion_decisions" ADD CONSTRAINT "rule_suggestion_decisions_checkpoint_result_fk" FOREIGN KEY ("organization_id","report_id","checkpoint_result_id") REFERENCES "public"."checkpoint_results"("organization_id","report_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suggestion_decisions" ADD CONSTRAINT "rule_suggestion_decisions_deviation_fk" FOREIGN KEY ("organization_id","report_id","deviation_id") REFERENCES "public"."deviations"("organization_id","report_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suggestion_decisions" ADD CONSTRAINT "rule_suggestion_decisions_decided_by_fk" FOREIGN KEY ("organization_id","decided_by") REFERENCES "public"."employees"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tgiu_details" ADD CONSTRAINT "tgiu_details_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tgiu_details" ADD CONSTRAINT "tgiu_details_report_fk" FOREIGN KEY ("organization_id","report_id") REFERENCES "public"."reports"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tgiu_details" ADD CONSTRAINT "tgiu_details_checkpoint_result_fk" FOREIGN KEY ("organization_id","report_id","checkpoint_result_id") REFERENCES "public"."checkpoint_results"("organization_id","report_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_report_fk" FOREIGN KEY ("organization_id","report_id") REFERENCES "public"."reports"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_measures" ADD CONSTRAINT "standard_measures_applies_to_tg_check" CHECK ("standard_measures"."applies_to_tg" is null or "standard_measures"."applies_to_tg" in (2, 3));
