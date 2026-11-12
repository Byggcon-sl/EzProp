import { afterEach, describe, expect, it, vi } from "vitest";
import type { TemplateDocument } from "@/core/templates";
import { RULE_CONDITION_TYPES } from "@/db/schema";
import {
  CONDITION_REASON_CODES,
  SUPPORTED_CONDITION_TYPES,
  evaluateRules,
  runRuleTestCases,
  type EvaluateRulesInput,
  type JsonValue,
  type LifespanEntry,
  type LifespanSet,
  type RuleResult,
  type ThresholdEntry,
  type ThresholdSet,
} from "./index";

/*
 * Regelmotoren (docs/funksjoner/fase2a-regler-bad-testplan.md avsnitt 1). Ren test uten database.
 *
 * Motoren prøves med små dokumenter laget her, med andre koder enn badmalen (`x.*`), så vi vet at
 * ingen feltkode, valgkode eller materialkode er skrevet inn i motoren. Levetidene og tersklene er
 * også laget her; grensene i badmalen prøves i `src/db/seed/templates/wet-room.rules.test.ts`.
 *
 * Støtter hovedmål:
 * - Færre reklamasjoner: tomt eller ugyldig felt og ukjent betingelsestype gir alltid «ikke
 *   vurdert», aldri en stille «slår ikke til» (T-0015). Strengeste levetidstrinn vinner.
 * - De ansatte: samme svar hver gang, på iPaden og på PC-en.
 * - KI i bunnen: svaret har bare faste koder og tall, ingen id-er og ingen fritekst.
 *
 * Testdata er oppdiktet. Befaringsåret er fast (2026), aldri dagens dato.
 */

afterEach(() => {
  vi.useRealTimers();
});

const YEAR = 2026;

type RuleDoc = TemplateDocument["rules"][number];
type ConditionDoc = TemplateDocument["rule_conditions"][number];
type OutcomeDoc = TemplateDocument["outcomes"][number];
type OptionDoc = TemplateDocument["element_options"][number];
type Doc = EvaluateRulesInput["document"];
type Answers = Record<string, JsonValue>;

// --- Dokumentet --------------------------------------------------------------------------------

const CP = "x.point";
const QUESTION = "x.point.state";

function outcome(key: string, kind: OutcomeDoc["kind"]): OutcomeDoc {
  return {
    checkpoint_key: CP,
    question_key: QUESTION,
    key,
    kind,
    deviation_text: "Oppdiktet avvik.",
    default_cause_text: null,
    default_cause_criterion: null,
    default_consequence_text: null,
    source_ref: null,
    text_status: "draft",
    sort_order: 0,
  };
}

const OUTCOMES: OutcomeDoc[] = [
  outcome("worn", "tg2"),
  outcome("old", "tg3"),
  outcome("pick", "choose_tg2_tg3"),
];

const WORN = { checkpoint_key: CP, question_key: QUESTION, outcome_key: "worn" };
const OLD = { checkpoint_key: CP, question_key: QUESTION, outcome_key: "old" };

function option(elementKey: string, key: string, materialCode: string | null = null): OptionDoc {
  return { element_key: elementKey, key, label: key, material_code: materialCode, sort_order: 0 };
}

/** Tre ja/nei-felt til treverditabellene: `yes` = sann, `no` = usann, tomt = ukjent. */
const FLAGS = ["x.p", "x.q", "x.r", "x.s"] as const;

const OPTIONS: OptionDoc[] = [
  ...FLAGS.flatMap((flag) => [option(flag, "yes"), option(flag, "no")]),
  option("x.material", "plate", "plate"),
  option("x.material", "paint", "paint"),
  option("x.material", "glass", "glass"),
  option("x.material", "unknown", "unknown"),
  option("x.doc", "papers"),
  option("x.doc", "none"),
  option("x.doc", "other_paper"),
  option("x.source", "owner"),
  option("x.source", "guess"),
  option("x.unit", "wp"),
  option("x.unit", "rh"),
];

function rule(key: string, extra: Partial<RuleDoc> = {}): RuleDoc {
  return {
    key,
    name: `Regel ${key}`,
    purpose: "suggest_outcome",
    match: "all",
    target_element_key: null,
    target_section_key: null,
    target_checkpoint_key: CP,
    target_question: null,
    suggested_outcome: WORN,
    validation_code: null,
    severity: null,
    message: "Oppdiktet melding.",
    source_ref: "Oppdiktet kilde",
    active: true,
    sort_order: 0,
    ...extra,
  };
}

function tgiuRule(key: string, extra: Partial<RuleDoc> = {}): RuleDoc {
  return rule(key, { purpose: "suggest_tgiu", suggested_outcome: null, ...extra });
}

function condition(ruleKey: string, extra: Partial<ConditionDoc> = {}): ConditionDoc {
  return {
    rule_key: ruleKey,
    group_no: null,
    type: "option_selected",
    element_key: null,
    checkpoint_key: null,
    operator: null,
    value: null,
    threshold_key: null,
    age_year_element_key: null,
    age_fallback_year_element_key: null,
    age_source_element_key: null,
    documentation_element_key: null,
    material_element_key: null,
    unit_element_key: null,
    sort_order: 0,
    ...extra,
  };
}

/** `x.p er yes` og lignende. */
function flagIsYes(ruleKey: string, flag: string, extra: Partial<ConditionDoc> = {}) {
  return condition(ruleKey, {
    type: "option_selected",
    element_key: flag,
    operator: "in",
    value: ["yes"],
    ...extra,
  });
}

const THRESHOLD_KEY = "x_limit";

function fixedLimit(
  ruleKey: string,
  operator: ConditionDoc["operator"],
  value: number,
  extra: Partial<ConditionDoc> = {},
) {
  return condition(ruleKey, {
    type: "number_vs_limit",
    element_key: "x.reading",
    operator,
    value,
    ...extra,
  });
}

function thresholdLimit(ruleKey: string, extra: Partial<ConditionDoc> = {}) {
  return condition(ruleKey, {
    type: "number_vs_limit",
    element_key: "x.reading",
    threshold_key: THRESHOLD_KEY,
    unit_element_key: "x.unit",
    ...extra,
  });
}

/** «Uten dokumentasjon» = `none` eller `other_paper`. Motoren kjenner ikke kodene. */
const WITHOUT_DOCS = ["none", "other_paper"];

function ageCondition(ruleKey: string, extra: Partial<ConditionDoc> = {}) {
  return condition(ruleKey, {
    type: "age_vs_lifespan",
    age_year_element_key: "x.year",
    age_fallback_year_element_key: "x.year_fallback",
    age_source_element_key: "x.source",
    documentation_element_key: "x.doc",
    material_element_key: "x.material",
    value: WITHOUT_DOCS,
    ...extra,
  });
}

function doc(rules: RuleDoc[], conditions: ConditionDoc[]): Doc {
  return { rules, rule_conditions: conditions, outcomes: OUTCOMES, element_options: OPTIONS };
}

// --- Levetider og terskler (oppdiktede tall, bare for motoren) ----------------------------------

function entry(extra: Partial<LifespanEntry> & Pick<LifespanEntry, "key">): LifespanEntry {
  return {
    material_code: null,
    component: "Oppdiktet komponent",
    from_year: null,
    to_year: null,
    min_age: null,
    documentation: "any",
    outcome_kind: "tg2",
    source_ref: "Oppdiktet kilde",
    sort_order: 0,
    status: "draft",
    ...extra,
  };
}

const LIFESPANS: LifespanSet = {
  key: "x_lifespans",
  entries: [
    entry({
      key: "plate_without",
      material_code: "plate",
      min_age: 18,
      documentation: "without",
      sort_order: 0,
    }),
    entry({
      key: "plate_with",
      material_code: "plate",
      min_age: 25,
      documentation: "with",
      sort_order: 1,
    }),
    entry({ key: "paint_any", material_code: "paint", min_age: 7, sort_order: 2 }),
    entry({ key: "before_cut", to_year: 1999, outcome_kind: "tg3", sort_order: 3 }),
  ],
};

const minAge = (key: string) => LIFESPANS.entries.find((e) => e.key === key)!.min_age!;
const PLATE_WITHOUT = minAge("plate_without");
const PLATE_WITH = minAge("plate_with");
const CUT_YEAR = LIFESPANS.entries.find((e) => e.key === "before_cut")!.to_year!;

function threshold(extra: Partial<ThresholdEntry> = {}): ThresholdEntry {
  return {
    key: THRESHOLD_KEY,
    description: "Oppdiktet måling",
    unit: "wp",
    value: 10,
    comparator: "gte",
    source_ref: "Oppdiktet kilde",
    status: "draft",
    ...extra,
  };
}

const THRESHOLDS: ThresholdSet = { key: "x_thresholds", entries: [threshold()] };
const LIMIT = THRESHOLDS.entries[0]!.value;

// --- Kjøring -----------------------------------------------------------------------------------

const SYSTEM = { kind: "system", reportType: "condition_report" } as const;

function input(document: Doc, answers: Answers, extra: Partial<EvaluateRulesInput> = {}) {
  return {
    template: SYSTEM,
    document,
    answers,
    inspectionYear: YEAR,
    lifespans: LIFESPANS,
    thresholds: THRESHOLDS,
    ...extra,
  } as EvaluateRulesInput;
}

function evaluate(document: Doc, answers: Answers, extra: Partial<EvaluateRulesInput> = {}) {
  return evaluateRules(input(document, answers, extra));
}

/** Svaret fra én regel. Feiler testen hvis regelen ikke ga svar. */
function one(results: RuleResult[], key: string): RuleResult {
  const found = results.find((r) => r.rule_key === key);
  if (!found) throw new Error(`regelen ${key} ga ikke svar: ${JSON.stringify(results)}`);
  return found;
}

function stateOf(document: Doc, answers: Answers, key: string, extra = {}) {
  return one(evaluate(document, answers, extra), key).state;
}

type Truth = "true" | "false" | "unknown";
function flagAnswer(truth: Truth): JsonValue | undefined {
  return truth === "true" ? "yes" : truth === "false" ? "no" : undefined;
}
function flagAnswers(truths: Record<string, Truth>): Answers {
  const out: Answers = {};
  for (const [flag, truth] of Object.entries(truths)) {
    const value = flagAnswer(truth);
    if (value !== undefined) out[flag] = value;
  }
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CODE = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

/** Alle strenger i en verdi (rekursivt). */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(stringsIn);
  }
  return [];
}

/** Alle verdier som ikke er tekst, tall, boolsk, null, liste eller objekt. */
function oddValuesIn(value: unknown): unknown[] {
  if (value === null) return [];
  if (["string", "number", "boolean"].includes(typeof value)) return [];
  if (Array.isArray(value)) return value.flatMap(oddValuesIn);
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(oddValuesIn);
  }
  return [value];
}

// --- Et dokument med alle tre betingelsestypene --------------------------------------------------

function mixedDocument(): Doc {
  return doc(
    [
      tgiuRule("x.option_rule", { sort_order: 0 }),
      rule("x.limit_rule", { sort_order: 1, suggested_outcome: OLD }),
      rule("x.age_rule", { sort_order: 2 }),
    ],
    [flagIsYes("x.option_rule", "x.p"), thresholdLimit("x.limit_rule"), ageCondition("x.age_rule")],
  );
}

const MIXED_TRIGGERING: Answers = {
  "x.p": "yes",
  "x.reading": LIMIT + 1,
  "x.unit": "wp",
  "x.year": YEAR - PLATE_WITHOUT,
  "x.source": "owner",
  "x.doc": "none",
  "x.material": "plate",
};

// =================================================================================================

describe("1.1 form og determinisme", () => {
  it("1.1.1 same_input_same_output: samme svar to ganger, og input er ikke endret", () => {
    const original = input(mixedDocument(), MIXED_TRIGGERING);
    const before = structuredClone(original);
    const first = evaluateRules(original);
    const second = evaluateRules(original);
    expect(second).toEqual(first);
    expect(original).toEqual(before);
    expect(first.map((r) => r.state)).toEqual(["triggered", "triggered", "triggered"]);
  });

  it("1.1.2 no_date_inside: dagens dato påvirker ikke svaret (bare inspectionYear)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-06-01T12:00:00Z"));
    const in2030 = evaluate(mixedDocument(), MIXED_TRIGGERING);
    vi.setSystemTime(new Date("2020-06-01T12:00:00Z"));
    const in2020 = evaluate(mixedDocument(), MIXED_TRIGGERING);
    expect(in2020).toEqual(in2030);
    // Et år før grensen er fortsatt ikke over levetiden, uansett klokken
    vi.setSystemTime(new Date("2040-01-01T12:00:00Z"));
    const younger = { ...MIXED_TRIGGERING, "x.year": YEAR - PLATE_WITHOUT + 1 };
    expect(stateOf(mixedDocument(), younger, "x.age_rule")).toBe("not_triggered");
  });

  it("1.1.3 result_shape_codes_only: faste felt, ingen id-er, ingen fritekst", () => {
    const answerSets: Answers[] = [
      MIXED_TRIGGERING,
      {},
      { ...MIXED_TRIGGERING, "x.reading": "abc", "x.material": "unknown", "x.doc": null },
    ];
    for (const answers of answerSets) {
      for (const result of evaluate(mixedDocument(), answers)) {
        expect(Object.keys(result).sort()).toEqual(
          [
            "code",
            "lifespan_set_key",
            "purpose",
            "reasons",
            "rule_key",
            "state",
            "suggestion",
            "threshold_set_key",
          ].sort(),
        );
        for (const text of stringsIn(result)) {
          expect(UUID.test(text), `id i svaret: ${text}`).toBe(false);
          expect(/\s/.test(text), `fritekst i svaret: «${text}»`).toBe(false);
        }
        for (const text of stringsIn(result.reasons)) {
          expect(text, "begrunnelsen har bare koder").toMatch(CODE);
        }
        expect(oddValuesIn(result)).toEqual([]);
        // Meldingen og navnet fra malen er ikke med i svaret
        expect(JSON.stringify(result)).not.toContain("Oppdiktet");
      }
    }
  });

  it("1.1.4 one_result_per_active_rule: ett svar per regel, i sort_order og så kode", () => {
    const document = doc(
      [
        tgiuRule("x.c", { sort_order: 2 }),
        tgiuRule("x.b", { sort_order: 1 }),
        tgiuRule("x.a2", { sort_order: 0 }),
        tgiuRule("x.a1", { sort_order: 0 }),
      ],
      ["x.c", "x.b", "x.a2", "x.a1"].map((key) => flagIsYes(key, "x.p")),
    );
    const results = evaluate(document, { "x.p": "yes" });
    expect(results.map((r) => r.rule_key)).toEqual(["x.a1", "x.a2", "x.b", "x.c"]);
  });
});

describe("1.2 hvilke regler kjøres", () => {
  it("1.2.5 inactive_rule_skipped: active = false gir ikke noe svar", () => {
    const document = doc(
      [tgiuRule("x.on"), tgiuRule("x.off", { active: false })],
      [flagIsYes("x.on", "x.p"), flagIsYes("x.off", "x.p")],
    );
    expect(evaluate(document, { "x.p": "yes" }).map((r) => r.rule_key)).toEqual(["x.on"]);
  });

  it("1.2.6 deleted_rule_skipped: regel med deleted_at gir ikke noe svar", () => {
    // Dokumentet fra malmotoren har aldri slettede rader, men motoren skal ikke stole på det
    const deleted = { ...tgiuRule("x.gone"), deleted_at: "2026-11-01T10:00:00.000Z" } as RuleDoc;
    const document = doc(
      [tgiuRule("x.on"), deleted],
      [flagIsYes("x.on", "x.p"), flagIsYes("x.gone", "x.p")],
    );
    expect(evaluate(document, { "x.p": "yes" }).map((r) => r.rule_key)).toEqual(["x.on"]);
  });

  it.each([
    { name: "active = false", extra: { active: false } },
    { name: "deleted_at satt", extra: { deleted_at: "2026-11-01T10:00:00.000Z" } },
  ])(
    "1.2.7 inactive_or_deleted_condition_ignored: betingelse med $name påvirker ikke svaret",
    ({ extra }) => {
      const ignored = { ...flagIsYes("x.rule", "x.q"), ...extra } as ConditionDoc;
      const document = doc([tgiuRule("x.rule")], [flagIsYes("x.rule", "x.p"), ignored]);
      // x.q er usann, men betingelsen skal ikke telle: regelen slår til på x.p alene
      expect(stateOf(document, { "x.p": "yes", "x.q": "no" }, "x.rule")).toBe("triggered");
      // x.q er tom (ukjent), og heller ikke det skal gjøre regelen ukjent
      expect(stateOf(document, { "x.p": "yes" }, "x.rule")).toBe("triggered");
      const result = one(evaluate(document, { "x.p": "yes" }), "x.rule");
      expect(result.reasons).toHaveLength(1);
    },
  );

  it.each([
    { name: "egen mal (custom)", template: { kind: "custom", reportType: "condition_report" } },
    { name: "systemmal med annen rapporttype", template: { kind: "system", reportType: "other" } },
  ])("1.2.8 custom_template_not_evaluated: $name gir not_evaluated", ({ template }) => {
    const results = evaluate(mixedDocument(), MIXED_TRIGGERING, {
      template: template as EvaluateRulesInput["template"],
    });
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.state, result.rule_key).toBe("not_evaluated");
      expect(result.suggestion, result.rule_key).toBeNull();
      expect(result.code, result.rule_key).toBe("tg_logic_not_allowed");
    }
  });

  it.each(["show", "validate"] as const)(
    "1.2.9 other_purpose_not_evaluated: %s slår aldri til",
    (purpose) => {
      const document = doc(
        [rule("x.other", { purpose, suggested_outcome: null })],
        [flagIsYes("x.other", "x.p")],
      );
      const results = evaluate(document, { "x.p": "yes" });
      for (const result of results) {
        expect(result.state).toBe("not_evaluated");
        expect(result.suggestion).toBeNull();
        expect(result.code).toBe("purpose_not_supported");
      }
    },
  );

  const unsupported = RULE_CONDITION_TYPES.filter(
    (type) => !(SUPPORTED_CONDITION_TYPES as readonly string[]).includes(type),
  );

  it("1.2.10 de støttede typene er nøyaktig de tre i kortet", () => {
    expect([...SUPPORTED_CONDITION_TYPES].sort()).toEqual(
      ["age_vs_lifespan", "number_vs_limit", "option_selected"].sort(),
    );
    expect(unsupported.length).toBe(RULE_CONDITION_TYPES.length - 3);
  });

  it.each(unsupported)(
    "1.2.10 unknown_condition_type_not_evaluated: %s gir not_evaluated, aldri not_triggered",
    (type) => {
      const document = doc(
        [tgiuRule("x.alone"), tgiuRule("x.with_true"), tgiuRule("x.any_false", { match: "any" })],
        [
          condition("x.alone", { type, element_key: "x.p", value: "yes" }),
          flagIsYes("x.with_true", "x.p"),
          condition("x.with_true", { type, element_key: "x.p", value: "yes", sort_order: 1 }),
          flagIsYes("x.any_false", "x.q"),
          condition("x.any_false", { type, element_key: "x.p", value: "yes", sort_order: 1 }),
        ],
      );
      const results = evaluate(document, { "x.p": "yes", "x.q": "no" });
      for (const key of ["x.alone", "x.with_true", "x.any_false"]) {
        const result = one(results, key);
        expect(result.state, key).toBe("not_evaluated");
        expect(result.suggestion, key).toBeNull();
      }
      const reason = one(results, "x.alone").reasons[0]!;
      expect(reason).toMatchObject({
        type: "unsupported",
        condition_type: type,
        truth: "unknown",
        code: "condition_type_not_supported",
      });
    },
  );
});

describe("1.3 treverdilogikk", () => {
  it.each<{ a: Truth; b: Truth; expected: RuleResult["state"] }>([
    { a: "true", b: "true", expected: "triggered" },
    { a: "true", b: "false", expected: "not_triggered" },
    { a: "false", b: "unknown", expected: "not_triggered" },
    { a: "unknown", b: "false", expected: "not_triggered" },
    { a: "true", b: "unknown", expected: "not_evaluated" },
    { a: "unknown", b: "unknown", expected: "not_evaluated" },
    { a: "false", b: "false", expected: "not_triggered" },
  ])("1.3.11 match_all: ($a, $b) gir $expected", ({ a, b, expected }) => {
    const document = doc(
      [tgiuRule("x.all", { match: "all" })],
      [flagIsYes("x.all", "x.p"), flagIsYes("x.all", "x.q", { sort_order: 1 })],
    );
    expect(stateOf(document, flagAnswers({ "x.p": a, "x.q": b }), "x.all")).toBe(expected);
  });

  it.each<{ a: Truth; b: Truth; expected: RuleResult["state"] }>([
    { a: "false", b: "true", expected: "triggered" },
    { a: "unknown", b: "true", expected: "triggered" },
    { a: "true", b: "true", expected: "triggered" },
    { a: "false", b: "false", expected: "not_triggered" },
    { a: "false", b: "unknown", expected: "not_evaluated" },
    { a: "unknown", b: "unknown", expected: "not_evaluated" },
  ])("1.3.12 match_any: ($a, $b) gir $expected", ({ a, b, expected }) => {
    const document = doc(
      [tgiuRule("x.any", { match: "any" })],
      [flagIsYes("x.any", "x.p"), flagIsYes("x.any", "x.q", { sort_order: 1 })],
    );
    expect(stateOf(document, flagAnswers({ "x.p": a, "x.q": b }), "x.any")).toBe(expected);
  });

  /*
   * Datamodellen har ikke egen `match` per gruppe: gruppen slås sammen med regelens `match`, og så
   * slås gruppene og betingelsene uten gruppe sammen med samme `match` (types.ts, ADR 0008).
   * Tabellen prøver at en ukjent eller usann verdi inne i en gruppe går riktig videre.
   */
  it.each<{
    match: "all" | "any";
    p: Truth;
    q: Truth;
    r: Truth;
    s: Truth;
    expected: RuleResult["state"];
  }>([
    // all: gruppe 1 (p, q), gruppe 2 (r), uten gruppe (s)
    { match: "all", p: "true", q: "true", r: "true", s: "true", expected: "triggered" },
    { match: "all", p: "true", q: "false", r: "true", s: "true", expected: "not_triggered" },
    { match: "all", p: "true", q: "unknown", r: "true", s: "true", expected: "not_evaluated" },
    { match: "all", p: "unknown", q: "false", r: "true", s: "true", expected: "not_triggered" },
    { match: "all", p: "true", q: "true", r: "unknown", s: "false", expected: "not_triggered" },
    // any
    { match: "any", p: "false", q: "false", r: "false", s: "true", expected: "triggered" },
    { match: "any", p: "unknown", q: "true", r: "false", s: "false", expected: "triggered" },
    { match: "any", p: "unknown", q: "false", r: "false", s: "false", expected: "not_evaluated" },
    { match: "any", p: "false", q: "false", r: "false", s: "false", expected: "not_triggered" },
    { match: "any", p: "false", q: "false", r: "unknown", s: "false", expected: "not_evaluated" },
  ])(
    "1.3.13 groups: match $match, gruppe 1 ($p, $q), gruppe 2 ($r), uten gruppe ($s) gir $expected",
    ({ match, p, q, r, s, expected }) => {
      const document = doc(
        [tgiuRule("x.groups", { match })],
        [
          flagIsYes("x.groups", "x.p", { group_no: 1, sort_order: 0 }),
          flagIsYes("x.groups", "x.q", { group_no: 1, sort_order: 1 }),
          flagIsYes("x.groups", "x.r", { group_no: 2, sort_order: 2 }),
          flagIsYes("x.groups", "x.s", { sort_order: 3 }),
        ],
      );
      const answers = flagAnswers({ "x.p": p, "x.q": q, "x.r": r, "x.s": s });
      expect(stateOf(document, answers, "x.groups")).toBe(expected);
    },
  );

  it("1.3.14 no_conditions: regel uten aktive betingelser gir not_evaluated", () => {
    const document = doc([tgiuRule("x.empty"), rule("x.empty_outcome")], []);
    const results = evaluate(document, { "x.p": "yes" });
    for (const key of ["x.empty", "x.empty_outcome"]) {
      const result = one(results, key);
      expect(result.state, key).toBe("not_evaluated");
      expect(result.code, key).toBe("no_conditions");
      expect(result.suggestion, key).toBeNull();
    }
  });
});

describe("1.4 option_selected", () => {
  const document = doc([tgiuRule("x.opt")], [flagIsYes("x.opt", "x.p")]);

  it.each<{ name: string; answers: Answers; expected: RuleResult["state"] }>([
    { name: "valgt kode i listen", answers: { "x.p": "yes" }, expected: "triggered" },
    { name: "annen kode", answers: { "x.p": "no" }, expected: "not_triggered" },
    { name: "tomt felt (mangler)", answers: {}, expected: "not_evaluated" },
    { name: "tomt felt (null)", answers: { "x.p": null }, expected: "not_evaluated" },
    { name: "tomt felt (tom tekst)", answers: { "x.p": "" }, expected: "not_evaluated" },
    { name: "kode som ikke finnes", answers: { "x.p": "maybe" }, expected: "not_evaluated" },
    { name: "tall i stedet for kode", answers: { "x.p": 1 }, expected: "not_evaluated" },
  ])("1.4.15 $name gir $expected", ({ answers, expected }) => {
    expect(stateOf(document, answers, "x.opt")).toBe(expected);
  });

  it("1.4.15 begrunnelsen har bare valgkoder som finnes i malen", () => {
    const valid = one(evaluate(document, { "x.p": "yes" }), "x.opt").reasons[0]!;
    expect(valid).toMatchObject({
      type: "option_selected",
      element_key: "x.p",
      truth: "true",
      selected_option_keys: ["yes"],
    });
    const invalid = one(evaluate(document, { "x.p": "Fritekst med navn" }), "x.opt").reasons[0]!;
    expect(invalid).toMatchObject({ type: "option_selected", truth: "unknown" });
    expect(JSON.stringify(invalid)).not.toContain("Fritekst");
  });
});

describe("1.5 number_vs_limit", () => {
  it.each<{ operator: "gte" | "gt" | "lte" | "lt" | "eq"; reading: number; truth: boolean }>([
    { operator: "gte", reading: 9, truth: false },
    { operator: "gte", reading: 10, truth: true },
    { operator: "gte", reading: 11, truth: true },
    { operator: "gt", reading: 9, truth: false },
    { operator: "gt", reading: 10, truth: false },
    { operator: "gt", reading: 11, truth: true },
    { operator: "lte", reading: 9, truth: true },
    { operator: "lte", reading: 10, truth: true },
    { operator: "lte", reading: 11, truth: false },
    { operator: "lt", reading: 9, truth: true },
    { operator: "lt", reading: 10, truth: false },
    { operator: "lt", reading: 11, truth: false },
    { operator: "eq", reading: 9, truth: false },
    { operator: "eq", reading: 10, truth: true },
    { operator: "eq", reading: 11, truth: false },
  ])("1.5.16 fixed_value: $reading $operator 10 er $truth", ({ operator, reading, truth }) => {
    const document = doc([tgiuRule("x.fixed")], [fixedLimit("x.fixed", operator, 10)]);
    const result = one(evaluate(document, { "x.reading": reading }), "x.fixed");
    expect(result.state).toBe(truth ? "triggered" : "not_triggered");
    expect(result.reasons[0]).toMatchObject({
      type: "number_vs_limit",
      value: reading,
      limit: 10,
      threshold_key: null,
    });
    expect(result.threshold_set_key).toBeNull();
  });

  it.each([LIMIT - 0.1, LIMIT, LIMIT + 0.1])(
    "1.5.17 threshold_key: %s gir samme svar som fast verdi med samme tall",
    (reading) => {
      const document = doc(
        [tgiuRule("x.thr"), tgiuRule("x.fix")],
        [thresholdLimit("x.thr"), fixedLimit("x.fix", "gte", LIMIT)],
      );
      const results = evaluate(document, { "x.reading": reading, "x.unit": "wp" });
      expect(one(results, "x.thr").state).toBe(one(results, "x.fix").state);
      expect(one(results, "x.thr").state).toBe(reading >= LIMIT ? "triggered" : "not_triggered");
    },
  );

  it("1.5.17 threshold_key: retningen hentes fra terskelen", () => {
    const below: ThresholdSet = {
      key: "x_thresholds_below",
      entries: [threshold({ comparator: "lt", value: 5 })],
    };
    const document = doc([tgiuRule("x.thr")], [thresholdLimit("x.thr")]);
    expect(
      stateOf(document, { "x.reading": 4, "x.unit": "wp" }, "x.thr", { thresholds: below }),
    ).toBe("triggered");
    expect(
      stateOf(document, { "x.reading": 5, "x.unit": "wp" }, "x.thr", { thresholds: below }),
    ).toBe("not_triggered");
  });

  it("1.5.18 unknown_threshold_key: kode som ikke finnes gir not_evaluated med egen kode", () => {
    const document = doc(
      [tgiuRule("x.thr")],
      [thresholdLimit("x.thr", { threshold_key: "x_missing" })],
    );
    const result = one(evaluate(document, { "x.reading": 99, "x.unit": "wp" }), "x.thr");
    expect(result.state).toBe("not_evaluated");
    expect(result.reasons[0]).toMatchObject({ truth: "unknown", code: "threshold_unknown" });
  });

  it.each<{ name: string; reading: JsonValue | undefined }>([
    { name: "mangler", reading: undefined },
    { name: "tom tekst", reading: "" },
    { name: "null", reading: null },
    { name: "negativ", reading: -1 },
    { name: "NaN", reading: Number.NaN },
    { name: "tekst med komma", reading: "14,5" },
    { name: "tekst", reading: "abc" },
    { name: "liste", reading: [20] },
    { name: "boolsk", reading: true },
  ])("1.5.19 invalid_reading: $name gir not_evaluated", ({ reading }) => {
    const document = doc(
      [tgiuRule("x.thr"), tgiuRule("x.fix")],
      [thresholdLimit("x.thr"), fixedLimit("x.fix", "gte", LIMIT)],
    );
    const answers: Answers = { "x.unit": "wp" };
    if (reading !== undefined) answers["x.reading"] = reading;
    const results = evaluate(document, answers);
    for (const key of ["x.thr", "x.fix"]) {
      const result = one(results, key);
      expect(result.state, key).toBe("not_evaluated");
      expect(result.reasons[0]!.truth, key).toBe("unknown");
      expect(result.reasons[0]!.code, key).not.toBeNull();
    }
  });

  it("1.5.20 unit: tom enhet, annen enhet og lik enhet", () => {
    const document = doc([tgiuRule("x.thr")], [thresholdLimit("x.thr")]);
    const empty = one(evaluate(document, { "x.reading": LIMIT + 5 }), "x.thr");
    expect(empty.state).toBe("not_evaluated");
    expect(empty.reasons[0]!.code).toBe("unit_missing");

    const other = one(evaluate(document, { "x.reading": LIMIT + 5, "x.unit": "rh" }), "x.thr");
    expect(other.state).toBe("not_evaluated");
    expect(other.reasons[0]!.code).toBe("unit_not_supported");

    const same = one(evaluate(document, { "x.reading": LIMIT + 5, "x.unit": "wp" }), "x.thr");
    expect(same.state).toBe("triggered");
  });

  it("1.5.21 reasons_measurement: verdi, enhet, grense, retning og terskelkode", () => {
    const document = doc([tgiuRule("x.thr")], [thresholdLimit("x.thr")]);
    const result = one(evaluate(document, { "x.reading": 12.5, "x.unit": "wp" }), "x.thr");
    expect(result.reasons).toEqual([
      expect.objectContaining({
        type: "number_vs_limit",
        element_key: "x.reading",
        value: 12.5,
        unit: "wp",
        threshold_key: THRESHOLD_KEY,
        limit: LIMIT,
        comparator: "gte",
        threshold_status: "draft",
        truth: "true",
      }),
    ]);
    expect(result.threshold_set_key).toBe(THRESHOLDS.key);
  });
});

describe("1.6 age_vs_lifespan", () => {
  function ageDocument(): Doc {
    return doc(
      [rule("x.tg2", { suggested_outcome: WORN }), rule("x.tg3", { suggested_outcome: OLD })],
      [ageCondition("x.tg2"), ageCondition("x.tg3")],
    );
  }

  function ageResults(answers: Answers, extra: Partial<EvaluateRulesInput> = {}) {
    const results = evaluate(ageDocument(), answers, extra);
    return { tg2: one(results, "x.tg2"), tg3: one(results, "x.tg3") };
  }

  const reasonOf = (result: RuleResult) => result.reasons[0] as Record<string, unknown>;

  it("1.6.22 boundary_min_age: alder lik min_age gir trinnet, ett år mindre gir det ikke", () => {
    const base = { "x.material": "plate", "x.doc": "none" };
    expect(ageResults({ ...base, "x.year": YEAR - PLATE_WITHOUT + 1 }).tg2.state).toBe(
      "not_triggered",
    );
    const atLimit = ageResults({ ...base, "x.year": YEAR - PLATE_WITHOUT }).tg2;
    expect(atLimit.state).toBe("triggered");
    expect(reasonOf(atLimit)).toMatchObject({
      type: "age_vs_lifespan",
      age: PLATE_WITHOUT,
      lifespan_entry_key: "plate_without",
      lifespan_outcome_kind: "tg2",
      lifespan_min_age: PLATE_WITHOUT,
      lifespan_status: "draft",
      truth: "true",
    });
  });

  it("1.6.23 year_range: to_year er med, året etter er ikke", () => {
    const base = { "x.material": "paint", "x.doc": "papers" };
    expect(ageResults({ ...base, "x.year": CUT_YEAR }).tg3.state).toBe("triggered");
    expect(ageResults({ ...base, "x.year": CUT_YEAR + 1 }).tg3.state).toBe("not_triggered");
  });

  it("1.6.23 year_range: from_year er med, året før er ikke", () => {
    const fromSet: LifespanSet = {
      key: "x_from",
      entries: [
        // Platen har en rad, så materialet er kjent; den passer aldri her
        entry({ key: "plate_far", material_code: "plate", min_age: 100, documentation: "any" }),
        entry({ key: "from_step", from_year: 2010, outcome_kind: "tg3", sort_order: 1 }),
      ],
    };
    const base = { "x.material": "plate", "x.doc": "papers" };
    expect(ageResults({ ...base, "x.year": 2010 }, { lifespans: fromSet }).tg3.state).toBe(
      "triggered",
    );
    expect(ageResults({ ...base, "x.year": 2009 }, { lifespans: fromSet }).tg3.state).toBe(
      "not_triggered",
    );
  });

  it("1.6.24 strictest_wins: når tg2 og tg3 passer, slår bare tg3-regelen til", () => {
    const { tg2, tg3 } = ageResults({ "x.material": "plate", "x.doc": "none", "x.year": 1990 });
    expect(tg3.state).toBe("triggered");
    expect(reasonOf(tg3)).toMatchObject({
      lifespan_entry_key: "before_cut",
      lifespan_outcome_kind: "tg3",
    });
    expect(tg2.state).toBe("not_triggered");
    expect(tg2.suggestion).toBeNull();
    expect(reasonOf(tg2)).toMatchObject({
      lifespan_outcome_kind: "tg3",
      code: "stricter_step_applies",
    });
  });

  it("1.6.25 documentation_list: valg i listen gir «uten», annet valg gir «med»", () => {
    const year = YEAR - PLATE_WITHOUT; // over «uten», under «med»
    expect(PLATE_WITH).toBeGreaterThan(PLATE_WITHOUT);
    for (const without of WITHOUT_DOCS) {
      const { tg2 } = ageResults({ "x.material": "plate", "x.doc": without, "x.year": year });
      expect(tg2.state, without).toBe("triggered");
      expect(reasonOf(tg2).documentation, without).toBe("without");
    }
    const withDocs = ageResults({ "x.material": "plate", "x.doc": "papers", "x.year": year }).tg2;
    expect(withDocs.state).toBe("not_triggered");
    expect(reasonOf(withDocs).documentation).toBe("with");
    // Med dokumentasjon slår til ved levetiden for «med»
    const old = ageResults({
      "x.material": "plate",
      "x.doc": "papers",
      "x.year": YEAR - PLATE_WITH,
    }).tg2;
    expect(old.state).toBe("triggered");
    expect(reasonOf(old).lifespan_entry_key).toBe("plate_with");
  });

  it.each<{ name: string; doc: JsonValue | undefined }>([
    { name: "mangler", doc: undefined },
    { name: "null", doc: null },
    { name: "tom tekst", doc: "" },
  ])("1.6.25 documentation_list: tomt felt ($name) gir «uten» og koden for ikke oppgitt", (c) => {
    const answers: Answers = { "x.material": "plate", "x.year": YEAR - PLATE_WITHOUT };
    if (c.doc !== undefined) answers["x.doc"] = c.doc;
    const { tg2 } = ageResults(answers);
    expect(tg2.state).toBe("triggered");
    expect(reasonOf(tg2)).toMatchObject({
      documentation: "without",
      code: "documentation_not_stated",
    });
  });

  it.each<{ name: string; material: JsonValue | undefined }>([
    { name: "tomt", material: undefined },
    { name: "null", material: null },
    { name: "valget ukjent", material: "unknown" },
    { name: "materiale uten levetid", material: "glass" },
    { name: "kode som ikke finnes", material: "steel" },
  ])("1.6.26 material_empty_rows_only: $name", ({ material }) => {
    const answers = (year: number): Answers => {
      const out: Answers = { "x.doc": "none", "x.year": year };
      if (material !== undefined) out["x.material"] = material;
      return out;
    };
    // Etter grensen passer ingen rad uten material_code: aldersregelen er ukjent
    const late = ageResults(answers(YEAR - PLATE_WITHOUT - 5));
    expect(late.tg2.state).toBe("not_evaluated");
    expect(reasonOf(late.tg2)).toMatchObject({ truth: "unknown", code: "material_unknown" });
    expect(late.tg2.suggestion).toBeNull();
    // Og regelen for før grensen slår ikke til (den gjelder alle materialer)
    expect(late.tg3.state).toBe("not_triggered");
    // Før grensen gjelder raden uten material_code: tg3 slår til
    const early = ageResults(answers(CUT_YEAR - 10));
    expect(early.tg3.state).toBe("triggered");
    expect(reasonOf(early.tg3)).toMatchObject({ lifespan_entry_key: "before_cut" });
  });

  it("1.6.27 year_source: årstallfeltet brukes først, med felt og kilde i begrunnelsen", () => {
    const { tg2 } = ageResults({
      "x.material": "plate",
      "x.doc": "none",
      "x.year": YEAR - PLATE_WITHOUT,
      "x.year_fallback": 1950,
      "x.source": "guess",
    });
    expect(tg2.state).toBe("triggered");
    expect(reasonOf(tg2)).toMatchObject({
      year: YEAR - PLATE_WITHOUT,
      year_element_key: "x.year",
      year_source: "guess",
      inspection_year: YEAR,
      age: PLATE_WITHOUT,
      material_code: "plate",
    });
  });

  it("1.6.27 year_source: uten årstall brukes reservefeltet", () => {
    const { tg2 } = ageResults({
      "x.material": "plate",
      "x.doc": "none",
      "x.year_fallback": YEAR - PLATE_WITHOUT,
      "x.source": "owner",
    });
    expect(tg2.state).toBe("triggered");
    expect(reasonOf(tg2)).toMatchObject({
      year: YEAR - PLATE_WITHOUT,
      year_element_key: "x.year_fallback",
      year_source: "owner",
    });
  });

  it.each<{ name: string; answers: Answers }>([
    { name: "begge mangler", answers: {} },
    { name: "begge tomme", answers: { "x.year": null, "x.year_fallback": "" } },
  ])("1.6.27 year_source: $name gir not_evaluated", ({ answers }) => {
    const { tg2, tg3 } = ageResults({ "x.material": "plate", "x.doc": "none", ...answers });
    for (const result of [tg2, tg3]) {
      expect(result.state).toBe("not_evaluated");
      expect(reasonOf(result)).toMatchObject({ truth: "unknown", code: "year_missing" });
    }
  });

  it.each<{ name: string; year: JsonValue }>([
    { name: "tekst", year: "nittitall" },
    { name: "desimal", year: 1990.5 },
    { name: "negativ", year: -1990 },
  ])("1.6.27 ugyldig årstall ($name) gir not_evaluated", ({ year }) => {
    const { tg2, tg3 } = ageResults({ "x.material": "plate", "x.doc": "none", "x.year": year });
    expect(tg2.state).toBe("not_evaluated");
    expect(tg3.state).toBe("not_evaluated");
  });

  it("1.6.28 future_year: årstall etter befaringsåret gir not_evaluated", () => {
    const { tg2, tg3 } = ageResults({ "x.material": "plate", "x.doc": "none", "x.year": YEAR + 1 });
    for (const result of [tg2, tg3]) {
      expect(result.state).toBe("not_evaluated");
      expect(reasonOf(result).code).toBe("year_after_inspection");
    }
    // Samme år som befaringen er alder 0, ikke ukjent
    expect(ageResults({ "x.material": "plate", "x.doc": "none", "x.year": YEAR }).tg2.state).toBe(
      "not_triggered",
    );
  });

  it("1.6.28 future_year: befaringsåret mangler gir not_evaluated", () => {
    const { tg2, tg3 } = ageResults(
      { "x.material": "plate", "x.doc": "none", "x.year": 1990 },
      { inspectionYear: null },
    );
    for (const result of [tg2, tg3]) {
      expect(result.state).toBe("not_evaluated");
      expect(reasonOf(result).code).toBe("inspection_year_missing");
    }
  });

  it("1.6.29 engine_knows_no_codes: andre feltkoder, valgkoder og materialkoder virker", () => {
    const other: Doc = {
      rules: [rule("q.rule", { suggested_outcome: WORN })],
      rule_conditions: [
        condition("q.rule", {
          type: "age_vs_lifespan",
          age_year_element_key: "q.when",
          material_element_key: "q.what",
          documentation_element_key: "q.papers",
          value: ["q_missing"],
        }),
      ],
      outcomes: OUTCOMES,
      element_options: [
        option("q.what", "m1", "m1"),
        option("q.papers", "q_missing"),
        option("q.papers", "q_present"),
      ],
    };
    const set: LifespanSet = {
      key: "q_set",
      entries: [entry({ key: "m1_step", material_code: "m1", min_age: 3, documentation: "any" })],
    };
    const run = (when: number) =>
      one(
        evaluateRules({
          template: SYSTEM,
          document: other,
          answers: { "q.when": when, "q.what": "m1", "q.papers": "q_present" },
          inspectionYear: YEAR,
          lifespans: set,
          thresholds: { key: "q_thresholds", entries: [] },
        }),
        "q.rule",
      );
    expect(run(YEAR - 3).state).toBe("triggered");
    expect(run(YEAR - 2).state).toBe("not_triggered");
    expect(run(YEAR - 3).lifespan_set_key).toBe("q_set");
  });

  it("1.6.30 set_keys_in_result: settkodene fra input står i svaret", () => {
    const results = evaluate(mixedDocument(), MIXED_TRIGGERING);
    expect(one(results, "x.age_rule")).toMatchObject({
      lifespan_set_key: LIFESPANS.key,
      threshold_set_key: null,
    });
    expect(one(results, "x.limit_rule")).toMatchObject({
      lifespan_set_key: null,
      threshold_set_key: THRESHOLDS.key,
    });
    expect(one(results, "x.option_rule")).toMatchObject({
      lifespan_set_key: null,
      threshold_set_key: null,
    });
  });
});

describe("1.7 forslag", () => {
  it("1.7.31 suggestion_outcome: koder fra dokumentet", () => {
    const result = one(evaluate(mixedDocument(), MIXED_TRIGGERING), "x.age_rule");
    expect(result.state).toBe("triggered");
    expect(result.suggestion).toEqual({ kind: "outcome", ...WORN });
  });

  it("1.7.32 suggestion_tgiu: TGIU på kontrollpunktet", () => {
    const result = one(evaluate(mixedDocument(), MIXED_TRIGGERING), "x.option_rule");
    expect(result.state).toBe("triggered");
    expect(result.suggestion).toEqual({ kind: "tgiu", checkpoint_key: CP });
  });

  it("1.7.33 no_suggestion_when_not_triggered: not_triggered og not_evaluated gir null", () => {
    const notTriggered = evaluate(mixedDocument(), {
      ...MIXED_TRIGGERING,
      "x.p": "no",
      "x.reading": LIMIT - 1,
      "x.year": YEAR - 1,
    });
    for (const result of notTriggered) {
      expect(result.state, result.rule_key).toBe("not_triggered");
      expect(result.suggestion, result.rule_key).toBeNull();
    }
    for (const result of evaluate(mixedDocument(), {})) {
      expect(result.state, result.rule_key).toBe("not_evaluated");
      expect(result.suggestion, result.rule_key).toBeNull();
    }
  });

  it("forslaget er aldri TG0 og bare outcome eller tgiu", () => {
    for (const result of evaluate(mixedDocument(), MIXED_TRIGGERING)) {
      expect(["outcome", "tgiu"]).toContain(result.suggestion!.kind);
      expect(JSON.stringify(result)).not.toMatch(/tg0/i);
    }
  });

  it("begrunnelseskodene i svaret finnes i kodelisten", () => {
    const sets: Answers[] = [MIXED_TRIGGERING, {}, { "x.reading": -1, "x.unit": "rh" }];
    for (const answers of sets) {
      for (const result of evaluate(mixedDocument(), answers)) {
        for (const reason of result.reasons) {
          if (reason.code !== null) expect(CONDITION_REASON_CODES).toContain(reason.code);
        }
      }
    }
  });
});

describe("runRuleTestCases (motoren)", () => {
  function caseDocument(cases: TemplateDocument["rule_test_cases"]) {
    return { ...mixedDocument(), rule_test_cases: cases };
  }

  function testCase(extra: Partial<TemplateDocument["rule_test_cases"][number]>) {
    return {
      rule_key: "x.age_rule",
      name: "Oppdiktet testsak",
      input: {},
      expected_state: "triggered" as const,
      inspection_year: YEAR,
      expected_outcome: null,
      sort_order: 0,
      ...extra,
    };
  }

  function runCases(cases: TemplateDocument["rule_test_cases"]) {
    return runRuleTestCases({
      template: SYSTEM,
      document: caseDocument(cases),
      lifespans: LIFESPANS,
      thresholds: THRESHOLDS,
    });
  }

  it("testsaken bruker sitt eget befaringsår og bare sin egen regel", () => {
    const input = {
      "x.material": "plate",
      "x.doc": "none",
      "x.year": 2000,
      "x.p": "yes",
    };
    const results = runCases([
      testCase({ name: "Gammel nok", input, inspection_year: 2000 + PLATE_WITHOUT }),
      testCase({
        name: "For ung",
        input,
        inspection_year: 2000 + PLATE_WITHOUT - 1,
        expected_state: "not_triggered",
        sort_order: 1,
      }),
      testCase({
        name: "Uten befaringsår",
        input,
        inspection_year: null,
        expected_state: "not_evaluated",
        sort_order: 2,
      }),
    ]);
    expect(results.map((r) => [r.name, r.passed, r.failure])).toEqual([
      ["Gammel nok", true, null],
      ["For ung", true, null],
      ["Uten befaringsår", true, null],
    ]);
    for (const result of results) expect(result.result!.rule_key).toBe("x.age_rule");
  });

  it("feil tilstand, feil utfall og ukjent regel gir passed = false med kode", () => {
    const input = { "x.material": "plate", "x.doc": "none", "x.year": YEAR - PLATE_WITHOUT };
    const results = runCases([
      testCase({ name: "Feil tilstand", input, expected_state: "not_triggered" }),
      testCase({
        name: "Feil utfall",
        input,
        expected_outcome: OLD,
        sort_order: 1,
      }),
      testCase({ name: "Riktig utfall", input, expected_outcome: WORN, sort_order: 2 }),
      testCase({ name: "Ukjent regel", rule_key: "x.nothing", input, sort_order: 3 }),
    ]);
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName["Feil tilstand"]).toMatchObject({ passed: false, failure: "state_mismatch" });
    expect(byName["Feil utfall"]).toMatchObject({ passed: false, failure: "outcome_mismatch" });
    expect(byName["Riktig utfall"]).toMatchObject({ passed: true, failure: null });
    expect(byName["Ukjent regel"]).toMatchObject({
      passed: false,
      failure: "rule_missing",
      result: null,
    });
  });
});
