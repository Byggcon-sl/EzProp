import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleResult } from "@/core/rules";
import { CHECKPOINT_WARNING_CODES } from "./codes";
import { warningText } from "./labels";
import type {
  CheckpointState,
  CheckpointWarning,
  CheckpointWarningCode,
  DecisionState,
  DeviationState,
  TgiuState,
} from "./types";
import {
  computeCheckpointWarnings,
  missingTgiuDetails,
  suggestionStillApplies,
  tgiuRequirementsFor,
  WARNING_CODES_WITH_CHECK,
} from "./warnings";

/*
 * Advarslene på kontrollpunktet (testplanen B1.10 med a–d og B1.11). Ren test med oppdiktede
 * data. Regelsvarene er bygd for hånd i samme form som fra regelmotoren; serveren sender dem inn.
 *
 * Hovedmål: færre reklamasjoner (manglende årsak, kostnad, TGIU-opplysninger og forslag som ikke
 * gjelder lenger, fanges før publisering) og de ansatte (advarsler, aldri sperre, regel 12).
 */

const ADJACENT = "cp.adjacent";
const OTHER = "cp.other";
const NOT_DONE_RULE = "rule.hole_not_done";
const OVER_LIMIT_RULE = "rule.moisture_over_limit";
const AGE_RULE = "rule.past_lifespan";

/** Et fullstendig TG2-avvik uten advarsler. */
function deviation(overrides: Partial<DeviationState> = {}): DeviationState {
  return {
    id: "dev-1",
    kind: "tg",
    tg: 2,
    causeCriterion: "symptom_of_damage",
    causeText: "Årsak.",
    consequenceText: "Konsekvens.",
    costType: "band",
    costAmount: null,
    measureCount: 1,
    outcomeTg: 2,
    hasMeasuresForTg: false,
    ...overrides,
  };
}

function fullTgiu(overrides: Partial<TgiuState> = {}): TgiuState {
  return {
    reason: "Ikke undersøkt fordi eier ikke ga samtykke.",
    riskAssessment: "Risiko.",
    howToExamine: "Hulltaking.",
    alternativeCheckMethod: "Overflatemåling.",
    alternativeCheckResult: "Ingen utslag.",
    constructionVulnerable: "yes",
    ownerInformed: true,
    ...overrides,
  };
}

/** Et ferdig punkt med TG1 og ingen advarsler. */
function checkpoint(overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    tgDirect: "1",
    done: true,
    hasContent: true,
    deviations: [],
    tgiu: null,
    tgiuRequirements: { alternativeCheck: false, ownerInformed: false },
    ruleResults: [],
    decisions: [],
    noFindingsWithReadingOverLimit: false,
    ...overrides,
  };
}

function triggered(
  ruleKey: string,
  suggestion: RuleResult["suggestion"],
  purpose: RuleResult["purpose"] = "suggest_outcome",
): RuleResult {
  return {
    rule_key: ruleKey,
    purpose,
    state: "triggered",
    suggestion,
    code: null,
    reasons: [],
    lifespan_set_key: null,
    threshold_set_key: null,
  };
}

function notTriggered(ruleKey: string): RuleResult {
  return { ...triggered(ruleKey, null), state: "not_triggered" };
}

const AGE_SUGGESTION = {
  kind: "outcome",
  checkpoint_key: "cp.membrane",
  question_key: "cp.membrane.age",
  outcome_key: "tg2",
} as const;

function decision(overrides: Partial<DecisionState> = {}): DecisionState {
  return {
    ruleKey: AGE_RULE,
    decision: "accepted",
    suggestion: AGE_SUGGESTION,
    chosenTg: "2",
    madeDeviation: true,
    deviationId: "dev-1",
    ...overrides,
  };
}

const codes = (warnings: CheckpointWarning[]) => warnings.map((w) => w.code);

/** Én rad per kode: et punkt som gir advarselen, og hva den skal inneholde. */
const WARNING_CASES: Record<
  CheckpointWarningCode,
  { state: CheckpointState; expected: Partial<CheckpointWarning> }
> = {
  deviation_tg_not_chosen: {
    state: checkpoint({ deviations: [deviation({ tg: null, outcomeTg: "choose" })] }),
    expected: { deviationId: "dev-1", missing: [] },
  },
  tg2_tg3_missing_cause_or_consequence: {
    state: checkpoint({
      deviations: [deviation({ causeCriterion: null, causeText: " ", consequenceText: null })],
    }),
    expected: {
      deviationId: "dev-1",
      missing: ["cause_criterion", "cause_text", "consequence_text"],
    },
  },
  tg2_tg3_missing_measure: {
    state: checkpoint({ deviations: [deviation({ measureCount: 0 })] }),
    expected: { deviationId: "dev-1", missing: ["measure"] },
  },
  tg3_missing_cost: {
    state: checkpoint({ deviations: [deviation({ tg: 3, outcomeTg: 3, costType: "none" })] }),
    expected: { deviationId: "dev-1" },
  },
  cost_amount_not_rounded: {
    state: checkpoint({ deviations: [deviation({ costType: "approx", costAmount: 37500 })] }),
    expected: { deviationId: "dev-1" },
  },
  hms_missing_consequence_or_measure: {
    state: checkpoint({
      deviations: [
        deviation({
          kind: "hms",
          tg: null,
          outcomeTg: null,
          causeCriterion: null,
          causeText: null,
          consequenceText: "",
          measureCount: 0,
          costType: "none",
        }),
      ],
    }),
    expected: { deviationId: "dev-1", missing: ["consequence_text", "measure"] },
  },
  tgiu_details_missing: {
    state: checkpoint({ tgDirect: "IU", tgiu: fullTgiu({ riskAssessment: "" }) }),
    expected: { deviationId: null, missing: ["risk_assessment"] },
  },
  tgiu_suggested_not_set: {
    state: checkpoint({
      ruleResults: [
        triggered(NOT_DONE_RULE, { kind: "tgiu", checkpoint_key: ADJACENT }, "suggest_tgiu"),
      ],
    }),
    expected: { ruleKey: NOT_DONE_RULE, deviationId: null },
  },
  no_findings_with_reading_over_limit: {
    state: checkpoint({ noFindingsWithReadingOverLimit: true }),
    expected: { deviationId: null },
  },
  suggestion_no_longer_applies: {
    state: checkpoint({
      deviations: [deviation()],
      ruleResults: [notTriggered(AGE_RULE)],
      decisions: [decision()],
    }),
    expected: { ruleKey: AGE_RULE, deviationId: "dev-1" },
  },
  texts_written_for_other_tg: {
    state: checkpoint({
      deviations: [deviation({ tg: 3, outcomeTg: 2, hasMeasuresForTg: false })],
    }),
    expected: { deviationId: "dev-1" },
  },
  checkpoint_done_without_tg: {
    state: checkpoint({ tgDirect: null }),
    expected: { deviationId: null },
  },
  tg3_on_age_only: {
    state: checkpoint({
      deviations: [
        deviation({
          tg: 3,
          outcomeTg: 2,
          causeCriterion: "age_uncertain_function",
          hasMeasuresForTg: true,
        }),
      ],
    }),
    expected: { deviationId: "dev-1" },
  },
};

describe("B1.10 advarslene på punktet", () => {
  it.each(CHECKPOINT_WARNING_CODES.map((code) => [code]))("%s", (code) => {
    const { state, expected } = WARNING_CASES[code];
    const warnings = computeCheckpointWarnings(state);
    const found = warnings.find((w) => w.code === code);
    expect(found, `${code} kom ikke: ${JSON.stringify(codes(warnings))}`).toBeDefined();
    expect(found).toMatchObject(expected);
    // Teksten finnes og har aldri råkoder.
    expect(warningText(found!)).not.toMatch(/[a-z]+_[a-z]+/u);
  });

  it("hver kode i listen har en testrad og en kontroll", () => {
    expect(Object.keys(WARNING_CASES).sort()).toEqual([...CHECKPOINT_WARNING_CODES].sort());
    expect([...WARNING_CODES_WITH_CHECK].sort()).toEqual([...CHECKPOINT_WARNING_CODES].sort());
  });

  it("ingen advarsel når alt er fylt ut", () => {
    const state = checkpoint({
      tgDirect: null,
      deviations: [
        deviation(),
        deviation({ id: "dev-2", tg: 3, outcomeTg: 3, costType: "approx", costAmount: 40000 }),
        deviation({
          id: "dev-3",
          kind: "hms",
          tg: null,
          outcomeTg: null,
          causeCriterion: null,
          causeText: null,
          costType: "none",
        }),
      ],
      ruleResults: [triggered(AGE_RULE, AGE_SUGGESTION)],
      decisions: [decision()],
    });
    expect(computeCheckpointWarnings(state)).toEqual([]);
  });

  it("ingen advarsel har sperre: advarslene har bare kode, id-er og hva som mangler", () => {
    for (const { state } of Object.values(WARNING_CASES)) {
      for (const warning of computeCheckpointWarnings(state)) {
        expect(Object.keys(warning).sort()).toEqual(["code", "deviationId", "missing", "ruleKey"]);
      }
    }
  });

  it("rekkefølgen følger kodelisten, så avvikets plass", () => {
    const state = checkpoint({
      tgDirect: null,
      deviations: [
        deviation({ id: "a", measureCount: 0 }),
        deviation({ id: "b", tg: null, outcomeTg: "choose" }),
        deviation({ id: "c", measureCount: 0 }),
      ],
    });
    expect(computeCheckpointWarnings(state).map((w) => [w.code, w.deviationId])).toEqual([
      ["deviation_tg_not_chosen", "b"],
      ["tg2_tg3_missing_measure", "a"],
      ["tg2_tg3_missing_measure", "c"],
    ]);
  });

  it("slettede avvik sendes ikke inn og gir ingen advarsel", () => {
    expect(computeCheckpointWarnings(checkpoint({ deviations: [] }))).toEqual([]);
  });

  it("TG3 uten kostnad: også ved cost_type none og eget beløp gir ingen", () => {
    const none = checkpoint({ deviations: [deviation({ tg: 3, outcomeTg: 3, costType: "none" })] });
    expect(codes(computeCheckpointWarnings(none))).toEqual(["tg3_missing_cost"]);
    const approx = checkpoint({
      deviations: [deviation({ tg: 3, outcomeTg: 3, costType: "approx", costAmount: 40000 })],
    });
    expect(computeCheckpointWarnings(approx)).toEqual([]);
    const tg2None = checkpoint({ deviations: [deviation({ costType: "none" })] });
    expect(computeCheckpointWarnings(tg2None)).toEqual([]);
  });

  it("årsak: bare kriteriet mangler gir missing med kriteriet", () => {
    const state = checkpoint({ deviations: [deviation({ causeCriterion: null })] });
    expect(computeCheckpointWarnings(state)).toEqual([
      {
        code: "tg2_tg3_missing_cause_or_consequence",
        deviationId: "dev-1",
        ruleKey: null,
        missing: ["cause_criterion"],
      },
    ]);
  });

  it("eget beløp 15 000 gir advarsel, 40 000 ikke", () => {
    const at = (amount: number) =>
      codes(
        computeCheckpointWarnings(
          checkpoint({ deviations: [deviation({ costType: "approx", costAmount: amount })] }),
        ),
      );
    expect(at(15000)).toEqual(["cost_amount_not_rounded"]);
    expect(at(40000)).toEqual([]);
  });
});

describe("B1.10a checkpoint_done_without_tg (A385)", () => {
  const hmsOnly = deviation({
    kind: "hms",
    tg: null,
    outcomeTg: null,
    causeCriterion: null,
    causeText: null,
    costType: "none",
  });

  it.each<[string, Partial<CheckpointState>, boolean]>([
    ["ferdig uten TG gir advarsel", { tgDirect: null }, true],
    ["ferdig med bare HMS gir advarsel", { tgDirect: null, deviations: [hmsOnly] }, true],
    ["ferdig med TG1 gir ingen", { tgDirect: "1" }, false],
    ["ferdig med TGIU gir ingen", { tgDirect: "IU", tgiu: fullTgiu() }, false],
    ["ferdig med TG2-avvik gir ingen", { tgDirect: null, deviations: [deviation()] }, false],
    ["ikke ferdig gir ingen", { tgDirect: null, done: false }, false],
  ])("%s", (_name, overrides, expected) => {
    const warnings = codes(computeCheckpointWarnings(checkpoint(overrides)));
    expect(warnings.includes("checkpoint_done_without_tg")).toBe(expected);
  });
});

describe("B1.10b tg3_on_age_only (A358, A396)", () => {
  const ageOnly = (overrides: Partial<DeviationState>) =>
    codes(
      computeCheckpointWarnings(
        checkpoint({
          deviations: [
            deviation({
              tg: 3,
              causeCriterion: "age_uncertain_function",
              hasMeasuresForTg: true,
              ...overrides,
            }),
          ],
        }),
      ),
    );

  it("TG2-alder endret til TG3 gir advarsel", () => {
    expect(ageOnly({ outcomeTg: 2 })).toContain("tg3_on_age_only");
  });

  it("utfall skrevet for TG3 (sjikt før 2000) gir ingen", () => {
    expect(ageOnly({ outcomeTg: 3 })).not.toContain("tg3_on_age_only");
  });

  it("TG3 med annet årsakskriterium gir ingen", () => {
    expect(ageOnly({ outcomeTg: 2, causeCriterion: "symptom_of_damage" })).not.toContain(
      "tg3_on_age_only",
    );
  });

  it("TG2 på alder gir ingen", () => {
    expect(ageOnly({ tg: 2, outcomeTg: 2 })).not.toContain("tg3_on_age_only");
  });
});

describe("B1.10c T-0059 og TGIU bygger på regelsvaret (A386)", () => {
  it("uten regelsvar som slår til gir måling over grensen ingen T-0059-advarsel", () => {
    // Den som kaller setter flagget bare når regelen slår til og valget er «utført uten funn».
    // 15 med annen enhet enn vekt-% gir ikke regelsvar, så flagget står usant.
    const state = checkpoint({
      ruleResults: [notTriggered(OVER_LIMIT_RULE)],
      noFindingsWithReadingOverLimit: false,
    });
    expect(codes(computeCheckpointWarnings(state))).not.toContain(
      "no_findings_with_reading_over_limit",
    );
  });

  it("forslag om TGIU som slår til, og punktet har TGIU, gir ingen", () => {
    const state = checkpoint({
      tgDirect: "IU",
      tgiu: fullTgiu(),
      ruleResults: [
        triggered(NOT_DONE_RULE, { kind: "tgiu", checkpoint_key: ADJACENT }, "suggest_tgiu"),
      ],
    });
    expect(computeCheckpointWarnings(state)).toEqual([]);
  });

  it("forslag om TGIU og punktet har TG2-avvik gir advarselen", () => {
    const state = checkpoint({
      tgDirect: null,
      deviations: [deviation()],
      ruleResults: [
        triggered(NOT_DONE_RULE, { kind: "tgiu", checkpoint_key: ADJACENT }, "suggest_tgiu"),
      ],
    });
    expect(codes(computeCheckpointWarnings(state))).toEqual(["tgiu_suggested_not_set"]);
  });

  it("regel som ikke slår til, gir ingen TGIU-advarsel", () => {
    const state = checkpoint({ ruleResults: [notTriggered(NOT_DONE_RULE)] });
    expect(computeCheckpointWarnings(state)).toEqual([]);
  });

  it("logic/ har ikke tallet 15 og ingen våtromskode (statisk)", () => {
    const dir = __dirname;
    const sources = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/(?<![\d.,_])15(?![\d_])/u);
      expect(source, file).not.toMatch(/wet_room/u);
    }
  });
});

describe("B1.10d rekkefølgen er låst (regel 6)", () => {
  it("CHECKPOINT_WARNING_CODES er uendret, med de to nye sist", () => {
    expect(CHECKPOINT_WARNING_CODES).toEqual([
      "deviation_tg_not_chosen",
      "tg2_tg3_missing_cause_or_consequence",
      "tg2_tg3_missing_measure",
      "tg3_missing_cost",
      "cost_amount_not_rounded",
      "hms_missing_consequence_or_measure",
      "tgiu_details_missing",
      "tgiu_suggested_not_set",
      "no_findings_with_reading_over_limit",
      "suggestion_no_longer_applies",
      "texts_written_for_other_tg",
      "checkpoint_done_without_tg",
      "tg3_on_age_only",
    ]);
  });
});

describe("B1.11 TGIU-opplysninger etter grunn", () => {
  const empty: TgiuState = {
    reason: null,
    riskAssessment: null,
    howToExamine: null,
    alternativeCheckMethod: null,
    alternativeCheckResult: null,
    constructionVulnerable: null,
    ownerInformed: null,
  };
  const requirements = (checkpointKey: string, ownerRefused: boolean) =>
    tgiuRequirementsFor({
      checkpointKey,
      alternativeCheckCheckpointKeys: [ADJACENT],
      ownerRefusedInspection: ownerRefused,
    });

  it("alle TGIU krever de tre feltene", () => {
    expect(missingTgiuDetails(empty, requirements(OTHER, false))).toEqual([
      "reason",
      "risk_assessment",
      "how_to_examine",
    ]);
  });

  it("tilliggende konstruksjoner krever i tillegg annen fuktkontroll, resultat og skadeutsatt konstruksjon", () => {
    expect(missingTgiuDetails(empty, requirements(ADJACENT, false))).toEqual([
      "reason",
      "risk_assessment",
      "how_to_examine",
      "alternative_check_method",
      "alternative_check_result",
      "construction_vulnerable",
    ]);
  });

  it("eier nektet krever i tillegg «eier informert»", () => {
    expect(
      missingTgiuDetails(fullTgiu({ ownerInformed: null }), requirements(ADJACENT, true)),
    ).toEqual(["owner_informed"]);
    expect(
      missingTgiuDetails(fullTgiu({ ownerInformed: false }), requirements(ADJACENT, true)),
    ).toEqual(["owner_informed"]);
  });

  it("ingen falske advarsler: annet punkt ber ikke om fuktkontroll, eier ikke nektet ber ikke om «eier informert»", () => {
    const onlyBasics = fullTgiu({
      alternativeCheckMethod: null,
      alternativeCheckResult: null,
      constructionVulnerable: null,
      ownerInformed: null,
    });
    expect(missingTgiuDetails(onlyBasics, requirements(OTHER, false))).toEqual([]);
    expect(
      missingTgiuDetails(fullTgiu({ ownerInformed: null }), requirements(ADJACENT, false)),
    ).toEqual([]);
  });

  it("TGIU uten opplysninger ennå gir advarsel med alt som kreves", () => {
    const state = checkpoint({
      tgDirect: "IU",
      tgiu: null,
      tgiuRequirements: requirements(OTHER, false),
    });
    expect(computeCheckpointWarnings(state)).toEqual([
      {
        code: "tgiu_details_missing",
        deviationId: null,
        ruleKey: null,
        missing: ["reason", "risk_assessment", "how_to_examine"],
      },
    ]);
  });

  it("TGIU-opplysninger på punkt uten TGIU gir ingen advarsel", () => {
    expect(computeCheckpointWarnings(checkpoint({ tgiu: { ...empty } }))).toEqual([]);
  });

  it("skadeutsatt konstruksjon «vet ikke» regnes som fylt ut", () => {
    expect(
      missingTgiuDetails(
        fullTgiu({ constructionVulnerable: "unknown" }),
        requirements(ADJACENT, false),
      ),
    ).toEqual([]);
  });
});

describe("suggestionStillApplies", () => {
  it.each<[string, DecisionState, RuleResult[], boolean]>([
    [
      "godtatt og regelen slår til med samme forslag",
      decision(),
      [triggered(AGE_RULE, AGE_SUGGESTION)],
      true,
    ],
    ["godtatt og regelen slår ikke til", decision(), [notTriggered(AGE_RULE)], false],
    ["godtatt og regelen mangler", decision(), [], false],
    [
      "godtatt og regelen foreslår noe annet",
      decision(),
      [triggered(AGE_RULE, { ...AGE_SUGGESTION, outcome_key: "tg3" })],
      false,
    ],
    [
      "endret og regelen slår ikke til",
      decision({ decision: "changed" }),
      [notTriggered(AGE_RULE)],
      false,
    ],
    ["avvist blir aldri «gjelder ikke lenger»", decision({ decision: "rejected" }), [], true],
    [
      "nøklenes rekkefølge spiller ingen rolle",
      decision(),
      [
        triggered(AGE_RULE, {
          outcome_key: "tg2",
          question_key: "cp.membrane.age",
          checkpoint_key: "cp.membrane",
          kind: "outcome",
        }),
      ],
      true,
    ],
  ])("%s", (_name, d, results, expected) => {
    expect(suggestionStillApplies(d, results)).toBe(expected);
  });
});
