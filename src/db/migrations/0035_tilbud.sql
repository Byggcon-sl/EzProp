-- Tilbud i stedet for ordre (ADR 0012, A318–A328): ordren får «gyldig til» (`valid_until`).
-- Rekkefølge: (1) ny kolonne som valgfri, (2) utfylling av alle rader, (3) påkrevd kolonne,
-- (4) indeks for tilbudslisten.
-- Migreringen kjøres i én transaksjon: stopper den, er ingenting endret.
-- Ingen rader slettes eller får ny status. Tabellen, kolonnene og statuskodene (`received`,
-- `converted`, `rejected`) er de samme som før. «Utløpt» lagres ikke; det regnes ut fra datoen.
ALTER TABLE "orders" ADD COLUMN "valid_until" date;--> statement-breakpoint
-- (2) Alle rader, også mykt slettede, gjort om og avslåtte: norsk dato for mottaket + 30 dager.
-- Tidssonen står i uttrykket, så svaret er det samme uansett hvilken tidssone databasen står i.
-- `row_version`, `updated_at` og `deleted_at` røres ikke (det finnes ingen triggere): ingen
-- ansatt har endret raden. Åpne ordre mottatt for mer enn 30 dager siden vises dermed som
-- «Utløpt» rett etter migreringen. Det er ønsket (ADR 0012 punkt 7).
UPDATE "orders"
SET "valid_until" = ("received_at" AT TIME ZONE 'Europe/Oslo')::date + 30;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "valid_until" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "orders_organization_id_status_valid_until_idx" ON "orders" USING btree ("organization_id","status","valid_until") WHERE "orders"."deleted_at" is null;
