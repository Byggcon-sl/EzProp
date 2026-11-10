CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"version_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"mandatory" boolean DEFAULT false NOT NULL,
	"regulation_ref" text,
	"gives_tg" boolean DEFAULT true NOT NULL,
	"scope" text DEFAULT 'building' NOT NULL,
	"room_type_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"applies_to_unit" text DEFAULT 'both' NOT NULL,
	"related_checkpoint_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "checkpoints_key_check" CHECK ("checkpoints"."key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "checkpoints_group_check" CHECK ("checkpoints"."group" in ('exterior', 'interior', 'room', 'technical', 'site')),
	CONSTRAINT "checkpoints_scope_check" CHECK ("checkpoints"."scope" in ('building', 'room')),
	CONSTRAINT "checkpoints_applies_to_unit_check" CHECK ("checkpoints"."applies_to_unit" in ('unit', 'common', 'both'))
);--> statement-breakpoint

CREATE TABLE "deviation_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "deviation_questions_key_check" CHECK ("deviation_questions"."key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$')
);--> statement-breakpoint

CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"deviation_question_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"deviation_text" text,
	"default_cause_criterion" text,
	"default_consequence_text" text,
	"source_ref" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "outcomes_key_check" CHECK ("outcomes"."key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "outcomes_kind_not_tgiu_check" CHECK ("outcomes"."kind" <> 'tgiu'),
	CONSTRAINT "outcomes_kind_check" CHECK ("outcomes"."kind" in ('tg2', 'tg3', 'hms', 'choose_tg2_tg3')),
	CONSTRAINT "outcomes_default_cause_criterion_check" CHECK ("outcomes"."default_cause_criterion" is null or "outcomes"."default_cause_criterion" in ('symptom_of_damage', 'age_uncertain_function', 'significant_deviation', 'functional_failure', 'danger_to_life_health', 'missing_documentation', 'other'))
);--> statement-breakpoint

CREATE TABLE "rule_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"rule_id" uuid NOT NULL,
	"group_no" integer,
	"type" text NOT NULL,
	"element_key" text,
	"checkpoint_key" text,
	"operator" text,
	"value" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rule_conditions_type_check" CHECK ("rule_conditions"."type" in ('always', 'option_selected', 'number_vs_limit', 'age_vs_lifespan', 'build_year', 'room_type', 'below_ground', 'housing_type', 'ownership_form', 'field_filled', 'snow_covered', 'building_type', 'checkpoint_tg', 'photo_missing', 'tgiu_set')),
	CONSTRAINT "rule_conditions_operator_check" CHECK ("rule_conditions"."operator" is null or "rule_conditions"."operator" in ('eq', 'in', 'gt', 'gte', 'lt', 'lte', 'before', 'after')),
	CONSTRAINT "rule_conditions_group_no_check" CHECK ("rule_conditions"."group_no" is null or "rule_conditions"."group_no" >= 1),
	CONSTRAINT "rule_conditions_element_key_check" CHECK ("rule_conditions"."element_key" is null or "rule_conditions"."element_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "rule_conditions_checkpoint_key_check" CHECK ("rule_conditions"."checkpoint_key" is null or "rule_conditions"."checkpoint_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$')
);--> statement-breakpoint

CREATE TABLE "rule_test_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"rule_id" uuid NOT NULL,
	"name" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expect_triggered" boolean NOT NULL,
	"expected_outcome_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rule_test_cases_input_check" CHECK (jsonb_typeof("rule_test_cases"."input") = 'object')
);--> statement-breakpoint

CREATE TABLE "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"purpose" text NOT NULL,
	"match" text DEFAULT 'all' NOT NULL,
	"target_element_id" uuid,
	"target_question_id" uuid,
	"target_section_id" uuid,
	"target_checkpoint_id" uuid,
	"suggested_outcome_id" uuid,
	"validation_code" text,
	"severity" text,
	"message" text,
	"source_ref" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rules_key_check" CHECK ("rules"."key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "rules_purpose_check" CHECK ("rules"."purpose" in ('show', 'suggest_outcome', 'suggest_tgiu', 'validate')),
	CONSTRAINT "rules_match_check" CHECK ("rules"."match" in ('all', 'any')),
	CONSTRAINT "rules_severity_check" CHECK ("rules"."severity" is null or "rules"."severity" in ('blocker', 'warning'))
);--> statement-breakpoint

CREATE TABLE "standard_measures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"outcome_id" uuid NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);--> statement-breakpoint

CREATE TABLE "template_element_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"element_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"material_code" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "template_element_options_key_check" CHECK ("template_element_options"."key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$')
);--> statement-breakpoint

CREATE TABLE "template_elements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"version_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"checkpoint_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"multiple" boolean DEFAULT false NOT NULL,
	"unit" text,
	"min_value" numeric,
	"max_value" numeric,
	"decimals" integer,
	"table_columns" jsonb,
	"phrase_slot" text,
	"required" boolean DEFAULT false NOT NULL,
	"default_value" jsonb,
	"help_text" text,
	"show_in_report" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "template_elements_key_check" CHECK ("template_elements"."key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "template_elements_field_type_check" CHECK ("template_elements"."field_type" in ('text', 'checkbox', 'choice', 'number', 'date', 'photo', 'signature', 'table', 'phrase')),
	CONSTRAINT "template_elements_phrase_slot_check" CHECK ("template_elements"."phrase_slot" is null or "template_elements"."phrase_slot" in ('description', 'deviation', 'cause', 'consequence', 'measure', 'cost_text', 'summary')),
	CONSTRAINT "template_elements_decimals_check" CHECK ("template_elements"."decimals" is null or "template_elements"."decimals" >= 0),
	CONSTRAINT "template_elements_value_range_check" CHECK ("template_elements"."min_value" is null or "template_elements"."max_value" is null or "template_elements"."min_value" <= "template_elements"."max_value"),
	CONSTRAINT "template_elements_table_columns_check" CHECK ("template_elements"."table_columns" is null or jsonb_typeof("template_elements"."table_columns") = 'array')
);--> statement-breakpoint

CREATE TABLE "template_families" (
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
	"kind" text NOT NULL,
	"report_type" text DEFAULT 'condition_report' NOT NULL,
	CONSTRAINT "template_families_kind_check" CHECK ("template_families"."kind" in ('system', 'custom')),
	CONSTRAINT "template_families_report_type_check" CHECK ("template_families"."report_type" in ('condition_report'))
);--> statement-breakpoint

CREATE TABLE "template_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"parent_section_id" uuid,
	"title" text NOT NULL,
	"repeat" text DEFAULT 'once' NOT NULL,
	"room_type_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"optional" boolean DEFAULT false NOT NULL,
	"standard_text" text,
	"help_text" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "template_sections_key_check" CHECK ("template_sections"."key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$'),
	CONSTRAINT "template_sections_repeat_check" CHECK ("template_sections"."repeat" in ('once', 'per_building', 'per_room'))
);--> statement-breakpoint

CREATE TABLE "template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"family_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_from" date,
	"ns_edition" text,
	"regulation_version" text,
	"based_on_version_id" uuid,
	"change_note" text,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "template_versions_status_check" CHECK ("template_versions"."status" in ('draft', 'published', 'retired')),
	CONSTRAINT "template_versions_version_number_check" CHECK ("template_versions"."version_number" >= 1),
	CONSTRAINT "template_versions_published_at_check" CHECK ("template_versions"."status" = 'draft' or "template_versions"."published_at" is not null)
);--> statement-breakpoint

CREATE UNIQUE INDEX "checkpoints_organization_id_id_idx" ON "checkpoints" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_version_id_key_idx" ON "checkpoints" USING btree ("version_id","key") WHERE "checkpoints"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "checkpoints_organization_id_section_id_idx" ON "checkpoints" USING btree ("organization_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deviation_questions_organization_id_id_idx" ON "deviation_questions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "deviation_questions_checkpoint_id_key_idx" ON "deviation_questions" USING btree ("checkpoint_id","key") WHERE "deviation_questions"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_organization_id_id_idx" ON "outcomes" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_deviation_question_id_key_idx" ON "outcomes" USING btree ("deviation_question_id","key") WHERE "outcomes"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "rule_conditions_organization_id_rule_id_idx" ON "rule_conditions" USING btree ("organization_id","rule_id");--> statement-breakpoint
CREATE INDEX "rule_test_cases_organization_id_rule_id_idx" ON "rule_test_cases" USING btree ("organization_id","rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_organization_id_id_idx" ON "rules" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "rules_version_id_key_idx" ON "rules" USING btree ("version_id","key") WHERE "rules"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "standard_measures_organization_id_outcome_id_idx" ON "standard_measures" USING btree ("organization_id","outcome_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_element_options_element_id_key_idx" ON "template_element_options" USING btree ("element_id","key") WHERE "template_element_options"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "template_elements_organization_id_id_idx" ON "template_elements" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_elements_version_id_key_idx" ON "template_elements" USING btree ("version_id","key") WHERE "template_elements"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "template_elements_organization_id_section_id_idx" ON "template_elements" USING btree ("organization_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_families_organization_id_id_idx" ON "template_families" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_sections_organization_id_id_idx" ON "template_sections" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_sections_version_id_key_idx" ON "template_sections" USING btree ("version_id","key") WHERE "template_sections"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_organization_id_id_idx" ON "template_versions" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_family_id_version_number_idx" ON "template_versions" USING btree ("family_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "template_versions_one_draft_per_family_idx" ON "template_versions" USING btree ("family_id") WHERE "template_versions"."status" = 'draft' and "template_versions"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_version_fk" FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."template_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_section_fk" FOREIGN KEY ("organization_id","section_id") REFERENCES "public"."template_sections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_questions" ADD CONSTRAINT "deviation_questions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deviation_questions" ADD CONSTRAINT "deviation_questions_checkpoint_fk" FOREIGN KEY ("organization_id","checkpoint_id") REFERENCES "public"."checkpoints"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_deviation_question_fk" FOREIGN KEY ("organization_id","deviation_question_id") REFERENCES "public"."deviation_questions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_rule_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."rules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_rule_fk" FOREIGN KEY ("organization_id","rule_id") REFERENCES "public"."rules"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_expected_outcome_fk" FOREIGN KEY ("organization_id","expected_outcome_id") REFERENCES "public"."outcomes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_version_fk" FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."template_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_target_element_fk" FOREIGN KEY ("organization_id","target_element_id") REFERENCES "public"."template_elements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_target_question_fk" FOREIGN KEY ("organization_id","target_question_id") REFERENCES "public"."deviation_questions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_target_section_fk" FOREIGN KEY ("organization_id","target_section_id") REFERENCES "public"."template_sections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_target_checkpoint_fk" FOREIGN KEY ("organization_id","target_checkpoint_id") REFERENCES "public"."checkpoints"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_suggested_outcome_fk" FOREIGN KEY ("organization_id","suggested_outcome_id") REFERENCES "public"."outcomes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_measures" ADD CONSTRAINT "standard_measures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_measures" ADD CONSTRAINT "standard_measures_outcome_fk" FOREIGN KEY ("organization_id","outcome_id") REFERENCES "public"."outcomes"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_element_options" ADD CONSTRAINT "template_element_options_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_element_options" ADD CONSTRAINT "template_element_options_element_fk" FOREIGN KEY ("organization_id","element_id") REFERENCES "public"."template_elements"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_elements" ADD CONSTRAINT "template_elements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_elements" ADD CONSTRAINT "template_elements_version_fk" FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."template_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_elements" ADD CONSTRAINT "template_elements_section_fk" FOREIGN KEY ("organization_id","section_id") REFERENCES "public"."template_sections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_elements" ADD CONSTRAINT "template_elements_checkpoint_fk" FOREIGN KEY ("organization_id","checkpoint_id") REFERENCES "public"."checkpoints"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_families" ADD CONSTRAINT "template_families_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_version_fk" FOREIGN KEY ("organization_id","version_id") REFERENCES "public"."template_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_sections" ADD CONSTRAINT "template_sections_parent_fk" FOREIGN KEY ("organization_id","parent_section_id") REFERENCES "public"."template_sections"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_family_fk" FOREIGN KEY ("organization_id","family_id") REFERENCES "public"."template_families"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_based_on_fk" FOREIGN KEY ("organization_id","based_on_version_id") REFERENCES "public"."template_versions"("organization_id","id") ON DELETE no action ON UPDATE no action;