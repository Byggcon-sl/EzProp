-- Mulig dublett (T3): uttrykksindekser for oppslaget i src/core/orders/duplicate-sql.ts.
-- Uttrykkene er nøyaktig de samme som der (A291). Bare IMMUTABLE-funksjoner.
CREATE INDEX "orders_organization_id_address_key_idx" ON "orders" USING btree ("organization_id", (nullif(regexp_replace(translate(split_part(address_text, ',', 1), 'ABCDEFGHIJKLMNOPQRSTUVWXYZÆØÅ', 'abcdefghijklmnopqrstuvwxyzæøå'), '[^a-z0-9æøå]', '', 'g'), '')));--> statement-breakpoint
CREATE INDEX "orders_organization_id_cadastre_key_idx" ON "orders" USING btree ("organization_id", (nullif(ltrim(regexp_replace(gnr, '[ \t\n\r\u00a0]', '', 'g'), '0'), '')), (nullif(ltrim(regexp_replace(bnr, '[ \t\n\r\u00a0]', '', 'g'), '0'), '')));
