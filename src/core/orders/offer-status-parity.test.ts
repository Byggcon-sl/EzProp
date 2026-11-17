import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { todayInOslo } from "@/shared/lib/dates";
import { OFFER_LIST_FILTERS } from "./codes";
import {
  isOfferExpired,
  offerDisplayStatus,
  offerExpiredSql,
  offerListFilterSql,
} from "./offer-status";
import { EXPIRY_CASES } from "../../../tests/offer-expiry-cases";

/*
 * Paritet mellom utløpsregelen i TypeScript og SQL-uttrykket (testplan 3.1, ADR 0012 punkt 4–5).
 * Sakene er de samme som i `offer-status.test.ts`, også rundt midnatt norsk tid vinter og sommer.
 * Uttrykket kjøres mot en `values`-liste som heter `orders`, så ingen rader trengs.
 *
 * Støtter hovedmål: de ansatte (listen og merket på siden sier det samme) og færre reklamasjoner
 * (et tilbud er aldri åpent ett sted og utløpt et annet).
 */

async function sqlExpired(status: string, validUntil: string, today: string): Promise<boolean> {
  const rows = await db.execute<{ expired: boolean }>(sql`
    select (${offerExpiredSql(today)}) as expired
    from (values (${status}::text, ${validUntil}::date)) as orders(status, valid_until)`);
  return rows[0]!.expired;
}

async function sqlFilters(status: string, validUntil: string, today: string) {
  const matches: string[] = [];
  for (const filter of OFFER_LIST_FILTERS) {
    const where = offerListFilterSql(filter, today) ?? sql`true`;
    const rows = await db.execute<{ hit: boolean }>(sql`
      select (${where}) as hit
      from (values (${status}::text, ${validUntil}::date)) as orders(status, valid_until)`);
    if (rows[0]!.hit) matches.push(filter);
  }
  return matches;
}

describe("3.1 paritet TS mot SQL", () => {
  it.each(EXPIRY_CASES)("$name", async ({ status, validUntil, now }) => {
    const today = todayInOslo(now);
    expect(await sqlExpired(status, validUntil, today)).toBe(
      isOfferExpired(status, validUntil, today),
    );
    // Hvert tilbud er i nøyaktig ett filter pluss «Alle», og det er visningsstatusen
    expect(await sqlFilters(status, validUntil, today)).toEqual(
      OFFER_LIST_FILTERS.filter(
        (filter) => filter === "all" || filter === offerDisplayStatus(status, validUntil, today),
      ),
    );
  });

  it("3.1.2 én klokke: uttrykkene og dublettspørringen bruker aldri databasens klokke", () => {
    const files = [
      join(__dirname, "offer-status.ts"),
      join(__dirname, "../assignments/booking/duplicate-sql.ts"),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8").toLowerCase();
      for (const clock of ["now()", "current_date", "localtimestamp", "current_timestamp"]) {
        expect(source, `${file}: ${clock}`).not.toContain(clock);
      }
    }
  });

  it("3.1.2 today er en parameter i SQL-teksten, ikke en bokstavelig dato", () => {
    const query = db
      .select({ expired: offerExpiredSql("2026-11-03") })
      .from(sql`(values ('received'::text, '2026-11-01'::date)) as orders(status, valid_until)`)
      .toSQL();
    expect(query.sql).not.toContain("2026-11-03");
    expect(query.params).toContain("2026-11-03");
  });
});
