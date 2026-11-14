-- Oppdraget eier bestillingsopplysningene (ADR 0011, A292, A293, A296).
-- Rekkefølge: (1) kontroll, (2) nye kolonner som valgfrie, (3) utfylling fra ordren, ellers fra
-- eiendommen, (4) påkrevde kolonner, (5) fremmednøkler, regler og indekser.
-- Migreringen kjøres i én transaksjon: stopper den, er ingenting endret.
--
-- (1) Et oppdrag uten ordre og uten eiendom med adresse kan ikke få adresse. Da stopper
-- migreringen før noe endres. Meldingen har bare antallet, aldri opplysninger om oppdraget.
DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*) INTO missing
  FROM "assignments" a
  WHERE NOT EXISTS (
      SELECT 1 FROM "orders" o
      WHERE o."organization_id" = a."organization_id"
        AND (o."id" = a."order_id" OR o."assignment_id" = a."id")
        AND length(trim(o."address_text")) > 0
    )
    AND NOT EXISTS (
      SELECT 1 FROM "properties" p
      WHERE p."organization_id" = a."organization_id"
        AND p."id" = a."property_id"
        AND length(trim(p."address")) > 0
    );
  IF missing > 0 THEN
    RAISE EXCEPTION 'Migrering 0034 stoppet: % oppdrag har verken ordre eller eiendom med adresse. Ingenting er endret. Legg inn eiendom med adresse på disse oppdragene, og kjør migreringen på nytt.', missing;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "external_ref" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "ordered_by_text" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "ordered_by_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "ordered_by_firm_id" uuid;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "address_text" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "gnr" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "bnr" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "snr" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "housing_association_name" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "seller_declaration_received" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "creation_key" uuid;--> statement-breakpoint
-- (3a) Fra ordren oppdraget kom fra. Flere ordre på samme oppdrag skal ikke finnes; skjer det
-- likevel, brukes en ordre som ikke er slettet, og så den eldste. `row_version` og `updated_at`
-- røres ikke: opplysningene om oppdraget er de samme som før, de har bare fått ny plass.
UPDATE "assignments" a
SET "received_at" = src."received_at",
    "source" = src."source",
    "external_ref" = src."external_ref",
    "ordered_by_text" = src."ordered_by_text",
    "ordered_by_contact_id" = src."ordered_by_contact_id",
    "ordered_by_firm_id" = src."ordered_by_firm_id",
    "address_text" = src."address_text",
    "gnr" = src."gnr",
    "bnr" = src."bnr",
    "snr" = src."snr",
    "housing_association_name" = src."housing_association_name",
    "seller_declaration_received" = src."seller_declaration_received"
FROM (
  SELECT DISTINCT ON (a2."id")
    a2."id" AS "target_id",
    o."received_at", o."source", o."external_ref", o."ordered_by_text",
    o."ordered_by_contact_id", o."ordered_by_firm_id", o."address_text",
    o."gnr", o."bnr", o."snr", o."housing_association_name", o."seller_declaration_received"
  FROM "assignments" a2
  JOIN "orders" o
    ON o."organization_id" = a2."organization_id"
   AND (o."id" = a2."order_id" OR o."assignment_id" = a2."id")
  WHERE length(trim(o."address_text")) > 0
  ORDER BY a2."id", (o."deleted_at" IS NOT NULL), o."received_at", o."id"
) src
WHERE a."id" = src."target_id";--> statement-breakpoint
-- (3b) Oppdrag uten ordre (skal ikke finnes i dag): adressen fra eiendommen.
UPDATE "assignments" a
SET "address_text" = concat_ws(', ', trim(p."address"), nullif(trim(concat_ws(' ', p."postal_code", p."city")), ''))
FROM "properties" p
WHERE a."address_text" IS NULL
  AND p."organization_id" = a."organization_id"
  AND p."id" = a."property_id"
  AND length(trim(p."address")) > 0;--> statement-breakpoint
-- (3c) Mottatt for oppdrag uten ordre: da oppdraget ble laget.
UPDATE "assignments" SET "received_at" = "created_at" WHERE "received_at" IS NULL;--> statement-breakpoint
-- (4) Påkrevd fra nå (A296). Kontrollen i (1) sikrer at alle rader har adresse.
ALTER TABLE "assignments" ALTER COLUMN "received_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "received_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "address_text" SET NOT NULL;--> statement-breakpoint
-- (5) Fremmednøkler, regler og indekser.
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_ordered_by_contact_fk" FOREIGN KEY ("organization_id","ordered_by_contact_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_ordered_by_firm_fk" FOREIGN KEY ("organization_id","ordered_by_firm_id") REFERENCES "public"."firms"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_source_check" CHECK ("assignments"."source" in ('manual', 'email'));--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_organization_id_creation_key_idx" ON "assignments" USING btree ("organization_id","creation_key");--> statement-breakpoint
CREATE INDEX "assignments_organization_id_ordered_by_contact_id_idx" ON "assignments" USING btree ("organization_id","ordered_by_contact_id");--> statement-breakpoint
CREATE INDEX "assignments_organization_id_ordered_by_firm_id_idx" ON "assignments" USING btree ("organization_id","ordered_by_firm_id");--> statement-breakpoint
-- Mulig dublett på oppdraget: uttrykksindekser med nøyaktig samme uttrykk som for `orders` i 0033
-- (tekstene står i src/core/assignments/booking/duplicate-sql.ts). Bare IMMUTABLE-funksjoner.
CREATE INDEX "assignments_organization_id_address_key_idx" ON "assignments" USING btree ("organization_id", (nullif(regexp_replace(translate(split_part(address_text, ',', 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ', 'abcdefghijklmnopqrstuvwxyzæøå'), '[^a-z0-9æøå]', '', 'g'), '')));--> statement-breakpoint
CREATE INDEX "assignments_organization_id_cadastre_key_idx" ON "assignments" USING btree ("organization_id", (nullif(ltrim(regexp_replace(gnr, '[ \t\n\r\u00a0]', '', 'g'), '0'), '')), (nullif(ltrim(regexp_replace(bnr, '[ \t\n\r\u00a0]', '', 'g'), '0'), '')));
