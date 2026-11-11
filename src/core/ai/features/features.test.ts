import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  featureDefinitions,
  languagePolish,
  type AiFeatureDefinitionForTest,
} from "../../../../tests/ai";

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
 * V8.1–V8.4, kortet Omfang 7, ad-7, A175). Kontrollen står i testen (`sourceProblems`) og prøves
 * selv mot oppdiktede definisjoner, så den ikke kan være hul. Minimumslisten er `BLOCKED` over,
 * skrevet fast her: en kolonne kan ikke fjernes fra både kode og kontroll i samme endring uten
 * rød test.
 */
const NEW_NEVER_COLUMNS = [
  "assignment_team_members.handed_over_reason",
  "certifications.certificate_number",
  "assignments.number",
];

/** `NEVER_FIELDS` fra koden (`never-fields.ts`, eller `features.ts` etter avtalen). */
async function neverFieldsFromCode(): Promise<string[]> {
  const candidates: Record<string, unknown>[] = [];
  try {
    candidates.push((await import("../never-fields")) as Record<string, unknown>);
  } catch {
    // Filen finnes ikke: listen kan stå i features.ts
  }
  candidates.push((await import("../features")) as Record<string, unknown>);
  for (const candidate of candidates) {
    const list = candidate.NEVER_FIELDS;
    if (Array.isArray(list) || list instanceof Set) return [...list].map(String);
  }
  throw new Error("NEVER_FIELDS finnes verken i never-fields.ts eller features.ts (avtalen)");
}

/** Feltkoder uten kilde, med ugyldig kilde, eller med kilde på «aldri»-listen. */
function sourceProblems(
  definition: Pick<AiFeatureDefinitionForTest, "code" | "allowedFields"> & {
    fieldSources?: unknown;
  },
  neverFields: readonly string[],
): string[] {
  const sources = (definition.fieldSources ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  for (const field of definition.allowedFields) {
    const source = Object.prototype.hasOwnProperty.call(sources, field)
      ? sources[field]
      : undefined;
    if (typeof source !== "string" || source.length === 0) {
      problems.push(`${definition.code}.${field}: mangler kilde`);
    } else if (source !== "free_text" && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u.test(source)) {
      problems.push(`${definition.code}.${field}: ugyldig kilde ${source}`);
    } else if (neverFields.includes(source)) {
      problems.push(`${definition.code}.${field}: ${source} står på «aldri»-listen`);
    }
  }
  return problems;
}

describe("vask før KI: «aldri»-kolonnene og fieldSources (V8.1–V8.4)", () => {
  it("V8.1 hver feltkode på tillatt-listen har en kilde (tabell.kolonne eller free_text)", async () => {
    const neverFields = await neverFieldsFromCode();
    for (const definition of featureDefinitions()) {
      const withSources = definition as AiFeatureDefinitionForTest & { fieldSources?: unknown };
      expect(withSources.fieldSources, `${definition.code}: fieldSources mangler`).toBeDefined();
      expect(sourceProblems(withSources, neverFields)).toEqual([]);
    }
    const polish = languagePolish() as AiFeatureDefinitionForTest & { fieldSources?: unknown };
    expect(polish.fieldSources).toEqual({ text: "free_text" });
  });

  it("V8.2 kontrollen er ikke hul: kilde på «aldri»-listen og feltkode uten kilde blir fanget", async () => {
    const neverFields = await neverFieldsFromCode();
    const invented = {
      code: "invented_feature",
      allowedFields: ["text", "recipient"],
      fieldSources: { text: "free_text", recipient: "contacts.email" },
    };
    expect(sourceProblems(invented, neverFields)).toEqual([
      "invented_feature.recipient: contacts.email står på «aldri»-listen",
    ]);
    expect(
      sourceProblems({ ...invented, fieldSources: { text: "free_text" } }, neverFields),
    ).toEqual(["invented_feature.recipient: mangler kilde"]);
    expect(sourceProblems({ ...invented, fieldSources: undefined }, neverFields)).toHaveLength(2);
    for (const column of NEW_NEVER_COLUMNS) {
      expect(
        sourceProblems(
          { ...invented, fieldSources: { text: column, recipient: "free_text" } },
          neverFields,
        ),
        column,
      ).toHaveLength(1);
    }
  });

  it("V8.3 NEVER_FIELDS har hele minimumslisten (fast kopi) og de tre nye kolonnene", async () => {
    const neverFields = await neverFieldsFromCode();
    const minimum = Object.entries(BLOCKED).flatMap(([table, columns]) =>
      columns.map((column) => `${table}.${column}`),
    );
    expect(minimum.length).toBeGreaterThan(30);
    const missing = [...minimum, ...NEW_NEVER_COLUMNS].filter(
      (column) => !neverFields.includes(column),
    );
    expect(missing, "mangler på «aldri»-listen").toEqual([]);
  });

  it("V8.4 kommentaren over listene krever gjennomgang av sikkerhet-personvern (A175)", () => {
    const files = ["never-fields.ts", "features.ts"]
      .map((name) => join(aiDir, name))
      .filter((file) => existsSync(file));
    const withList = files.filter((file) =>
      /export const NEVER_FIELDS/u.test(readFileSync(file, "utf8")),
    );
    expect(withList, "NEVER_FIELDS finnes ikke i koden").toHaveLength(1);
    const neverSource = readFileSync(withList[0]!, "utf8");
    const listAt = neverSource.indexOf("export const NEVER_FIELDS");
    expect(neverSource.slice(0, listAt)).toMatch(/sikkerhet-personvern/u);
    const features = readFileSync(join(aiDir, "features.ts"), "utf8");
    const featuresAt = features.indexOf("export const AI_FEATURES");
    expect(features.slice(0, featuresAt)).toMatch(/sikkerhet-personvern/u);
  });
});
