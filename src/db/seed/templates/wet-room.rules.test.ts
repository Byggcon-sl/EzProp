import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import {
  evaluateRules,
  runRuleTestCases,
  type JsonValue,
  type RuleResult,
  type RunRuleTestCasesInput,
} from "@/core/rules";
import { WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { WET_ROOM_THRESHOLDS } from "@/core/rules/data/thresholds";
import { parseTemplateDocument, type TemplateDocument } from "@/core/templates";
import { wetRoomTemplate } from "./wet-room";

/*
 * Regeltestene for badet (docs/funksjoner/fase2a-regler-bad-testplan.md avsnitt 4 og 10.2). Ren
 * test uten database.
 *
 * Testsakene står som data i malen og kjøres med `runRuleTestCases`. Denne filen sjekker i tillegg
 * at testsakene i kortet (Omfang 5) finnes, og kjører hver av dem med `evaluateRules` direkte, så de
 * ikke bare står i data. Grensene leses fra `thresholds.ts` og `lifespans.ts`, aldri som tall her.
 *
 * Godkjennes ikke uten: 4.6 og 4.7 (svar 59a per kontrollpunkt, T-0003) og H1 (alle fire grunner og
 * uten grunn gir TGIU).
 *
 * Støtter hovedmål:
 * - Færre reklamasjoner: et bad uten hulltaking ender alltid med TGIU-forslag, alder alene gir aldri
 *   TG2 på tilliggende konstruksjoner, og tomme felt gir «ikke vurdert», aldri «ingen avvik».
 * - De ansatte: forslaget og begrunnelsen er like hver gang.
 * - KI i bunnen: begrunnelsen har bare koder og tall (ingen persondata), og ingen regel foreslår TG0.
 *
 * Testdata er oppdiktet. Befaringsåret er fast (2026).
 */

const YEAR = 2026;
const SYSTEM = { kind: "system", reportType: "condition_report" } as const;

const PAST_LIFESPAN = "wet_room.membrane_past_lifespan";
const BEFORE_2000 = "wet_room.membrane_before_2000";
const MOISTURE = "wet_room.hole_moisture_over_limit";
const NOT_DRILLED = "wet_room.hole_drilling_not_done";
const RULE_KEYS = [PAST_LIFESPAN, BEFORE_2000, MOISTURE, NOT_DRILLED] as const;

const MEMBRANE_DRAIN = "wet_room.membrane_drain";
const ADJACENT = "wet_room.adjacent";

// Feltkodene i badmalen
const TYPE = "wet_room.membrane_type";
const DOCS = "wet_room.documentation_type";
const MEMBRANE_YEAR = "wet_room.membrane_year";
const BUILD_YEAR = "wet_room.build_year";
const SOURCE = "wet_room.build_year_source";
const HOLE = "wet_room.hole_drilling";
const READING = "wet_room.hole_moisture_reading";
const UNIT = "wet_room.hole_moisture_unit";
const REASON = "wet_room.hole_drilling_reason";

function parsedTemplate(): TemplateDocument {
  const result = parseTemplateDocument(wetRoomTemplate);
  if (!result.success) throw new Error(`malen er ugyldig: ${JSON.stringify(result.issues)}`);
  return result.document;
}

const TEMPLATE = parsedTemplate();

// --- Grensene fra dataene ------------------------------------------------------------------------

const moistureCondition = TEMPLATE.rule_conditions.find(
  (c) => c.rule_key === MOISTURE && c.threshold_key !== null,
);
const THRESHOLD = WET_ROOM_THRESHOLDS.entries.find(
  (t) => t.key === moistureCondition?.threshold_key,
);
/** Fuktgrensen fra `thresholds.ts`. */
const LIMIT = THRESHOLD?.value ?? Number.NaN;
const LIMIT_UNIT = THRESHOLD?.unit ?? "mangler";

/** Levetiden for folie uten dokumentasjon fra `lifespans.ts`. */
const FOIL_WITHOUT =
  WET_ROOM_LIFESPANS.entries.find(
    (e) =>
      e.material_code === "foil" && (e.documentation === "without" || e.documentation === "any"),
  )?.min_age ?? Number.NaN;

/** Siste år i trinnet «før 2000» fra `lifespans.ts`. */
const CUT_YEAR =
  WET_ROOM_LIFESPANS.entries.find((e) => e.material_code === null && e.outcome_kind === "tg3")
    ?.to_year ?? Number.NaN;

// --- Kjøring -------------------------------------------------------------------------------------

type Answers = Record<string, JsonValue>;

function evaluate(answers: Answers, inspectionYear: number | null = YEAR): RuleResult[] {
  return evaluateRules({
    template: SYSTEM,
    document: TEMPLATE,
    answers,
    inspectionYear,
    lifespans: WET_ROOM_LIFESPANS,
    thresholds: WET_ROOM_THRESHOLDS,
  });
}

function resultOf(results: RuleResult[], key: string): RuleResult {
  const found = results.find((r) => r.rule_key === key);
  if (!found) throw new Error(`regelen ${key} ga ikke svar`);
  return found;
}

function runCases(document: RunRuleTestCasesInput["document"] = TEMPLATE) {
  return runRuleTestCases({
    template: SYSTEM,
    document,
    lifespans: WET_ROOM_LIFESPANS,
    thresholds: WET_ROOM_THRESHOLDS,
  });
}

/** Tom verdi i en testsak: feltet mangler, er `null` eller tom tekst. */
const EMPTY = Symbol("tomt");
/**
 * En måling over grensen der kortet ikke låser tallet (F4, F5 tom enhet): i malen godtas ethvert
 * tall som ikke er negativt, og testen kjører motoren med grensen pluss 5.
 */
const ANY_READING = Symbol("et tall");
type Spec = Record<string, JsonValue | typeof EMPTY | typeof ANY_READING>;

function answersOf(spec: Spec): Answers {
  const out: Answers = {};
  for (const [key, value] of Object.entries(spec)) {
    if (value === EMPTY) continue;
    out[key] = value === ANY_READING ? LIMIT + 5 : value;
  }
  return out;
}

function inputMatches(input: Record<string, JsonValue>, spec: Spec): boolean {
  return Object.entries(spec).every(([key, value]) => {
    const actual = input[key];
    if (value === EMPTY) return actual === undefined || actual === null || actual === "";
    if (value === ANY_READING) return typeof actual === "number" && actual >= 0;
    return isDeepStrictEqual(actual, value);
  });
}

type ListedCase = {
  id: string;
  rule: (typeof RULE_KEYS)[number];
  spec: Spec;
  inspectionYear?: number;
  expected: RuleResult["state"];
  /** Ekstra sjekk av svaret fra `evaluateRules`. */
  check?: (results: RuleResult[]) => void;
};

const reasonsOf = (results: RuleResult[], key: string) =>
  resultOf(results, key).reasons as unknown as Record<string, unknown>[];

const ageReason = (results: RuleResult[], key: string) =>
  reasonsOf(results, key).find((r) => r.type === "age_vs_lifespan")!;

const outcomeSuggestion = (checkpoint: string, question: string, outcome: string) => ({
  kind: "outcome",
  checkpoint_key: checkpoint,
  question_key: question,
  outcome_key: outcome,
});

const PAST_LIFESPAN_OUTCOME = outcomeSuggestion(
  MEMBRANE_DRAIN,
  "wet_room.membrane_drain.membrane_past_lifespan",
  "tg2",
);
const BEFORE_2000_OUTCOME = outcomeSuggestion(
  MEMBRANE_DRAIN,
  "wet_room.membrane_drain.membrane_before_2000",
  "tg3",
);
const MOISTURE_OUTCOME = outcomeSuggestion(
  ADJACENT,
  "wet_room.adjacent.elevated_moisture",
  "choose",
);

const AT_LIMIT = YEAR - FOIL_WITHOUT; // folie uten dokumentasjon, alder lik levetiden

/** Testsakene i kortet (Omfang 5) og testplanen (avsnitt 4). */
const LISTED: ListedCase[] = [
  // --- Alder ---
  {
    id: "A1",
    rule: PAST_LIFESPAN,
    spec: { [TYPE]: "foil", [DOCS]: "none", [MEMBRANE_YEAR]: AT_LIMIT + 1 },
    expected: "not_triggered",
  },
  {
    id: "A2",
    rule: PAST_LIFESPAN,
    spec: { [TYPE]: "foil", [DOCS]: "none", [MEMBRANE_YEAR]: AT_LIMIT },
    expected: "triggered",
    check: (results) => {
      expect(resultOf(results, PAST_LIFESPAN).suggestion).toEqual(PAST_LIFESPAN_OUTCOME);
      expect(ageReason(results, PAST_LIFESPAN)).toMatchObject({
        age: FOIL_WITHOUT,
        documentation: "without",
        material_code: "foil",
      });
    },
  },
  {
    id: "A3",
    rule: PAST_LIFESPAN,
    spec: { [TYPE]: "foil", [DOCS]: "declaration_of_conformity", [MEMBRANE_YEAR]: AT_LIMIT },
    expected: "not_triggered",
    check: (results) => {
      expect(ageReason(results, PAST_LIFESPAN).documentation).toBe("with");
    },
  },
  {
    id: "A4",
    rule: PAST_LIFESPAN,
    spec: { [TYPE]: "foil", [DOCS]: EMPTY, [MEMBRANE_YEAR]: AT_LIMIT },
    expected: "triggered",
    check: (results) => {
      expect(ageReason(results, PAST_LIFESPAN)).toMatchObject({
        documentation: "without",
        code: "documentation_not_stated",
      });
    },
  },
  {
    id: "A5",
    rule: PAST_LIFESPAN,
    spec: { [TYPE]: "foil", [DOCS]: "other_written", [MEMBRANE_YEAR]: AT_LIMIT },
    expected: "triggered",
  },
  {
    id: "A6",
    rule: PAST_LIFESPAN,
    spec: { [TYPE]: "unknown", [MEMBRANE_YEAR]: 2005 },
    expected: "not_evaluated",
    check: (results) => {
      expect(ageReason(results, PAST_LIFESPAN).code).toBe("material_unknown");
      // Regelen for sjikt fra før 2000 gjelder alle typer og slår ikke til i 2005 (A228)
      expect(resultOf(results, BEFORE_2000).state).toBe("not_triggered");
    },
  },
  {
    id: "A7",
    rule: PAST_LIFESPAN,
    spec: { [TYPE]: "foil", [MEMBRANE_YEAR]: YEAR + 1 },
    expected: "not_evaluated",
    check: (results) => {
      expect(ageReason(results, PAST_LIFESPAN).code).toBe("year_after_inspection");
    },
  },
  {
    id: "A8",
    rule: PAST_LIFESPAN,
    spec: {
      [TYPE]: "foil",
      [DOCS]: "none",
      [MEMBRANE_YEAR]: EMPTY,
      [BUILD_YEAR]: AT_LIMIT,
      [SOURCE]: "owner_stated",
    },
    expected: "triggered",
    check: (results) => {
      expect(ageReason(results, PAST_LIFESPAN)).toMatchObject({
        year: AT_LIMIT,
        year_element_key: BUILD_YEAR,
        year_source: "owner_stated",
      });
    },
  },
  {
    id: "A9",
    rule: PAST_LIFESPAN,
    spec: { [TYPE]: "foil", [DOCS]: "none", [MEMBRANE_YEAR]: EMPTY, [BUILD_YEAR]: EMPTY },
    expected: "not_evaluated",
    check: (results) => {
      expect(ageReason(results, PAST_LIFESPAN).code).toBe("year_missing");
    },
  },
  // --- Før 2000 ---
  {
    id: "B1",
    rule: BEFORE_2000,
    spec: { [TYPE]: "foil", [MEMBRANE_YEAR]: CUT_YEAR },
    expected: "triggered",
    check: (results) => {
      expect(resultOf(results, BEFORE_2000).suggestion).toEqual(BEFORE_2000_OUTCOME);
    },
  },
  {
    id: "B2",
    rule: BEFORE_2000,
    spec: { [TYPE]: "foil", [DOCS]: "none", [MEMBRANE_YEAR]: CUT_YEAR + 1 },
    expected: "not_triggered",
    check: (results) => {
      // 2000 og folie uten dokumentasjon: over levetiden, så TG2 for alder
      expect(YEAR - (CUT_YEAR + 1)).toBeGreaterThanOrEqual(FOIL_WITHOUT);
      expect(resultOf(results, PAST_LIFESPAN).state).toBe("triggered");
    },
  },
  {
    id: "B3",
    rule: BEFORE_2000,
    spec: { [TYPE]: "foil", [MEMBRANE_YEAR]: 1990 },
    expected: "triggered",
    check: (results) => {
      // Bare TG3, ikke TG2 i tillegg
      expect(resultOf(results, PAST_LIFESPAN).state).toBe("not_triggered");
      expect(resultOf(results, PAST_LIFESPAN).suggestion).toBeNull();
    },
  },
  {
    id: "B4 ukjent type",
    rule: BEFORE_2000,
    spec: { [TYPE]: "unknown", [MEMBRANE_YEAR]: 1990 },
    expected: "triggered",
  },
  {
    id: "B4 tom type",
    rule: BEFORE_2000,
    spec: { [TYPE]: EMPTY, [MEMBRANE_YEAR]: 1990 },
    expected: "triggered",
  },
  {
    id: "B5",
    rule: BEFORE_2000,
    spec: { [BUILD_YEAR]: 1990, [MEMBRANE_YEAR]: 2015 },
    expected: "not_triggered",
  },
  {
    id: "B6",
    rule: BEFORE_2000,
    spec: { [BUILD_YEAR]: 1995, [SOURCE]: "estimated", [MEMBRANE_YEAR]: EMPTY },
    expected: "triggered",
    check: (results) => {
      expect(ageReason(results, BEFORE_2000)).toMatchObject({
        year: 1995,
        year_element_key: BUILD_YEAR,
        year_source: "estimated",
      });
    },
  },
  {
    id: "B7",
    rule: BEFORE_2000,
    spec: { [MEMBRANE_YEAR]: EMPTY, [BUILD_YEAR]: EMPTY },
    expected: "not_evaluated",
  },
  // --- Fukt ---
  {
    id: "F1",
    rule: MOISTURE,
    spec: {
      [HOLE]: "done_with_findings",
      [READING]: Math.round((LIMIT - 0.1) * 10) / 10,
      [UNIT]: LIMIT_UNIT,
    },
    expected: "not_triggered",
  },
  {
    id: "F2",
    rule: MOISTURE,
    spec: { [HOLE]: "done_with_findings", [READING]: LIMIT, [UNIT]: LIMIT_UNIT },
    expected: "triggered",
    check: (results) => {
      expect(resultOf(results, MOISTURE).suggestion).toEqual(MOISTURE_OUTCOME);
      const reason = reasonsOf(results, MOISTURE).find((r) => r.type === "number_vs_limit")!;
      expect(reason).toMatchObject({
        value: LIMIT,
        unit: LIMIT_UNIT,
        limit: LIMIT,
        threshold_key: THRESHOLD?.key,
      });
    },
  },
  {
    id: "F3",
    rule: MOISTURE,
    spec: { [HOLE]: "done_no_findings", [READING]: LIMIT, [UNIT]: LIMIT_UNIT },
    expected: "triggered",
  },
  {
    id: "F4",
    rule: MOISTURE,
    spec: { [HOLE]: "done_with_findings", [READING]: ANY_READING, [UNIT]: "relative_humidity" },
    expected: "not_evaluated",
    check: (results) => {
      const codes = reasonsOf(results, MOISTURE).map((r) => r.code);
      expect(codes).toContain("unit_not_supported");
    },
  },
  {
    id: "F5 tom måleverdi",
    rule: MOISTURE,
    spec: { [HOLE]: "done_with_findings", [READING]: EMPTY, [UNIT]: LIMIT_UNIT },
    expected: "not_evaluated",
  },
  {
    id: "F5 tom enhet",
    rule: MOISTURE,
    spec: { [HOLE]: "done_with_findings", [READING]: ANY_READING, [UNIT]: EMPTY },
    expected: "not_evaluated",
  },
  {
    id: "F5 negativ",
    rule: MOISTURE,
    spec: { [HOLE]: "done_with_findings", [READING]: -1, [UNIT]: LIMIT_UNIT },
    expected: "not_evaluated",
  },
  {
    id: "F5 tekst",
    rule: MOISTURE,
    spec: { [HOLE]: "done_with_findings", [READING]: "abc", [UNIT]: LIMIT_UNIT },
    expected: "not_evaluated",
  },
  {
    id: "F6",
    rule: MOISTURE,
    spec: { [HOLE]: "not_done", [READING]: EMPTY },
    expected: "not_triggered",
  },
  {
    id: "F7",
    rule: MOISTURE,
    spec: { [HOLE]: EMPTY },
    expected: "not_evaluated",
  },
  // --- Hulltaking ---
  ...(["owner_refused", "no_access", "concrete_or_masonry", "other", EMPTY] as const).map(
    (reason): ListedCase => ({
      id: `H1 ${reason === EMPTY ? "uten grunn" : reason}`,
      rule: NOT_DRILLED,
      spec: { [HOLE]: "not_done", [REASON]: reason },
      expected: "triggered",
      check: (results) => {
        expect(resultOf(results, NOT_DRILLED).suggestion).toEqual({
          kind: "tgiu",
          checkpoint_key: ADJACENT,
        });
      },
    }),
  ),
  {
    id: "H2",
    rule: NOT_DRILLED,
    spec: { [HOLE]: "done_no_findings" },
    expected: "not_triggered",
  },
  {
    id: "H3",
    rule: NOT_DRILLED,
    spec: { [HOLE]: EMPTY },
    expected: "not_evaluated",
  },
];

// =================================================================================================

describe("4 regeltestene for badet", () => {
  it("grensene er lest fra dataene", () => {
    expect(THRESHOLD, "fuktregelen bruker en terskel i thresholds.ts").toBeDefined();
    expect(Number.isFinite(LIMIT)).toBe(true);
    expect(Number.isFinite(FOIL_WITHOUT)).toBe(true);
    expect(Number.isFinite(CUT_YEAR)).toBe(true);
  });

  it("malen har testsaker", () => {
    expect(TEMPLATE.rule_test_cases.length).toBeGreaterThanOrEqual(LISTED.length);
  });

  it.each(TEMPLATE.rule_test_cases.map((tc) => ({ title: `${tc.rule_key}: ${tc.name}`, tc })))(
    "4.1 all_test_cases_pass: $title",
    ({ tc }) => {
      const result = runCases().find(
        (r) => r.rule_key === tc.rule_key && r.name === tc.name && r.sort_order === tc.sort_order,
      );
      expect(result, "testsaken ble kjørt").toBeDefined();
      expect(
        { passed: result!.passed, failure: result!.failure, state: result!.result?.state },
        JSON.stringify(result!.result?.reasons),
      ).toEqual({ passed: true, failure: null, state: tc.expected_state });
    },
  );

  it("4.1 all_test_cases_pass: ett resultat per testsak", () => {
    const results = runCases();
    expect(results).toHaveLength(TEMPLATE.rule_test_cases.length);
    expect(results.filter((r) => !r.passed)).toEqual([]);
  });

  it.each(RULE_KEYS)("4.2 coverage_per_rule: %s har alle tre tilstandene", (key) => {
    const states = new Set(
      TEMPLATE.rule_test_cases.filter((tc) => tc.rule_key === key).map((tc) => tc.expected_state),
    );
    expect([...states].sort()).toEqual(["not_evaluated", "not_triggered", "triggered"]);
  });

  it("4.2 coverage_per_rule: kantverdiene finnes (A1/A2 alder, B1/B2 år 2000, F1/F2 fukt)", () => {
    for (const id of ["A1", "A2", "B1", "B2", "F1", "F2"]) {
      const listed = LISTED.find((c) => c.id === id)!;
      const found = TEMPLATE.rule_test_cases.some(
        (tc) =>
          tc.rule_key === listed.rule &&
          tc.expected_state === listed.expected &&
          inputMatches(tc.input, listed.spec),
      );
      expect(found, `kantverdien ${id} finnes som testsak`).toBe(true);
    }
  });

  it("4.3 test_cases_can_fail: en snudd forventning gir passed = false", () => {
    const copy = structuredClone(TEMPLATE);
    const target = copy.rule_test_cases.find((tc) => tc.expected_state === "triggered")!;
    target.expected_state = "not_triggered";
    const result = runCases(copy).find(
      (r) => r.rule_key === target.rule_key && r.name === target.name,
    )!;
    expect(result).toMatchObject({ passed: false, failure: "state_mismatch" });
    // Og en testsak for en regel som ikke finnes
    const missing = structuredClone(TEMPLATE);
    missing.rule_test_cases = [{ ...target, rule_key: "wet_room.no_such_rule" }];
    expect(runCases(missing)[0]).toMatchObject({ passed: false, failure: "rule_missing" });
  });

  it("4.4 inspection_year_set: hver testsak har befaringsår, og input har det ikke", () => {
    for (const tc of TEMPLATE.rule_test_cases) {
      expect(tc.inspection_year, `${tc.rule_key}: ${tc.name}`).not.toBeNull();
      for (const key of Object.keys(tc.input)) {
        expect(key, `${tc.rule_key}: ${tc.name}`).not.toMatch(/inspection|befaring/i);
        expect(key, `${tc.rule_key}: ${tc.name}`).toMatch(/^wet_room\./);
      }
    }
  });

  it.each(LISTED.map((c) => ({ ...c, title: `${c.id} ${c.rule} gir ${c.expected}` })))(
    "4.5 each_listed_case_exists: $title",
    ({ rule, spec, expected, inspectionYear, check }) => {
      const year = inspectionYear ?? YEAR;
      // Direkte med motoren
      const results = evaluate(answersOf(spec), year);
      const result = resultOf(results, rule);
      expect(result.state, JSON.stringify(result.reasons)).toBe(expected);
      if (expected !== "triggered") expect(result.suggestion).toBeNull();
      check?.(results);
      // Og som testsak i malen
      const found = TEMPLATE.rule_test_cases.filter(
        (tc) =>
          tc.rule_key === rule &&
          tc.expected_state === expected &&
          (tc.inspection_year ?? null) === year &&
          inputMatches(tc.input, spec),
      );
      expect(found.length, "testsaken står i malen").toBeGreaterThanOrEqual(1);
    },
  );
});

describe("4.6–4.8 svar 59a (T-0003, kan ikke fjernes)", () => {
  const below = Math.round((LIMIT - 1) * 10) / 10;

  it.each(["done_no_findings", "done_with_findings"])(
    "4.6 59a_per_checkpoint: bad fra 1985, %s, fukt under grensen",
    (hole) => {
      const results = evaluate({
        [BUILD_YEAR]: 1985,
        [HOLE]: hole,
        [READING]: below,
        [UNIT]: LIMIT_UNIT,
      });
      // Ingen forslag på tilliggende konstruksjoner
      const onAdjacent = results.filter(
        (r) => r.state === "triggered" && r.suggestion?.checkpoint_key === ADJACENT,
      );
      expect(onAdjacent).toEqual([]);
      expect(resultOf(results, MOISTURE).state).toBe("not_triggered");
      expect(resultOf(results, NOT_DRILLED).state).toBe("not_triggered");
      // TG3-forslaget på det vanntette sjiktet kommer fortsatt
      const before2000 = resultOf(results, BEFORE_2000);
      expect(before2000.state).toBe("triggered");
      expect(before2000.suggestion).toEqual(BEFORE_2000_OUTCOME);
    },
  );

  it.each(["done_no_findings", "done_with_findings"])(
    "4.6 59a: %s med fukt lik grensen gir valg mellom TG2 og TG3 på tilliggende",
    (hole) => {
      const results = evaluate({
        [BUILD_YEAR]: 1985,
        [HOLE]: hole,
        [READING]: LIMIT,
        [UNIT]: LIMIT_UNIT,
      });
      expect(resultOf(results, MOISTURE).suggestion).toEqual(MOISTURE_OUTCOME);
      const outcome = TEMPLATE.outcomes.find(
        (o) =>
          o.checkpoint_key === ADJACENT &&
          o.question_key === MOISTURE_OUTCOME.question_key &&
          o.key === MOISTURE_OUTCOME.outcome_key,
      );
      expect(outcome?.kind).toBe("choose_tg2_tg3");
    },
  );

  it("4.7 59a_no_age_rule_on_adjacent: ingen regel på tilliggende leser alder", () => {
    const adjacentRules = TEMPLATE.rules.filter(
      (r) =>
        r.target_checkpoint_key === ADJACENT || r.suggested_outcome?.checkpoint_key === ADJACENT,
    );
    expect(adjacentRules.map((r) => r.key).sort()).toEqual([MOISTURE, NOT_DRILLED].sort());
    for (const r of adjacentRules) {
      const conditions = TEMPLATE.rule_conditions.filter((c) => c.rule_key === r.key);
      for (const c of conditions) {
        expect(c.type, r.key).not.toBe("age_vs_lifespan");
        expect(c.type, r.key).not.toBe("build_year");
        for (const field of [
          c.element_key,
          c.age_year_element_key,
          c.age_fallback_year_element_key,
        ]) {
          expect([BUILD_YEAR, MEMBRANE_YEAR], r.key).not.toContain(field);
        }
      }
    }
  });

  it.each(["owner_refused", "no_access", "concrete_or_masonry", "other", null])(
    "4.8 no_tgiu_and_outcome_together: not_done med grunn %s gir bare TGIU på tilliggende",
    (reason) => {
      const answers: Answers = {
        [BUILD_YEAR]: 1985,
        [HOLE]: "not_done",
        // Selv med en måling som står igjen fra før
        [READING]: LIMIT + 5,
        [UNIT]: LIMIT_UNIT,
      };
      if (reason !== null) answers[REASON] = reason;
      const results = evaluate(answers);
      const onAdjacent = results.filter(
        (r) => r.state === "triggered" && r.suggestion?.checkpoint_key === ADJACENT,
      );
      expect(onAdjacent.map((r) => r.suggestion)).toEqual([
        { kind: "tgiu", checkpoint_key: ADJACENT },
      ]);
      expect(resultOf(results, MOISTURE).state).toBe("not_triggered");
    },
  );
});

describe("4.9 og 10.2 begrunnelsen og forslagene", () => {
  const allResults = () =>
    TEMPLATE.rule_test_cases.flatMap((tc) =>
      evaluate(tc.input, tc.inspection_year).map((result) => ({ tc, result })),
    );

  it("4.9 reasons_no_personal_data: bare koder og tall i begrunnelsen", () => {
    const pairs = allResults();
    expect(pairs.length).toBeGreaterThan(0);
    for (const { tc, result } of pairs) {
      const text = JSON.stringify(result.reasons);
      const where = `${tc.rule_key}: ${tc.name} / ${result.rule_key}`;
      expect(text, where).not.toContain("@");
      expect(text, where).not.toMatch(/\d{8,}/);
      expect(text, where).not.toMatch(/\s/);
    }
  });

  it("4.9 fritekst i svarene havner aldri i begrunnelsen", () => {
    const results = evaluate({
      [TYPE]: "Ola Nordmann, Storgata 1",
      [DOCS]: "kari@example.com",
      [SOURCE]: "Telefon 99999999",
      [BUILD_YEAR]: 1985,
      [HOLE]: "done_with_findings",
      [READING]: LIMIT + 1,
      [UNIT]: "Oppdiktet enhet",
      [REASON]: "Eier sa nei",
    });
    const text = JSON.stringify(results);
    for (const leak of ["Ola", "Storgata", "kari@", "99999999", "Oppdiktet", "Eier sa"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("10.2 no_tg0_suggestion: forslagene er bare utfall med TG2, TG3 eller valg, og TGIU", () => {
    for (const { result } of allResults()) {
      if (result.suggestion === null) continue;
      expect(["outcome", "tgiu"]).toContain(result.suggestion.kind);
      if (result.suggestion.kind === "outcome") {
        const { checkpoint_key, question_key, outcome_key } = result.suggestion;
        const outcome = TEMPLATE.outcomes.find(
          (o) =>
            o.checkpoint_key === checkpoint_key &&
            o.question_key === question_key &&
            o.key === outcome_key,
        );
        expect(outcome, `${question_key}/${outcome_key} finnes`).toBeDefined();
        expect(["tg2", "tg3", "choose_tg2_tg3"]).toContain(outcome!.kind);
      }
      expect(JSON.stringify(result)).not.toMatch(/tg0/i);
    }
  });
});
