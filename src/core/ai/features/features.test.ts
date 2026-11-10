import { describe, expect, it } from "vitest";
import { AI_FEATURE_CODES, AI_FEATURES, getFeatureDefinition } from "@/core/ai";

/*
 * Funksjonsdefinisjonene i KI-modulen (testplan docs/funksjoner/fase2a-ki-modul-logg-testplan.md
 * avsnitt 2). Ren test, ingen database. Fasiten står i testen, ikke importert fra koden (regel 6).
 *
 * Støtter hovedmål: KI i bunnen (hver funksjon er data med fast kode, rettighet og tillatt-liste)
 * og færre reklamasjoner (KI kan aldri få et TG-felt eller personopplysninger som grunnlag).
 */

/** Fasit: kodene som finnes. En ny funksjon må få testsak her. */
const EXPECTED_CODES = ["language_polish"];

/** Sperrelisten fra ADR 0006 del 6 («aldri på tillatt-liste»). Fast i testen. */
const BLOCKLIST: Record<string, readonly string[]> = {
  contacts: ["first_name", "last_name", "email", "phone", "notes"],
  firms: ["name", "org_number", "notes"],
  assignment_parties: ["name", "firm_name", "email", "phone"],
  orders: [
    "address_text",
    "gnr",
    "bnr",
    "snr",
    "housing_association_name",
    "ordered_by_text",
    "external_ref",
    "rejected_reason",
  ],
  properties: ["address", "postal_code", "city"],
  cadastral_units: [
    "gnr",
    "bnr",
    "fnr",
    "snr",
    "share_number",
    "association_name",
    "association_org_number",
  ],
  common_areas: ["managing_agent", "notes"],
  claims: ["claimant_text", "description", "building_part_text"],
  employees: ["name"],
  users: ["name", "email"],
  assignments: ["internal_note"],
};

/** Alle sperrede feltnavn, både `tabell.kolonne`, kolonnenavnet alene og camelCase. */
const BLOCKED_NAMES: ReadonlySet<string> = new Set(
  Object.entries(BLOCKLIST).flatMap(([table, columns]) =>
    columns.flatMap((column) => [
      `${table}.${column}`,
      column,
      column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
    ]),
  ),
);

const isTgField = (key: string) => {
  const lower = key.toLowerCase();
  return lower === "tg" || lower.startsWith("tg_") || lower.startsWith("tg.");
};

type DefinitionLike = {
  code: string;
  allowedFields: readonly string[];
  allowedTargets: readonly { type: string; fieldKey: string }[];
};

/** Brudd på reglene for én definisjon. Tom liste betyr at den er i orden. */
function violations(definition: DefinitionLike): string[] {
  const found: string[] = [];
  for (const field of definition.allowedFields) {
    if (BLOCKED_NAMES.has(field)) found.push(`${definition.code}: sperret felt ${field}`);
    if (isTgField(field)) found.push(`${definition.code}: TG-felt ${field} på tillatt-listen`);
  }
  for (const target of definition.allowedTargets) {
    if (isTgField(target.fieldKey))
      found.push(`${definition.code}: TG-felt ${target.fieldKey} som mål`);
  }
  return found;
}

const definitions = Object.values(AI_FEATURES) as DefinitionLike[];

describe("funksjonsdefinisjonen language_polish (2.1)", () => {
  it("2.1 finnes med report.edit, language_polish.v1, ett felt (text) og ett lovlig mål", () => {
    const definition = getFeatureDefinition("language_polish");
    expect(definition).not.toBeNull();
    expect(definition!.code).toBe("language_polish");
    expect(definition!.permission).toBe("report.edit");
    expect(definition!.promptVersion).toBe("language_polish.v1");
    expect([...definition!.allowedFields]).toEqual(["text"]);
    expect(definition!.allowedTargets).toHaveLength(1);
    const [target] = definition!.allowedTargets;
    expect(typeof target!.type).toBe("string");
    expect(target!.type.length).toBeGreaterThan(0);
    expect(target!.fieldKey.length).toBeGreaterThan(0);
  });

  it("2.1 ukjent kode gir ingen definisjon", () => {
    expect(getFeatureDefinition("tg_suggest" as never)).toBeNull();
    expect(getFeatureDefinition("" as never)).toBeNull();
  });
});

describe("faste koder (2.2)", () => {
  it("2.2 listen over funksjonskoder er nøyaktig language_polish", () => {
    expect(Object.keys(AI_FEATURES).sort()).toEqual(EXPECTED_CODES);
    expect([...AI_FEATURE_CODES].sort()).toEqual(EXPECTED_CODES);
  });

  it("2.2 hver definisjon har koden den er lagret under", () => {
    for (const [code, definition] of Object.entries(AI_FEATURES)) {
      expect(definition.code, code).toBe(code);
    }
  });
});

describe("ingen TG og ingen sperrede felt (2.3, 2.4)", () => {
  it.each(definitions.map((definition) => [definition.code, definition] as const))(
    "2.3–2.4 %s har ingen TG-felt som mål og ingen sperrede felt på tillatt-listen",
    (_code, definition) => {
      expect(violations(definition)).toEqual([]);
    },
  );

  it("2.4 sjekken er ikke hul: en oppdiktet definisjon med email og tg_value gir brudd", () => {
    const bad: DefinitionLike = {
      code: "oppdiktet",
      allowedFields: ["email", "tg_value", "properties.address", "firstName"],
      allowedTargets: [
        { type: "answer", fieldKey: "tg" },
        { type: "answer", fieldKey: "tg_value" },
      ],
    };
    const found = violations(bad);
    expect(found).toContain("oppdiktet: sperret felt email");
    expect(found).toContain("oppdiktet: TG-felt tg_value på tillatt-listen");
    expect(found).toContain("oppdiktet: sperret felt properties.address");
    expect(found).toContain("oppdiktet: sperret felt firstName");
    expect(found).toContain("oppdiktet: TG-felt tg som mål");
    expect(found).toContain("oppdiktet: TG-felt tg_value som mål");
  });

  it("2.4 sperrelisten har alle tabellene fra ADR 0006 del 6", () => {
    expect(Object.keys(BLOCKLIST)).toHaveLength(11);
    expect(BLOCKED_NAMES.has("cadastral_units.share_number")).toBe(true);
    expect(BLOCKED_NAMES.has("internal_note")).toBe(true);
  });
});

describe("ledeteksten (2.5)", () => {
  it("2.5 language_polish.v1 har en ikke-tom ledetekst uten gjetteord", () => {
    const definition = AI_FEATURES.language_polish;
    const prompt = definition.buildPrompt({ text: "Vinduet er nytt." });
    expect(prompt.trim().length).toBeGreaterThan("Vinduet er nytt.".length);
    expect(prompt).toContain("Vinduet er nytt.");
    const withoutInput = prompt.replace("Vinduet er nytt.", "");
    expect(withoutInput.trim().length).toBeGreaterThan(0);
    expect(withoutInput).not.toMatch(/\bantas\b/i);
    expect(withoutInput).not.toMatch(/\btrolig\b/i);
  });

  it("2.5 ledeteksten tar bare med felt fra tillatt-listen", () => {
    const definition = AI_FEATURES.language_polish;
    const prompt = definition.buildPrompt({ text: "Kort tekst.", email: "MARKOR-ikke-med" });
    expect(prompt).not.toContain("MARKOR-ikke-med");
  });
});
