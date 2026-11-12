ALTER TABLE "rule_conditions" ADD COLUMN "threshold_key" text;--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD COLUMN "age_year_element_key" text;--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD COLUMN "age_fallback_year_element_key" text;--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD COLUMN "age_source_element_key" text;--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD COLUMN "documentation_element_key" text;--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD COLUMN "material_element_key" text;--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD COLUMN "unit_element_key" text;--> statement-breakpoint
-- Tre tilstander erstatter ja/nei (ADR 0009). Eksisterende testsaker beholder betydningen:
-- true -> 'triggered', false -> 'not_triggered'. Gjelder også myk-slettede rader.
ALTER TABLE "rule_test_cases" ADD COLUMN "expected_state" text;--> statement-breakpoint
UPDATE "rule_test_cases" SET "expected_state" = CASE WHEN "expect_triggered" THEN 'triggered' ELSE 'not_triggered' END;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ALTER COLUMN "expected_state" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD COLUMN "inspection_year" integer;--> statement-breakpoint
ALTER TABLE "rule_test_cases" DROP COLUMN "expect_triggered";--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_threshold_key_check" CHECK ("rule_conditions"."threshold_key" is null or "rule_conditions"."threshold_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_age_year_element_key_check" CHECK ("rule_conditions"."age_year_element_key" is null or "rule_conditions"."age_year_element_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_age_fallback_year_element_key_check" CHECK ("rule_conditions"."age_fallback_year_element_key" is null or "rule_conditions"."age_fallback_year_element_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_age_source_element_key_check" CHECK ("rule_conditions"."age_source_element_key" is null or "rule_conditions"."age_source_element_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_documentation_element_key_check" CHECK ("rule_conditions"."documentation_element_key" is null or "rule_conditions"."documentation_element_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_material_element_key_check" CHECK ("rule_conditions"."material_element_key" is null or "rule_conditions"."material_element_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD CONSTRAINT "rule_conditions_unit_element_key_check" CHECK ("rule_conditions"."unit_element_key" is null or "rule_conditions"."unit_element_key" ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$');--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_expected_state_check" CHECK ("rule_test_cases"."expected_state" in ('triggered', 'not_triggered', 'not_evaluated'));--> statement-breakpoint
ALTER TABLE "rule_test_cases" ADD CONSTRAINT "rule_test_cases_inspection_year_check" CHECK ("rule_test_cases"."inspection_year" is null or "rule_test_cases"."inspection_year" between 1900 and 2200);