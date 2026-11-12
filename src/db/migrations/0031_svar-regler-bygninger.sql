ALTER TABLE "rooms" DROP CONSTRAINT "rooms_area_type_check";--> statement-breakpoint
ALTER TABLE "rules" DROP CONSTRAINT "rules_purpose_check";--> statement-breakpoint
ALTER TABLE "rule_conditions" ADD COLUMN "negate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_area_type_check" CHECK ("rooms"."area_type" in ('bra_i', 'bra_e', 'bra_b', 'not_bra'));--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_purpose_check" CHECK ("rules"."purpose" in ('show', 'suggest_outcome', 'suggest_tgiu', 'validate', 'suggest_tg0'));