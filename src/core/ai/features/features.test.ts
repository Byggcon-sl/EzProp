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
const FEATURE_CODES = ["language_polish", "phrase_suggest", "summary_draft"];

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
  it("2.1 language_polish: rettighet report.edit, ledetekst v2, én feltkode og målene i rapporten", () => {
    const definition = languagePolish();
    expect(definition.code).toBe("language_polish");
    expect(definition.permission).toBe("report.edit");
    // Endret med vilje fra v1 til v2 (docs/funksjoner/fase2a-evalueringssett.md Omfang 5, E5.7)
    expect(definition.promptVersion).toBe("language_polish.v2");
    expect([...definition.allowedFields]).toEqual(["text"]);
    // Skrevet om bevisst («KI i veien», A350, A356, A487): `ai_trial` er arkivert, og
    // språkvasken har fått målene i rapporten. `field_answer` står fortsatt først.
    expect(definition.allowedTargets.map((target) => ({ ...target }))).toEqual([
      { type: "field_answer", fieldKey: "text" },
      { type: "deviation", fieldKey: "deviation_text" },
      { type: "deviation", fieldKey: "cause_text" },
      { type: "deviation", fieldKey: "consequence_text" },
      { type: "deviation_measure", fieldKey: "text" },
      { type: "checkpoint_result", fieldKey: "description_text" },
    ]);
  });

  it("2.2 kodene er faste: listen er nøyaktig language_polish, phrase_suggest og summary_draft", () => {
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
      allowedTargets: [{ type: "field_answer", fieldKey: "tg" }],
      promptVersion: "invented_feature.v1",
    };
    const found = violations(invented);
    expect(found).toContain("tillatt-liste: email (sperrelisten)");
    expect(found).toContain("tillatt-liste: contacts.phone (sperrelisten)");
    expect(found).toContain("tillatt-liste: tg_value (TG)");
    expect(found).toContain("mål: field_answer.tg (TG)");
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
    const raw = Object.prototype.hasOwnProperty.call(sources, field) ? sources[field] : undefined;
    // «KI i veien»: en feltkode kan ha flere kolonner som kilde (avvik, årsak, konsekvens, tiltak)
    const list: unknown[] = Array.isArray(raw) ? raw : [raw];
    if (list.length === 0 || list.some((source) => typeof source !== "string" || source === "")) {
      problems.push(`${definition.code}.${field}: mangler kilde`);
      continue;
    }
    for (const source of list as string[]) {
      if (source !== "free_text" && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u.test(source)) {
        problems.push(`${definition.code}.${field}: ugyldig kilde ${source}`);
      } else if (neverFields.includes(source)) {
        problems.push(`${definition.code}.${field}: ${source} står på «aldri»-listen`);
      }
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
    // «KI i veien»: kolonnene feltet kan komme fra, ikke lenger `free_text` (K1.27)
    const polish = languagePolish() as AiFeatureDefinitionForTest & { fieldSources?: unknown };
    expect(polish.fieldSources).toEqual({
      text: [
        "deviations.deviation_text",
        "deviations.cause_text",
        "deviations.consequence_text",
        "deviation_measures.text",
        "checkpoint_results.description_text",
        "field_answers.value_text",
      ],
    });
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

  it("V8.2 kontrollen i koden (findFieldSourceViolations) godtar definisjonene og fanger «aldri»-kilde, manglende og ugyldig kilde", async () => {
    const { AI_FEATURES, findFieldSourceViolations } = await import("../features");
    expect(findFieldSourceViolations(Object.values(AI_FEATURES))).toEqual([]);
    expect(
      findFieldSourceViolations([
        {
          code: "invented_feature",
          allowedFields: ["text", "mail", "missing", "odd"],
          fieldSources: { text: "free_text", mail: "contacts.email", odd: "email" },
        },
        { code: "no_sources", allowedFields: ["text"] },
      ]),
    ).toEqual([
      "invented_feature.mail: contacts.email står i «aldri»-listen",
      "invented_feature.missing: mangler kilde",
      "invented_feature.odd: ugyldig kilde email",
      "no_sources.text: mangler kilde",
    ]);
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
    expect(new Set(neverFields).size, "dubletter på «aldri»-listen").toBe(neverFields.length);
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

/*
 * Ledetekst v2 og treffgrensen (docs/funksjoner/fase2a-evalueringssett-testplan.md E5.3–E5.6,
 * kortet Omfang 2 og 5, A184). Fasiten for v1 er skrevet inn her: en versjon endres aldri.
 */
const LOCKED_V1 = [
  "Du retter språket i en kort tekst fra en tilstandsrapport.",
  "Rett skrivefeil, tegnsetting og setninger som er tunge å lese. Skriv på norsk bokmål.",
  "Behold alle fakta, tall og mål slik de står. Ikke legg til noe nytt, og ikke ta bort noe.",
  "Skriv sikkert og konkret, uten ord som uttrykker gjetting.",
  "Svar bare med den rettede teksten.",
].join("\n");

describe("evalueringssett: ledetekst v2 og treffgrense (E5.3–E5.6)", () => {
  async function prompts(): Promise<Readonly<Record<string, string>>> {
    return (await import("../features")).AI_PROMPTS;
  }

  it("E5.3 language_polish peker på language_polish.v2, og v1 står urørt", async () => {
    const all = await prompts();
    expect(languagePolish().promptVersion).toBe("language_polish.v2");
    expect(all["language_polish.v1"]).toBe(LOCKED_V1);
    expect(typeof all["language_polish.v2"]).toBe("string");
    expect(all["language_polish.v2"]).not.toBe(LOCKED_V1);
  });

  it("E5.4 v2 sier at bør/må, TG og grad av sikkerhet står som før, og at innholdet aldri er instruks", async () => {
    const v2 = (await prompts())["language_polish.v2"] ?? "";
    expect(v2).toMatch(/\bbør\b|«bør»/u);
    expect(v2).toMatch(/(?<![\p{L}])må(?![\p{L}])/u);
    expect(v2).toMatch(/\bTG\b|tilstandsgrad/iu);
    expect(v2).toMatch(/sikker/iu);
    expect(v2).toMatch(/ikke legg til|legg aldri til|legger ikke til/iu);
    expect(v2).toMatch(/ikke ta bort|ikke fjern|fjerner ikke/iu);
    expect(v2).toMatch(/instruks/iu);
    // Linjen fra v1 om å skrive uten gjetteord er tatt ut (den sier imot)
    expect(v2).not.toContain("uten ord som uttrykker gjetting");
    expect(v2).not.toMatch(/skriv sikkert/iu);
    // Ingen kobling mellom bør/må og TG i ledeteksten (kortet punkt 3)
    for (const line of v2.split("\n")) {
      const modal = /«bør»|«må»|\bbør\b/u.test(line);
      const tg = /\bTG\b|tilstandsgrad/iu.test(line);
      expect(modal && tg, line).toBe(false);
    }
    // Regel 7: ingen gjetteord i selve ledeteksten
    expect(v2).not.toMatch(/\b(antas|trolig)\b/iu);
  });

  it("E5.5 v2 har ingen navn, e-post, telefon, adresse eller matrikkel", async () => {
    const { redactPii } = await import("@/shared/lib/pii-patterns");
    const v2 = (await prompts())["language_polish.v2"] ?? "";
    expect(v2.length).toBeGreaterThan(0);
    expect(redactPii(v2).count).toBe(0);
  });

  it("E5.6 evalPassRate er 0.9 for language_polish; allowedFields er uendret", async () => {
    const { AI_FEATURES } = await import("../features");
    const definition = AI_FEATURES.language_polish as unknown as {
      evalPassRate?: number;
      allowedFields: readonly string[];
      fieldSources: Record<string, string>;
    };
    expect(definition.evalPassRate).toBe(0.9);
    expect([...definition.allowedFields]).toEqual(["text"]);
    // fieldSources er skrevet om med vilje i «KI i veien» (K1.27, prøvd i V8.1)
    expect(Object.keys(definition.fieldSources)).toEqual(["text"]);
  });
});

/*
 * «KI i veien» (docs/funksjoner/fase2a-ki-i-veien-testplan.md 1e, K1.27–K1.31). Fasiten for de
 * nye funksjonene står her.
 */
describe("KI i veien: funksjonsdefinisjonene (K1.27–K1.31)", () => {
  async function load() {
    return import("../features");
  }

  /** Alle `tabell.kolonne` som finnes i Drizzle-skjemaet. */
  async function schemaColumns(): Promise<Set<string>> {
    const { getTableConfig, PgTable } = await import("drizzle-orm/pg-core");
    const schema = (await import("@/db/schema")) as Record<string, unknown>;
    const out = new Set<string>();
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue;
      const config = getTableConfig(value);
      for (const column of config.columns) out.add(`${config.name}.${column.name}`);
    }
    return out;
  }

  it("K1.27 rettighet, ledetekst og egne kilder per tabell.kolonne (ingen free_text for de nye)", async () => {
    const { AI_FEATURES } = await load();
    expect(AI_FEATURES.phrase_suggest.permission).toBe("report.edit");
    expect(AI_FEATURES.summary_draft.permission).toBe("report.edit");
    expect(AI_FEATURES.language_polish.permission).toBe("report.edit");
    expect(AI_FEATURES.phrase_suggest.promptVersion).toBe("phrase_suggest.v1");
    expect(AI_FEATURES.summary_draft.promptVersion).toBe("summary_draft.v1");
    expect(AI_FEATURES.language_polish.promptVersion).toBe("language_polish.v2");

    expect({ ...AI_FEATURES.phrase_suggest.fieldSources }).toEqual({
      text: [
        "deviations.deviation_text",
        "deviations.cause_text",
        "deviations.consequence_text",
        "deviation_measures.text",
      ],
      outcome_key: "outcomes.key",
      group: ["deviations.tg", "deviations.kind"],
    });
    expect({ ...AI_FEATURES.phrase_suggest.serverSources }).toEqual({
      candidates: [
        "outcomes.deviation_text",
        "outcomes.default_cause_text",
        "outcomes.default_consequence_text",
        "standard_measures.text",
      ],
    });
    expect([...AI_FEATURES.summary_draft.allowedFields]).toEqual([]);
    expect({ ...AI_FEATURES.summary_draft.serverSources }).toEqual({
      findings: [
        "checkpoints.name",
        "deviations.deviation_text",
        "deviations.cause_text",
        "deviations.consequence_text",
        "deviation_measures.text",
      ],
    });

    const columns = await schemaColumns();
    expect(columns.size).toBeGreaterThan(100);
    for (const definition of Object.values(AI_FEATURES)) {
      const sources = [
        ...Object.values(definition.fieldSources).flatMap((source) =>
          typeof source === "string" ? [source] : [...source],
        ),
        ...Object.values(definition.serverSources).flat(),
      ];
      for (const source of sources) {
        expect(source, `${definition.code}: free_text`).not.toBe("free_text");
        expect(columns.has(source), `${definition.code}: ${source} finnes ikke i skjemaet`).toBe(
          true,
        );
      }
    }
  });

  it("K1.27 findFieldSourceViolations fanger «aldri»-kolonner og free_text i serverkildene", async () => {
    const { findFieldSourceViolations } = await load();
    expect(
      findFieldSourceViolations([
        {
          code: "invented_feature",
          allowedFields: ["text"],
          fieldSources: { text: ["deviations.cause_text", "rooms.name"] },
          serverSources: { findings: ["free_text", "deviations.cost_amount"], empty: [] },
        },
      ]),
    ).toEqual([
      "invented_feature.text: rooms.name står i «aldri»-listen",
      "invented_feature.findings: ugyldig kilde free_text",
      "invented_feature.findings: deviations.cost_amount står i «aldri»-listen",
      "invented_feature.empty: mangler kilde",
    ]);
  });

  it("K1.28 ingen funksjon har et TG-mål, og ingen TG-felt står i REPORT_AI_TARGET_FIELDS", async () => {
    const { AI_FEATURES } = await load();
    const { REPORT_AI_TARGET_FIELDS } = await import("@/shared/config/ai-targets");
    const tgKeys = new Set(["tg", "tg_direct", "tg_computed"]);
    for (const fields of Object.values(REPORT_AI_TARGET_FIELDS)) {
      for (const field of fields ?? []) {
        expect(tgKeys.has(field) || isTgField(field), field).toBe(false);
      }
    }
    for (const definition of Object.values(AI_FEATURES)) {
      for (const target of definition.allowedTargets) {
        expect(tgKeys.has(target.fieldKey) || isTgField(target.fieldKey)).toBe(false);
      }
    }
  });

  it("K1.28 målene: new_measure bare for phrase_suggest, summary_text bare for summary_draft", async () => {
    const { AI_FEATURES } = await load();
    const targets = (code: keyof typeof AI_FEATURES) =>
      AI_FEATURES[code].allowedTargets.map((target) => `${target.type}/${target.fieldKey}`);
    expect(targets("phrase_suggest")).toEqual([
      "deviation/deviation_text",
      "deviation/cause_text",
      "deviation/consequence_text",
      "deviation/new_measure",
    ]);
    expect(targets("summary_draft")).toEqual(["report/summary_text"]);
    expect(targets("language_polish")).not.toContain("deviation/new_measure");
    expect(targets("language_polish")).not.toContain("report/summary_text");
  });

  it("K1.29 ledetekstene har skillet, forbudene og ingen modellnavn", async () => {
    const { AI_PROMPTS } = await load();
    for (const version of ["phrase_suggest.v1", "summary_draft.v1"]) {
      const prompt = AI_PROMPTS[version] ?? "";
      expect(prompt.length, version).toBeGreaterThan(0);
      expect(prompt, version).toMatch(/aldri en instruks/u);
      expect(prompt, version).toMatch(/gjetteord/u);
      expect(prompt, version).toMatch(/standarder/u);
      expect(prompt, version).toMatch(/NS 3600/u);
      expect(prompt, version).toMatch(/tabeller/u);
      expect(prompt, version).toMatch(/IVIT/u);
      expect(prompt, version).toMatch(/«bør» og «må»/u);
      expect(prompt, version).toMatch(/badet er i god stand/u);
      expect(prompt, version).not.toMatch(/\b(antas|trolig)\b/iu);
      // Modellnavn prøves for hele repoet i tests/no-model-names.test.ts
    }
    const summary = AI_PROMPTS["summary_draft.v1"] ?? "";
    expect(summary).toMatch(/«mindre», «alvorlig» eller «vesentlig»/u);
    expect(summary).toMatch(/Nevn aldri TG/u);
    expect(summary).toMatch(/F1: tekst/u);
    const phrase = AI_PROMPTS["phrase_suggest.v1"] ?? "";
    expect(phrase).toMatch(/K1: tekst/u);
    expect(phrase).toMatch(/INGEN/u);
  });

  it("K1.30 REPORT_AI_TARGET_FIELDS står i src/shared med report/summary_text; codes.ts har ingen kopi", async () => {
    const { REPORT_AI_TARGET_FIELDS } = await import("@/shared/config/ai-targets");
    expect([...REPORT_AI_TARGET_FIELDS.report]).toEqual(["summary_text"]);
    const codes = readFileSync(join(__dirname, "..", "..", "reports", "logic", "codes.ts"), "utf8");
    expect(codes).toMatch(
      /export \{ REPORT_AI_TARGET_FIELDS \} from "@\/shared\/config\/ai-targets"/u,
    );
    expect(codes).not.toMatch(/(const|let)\s+REPORT_AI_TARGET_FIELDS/u);
  });

  it("K1.31 FAKE_ONLY_TARGET_TYPES er nøyaktig field_answer og tgiu_detail; ingen funksjon godtar tgiu_detail", async () => {
    const { FAKE_ONLY_TARGET_TYPES } = await import("../request-suggestion");
    expect([...FAKE_ONLY_TARGET_TYPES].sort()).toEqual(["field_answer", "tgiu_detail"]);
    const { AI_FEATURES } = await load();
    for (const definition of Object.values(AI_FEATURES)) {
      expect(definition.allowedTargets.map((target) => target.type)).not.toContain("tgiu_detail");
    }
  });
});
