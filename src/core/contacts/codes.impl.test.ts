import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { CONTACT_SOURCES, FIRM_TYPES, contactSourceLabel, firmTypeLabel } from "./codes";

/*
 * Faste koder for firma og kontakter (regel 6: en kode endres aldri, nye legges til).
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 2.
 * Støtter hovedmål: KI først (låste koder som en senere KI-ordre kan bruke).
 */

describe("faste koder", () => {
  it("FIRM_TYPES er låst i fast rekkefølge (regel 6)", () => {
    expect([...FIRM_TYPES]).toEqual(["broker_firm", "insurer", "housing_association", "other"]);
  });

  it("CONTACT_SOURCES er låst; broker_system finnes ikke ennå", () => {
    expect([...CONTACT_SOURCES]).toEqual(["manual", "order"]);
  });

  it("etikettene er norske, og ukjent kode gir koden tilbake", () => {
    expect(FIRM_TYPES.map(firmTypeLabel)).toEqual([
      "Meglerforetak",
      "Forsikringsselskap",
      "Sameie eller borettslag",
      "Annet",
    ]);
    expect(CONTACT_SOURCES.map(contactSourceLabel)).toEqual(["Lagt inn for hånd", "Fra en ordre"]);
    expect(firmTypeLabel("bank")).toBe("bank");
    expect(contactSourceLabel("import")).toBe("import");
  });

  it("alle koder har en egen etikett (ny kode uten etikett gjør testen rød)", () => {
    for (const code of FIRM_TYPES) expect(firmTypeLabel(code)).not.toBe(code);
    for (const code of CONTACT_SOURCES) expect(contactSourceLabel(code)).not.toBe(code);
  });

  it("CHECK-reglene i databasen har de samme kodene", async () => {
    const result = await db.execute<{ name: string; def: string }>(sql`
      select conname as name, pg_get_constraintdef(oid) as def
      from pg_constraint
      where conname in ('firms_firm_type_check', 'contacts_source_check')
    `);
    const defs = Object.fromEntries(result.map((row) => [row.name, row.def]));
    const codesIn = (def: string | undefined) =>
      [...(def ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(codesIn(defs.firms_firm_type_check)).toEqual([...FIRM_TYPES]);
    expect(codesIn(defs.contacts_source_check)).toEqual([...CONTACT_SOURCES]);
  });
});
