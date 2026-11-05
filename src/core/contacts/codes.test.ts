import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { CONTACT_SOURCES, contactSourceLabel, FIRM_TYPES, firmTypeLabel } from "./codes";

/*
 * Faste koder for firma og kontakter. Testplan:
 * docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 2.
 *
 * Regel 6: en fast kode endres aldri, den arkiveres. Listene under er låst med vilje. Skal en
 * kode få ny betydning, lages en ny kode, og testen utvides; den gamle står.
 *
 * Støtter hovedmål: KI først (kodene for kilde og firmatype er stabile data som en senere
 * KI-ordre kan bruke) og reklamasjoner (kilden står på hver kontakt).
 */

const FIRM_TYPE_LABELS = {
  broker_firm: "Meglerforetak",
  insurer: "Forsikringsselskap",
  housing_association: "Sameie eller borettslag",
  other: "Annet",
} as const;

const CONTACT_SOURCE_LABELS = {
  manual: "Lagt inn for hånd",
  order: "Fra en ordre",
} as const;

describe("2. faste koder", () => {
  // Regel 6: kodene endres aldri. Ny kode legges til bakerst, og testen oppdateres bevisst.
  it("2.1 FIRM_TYPES er nøyaktig de fire kodene i fast rekkefølge", () => {
    expect([...FIRM_TYPES]).toEqual(["broker_firm", "insurer", "housing_association", "other"]);
  });

  it("2.2 CONTACT_SOURCES er nøyaktig manual og order; broker_system finnes ikke ennå", () => {
    expect([...CONTACT_SOURCES]).toEqual(["manual", "order"]);
    expect(CONTACT_SOURCES as readonly string[]).not.toContain("broker_system");
  });

  it.each(Object.entries(FIRM_TYPE_LABELS))("2.3 firmTypeLabel(%s) = %s", (code, label) => {
    expect(firmTypeLabel(code)).toBe(label);
  });

  it.each(Object.entries(CONTACT_SOURCE_LABELS))(
    "2.3 contactSourceLabel(%s) = %s",
    (code, label) => {
      expect(contactSourceLabel(code)).toBe(label);
    },
  );

  it("2.3 ukjent kode gir koden tilbake, aldri undefined", () => {
    expect(firmTypeLabel("bank")).toBe("bank");
    expect(contactSourceLabel("broker_system")).toBe("broker_system");
    expect(firmTypeLabel("")).toBe("");
  });

  it("2.4 alle koder har egen etikett (ny kode uten etikett gjør testen rød)", () => {
    const firmLabels = FIRM_TYPES.map(firmTypeLabel);
    const sourceLabels = CONTACT_SOURCES.map(contactSourceLabel);
    FIRM_TYPES.forEach((code, index) => expect(firmLabels[index]).not.toBe(code));
    CONTACT_SOURCES.forEach((code, index) => expect(sourceLabels[index]).not.toBe(code));
    expect(new Set(firmLabels).size).toBe(FIRM_TYPES.length);
    expect(new Set(sourceLabels).size).toBe(CONTACT_SOURCES.length);
    expect(Object.keys(FIRM_TYPE_LABELS)).toHaveLength(FIRM_TYPES.length);
    expect(Object.keys(CONTACT_SOURCE_LABELS)).toHaveLength(CONTACT_SOURCES.length);
  });
});

/** Kodene i CHECK-regelen for kolonnen, lest fra databasen. */
async function checkCodes(table: string, column: string): Promise<string[]> {
  const rows = await db.execute<{ definition: string }>(sql`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = ${table}::regclass and contype = 'c'`);
  const definition = [...rows]
    .map((row) => row.definition)
    .find((text) => text.includes(column) && /'[a-z_]+'/.test(text));
  expect(definition, `CHECK-regel for ${table}.${column}`).toBeDefined();
  return [...definition!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]!);
}

describe("2.5 kodene i databasen = kodene i koden", () => {
  it("firms.firm_type har de samme kodene som FIRM_TYPES", async () => {
    expect((await checkCodes("firms", "firm_type")).sort()).toEqual([...FIRM_TYPES].sort());
  });

  it("contacts.source har de samme kodene som CONTACT_SOURCES", async () => {
    expect((await checkCodes("contacts", "source")).sort()).toEqual([...CONTACT_SOURCES].sort());
  });
});
