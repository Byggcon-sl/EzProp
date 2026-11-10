-- PowerSync og ElectricSQL er fjernet (ADR 0004, godkjent av Ståle 10.11.2026). Synken er egenbygd
-- og trenger verken logisk replikering, publikasjoner eller hele raden i endringsloggen.
-- Skrevet for hånd: drizzle-kit sporer ikke publikasjoner eller replikaidentitet (som 0001 og 0002).
DROP PUBLICATION IF EXISTS "powersync";--> statement-breakpoint
DROP PUBLICATION IF EXISTS "electric_publication_default";--> statement-breakpoint
ALTER TABLE "trial_forms" REPLICA IDENTITY DEFAULT;--> statement-breakpoint
ALTER TABLE "trial_answers" REPLICA IDENTITY DEFAULT;--> statement-breakpoint
ALTER TABLE "trial_photos" REPLICA IDENTITY DEFAULT;--> statement-breakpoint
-- Ubrukte replikeringsplasser fra synktjenestene i denne databasen (finnes bare der tjenestene har
-- kjørt, for eksempel på Macen). En plass som blir liggende, holder på WAL og fyller disken.
-- Plasser i bruk og plasser i andre databaser røres ikke. Mangler rollen rettigheten, hoppes
-- ryddingen over uten feil.
DO $$
BEGIN
  PERFORM pg_drop_replication_slot(slot_name)
  FROM pg_replication_slots
  WHERE database = current_database()
    AND slot_type = 'logical'
    AND NOT active
    AND (slot_name LIKE 'powersync%' OR slot_name LIKE 'electric_slot%');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Hoppet over rydding av replikeringsplasser (mangler rettighet).';
END
$$;
