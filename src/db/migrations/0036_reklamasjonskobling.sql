-- Reklamasjonskoblingen (ADR 0013, A419–A430, Ståles svar 10.11.2026 nr. 38).
-- (1) Ny tabell `claim_reinspections`: kobler en sak til oppdraget for ny befaring. Sammensatte
--     fremmednøkler holder sak og oppdrag i samme organisasjon. Ingen ON DELETE CASCADE (regel 3).
--     Et oppdrag hører til høyst én aktiv kobling (unik delindeks på ikke-slettede rader).
-- (2) Ny sakstype `inquiry` («Henvendelse»): CHECK-regelen på `claims.claim_type` byttes med
--     drop og add. Den nye listen har alle de gamle kodene, så saker som finnes fra før, består.
-- Migreringen kjøres i én transaksjon: stopper den, er ingenting endret. Ingen rader endres.
CREATE TABLE "claim_reinspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"claim_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" DROP CONSTRAINT "claims_claim_type_check";--> statement-breakpoint
ALTER TABLE "claim_reinspections" ADD CONSTRAINT "claim_reinspections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_reinspections" ADD CONSTRAINT "claim_reinspections_claim_fk" FOREIGN KEY ("organization_id","claim_id") REFERENCES "public"."claims"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_reinspections" ADD CONSTRAINT "claim_reinspections_assignment_fk" FOREIGN KEY ("organization_id","assignment_id") REFERENCES "public"."assignments"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_reinspections_organization_id_assignment_id_idx" ON "claim_reinspections" USING btree ("organization_id","assignment_id") WHERE "claim_reinspections"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "claim_reinspections_organization_id_claim_id_idx" ON "claim_reinspections" USING btree ("organization_id","claim_id");--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_claim_type_check" CHECK ("claims"."claim_type" in ('inquiry', 'complaint', 'insurance_claim', 'other'));