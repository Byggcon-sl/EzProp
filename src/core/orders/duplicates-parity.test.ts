import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { ADDRESS_CASES, CADASTRE_NUMBER_CASES } from "../../../tests/duplicate-cases";
import { createOrder, createOrganization, resetDatabase } from "../../../tests/factories";
import {
  ORDER_ADDRESS_KEY_SQL,
  ORDER_BNR_KEY_SQL,
  ORDER_GNR_KEY_SQL,
  ORDER_SNR_KEY_SQL,
} from "./duplicate-sql";
import { normalizeAddressKey, normalizeCadastreNumber } from "./index";

/*
 * Paritet mellom TS og SQL for regelen om mulig dublett (T3). Testplan:
 * docs/funksjoner/fase2a-varsel-dublett-testplan.md avsnitt 2 og 4. Samme tabell med testsaker
 * kjøres gjennom `normalizeAddressKey`/`normalizeCadastreNumber` og gjennom SQL-uttrykkene, og
 * gjennom uttrykkene slik PostgreSQL har lagret dem i indeksene. Avtale: `null` i TS er `NULL` i
 * SQL (ikke tom tekst).
 *
 * Oppdiktede adresser og matrikler.
 *
 * Støtter hovedmål: færre reklamasjoner (iPad-, server- og indeksregelen gir samme svar, så et
 * varsel ikke forsvinner fordi databasen normaliserer annerledes) og de ansatte (oppslaget er
 * raskt fordi indeksen bruker nøyaktig samme uttrykk).
 */

type Row = Record<string, unknown>;

async function rows(query: ReturnType<typeof sql>): Promise<Row[]> {
  const result = await db.execute(query);
  return result as unknown as Row[];
}

/** Kjører et SQL-uttrykk over én kolonne på hver verdi, i samme rekkefølge. */
async function evaluate(
  expression: string,
  column: string,
  values: readonly (string | null)[],
): Promise<(string | null)[]> {
  const out: (string | null)[] = [];
  for (const value of values) {
    const [row] = await rows(
      sql`select ${sql.raw(expression)} as v from (select ${value}::text as ${sql.raw(column)}) t`,
    );
    out.push((row?.v as string | null) ?? null);
  }
  return out;
}

/** Indeksene på `orders` med uttrykk (de nye for mulig dublett). */
async function duplicateIndexes() {
  const all = await rows(sql`
    select indexname, indexdef from pg_indexes
    where schemaname = current_schema() and tablename = 'orders'`);
  const address = all.find((row) => /split_part/i.test(String(row.indexdef)));
  const cadastre = all.find(
    (row) => /\bgnr\b/.test(String(row.indexdef)) && /\bbnr\b/.test(String(row.indexdef)),
  );
  return { address, cadastre };
}

/** Uttrykket i kolonne `column` (1-basert) i indeksen, slik PostgreSQL har skrevet det om. */
async function indexColumnExpression(indexName: string, column: number): Promise<string> {
  const [row] = await rows(sql`
    select pg_get_indexdef(c.oid, ${column}::int, true) as expr
    from pg_class c
    where c.relname = ${indexName} and c.relnamespace = current_schema()::regnamespace`);
  return String(row?.expr ?? "");
}

describe("2 paritet TS mot SQL", () => {
  it("2.1 adresse: hele tabellen gir like svar i TS og SQL", async () => {
    const inputs = ADDRESS_CASES.map(([input]) => input);
    const fromSql = await evaluate(ORDER_ADDRESS_KEY_SQL, "address_text", inputs);
    inputs.forEach((input, index) => {
      expect(fromSql[index], `«${input}»`).toBe(normalizeAddressKey(input));
    });
  });

  it("2.1 adresse: SQL gir NULL (ikke tom tekst) når TS gir null", async () => {
    const empty = ADDRESS_CASES.filter(([, key]) => key === null).map(([input]) => input);
    expect(empty.length).toBeGreaterThan(0);
    for (const value of await evaluate(ORDER_ADDRESS_KEY_SQL, "address_text", empty)) {
      expect(value).toBeNull();
    }
  });

  it.each([
    ["gnr", ORDER_GNR_KEY_SQL],
    ["bnr", ORDER_BNR_KEY_SQL],
    ["snr", ORDER_SNR_KEY_SQL],
  ] as const)(
    "2.2 matrikkel (%s): hele tabellen gir like svar i TS og SQL",
    async (column, expr) => {
      const inputs = CADASTRE_NUMBER_CASES.map(([input]) => input);
      const fromSql = await evaluate(expr, column, inputs);
      inputs.forEach((input, index) => {
        expect(fromSql[index], `«${input}»`).toBe(normalizeCadastreNumber(input));
      });
    },
  );

  it("2.3 indeksene har samme uttrykk som spørringen (kjørt på de samme testsakene)", async () => {
    const { address, cadastre } = await duplicateIndexes();
    expect(address, "indeks for adressen på orders").toBeDefined();
    expect(cadastre, "indeks for matrikkelen på orders").toBeDefined();

    const addressExpr = await indexColumnExpression(String(address!.indexname), 2);
    const addressInputs = ADDRESS_CASES.map(([input]) => input);
    expect(await evaluate(addressExpr, "address_text", addressInputs)).toEqual(
      await evaluate(ORDER_ADDRESS_KEY_SQL, "address_text", addressInputs),
    );

    const numberInputs = CADASTRE_NUMBER_CASES.map(([input]) => input);
    const gnrExpr = await indexColumnExpression(String(cadastre!.indexname), 2);
    const bnrExpr = await indexColumnExpression(String(cadastre!.indexname), 3);
    expect(await evaluate(gnrExpr, "gnr", numberInputs)).toEqual(
      await evaluate(ORDER_GNR_KEY_SQL, "gnr", numberInputs),
    );
    expect(await evaluate(bnrExpr, "bnr", numberInputs)).toEqual(
      await evaluate(ORDER_BNR_KEY_SQL, "bnr", numberInputs),
    );
  });
});

describe("4 migreringen", () => {
  it("4.2 de to indeksene finnes med organization_id som første kolonne", async () => {
    const { address, cadastre } = await duplicateIndexes();
    for (const index of [address, cadastre]) {
      expect(index).toBeDefined();
      expect(String(index!.indexdef)).toMatch(/USING btree \(organization_id,/);
    }
    expect(address!.indexname).not.toBe(cadastre!.indexname);
  });

  it("4.1 indeksuttrykkene tåler eksisterende ordre med tom gnr og adresse bare «,»", async () => {
    // Testdatabasen er migrert (4.4: indeks med ikke-IMMUTABLE funksjon ville feilet). Her vises at
    // rader med kantverdier kan skrives og leses gjennom indeksene uten feil.
    await resetDatabase();
    const org = await createOrganization("Testfirma takst");
    await createOrder(org.id, { addressText: ",", gnr: null, bnr: null, snr: null });
    await createOrder(org.id, { addressText: " , 8006 Bodø", gnr: "", bnr: "0", snr: "000" });
    await createOrder(org.id, { addressText: "Storgata 1A, 8006 Bodø", gnr: " 012 ", bnr: "1 2" });
    await db.execute(sql`reindex table orders`);
    const [counted] = await rows(sql`select count(*)::int as n from orders`);
    expect(counted?.n).toBe(3);
  });
});
