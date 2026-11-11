import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  featureDefinitions,
  languagePolish,
  type AiFeatureDefinitionForTest,
} from "../../../../tests/ai";
import { fieldSourceViolations, NEVER_FIELDS } from "../never-fields";

/*
 * Funksjonsdefinisjonene i src/core/ai (docs/funksjoner/fase2a-ki-modul-logg-testplan.md
 * avsnitt 2). Ren test, ingen database. Fasiten er skrevet inn her og importeres aldri fra koden:
 * faste koder endres aldri, de arkiveres (regel 6).
 *
 * Støtter hovedmål: KI i bunnen (hver funksjon har én definisjon med rettighet og tillatt-liste)
 * og færre reklamasjoner (KI kan aldri få TG som mål, og personopplysninger kan aldri stå på en
 * tillatt-liste).
 */

/** Alle funksjonskodene som finnes. Ny funksjon uten testsak gjør testen rød. */
const FEATURE_CODES = ["language_polish"];

/**
 * Sperrelisten fra ADR 0006 del 6 («aldri på tillatt-liste»), fast i testen. Hver kolonne
 * prøves både som `tabell.kolonne` og som kolonnenavnet alene.
 */
const BLOCKED: Record<string, string[]> = {
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

const BLOCKED_NAMES = new Set(
  Object.entries(BLOCKED).flatMap(([table, cols]) =>
    cols.flatMap((col) => [`${table}.${col}`, col]),
  ),
);
// Fødselsnummer (alle tabeller) i de vanlige skrivemåtene
for (const name of ["national_id", "national_identity_number", "birth_number", "ssn", "fnr"]) {
  BLOCKED_NAMES.add(name);
}

const isTgField = (fieldKey: string) => fieldKey === "tg" || fieldKey.startsWith("tg_");

/** Feltene i definisjonen som bryter sperrelisten eller er TG-felt. */
function violations(definition: AiFeatureDefinitionForTest): string[] {
  const out: string[] = [];
  for (const field of definition.allowedFields) {
    if (BLOCKED_NAMES.has(field)) out.push(`tillatt-liste: ${field} (sperrelisten)`);
    if (isTgField(field)) out.push(`tillatt-liste: ${field} (TG)`);
  }
  for (const target of definition.allowedTargets) {
    if (isTgField(target.fieldKey)) out.push(`mål: ${target.type}.${target.fieldKey} (TG)`);
    if (BLOCKED_NAMES.has(target.fieldKey)) {
      out.push(`mål: ${target.type}.${target.fieldKey} (sperrelisten)`);
    }
  }
  return out;
}

const aiDir = join(__dirname, "..");

function productFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .filter((entry) => !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("funksjonsdefinisjonene (2)", () => {
  it("2.1 language_polish: rettighet report.edit, ledetekst v1, én feltkode og to lovlige mål", () => {
    const definition = languagePolish();
    expect(definition.code).toBe("language_polish");
    expect(definition.permission).toBe("report.edit");
    expect(definition.promptVersion).toBe("language_polish.v1");
    expect([...definition.allowedFields]).toEqual(["text"]);
    // Skrevet om bevisst (docs/funksjoner/fase2a-forslagsmonster.md «Data», A166): prøvesiden
    // /prove/ki har fått sitt eget mål `ai_trial`. Svaret i teksten (`answer`) står først.
    expect(definition.allowedTargets.map((target) => ({ ...target }))).toEqual([
      { type: "answer", fieldKey: "text" },
      { type: "ai_trial", fieldKey: "text" },
    ]);
  });

  it("2.2 kodene er faste: listen er nøyaktig language_polish", () => {
    expect(
      featureDefinitions()
        .map((definition) => definition.code)
        .sort(),
    ).toEqual([...FEATURE_CODES].sort());
  });

  it("2.3 ingen TG som mål eller på tillatt-listen, for hver definisjon", () => {
    for (const definition of featureDefinitions()) {
      for (const target of definition.allowedTargets) {
        expect(isTgField(target.fieldKey), `${definition.code}: ${target.fieldKey}`).toBe(false);
      }
      for (const field of definition.allowedFields) {
        expect(isTgField(field), `${definition.code}: ${field}`).toBe(false);
      }
    }
  });

  it("2.4 ingen definisjon har et felt fra sperrelisten på tillatt-listen", () => {
    for (const definition of featureDefinitions()) {
      expect(violations(definition), definition.code).toEqual([]);
    }
  });

  it("2.4 sjekken er ikke hul: en oppdiktet definisjon med email og tg_value blir fanget", () => {
    const invented: AiFeatureDefinitionForTest = {
      code: "invented_feature",
      permission: "report.edit",
      allowedFields: ["text", "email", "contacts.phone", "tg_value"],
      allowedTargets: [{ type: "answer", fieldKey: "tg" }],
      promptVersion: "invented_feature.v1",
    };
    const found = violations(invented);
    expect(found).toContain("tillatt-liste: email (sperrelisten)");
    expect(found).toContain("tillatt-liste: contacts.phone (sperrelisten)");
    expect(found).toContain("tillatt-liste: tg_value (TG)");
    expect(found).toContain("mål: answer.tg (TG)");
  });

  it("2.5 ledeteksten language_polish.v1 finnes, er ikke tom og har ingen gjetteord", () => {
    const files = productFiles(aiDir);
    expect(files.length).toBeGreaterThan(0);
    const withVersion = files.filter((file) =>
      readFileSync(file, "utf8").includes("language_polish.v1"),
    );
    expect(withVersion.length, "en kildefil har ledetekstversjonen").toBeGreaterThan(0);
    // Regel 7: ingen gjetteord i KI-modulens tekster (ledeteksten ligger her)
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\b(antas|trolig)\b/i);
    }
    // Selve ledeteksten prøves også i request-suggestion.test.ts (det leverandøren får).
  });
});

/*
 * «Aldri»-kolonnene og kildene til feltkodene (docs/funksjoner/fase2a-vask-for-ki-testplan.md
 * avsnitt 8.1–8.3, ad-7, A175). Minimumslisten er sperrelisten over (BLOCKED), skrevet fast her,
 * så en kolonne ikke kan fjernes fra både koden og kontrollen i samme endring uten rød test.
 */
const NEW_NEVER_FIELDS = [
  "assignment_team_members.handed_over_reason",
  "certifications.certificate_number",
  "assignments.number",
];

describe("«aldri»-kolonnene og fieldSources (8)", () => {
  it("V8.1 hver feltkode på tillatt-listen har en kilde (tabell.kolonne eller free_text)", () => {
    for (const definition of featureDefinitions()) {
      const sources = definition.fieldSources;
      expect(sources, `${definition.code}: fieldSources`).toBeDefined();
      for (const field of definition.allowedFields) {
        const source = sources?.[field];
        expect(source, `${definition.code}.${field}`).toMatch(
          /^(free_text|[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/,
        );
      }
    }
    expect(languagePolish().fieldSources).toEqual({ text: "free_text" });
  });

  it("V8.2 ingen kilde står på «aldri»-listen, for hver definisjon", () => {
    for (const definition of featureDefinitions()) {
      expect(fieldSourceViolations(definition), definition.code).toEqual([]);
      for (const source of Object.values(definition.fieldSources ?? {})) {
        expect(NEVER_FIELDS, `${definition.code}: ${source}`).not.toContain(source);
      }
    }
  });

  it("V8.2 kontrollen er ikke hul: kilde contacts.email og feltkode uten kilde blir fanget", () => {
    const withNeverSource: AiFeatureDefinitionForTest = {
      code: "invented_feature",
      permission: "report.edit",
      allowedFields: ["text", "recipient"],
      fieldSources: { text: "free_text", recipient: "contacts.email" },
      allowedTargets: [{ type: "answer", fieldKey: "text" }],
      promptVersion: "invented_feature.v1",
    };
    expect(fieldSourceViolations(withNeverSource)).toEqual([
      "invented_feature.recipient: kilden contacts.email står på «aldri»-listen",
    ]);

    const withoutSource: AiFeatureDefinitionForTest = {
      ...withNeverSource,
      allowedFields: ["text", "note"],
      fieldSources: { text: "free_text" },
    };
    expect(fieldSourceViolations(withoutSource)).toEqual(["invented_feature.note: mangler kilde"]);

    const noSourcesAtAll: AiFeatureDefinitionForTest = {
      ...withoutSource,
      fieldSources: undefined,
    };
    expect(fieldSourceViolations(noSourcesAtAll)).toHaveLength(2);

    // De nye kolonnene fanges også
    for (const source of NEW_NEVER_FIELDS) {
      expect(
        fieldSourceViolations({
          ...withNeverSource,
          fieldSources: { text: source, recipient: "free_text" },
        }),
        source,
      ).toHaveLength(1);
    }
  });

  it("V8.3 NEVER_FIELDS har hele minimumslisten og de tre nye kolonnene", () => {
    const minimum = Object.entries(BLOCKED).flatMap(([table, cols]) =>
      cols.map((col) => `${table}.${col}`),
    );
    expect(minimum.length).toBeGreaterThan(30);
    expect([...NEVER_FIELDS]).toEqual(expect.arrayContaining([...minimum, ...NEW_NEVER_FIELDS]));
    expect(new Set(NEVER_FIELDS).size, "ingen dubletter").toBe(NEVER_FIELDS.length);
  });
});
