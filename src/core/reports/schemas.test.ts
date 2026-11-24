import { describe, expect, it } from "vitest";
import { evaluateRules, runRuleTestCases, type RuleResult } from "@/core/rules";
import { WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { WET_ROOM_THRESHOLDS } from "@/core/rules/data/thresholds";
import { parseTemplateDocument, type TemplateDocument } from "@/core/templates";
import { RULE_REASONS_MAX_CHARS } from "@/db/schema";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import {
  applyPhraseInputSchema,
  ruleResultSchema,
  saveSummaryInputSchema,
  suggestPhrasesInputSchema,
  summaryBasisEntrySchema,
} from "./schemas";

/*
 * B1.14 regelsvarets skjema (docs/funksjoner/fase2a-badet-pc-testplan.md avsnitt 1). Ren test uten
 * database. `ruleResultSchema` er det serveren bruker før regelsvaret lagres i beslutningsraden:
 * det skal godta alt regelmotoren gir for badmalen, og avvise ukjente nøkler, fritekst der det
 * skal stå faste koder, og for store svar.
 *
 * Støtter hovedmål: færre reklamasjoner (beslutningsloggen har alltid samme form) og KI i bunnen
 * (regelsvaret er strukturerte data med faste koder, aldri fritekst eller persondata).
 * Testdata er oppdiktet.
 */

const SYSTEM = { kind: "system", reportType: "condition_report" } as const;

function parsedTemplate(): TemplateDocument {
  const result = parseTemplateDocument(wetRoomTemplate);
  if (!result.success) throw new Error(`malen er ugyldig: ${JSON.stringify(result.issues)}`);
  return result.document;
}

const TEMPLATE = parsedTemplate();

/** Regelsvaret fra hver testsak i badmalen, både fra kjøreren og fra alle reglene samlet. */
function allResults(): { name: string; result: RuleResult }[] {
  const out: { name: string; result: RuleResult }[] = [];
  const cases = runRuleTestCases({
    template: SYSTEM,
    document: TEMPLATE,
    lifespans: WET_ROOM_LIFESPANS,
    thresholds: WET_ROOM_THRESHOLDS,
  });
  for (const testCase of cases) {
    if (testCase.result) out.push({ name: testCase.name, result: testCase.result });
  }
  for (const testCase of TEMPLATE.rule_test_cases) {
    const results = evaluateRules({
      template: SYSTEM,
      document: TEMPLATE,
      answers: testCase.input,
      inspectionYear: testCase.inspection_year,
      lifespans: WET_ROOM_LIFESPANS,
      thresholds: WET_ROOM_THRESHOLDS,
    });
    for (const result of results)
      out.push({ name: `${testCase.name} / ${result.rule_key}`, result });
  }
  // Uten svar og uten befaringsår: «ikke vurdert» fra alle reglene
  for (const result of evaluateRules({
    template: SYSTEM,
    document: TEMPLATE,
    answers: {},
    inspectionYear: null,
    lifespans: WET_ROOM_LIFESPANS,
    thresholds: WET_ROOM_THRESHOLDS,
  })) {
    out.push({ name: `tomme svar / ${result.rule_key}`, result });
  }
  return out;
}

const RESULTS = allResults();

/** Et gyldig svar som slår til, til å endre på i avvisningstestene. */
function triggered(): RuleResult {
  const found = RESULTS.find(
    (r) => r.result.state === "triggered" && r.result.suggestion?.kind === "outcome",
  );
  if (!found) throw new Error("ingen testsak gir et forslag med utfall");
  return structuredClone(found.result);
}

describe("B1.14 regelsvarets skjema", () => {
  it("B1.14 testsakene i badmalen gir regelsvar (testen prøver noe)", () => {
    expect(TEMPLATE.rule_test_cases.length).toBeGreaterThan(0);
    expect(RESULTS.length).toBeGreaterThan(TEMPLATE.rule_test_cases.length);
    const states = new Set(RESULTS.map((r) => r.result.state));
    expect(states.has("triggered")).toBe(true);
    expect(states.has("not_triggered")).toBe(true);
    expect(states.has("not_evaluated")).toBe(true);
    const kinds = new Set(RESULTS.map((r) => r.result.suggestion?.kind ?? null));
    for (const kind of ["outcome", "tgiu", "tg0"])
      expect(kinds.has(kind as never), kind).toBe(true);
  });

  it("B1.14 godtar regelsvaret fra alle testsakene og alle reglene", () => {
    const rejected = RESULTS.filter((r) => !ruleResultSchema.safeParse(r.result).success).map(
      (r) => r.name,
    );
    expect(rejected).toEqual([]);
  });

  it("B1.14 avviser ukjent nøkkel øverst, i forslaget og i begrunnelsen", () => {
    const top = { ...triggered(), fritekst: "x" };
    expect(ruleResultSchema.safeParse(top).success).toBe(false);

    const inSuggestion = triggered();
    (inSuggestion.suggestion as unknown as Record<string, unknown>).note = "x";
    expect(ruleResultSchema.safeParse(inSuggestion).success).toBe(false);

    const inReason = triggered();
    expect(inReason.reasons.length).toBeGreaterThan(0);
    (inReason.reasons[0] as unknown as Record<string, unknown>).comment = "x";
    expect(ruleResultSchema.safeParse(inReason).success).toBe(false);
  });

  it.each([
    ["rule_key med fritekst", (r: Record<string, unknown>) => (r.rule_key = "Sjiktet er gammelt")],
    ["code med fritekst", (r: Record<string, unknown>) => (r.code = "regelen slo til fordi")],
    ["ukjent state", (r: Record<string, unknown>) => (r.state = "maybe")],
    ["ukjent purpose", (r: Record<string, unknown>) => (r.purpose = "set_tg")],
    [
      "utfallskode med fritekst",
      (r: Record<string, unknown>) =>
        ((r.suggestion as Record<string, unknown>).outcome_key = "Avvik med tekst"),
    ],
    ["ukjent forslagstype", (r: Record<string, unknown>) => (r.suggestion = { kind: "tg3" })],
    [
      "begrunnelse med fritekst som kode",
      (r: Record<string, unknown>) =>
        ((r.reasons as Record<string, unknown>[])[0]!.code = "verdien var for høy"),
    ],
    [
      "begrunnelse med ukjent type",
      (r: Record<string, unknown>) =>
        ((r.reasons as Record<string, unknown>[])[0]!.type = "free_text"),
    ],
    ["begrunnelse som tekst", (r: Record<string, unknown>) => (r.reasons = "Sjiktet er fra 1990")],
  ])("B1.14 avviser %s", (_name, change) => {
    const result = triggered() as unknown as Record<string, unknown>;
    change(result);
    expect(ruleResultSchema.safeParse(result).success).toBe(false);
  });

  it("B1.14 avviser svar over øvre størrelse", () => {
    const base = triggered();
    const reason = base.reasons[0]!;
    // Mange begrunnelser: over grensen i tegn (samme grense som CHECK-regelen i databasen)
    const copies = Math.ceil(RULE_REASONS_MAX_CHARS / JSON.stringify(reason).length) + 1;
    const big = { ...base, reasons: Array.from({ length: copies }, () => reason) };
    expect(JSON.stringify(big.reasons).length).toBeGreaterThan(RULE_REASONS_MAX_CHARS);
    expect(ruleResultSchema.safeParse(big).success).toBe(false);

    // Svært mange begrunnelser avvises også
    const many = { ...base, reasons: Array.from({ length: 10_000 }, () => reason) };
    expect(ruleResultSchema.safeParse(many).success).toBe(false);

    // For lang kode
    const longKey = { ...base, rule_key: `wet_room.${"a".repeat(500)}` };
    expect(ruleResultSchema.safeParse(longKey).success).toBe(false);
  });

  it("B1.14 avviser tall som ikke er endelige i begrunnelsen", () => {
    const withNumber = RESULTS.find((r) =>
      r.result.reasons.some((reason) => reason.type === "number_vs_limit"),
    );
    expect(withNumber).toBeDefined();
    const result = structuredClone(withNumber!.result) as unknown as {
      reasons: Record<string, unknown>[];
    };
    const reason = result.reasons.find((r) => r.type === "number_vs_limit")!;
    reason.value = Number.POSITIVE_INFINITY;
    expect(ruleResultSchema.safeParse(result).success).toBe(false);
    reason.value = "15";
    expect(ruleResultSchema.safeParse(result).success).toBe(false);
  });
});

// --- KI i veien (docs/funksjoner/fase2a-ki-i-veien-testplan.md K1.32 og K4.17a) ----------------

const UUID = "0190f2a4-0000-7000-8000-000000000001";

describe("KI i veien: inndata fra nettleseren", () => {
  const suggest = { requestId: UUID, deviationId: UUID, field: "cause_text", text: "" };

  it("K1.32 fraseforslag tar bare requestId, avviket, feltet og egen tekst", () => {
    expect(suggestPhrasesInputSchema.safeParse(suggest).success).toBe(true);
    for (const extra of [
      { candidates: [] },
      { findings: [] },
      { assignmentId: UUID },
      { reportId: UUID },
      { organizationId: UUID },
    ]) {
      expect(suggestPhrasesInputSchema.safeParse({ ...suggest, ...extra }).success).toBe(false);
    }
    expect(suggestPhrasesInputSchema.safeParse({ ...suggest, field: "tg" }).success).toBe(false);
  });

  it("K1.32 valgt kandidat har bare kilde og id, og kilden er en fast kode", () => {
    const apply = {
      usageId: UUID,
      candidate: { source: "template_outcome", id: UUID },
      base: null,
    };
    expect(applyPhraseInputSchema.safeParse(apply).success).toBe(true);
    expect(
      applyPhraseInputSchema.safeParse({ ...apply, candidate: { ...apply.candidate, text: "x" } })
        .success,
    ).toBe(false);
    expect(
      applyPhraseInputSchema.safeParse({ ...apply, candidate: { source: "fritekst", id: UUID } })
        .success,
    ).toBe(false);
  });

  it("K4.17a summary_basis er strengt: bare UUID, faste koder og heltall", () => {
    const entry = { source: "deviation", id: UUID, group: "tg2", rowVersion: 1, parts: [] };
    expect(summaryBasisEntrySchema.safeParse(entry).success).toBe(true);
    for (const bad of [
      { ...entry, text: "Mxq" },
      { ...entry, id: "ikke-uuid" },
      { ...entry, group: "tg1" },
      { ...entry, source: "room" },
      { ...entry, rowVersion: 1.5 },
      { ...entry, rowVersion: -1 },
      { ...entry, parts: [{ id: UUID, rowVersion: 1, text: "x" }] },
      { ...entry, parts: Array.from({ length: 21 }, () => ({ id: UUID, rowVersion: 1 })) },
    ]) {
      expect(summaryBasisEntrySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("K1.26 sammendraget: tom tekst er lov og blir tom, ekstra nøkler avvises", () => {
    const parsed = saveSummaryInputSchema.safeParse({ text: "", baseRowVersion: 1 });
    expect(parsed.success && parsed.data.text).toBeNull();
    expect(
      saveSummaryInputSchema.safeParse({ text: "x", baseRowVersion: 1, reportId: UUID }).success,
    ).toBe(false);
  });
});
