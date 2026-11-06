CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"assignment_id" uuid NOT NULL,
	"claim_type" text NOT NULL,
	"received_at" date NOT NULL,
	"claimant_party_id" uuid,
	"claimant_text" text,
	"description" text NOT NULL,
	"building_part_text" text,
	"outcome" text DEFAULT 'open' NOT NULL,
	"amount" integer,
	"closed_at" timestamp with time zone,
	CONSTRAINT "claims_claim_type_check" CHECK ("claims"."claim_type" in ('complaint', 'insurance_claim', 'other')),
	CONSTRAINT "claims_outcome_check" CHECK ("claims"."outcome" in ('open', 'rejected', 'upheld', 'settled', 'withdrawn')),
	CONSTRAINT "claims_amount_check" CHECK ("claims"."amount" is null or "claims"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claimant_party_fk" FOREIGN KEY ("claimant_party_id") REFERENCES "public"."assignment_parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_organization_id_id_idx" ON "claims" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "claims_organization_id_assignment_id_idx" ON "claims" USING btree ("organization_id","assignment_id");