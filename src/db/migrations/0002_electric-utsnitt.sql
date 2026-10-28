-- Prøve fase 1, kandidat 2 (ElectricSQL). docs/funksjoner/fase1-kandidat-electricsql.md, avgjørelse C.
-- Ingen nye tabeller eller kolonner. drizzle-kit sporer verken replikaidentitet eller publikasjoner,
-- så filen er skrevet for hånd (som publikasjonen i 0001); 0002_snapshot.json er lik 0001.
--
-- REPLICA IDENTITY FULL: Electric trenger hele raden i endringsloggen for å følge oppdateringer og
-- slettinger. Settes her, så databaserollen Electric kjører med bare trenger SELECT på de tre
-- tabellene og REPLICATION, aldri eierskap (ellers ville Electric kjørt ALTER TABLE selv).
-- Koster mer WAL per oppdatering på tre prøvetabeller. PowerSync påvirkes ikke.
ALTER TABLE "trial_forms" REPLICA IDENTITY FULL;--> statement-breakpoint
ALTER TABLE "trial_answers" REPLICA IDENTITY FULL;--> statement-breakpoint
ALTER TABLE "trial_photos" REPLICA IDENTITY FULL;--> statement-breakpoint
-- Electrics egen publikasjon, ferdiglaget av samme grunn. Bare de tre trial-tabellene, aldri
-- FOR ALL TABLES: da ville brukere, sesjoner og engangskoder gått til synktjenesten. Kjører side om
-- side med publikasjonen "powersync" fra 0001 (hver tjeneste har sin egen replikeringsplass).
-- Krever ikke wal_level=logical, så den går også i testdatabasen og i Azure før parameteren er satt.
CREATE PUBLICATION "electric_publication_default" FOR TABLE "trial_forms", "trial_answers", "trial_photos";
