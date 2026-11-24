import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EVAL_GUESS_WORDS } from "@/core/ai/evals/run";
import { COST_BANDS } from "@/core/reports/logic/cost-bands";
import { missingTgiuDetails } from "@/core/reports/logic/warnings";
import { runRuleTestCases } from "@/core/rules";
import { WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { WET_ROOM_THRESHOLDS } from "@/core/rules/data/thresholds";
import { wetRoomTemplate } from "./templates/wet-room";
import {
  assignBathScenarios,
  bathAnswerSteps,
  bathCandidatesFromPlan,
  bathRuleAnswers,
  bathScenarioProblems,
  evaluateBathRules,
  evaluateScenario,
  expectedRuleKeys,
  scenarioFitsBath,
  triggeredRuleKeys,
  type TestdataBathCandidate,
} from "./testdata-bath";
import {
  BATH_RULES,
  MANDATORY_BATH_SCENARIO_KEYS,
  TESTDATA_BATH_EDITED_TEXTS,
  TESTDATA_BATH_FREE_TEXTS,
  TESTDATA_BATH_SCENARIOS,
  TESTDATA_DRAFT_LABEL,
  TG3_COST_BANDS,
  TG3_COST_BANDS_LABEL,
  WET_ROOM_CHECKPOINT_ORDER,
  bathScenarioByKey,
  type BathScenario,
} from "./testdata-bath.data";
import { buildTestdataPlan } from "./testdata-plan";
import {
  TESTDATA_FIRST_NAMES,
  TESTDATA_LAST_NAMES,
  TESTDATA_SEED,
  TESTDATA_STREET_NAMES,
} from "./testdata.data";

/*
 * Scenariofilen for badene (docs/funksjoner/fase2a-testdata-del-2-testplan.md seksjon 1). Ren:
 * ingen database. Regeltestene kjører regelmotoren på scenarioene med badets år og befaringsåret,
 * og ingen TG skrives i testene: forventet TG leses fra scenarioene og malens testsaker.
 *
 * Støtter hovedmålene: færre reklamasjoner (TG bare fra reglene og malen, faglige grenser holder),
 * KI i bunnen (faste koder og feltnotat som fasit), og de ansatte (realistiske bad uten
 * persondata).
 */

const ANCHOR = new Date("2026-11-03T10:00:00Z");
const plan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: ANCHOR });
const baths = bathCandidatesFromPlan(plan);
const distribution = assignBathScenarios({ baths, seed: TESTDATA_SEED });
const mandatory = TESTDATA_BATH_SCENARIOS.filter((s) => s.mandatory);
const doc = wetRoomTemplate;

afterEach(() => {
  vi.useRealTimers();
});

/** Alle tekstverdier i en verdi (objekt, liste), med sti. */
function strings(value: unknown, path = ""): { path: string; text: string }[] {
  if (typeof value === "string") return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => strings(item, `${path}[${i}]`));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      strings(item, path === "" ? key : `${path}.${key}`),
    );
  }
  return [];
}

/** Fritekstene i datafilen: alt som ikke er en fast kode (koder har ikke mellomrom). */
const allTexts = strings({
  TESTDATA_BATH_SCENARIOS,
  TESTDATA_BATH_FREE_TEXTS,
  TESTDATA_BATH_EDITED_TEXTS,
}).filter(({ text }) => /\s/.test(text));

/** Et syntetisk bad for et scenario: første år fra 1960 som gir scenarioets forslag. */
function fittingBath(scenario: BathScenario, inspectionYear = 2026): TestdataBathCandidate | null {
  for (let year = 1960; year <= inspectionYear; year += 1) {
    for (const source of ["documented", "owner_stated"] as const) {
      const bath: TestdataBathCandidate = {
        assignmentKey: "TD-9999",
        assignmentLabel: "TD-9999",
        status: scenario.allowedStatuses[0] as string,
        inspectionYear,
        roomOrder: 1,
        roomName: "Bad",
        bathYear: year,
        bathYearSource: source,
      };
      if (scenarioFitsBath(scenario, bath, doc)) return bath;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// 1.1 Dekning og fordeling
// ---------------------------------------------------------------------------------------------

describe("1.1 dekning og fordeling", () => {
  it("1 tolv pliktige scenarioer finnes, i fast rekkefølge", () => {
    expect(MANDATORY_BATH_SCENARIO_KEYS).toEqual([
      "showcase",
      "tg2_age",
      "tg3_before_2000",
      "tgiu_owner_refused",
      "tg0",
      "moisture_tg2",
      "moisture_tg3",
      "changed_suggestion",
      "rejected_suggestion",
      "no_deviations",
      "unknown_build_year",
      "hms",
    ]);
    expect(mandatory.map((s) => s.key)).toEqual([...MANDATORY_BATH_SCENARIO_KEYS]);
    expect(new Set(TESTDATA_BATH_SCENARIOS.map((s) => s.key)).size).toBe(
      TESTDATA_BATH_SCENARIOS.length,
    );
  });

  it.each(mandatory.map((s) => [s.key, s] as const))(
    "2 %s har forventede avvik med nøkler, TG, text_source og planlagte bilder",
    (_, scenario) => {
      for (const deviation of scenario.expected.deviations) {
        expect(deviation.questionKey).toMatch(/^wet_room\.[a-z_]+\.[a-z0-9_]+$/);
        expect(["tg2", "tg3", "choose", "hms"]).toContain(deviation.outcomeKey);
        expect([2, 3, null]).toContain(deviation.tg);
        expect(["template", "edited"]).toContain(deviation.textSource);
        expect(deviation.plannedPhotos.length).toBeGreaterThan(0);
      }
    },
  );

  it("3 samme frø gir samme fordeling", () => {
    expect(assignBathScenarios({ baths, seed: TESTDATA_SEED })).toEqual(distribution);
  });

  it("4 pliktige går til de første badene som passer; annet frø endrer bare resten", () => {
    const sorted = [...distribution];
    const used = new Set<TestdataBathCandidate>();
    for (const key of MANDATORY_BATH_SCENARIO_KEYS) {
      const scenario = bathScenarioByKey(key);
      const first = sorted.find(
        (a) => !used.has(a.bath) && scenarioFitsBath(scenario, a.bath, doc),
      );
      expect(first, key).toBeDefined();
      const placed = distribution.filter((a) => a.scenarioKey === key)[0];
      expect(placed?.bath, key).toBe(first?.bath);
      used.add(first!.bath);
    }
    const other = assignBathScenarios({ baths, seed: 99 });
    for (const key of MANDATORY_BATH_SCENARIO_KEYS) {
      const a = distribution.find((x) => x.scenarioKey === key)!.bath;
      const b = other.find((x) => x.scenarioKey === key)!.bath;
      expect([b.assignmentKey, b.roomName]).toEqual([a.assignmentKey, a.roomName]);
    }
    const differs = other.some((x, i) => x.scenarioKey !== distribution[i]!.scenarioKey);
    expect(differs).toBe(true);
  });

  it.each(
    distribution.map(
      (a) => [`${a.bath.assignmentKey} ${a.bath.roomName}`, a.scenarioKey, a] as const,
    ),
  )("5 %s får %s med riktig status og år", (_, __, assignment) => {
    const scenario = bathScenarioByKey(assignment.scenarioKey);
    expect(scenario.allowedStatuses).toContain(assignment.bath.status);
    expect(scenarioFitsBath(scenario, assignment.bath, doc)).toBe(true);
  });

  it("6 del 1 har minst like mange passende bad som pliktige scenarioer", () => {
    const eligible = baths.filter((b) =>
      ["in_progress", "completed", "invoiced"].includes(b.status),
    );
    expect(eligible.length).toBeGreaterThanOrEqual(MANDATORY_BATH_SCENARIO_KEYS.length);
    for (const key of MANDATORY_BATH_SCENARIO_KEYS) {
      expect(distribution.filter((a) => a.scenarioKey === key).length, key).toBeGreaterThan(0);
    }
  });

  it("7 «bestilt» får ingen scenario", () => {
    expect(distribution.some((a) => a.bath.status === "ordered")).toBe(false);
    expect(baths.some((b) => b.status === "ordered")).toBe(false);
  });

  it("8 visningsbadet er under arbeid med TG3 før 2000, fast TG2 med endret tekst, TGIU, HMS og punkt igjen", () => {
    const showcase = bathScenarioByKey("showcase");
    expect(showcase.allowedStatuses).toEqual(["in_progress"]);
    expect(showcase.doneCount).toBeLessThan(8);
    const devs = showcase.expected.deviations;
    expect(devs.some((d) => d.tg === 3 && d.cost.type === "band")).toBe(true);
    const edited = devs.find((d) => d.textSource === "edited");
    expect(edited?.tg).toBe(2);
    expect(edited?.outcomeKey).toBe("tg2");
    expect(devs.some((d) => d.kind === "hms" && d.tg === null)).toBe(true);
    expect(showcase.tgiu?.reason).toBe("owner_refused");
    expect(showcase.decisions).toContainEqual({
      ruleKey: BATH_RULES.notDone,
      decision: "accepted",
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 1.2 Regelmotoren på hvert scenario
// ---------------------------------------------------------------------------------------------

describe("1.2 regelmotoren", () => {
  it.each(TESTDATA_BATH_SCENARIOS.map((s) => [s.key, s] as const))(
    "9 %s gir forslagene i scenarioet med befaringsåret",
    (_, scenario) => {
      const bath = fittingBath(scenario);
      expect(bath, `fant ikke et bad for ${scenario.key}`).not.toBeNull();
      const outcome = evaluateScenario(scenario, bath!, 2026, doc);
      expect(outcome.triggered).toEqual(expectedRuleKeys(scenario));
      expect(outcome.profile).toBe(scenario.ageProfile);
      // Regel og utfall er lik det forventede avviket
      for (const deviation of scenario.expected.deviations) {
        if (deviation.source.type !== "rule") continue;
        const ruleKey = deviation.source.ruleKey;
        const result = outcome.results.find((r) => r.rule_key === ruleKey);
        expect(result?.suggestion).toMatchObject({
          kind: "outcome",
          question_key: deviation.questionKey,
          outcome_key: deviation.outcomeKey,
        });
      }
    },
  );

  it("10 samme fordeling og samme forslag med klokken flyttet to år fram", () => {
    const before = distribution.map((a) => {
      const scenario = bathScenarioByKey(a.scenarioKey);
      return evaluateScenario(scenario, a.bath, a.bath.inspectionYear!, doc).triggered;
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2028-11-03T10:00:00Z"));
    expect(assignBathScenarios({ baths, seed: TESTDATA_SEED })).toEqual(distribution);
    const after = distribution.map((a) => {
      const scenario = bathScenarioByKey(a.scenarioKey);
      return evaluateScenario(scenario, a.bath, a.bath.inspectionYear!, doc).triggered;
    });
    expect(after).toEqual(before);
  });

  const membraneAnswers = (type: string, docs: string, year: number) => ({
    "wet_room.membrane_type": [type],
    "wet_room.documentation_type": [docs],
    "wet_room.build_year": year,
    "wet_room.build_year_source": ["documented"],
  });
  const hole = (drilling: string, reading: number | null, unit: string | null) => ({
    "wet_room.hole_drilling": [drilling],
    ...(reading === null ? {} : { "wet_room.hole_moisture_reading": reading }),
    ...(unit === null ? {} : { "wet_room.hole_moisture_unit": [unit] }),
  });

  it.each([
    ["alder −18 gir TG2", membraneAnswers("foil", "none", 2008), [BATH_RULES.pastLifespan]],
    ["alder −17 gir ingenting", membraneAnswers("foil", "none", 2009), []],
    ["1999 gir TG3 uten TG2", membraneAnswers("foil", "none", 1999), [BATH_RULES.before2000]],
    ["2000 gir TG2", membraneAnswers("foil", "none", 2000), [BATH_RULES.pastLifespan]],
    [
      "hull nektet gir TGIU uten TG2",
      {
        ...membraneAnswers("foil", "declaration_of_conformity", 2015),
        "wet_room.hole_drilling": ["not_done"],
        "wet_room.hole_drilling_reason": ["owner_refused"],
      },
      [BATH_RULES.notDone],
    ],
    [
      "14,9 vekt-% gir TG0",
      hole("done_no_findings", 14.9, "weight_percent"),
      [BATH_RULES.noMoisture],
    ],
    [
      "15 vekt-% gir forhøyet fukt",
      hole("done_with_findings", 15, "weight_percent"),
      [BATH_RULES.moisture],
    ],
    ["RF % gir ikke vurdert", hole("done_no_findings", 85, "relative_humidity"), []],
    [
      "«Ukjent» byggeår gir ikke vurdert (B2.5)",
      {
        "wet_room.membrane_type": ["foil"],
        "wet_room.documentation_type": ["none"],
        "wet_room.build_year_source": ["unknown"],
      },
      [],
    ],
  ])("11 %s", (_, answers, expected) => {
    const results = evaluateBathRules(doc, answers, 2026);
    expect(triggeredRuleKeys(results)).toEqual([...expected].sort());
  });

  it("11 TG0 kommer bare på tilliggende, og tiltaket følger valgt TG ved forhøyet fukt", () => {
    const results = evaluateBathRules(doc, hole("done_no_findings", 14.9, "weight_percent"), 2026);
    const tg0 = results.find((r) => r.rule_key === BATH_RULES.noMoisture);
    expect(tg0?.suggestion).toEqual({ kind: "tg0", checkpoint_key: "wet_room.adjacent" });
    const measures = doc.standard_measures.filter(
      (m) => m.question_key === "wet_room.adjacent.elevated_moisture",
    );
    expect(measures.map((m) => m.applies_to_tg).sort()).toEqual([2, 3]);
  });

  it("11 «ikke vurdert» står i regelsvaret for RF % og «Ukjent»", () => {
    const rf = evaluateBathRules(doc, hole("done_no_findings", 85, "relative_humidity"), 2026);
    expect(rf.find((r) => r.rule_key === BATH_RULES.noMoisture)?.state).toBe("not_evaluated");
    const unknown = evaluateBathRules(
      doc,
      {
        "wet_room.membrane_type": ["foil"],
        "wet_room.documentation_type": ["none"],
        "wet_room.build_year_source": ["unknown"],
      },
      2026,
    );
    expect(unknown.find((r) => r.rule_key === BATH_RULES.pastLifespan)?.state).toBe(
      "not_evaluated",
    );
  });

  /** Testsaken i malen hvert alders- og fuktscenario bygger på. */
  const TEST_CASE_FOR: Record<string, string> = {
    tg2_age: "A8",
    tg3_before_2000: "B6",
    tgiu_owner_refused: "H1",
    tg0: "T1",
    moisture_tg2: "F2",
    moisture_tg3: "F2",
    changed_suggestion: "T1",
    rejected_suggestion: "T1",
    no_deviations: "T1",
    unknown_build_year: "B2.5",
    showcase: "B6",
  };

  it.each(Object.entries(TEST_CASE_FOR))(
    "12 %s bygger på testsaken %s i malen, og testsaken består",
    (_, prefix) => {
      const results = runRuleTestCases({
        template: { kind: "system", reportType: "condition_report" },
        document: doc,
        lifespans: WET_ROOM_LIFESPANS,
        thresholds: WET_ROOM_THRESHOLDS,
      }).filter((r) => r.name.startsWith(`${prefix} `));
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) expect(result.passed, result.name).toBe(true);
    },
  );

  it("13 ingen low_threshold_height; insufficient_fall bare med negativ fall", () => {
    for (const scenario of TESTDATA_BATH_SCENARIOS) {
      for (const deviation of scenario.expected.deviations) {
        expect(deviation.questionKey).not.toMatch(/low_threshold_height/);
        if (deviation.questionKey === "wet_room.floor.insufficient_fall") {
          const floor = scenario.answers["wet_room.floor"] ?? {};
          expect(Number(floor["wet_room.fall_direction_1"])).toBeLessThan(0);
        }
      }
      const floor = scenario.answers["wet_room.floor"] ?? {};
      const negative = Number(floor["wet_room.fall_direction_1"] ?? 0) < 0;
      const hasFall = scenario.expected.deviations.some(
        (d) => d.questionKey === "wet_room.floor.insufficient_fall",
      );
      expect(negative, scenario.key).toBe(hasFall);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 1.3 Faglige grenser
// ---------------------------------------------------------------------------------------------

const deviationsOf = (s: BathScenario) => s.expected.deviations.map((d) => ({ s, d }));
const allDeviations = TESTDATA_BATH_SCENARIOS.flatMap(deviationsOf);

describe("1.3 faglige grenser", () => {
  it.each(TESTDATA_BATH_SCENARIOS.map((s) => [s.key, s] as const))(
    "alle grensene holder for %s",
    (_, scenario) => {
      expect(bathScenarioProblems(scenario, doc)).toEqual([]);
    },
  );

  it("14 ingen TG3 uten kostnadsintervall og ingen TG2 med kostnad", () => {
    for (const { d } of allDeviations) {
      if (d.tg === 3) expect(d.cost.type).toBe("band");
      if (d.tg === 2) expect(d.cost.type).toBe("none");
    }
  });

  it("15 eget beløp er rundet til nærmeste 10 000", () => {
    for (const { d } of allDeviations) {
      if (d.cost.type === "approx") expect(d.cost.amount % 10_000).toBe(0);
    }
  });

  it("16 ingen TG0 utenfor tilliggende og ingen TG3 på dokumentasjon", () => {
    for (const scenario of TESTDATA_BATH_SCENARIOS) {
      for (const decision of scenario.decisions) {
        if (decision.decision === "accepted" && decision.ruleKey === BATH_RULES.noMoisture) {
          const rule = doc.rules.find((r) => r.key === decision.ruleKey);
          expect(rule?.target_checkpoint_key).toBe("wet_room.adjacent");
        }
      }
    }
    for (const { d } of allDeviations) {
      if (d.checkpointKey === "wet_room.documentation") expect(d.tg).not.toBe(3);
    }
  });

  it("17 HMS har tg null, konsekvens og tiltak", () => {
    const hms = allDeviations.filter(({ d }) => d.kind === "hms");
    expect(hms.length).toBeGreaterThan(0);
    for (const { d } of hms) {
      expect(d.tg).toBeNull();
      const outcome = doc.outcomes.find((o) => o.question_key === d.questionKey);
      expect(outcome?.default_consequence_text).toBeTruthy();
      expect(doc.standard_measures.some((m) => m.question_key === d.questionKey)).toBe(true);
    }
  });

  it("18 forbudte beslutninger finnes ikke", () => {
    for (const scenario of TESTDATA_BATH_SCENARIOS) {
      for (const decision of scenario.decisions) {
        if (decision.ruleKey === BATH_RULES.notDone) expect(decision.decision).toBe("accepted");
        if (decision.ruleKey === BATH_RULES.pastLifespan)
          expect(decision.decision).toBe("accepted");
        if (decision.ruleKey === BATH_RULES.before2000) {
          expect(["accepted", "open"]).toContain(decision.decision);
        }
        if (decision.decision === "changed") {
          expect(decision.ruleKey).toBe(BATH_RULES.noMoisture);
          expect(decision.chosenTg).toBe("1");
        }
        if (decision.decision === "rejected") {
          expect(decision.ruleKey).toBe(BATH_RULES.noMoisture);
          expect(decision.overrideReasonCode).toBe("measured_again");
          expect(scenario.doneCount).toBeLessThan(8);
        }
      }
    }
  });

  it("19 bare koder fra badmalen", () => {
    const elements = new Map(doc.elements.map((e) => [e.key, e]));
    const options = new Set(doc.element_options.map((o) => `${o.element_key}|${o.key}`));
    const checkpoints = new Set(doc.checkpoints.map((c) => c.key));
    const rules = new Set(doc.rules.map((r) => r.key));
    for (const scenario of TESTDATA_BATH_SCENARIOS) {
      const bath = fittingBath(scenario)!;
      for (const step of bathAnswerSteps(scenario, bath)) {
        expect(checkpoints.has(step.checkpointKey)).toBe(true);
        const element = elements.get(step.elementKey);
        expect(element, step.elementKey).toBeDefined();
        expect(element?.checkpoint_key).toBe(step.checkpointKey);
        if (element?.field_type === "choice") {
          expect(options.has(`${step.elementKey}|${String(step.value)}`), step.elementKey).toBe(
            true,
          );
        }
      }
      for (const decision of scenario.decisions) expect(rules.has(decision.ruleKey)).toBe(true);
      for (const d of scenario.expected.deviations) {
        expect(
          doc.outcomes.some(
            (o) =>
              o.checkpoint_key === d.checkpointKey &&
              o.question_key === d.questionKey &&
              o.key === d.outcomeKey,
          ),
          d.questionKey,
        ).toBe(true);
      }
    }
  });

  it("20 ingen avvik utenfor badmalen", () => {
    for (const { d } of allDeviations) {
      expect(WET_ROOM_CHECKPOINT_ORDER).toContain(d.checkpointKey);
      expect(d.questionKey.startsWith(`${d.checkpointKey}.`)).toBe(true);
    }
  });

  it("21 TG3_COST_BANDS finnes for begge utfallene, er gyldige og merket utkast", () => {
    const keys = new Set(COST_BANDS.filter((b) => !b.archived).map((b) => b.key as string));
    expect(keys.has(TG3_COST_BANDS.membrane_before_2000)).toBe(true);
    expect(keys.has(TG3_COST_BANDS.elevated_moisture)).toBe(true);
    expect(TG3_COST_BANDS_LABEL).toBe(TESTDATA_DRAFT_LABEL);
    expect(TESTDATA_DRAFT_LABEL).toBe("utkast, ikke godkjent av fagrådet");
  });
});

// ---------------------------------------------------------------------------------------------
// 1.4 Tekstene
// ---------------------------------------------------------------------------------------------

const RESEARCH_DIR = join(process.cwd(), "docs", "kartlegging");
const RUN_LENGTH = 8;

function words(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((w) => w.length > 0);
}

function runsOf(text: string): string[] {
  const list = words(text);
  const out: string[] = [];
  for (let i = 0; i + RUN_LENGTH <= list.length; i += 1) {
    out.push(list.slice(i, i + RUN_LENGTH).join(" "));
  }
  return out;
}

function researchFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return researchFiles(path);
    return /\.(md|txt|json|csv)$/u.test(name) ? [path] : [];
  });
}

let researchRuns: Set<string> | null = null;
function copiedRun(text: string): string | null {
  if (researchRuns === null) {
    researchRuns = new Set();
    for (const file of researchFiles(RESEARCH_DIR)) {
      for (const run of runsOf(readFileSync(file, "utf8"))) researchRuns.add(run);
    }
  }
  const set = researchRuns;
  return runsOf(text).find((run) => set.has(run)) ?? null;
}

/** Ord som avslører personopplysninger eller adresse fra del 1. */
const PERSON_WORDS = [...TESTDATA_FIRST_NAMES, ...TESTDATA_LAST_NAMES, ...TESTDATA_STREET_NAMES];

function guessWordsIn(text: string): string[] {
  return EVAL_GUESS_WORDS.filter((word) =>
    new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "iu").test(text),
  );
}

function personDataIn(text: string): string[] {
  const found: string[] = [];
  if (text.includes("@")) found.push("@");
  if (/(\+47|\b\d{3} ?\d{2} ?\d{3}\b|\b\d{8}\b)/.test(text)) found.push("telefon");
  if (/\bgnr\b|\bbnr\b|gårdsnummer|bruksnummer/i.test(text)) found.push("matrikkel");
  if (/\b\d{4} [A-ZÆØÅ]/.test(text)) found.push("postnummer");
  for (const word of PERSON_WORDS) {
    if (new RegExp(`(?<![\\p{L}])${word}(?![\\p{L}])`, "u").test(text)) found.push(word);
  }
  return found;
}

describe("1.4 tekstene", () => {
  it("22 høyst tre endrede varianter, som beholder årsak, konsekvens og flettefelt", () => {
    const variants = Object.entries(TESTDATA_BATH_EDITED_TEXTS.variants);
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.length).toBeLessThanOrEqual(3);
    expect(TESTDATA_BATH_EDITED_TEXTS.label).toBe(TESTDATA_DRAFT_LABEL);
    for (const [key, text] of variants) {
      const [questionKey, outcomeKey] = key.split("|");
      const outcome = doc.outcomes.find(
        (o) => o.question_key === questionKey && o.key === outcomeKey,
      );
      expect(outcome, key).toBeDefined();
      // Bare avviksteksten endres; malens årsak og konsekvens står, og flettefeltene er med
      expect(outcome?.default_cause_text).toBeTruthy();
      expect(outcome?.default_consequence_text).toBeTruthy();
      for (const field of (outcome?.deviation_text ?? "").match(/\{[^}]+\}/g) ?? []) {
        expect(text).toContain(field);
      }
      expect(text).not.toBe(outcome?.deviation_text);
    }
    for (const { d } of allDeviations) {
      if (d.textSource === "edited") {
        expect(Object.keys(TESTDATA_BATH_EDITED_TEXTS.variants)).toContain(
          `${d.questionKey}|${d.outcomeKey}`,
        );
      }
    }
  });

  it.each(Object.entries(TESTDATA_BATH_FREE_TEXTS))(
    "23 fritekst %s er merket utkast, har én eller to varianter og er kort",
    (_, entry) => {
      expect(entry.label).toBe(TESTDATA_DRAFT_LABEL);
      expect(entry.variants.length).toBeGreaterThanOrEqual(1);
      expect(entry.variants.length).toBeLessThanOrEqual(2);
      for (const text of entry.variants) expect(text.length).toBeLessThanOrEqual(120);
    },
  );

  it("24 ingen gjetteord i noen tekst i datafilen", () => {
    for (const { path, text } of allTexts) expect(guessWordsIn(text), path).toEqual([]);
  });

  it("25 ingen henvisning til standarden og ingen kopi fra researchen", () => {
    for (const { path, text } of allTexts) {
      expect(text, path).not.toMatch(/NS ?3600|NS ?3424|\bTEK ?\d|\bTEK\b|byggforsk/i);
      expect(copiedRun(text), path).toBeNull();
    }
  });

  it("25 kopisjekken blir rød på en setning fra researchen", () => {
    const file = researchFiles(RESEARCH_DIR)[0]!;
    const run = runsOf(readFileSync(file, "utf8"))[0]!;
    expect(copiedRun(run)).not.toBeNull();
  });

  it("26 ingen persondata i datafilen", () => {
    for (const { path, text } of allTexts) expect(personDataIn(text), path).toEqual([]);
    expect(personDataIn("Ring Kari Testvik på 912 34 567")).not.toEqual([]);
  });

  it("27 planlagte bilder er korte beskrivelser uten personer og uten filnavn", () => {
    for (const { s, d } of allDeviations) {
      for (const photo of d.plannedPhotos) {
        expect(photo.length, s.key).toBeLessThanOrEqual(60);
        expect(photo).not.toMatch(/person|eier|ansikt|\.(jpe?g|png|heic)|\//i);
      }
    }
  });

  it("28 hvert avvik har ett kort feltnotat, som også er sjekket for gjetteord, kopi og persondata", () => {
    for (const { s, d } of allDeviations) {
      expect(d.fieldNote.trim().length, s.key).toBeGreaterThan(0);
      expect(d.fieldNote.length).toBeLessThanOrEqual(100);
      expect(allTexts.some(({ text }) => text === d.fieldNote)).toBe(true);
      expect(guessWordsIn(d.fieldNote)).toEqual([]);
      expect(personDataIn(d.fieldNote)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 1.5 Rettinger fra fagansvarlig, runde 2 og 3
// ---------------------------------------------------------------------------------------------

/** Et scenario med endringer, for testene som skal bli røde. */
function forced(base: BathScenario, change: Partial<BathScenario>): BathScenario {
  return { ...base, ...change };
}

describe("1.5 rettinger fra fagansvarlig", () => {
  it("29 badet uten avvik: sju TG1, TG0 fra godtatt forslag på 11 vekt-%, dokumentasjon lagt fram", () => {
    const scenario = bathScenarioByKey("no_deviations");
    expect(scenario.doneCount).toBe(8);
    expect(scenario.expected.deviations).toEqual([]);
    expect(scenario.decisions).toEqual([{ ruleKey: BATH_RULES.noMoisture, decision: "accepted" }]);
    const adjacent = scenario.answers["wet_room.adjacent"]!;
    expect(adjacent["wet_room.hole_drilling"]).toBe("done_no_findings");
    expect(adjacent["wet_room.hole_moisture_reading"]).toBe(11);
    expect(adjacent["wet_room.hole_moisture_unit"]).toBe("weight_percent");
    expect(["declaration_of_conformity", "wet_room_certificate"]).toContain(
      scenario.answers["wet_room.documentation"]?.["wet_room.documentation_type"],
    );
  });

  it("29 et åpent forslag på et ferdig punkt avvises (ingen TG1 der)", () => {
    const base = bathScenarioByKey("no_deviations");
    const bad = forced(base, {
      decisions: [{ ruleKey: BATH_RULES.noMoisture, decision: "open" }],
    });
    expect(bathScenarioProblems(bad, doc).join(" ")).toMatch(/åpent forslag på ferdig punkt/);
  });

  it.each(TESTDATA_BATH_SCENARIOS.map((s) => [s.key, s] as const))(
    "30 dokumentasjon «Ingen» på et ferdig punkt gir missing_membrane_documentation med TG2 uten kostnad (%s)",
    (_, scenario) => {
      const docType =
        scenario.answers["wet_room.documentation"]?.["wet_room.documentation_type"] ?? "none";
      const done = scenario.doneCount > 1;
      const missing = scenario.expected.deviations.find(
        (d) => d.questionKey === "wet_room.documentation.missing_membrane_documentation",
      );
      if (done && docType === "none") {
        expect(missing?.tg).toBe(2);
        expect(missing?.cost.type).toBe("none");
      } else {
        expect(missing).toBeUndefined();
      }
    },
  );

  it.each(TESTDATA_BATH_SCENARIOS.filter((s) => s.tgiu !== null).map((s) => [s.key, s] as const))(
    "31 TGIU i %s har opplysningene grunnen krever",
    (_, scenario) => {
      const t = scenario.tgiu!;
      expect(t.ownerInformed).toBe(t.reason === "owner_refused");
      for (const value of [
        t.reasonNote,
        t.alternativeMethod,
        t.alternativeResult,
        t.risk,
        t.howToExamine,
      ]) {
        expect(value.trim().length).toBeGreaterThan(0);
      }
      expect(["yes", "no"]).toContain(t.constructionVulnerable);
      const missing = missingTgiuDetails(
        {
          reason: t.reasonNote,
          riskAssessment: t.risk,
          howToExamine: t.howToExamine,
          alternativeCheckMethod: t.alternativeMethod,
          alternativeCheckResult: t.alternativeResult,
          constructionVulnerable: t.constructionVulnerable,
          ownerInformed: t.ownerInformed ? true : null,
        },
        { alternativeCheck: true, ownerInformed: t.reason === "owner_refused" },
      );
      expect(missing).toEqual([]);
      const steps = bathAnswerSteps(scenario, fittingBath(scenario)!);
      expect(steps.some((s) => s.elementKey === "wet_room.owner_informed")).toBe(
        t.reason === "owner_refused",
      );
    },
  );

  it("31 både eier nektet og betong eller mur finnes", () => {
    const reasons = TESTDATA_BATH_SCENARIOS.flatMap((s) => (s.tgiu ? [s.tgiu.reason] : []));
    expect(reasons).toContain("owner_refused");
    expect(reasons).toContain("concrete_or_masonry");
  });

  it("36 ingen other_written; et påtvunget ferdig bad med other_written blir rødt", () => {
    for (const scenario of TESTDATA_BATH_SCENARIOS) {
      expect(scenario.answers["wet_room.documentation"]?.["wet_room.documentation_type"]).not.toBe(
        "other_written",
      );
    }
    const base = bathScenarioByKey("no_deviations");
    const bad = forced(base, {
      answers: {
        ...base.answers,
        "wet_room.documentation": { "wet_room.documentation_type": "other_written" },
      },
    });
    expect(bathScenarioProblems(bad, doc).join(" ")).toMatch(/other_written/);
  });

  it.each(distribution.map((a) => [`${a.bath.assignmentKey} ${a.bath.roomName}`, a] as const))(
    "37 aldersprofil og forslag på hele fordelingen: %s",
    (_, assignment) => {
      const scenario = bathScenarioByKey(assignment.scenarioKey);
      const outcome = evaluateScenario(
        scenario,
        assignment.bath,
        assignment.bath.inspectionYear!,
        doc,
      );
      expect(outcome.profile).toBe(scenario.ageProfile);
      expect(outcome.triggered).toEqual(expectedRuleKeys(scenario));
      for (const decision of scenario.decisions) {
        if (decision.decision !== "open") continue;
        const rule = doc.rules.find((r) => r.key === decision.ruleKey)!;
        const index = WET_ROOM_CHECKPOINT_ORDER.indexOf(
          rule.target_checkpoint_key as (typeof WET_ROOM_CHECKPOINT_ORDER)[number],
        );
        expect(index).toBeGreaterThanOrEqual(scenario.doneCount);
      }
    },
  );

  it.each([
    ["foil", "none", 18, BATH_RULES.pastLifespan],
    ["liquid_membrane", "none", 15, BATH_RULES.pastLifespan],
    ["membrane_boards", "none", 15, BATH_RULES.pastLifespan],
    ["foil", "none", 17, null],
    ["unknown", "none", 1990, BATH_RULES.before2000],
    ["sheet_membrane", "wet_room_certificate", 1995, BATH_RULES.before2000],
  ] as const)("37 alderstabellen: %s med %s og %s gir %s", (type, docs, age, rule) => {
    const year = age > 1000 ? age : 2026 - age;
    const results = evaluateBathRules(
      doc,
      {
        "wet_room.membrane_type": [type],
        "wet_room.documentation_type": [docs],
        "wet_room.build_year": year,
        "wet_room.build_year_source": ["documented"],
      },
      2026,
    );
    expect(triggeredRuleKeys(results)).toEqual(rule === null ? [] : [rule]);
  });

  it("32 vekt-% betyr treverk; en påtvunget tekst med betong blir rød", () => {
    for (const scenario of TESTDATA_BATH_SCENARIOS) {
      const adjacent = scenario.answers["wet_room.adjacent"] ?? {};
      if (adjacent["wet_room.hole_moisture_unit"] !== "weight_percent") continue;
      for (const field of ["wet_room.hole_moisture_location", "wet_room.hole_construction"]) {
        expect(String(adjacent[field] ?? "")).not.toMatch(/betong|\bmur|murt|støp/i);
      }
    }
    const base = bathScenarioByKey("tg0");
    const bad = forced(base, {
      answers: {
        ...base.answers,
        "wet_room.adjacent": {
          ...base.answers["wet_room.adjacent"],
          "wet_room.hole_construction": "Betong med påstøp",
        },
      },
    });
    expect(bathScenarioProblems(bad, doc).join(" ")).toMatch(/betong eller mur/);
  });

  it("33 RF %: ingen ferdig tilliggende med RF %; et påtvunget bad med RF 85 % og TG1 blir rødt", () => {
    for (const scenario of TESTDATA_BATH_SCENARIOS) {
      const adjacent = scenario.answers["wet_room.adjacent"] ?? {};
      if (adjacent["wet_room.hole_moisture_unit"] === "relative_humidity") {
        expect(scenario.doneCount).toBeLessThan(8);
        expect(scenario.allowedStatuses).toEqual(["in_progress"]);
      }
    }
    const base = bathScenarioByKey("no_deviations");
    const bad = forced(base, {
      answers: {
        ...base.answers,
        "wet_room.adjacent": {
          "wet_room.hole_drilling": "done_no_findings",
          "wet_room.hole_moisture_reading": 85,
          "wet_room.hole_moisture_unit": "relative_humidity",
        },
      },
      decisions: [],
    });
    expect(bathScenarioProblems(bad, doc).join(" ")).toMatch(/RF %/);
  });

  it("34 «utført uten funn» med 15 vekt-% eller mer finnes ikke", () => {
    for (const scenario of TESTDATA_BATH_SCENARIOS) {
      const adjacent = scenario.answers["wet_room.adjacent"] ?? {};
      if (
        adjacent["wet_room.hole_drilling"] === "done_no_findings" &&
        adjacent["wet_room.hole_moisture_unit"] === "weight_percent"
      ) {
        expect(Number(adjacent["wet_room.hole_moisture_reading"])).toBeLessThan(15);
      }
    }
  });

  it("35 TG3_COST_BANDS har intervallene i A509", () => {
    expect(TG3_COST_BANDS.membrane_before_2000).toBe("from_200000_to_500000");
    expect(TG3_COST_BANDS.elevated_moisture).toBe("from_100000_to_200000");
  });

  it("svarene regelmotoren leser, har samme form som på serveren", () => {
    const scenario = bathScenarioByKey("tg2_age");
    const answers = bathRuleAnswers(doc, bathAnswerSteps(scenario, fittingBath(scenario)!));
    expect(answers["wet_room.membrane_type"]).toEqual(["foil"]);
    expect(typeof answers["wet_room.build_year"]).toBe("number");
    expect(answers["wet_room.membrane_year"]).toBeUndefined();
  });
});
