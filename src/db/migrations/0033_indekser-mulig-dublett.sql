-- Varsel om mulig dublett (T3, A291): uttrykksindekser for adressenøkkel og matrikkel på ordren.
-- Skrevet for hånd: uttrykkene står i src/core/orders/duplicate-sql.ts (ORDER_ADDRESS_KEY_SQL,
-- ORDER_GNR_KEY_SQL, ORDER_BNR_KEY_SQL) og må være nøyaktig like her, ellers bruker spørringen ikke
-- indeksen. Paritetstesten (duplicates-parity.test.ts) sjekker det. Bare IMMUTABLE-funksjoner, så
-- indeksen tåler eksisterende rader med tom adresse, «,» eller tom gnr.
CREATE INDEX "orders_organization_id_address_key_idx" ON "orders" USING btree ("organization_id", (nullif(regexp_replace(lower(split_part(address_text, ',', 1)), '[^[:alnum:]]', '', 'g'), ''))) WHERE "orders"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "orders_organization_id_gnr_bnr_key_idx" ON "orders" USING btree ("organization_id", (nullif(ltrim(regexp_replace(gnr, '[[:space:]]', '', 'g'), '0'), '')), (nullif(ltrim(regexp_replace(bnr, '[[:space:]]', '', 'g'), '0'), ''))) WHERE "orders"."deleted_at" is null;
