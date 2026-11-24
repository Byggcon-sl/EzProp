import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RuleResult } from "@/core/rules";
import { CHECKPOINT_WARNING_CODES } from "./codes";
import { warningText } from "./labels";
import { computeCheckpointStatus } from "./status";
import type {
  CheckpointState,
  CheckpointWarning,
  CheckpointWarningCode,
  DecisionState,
  DeviationState,
  SuggestionTg,
  TgiuState,
} from "./types";
import {
  computeCheckpointWarnings,
  missingTgiuDetails,
  sortReviewWarnings,
  suggestionStillApplies,
  suggestionTgRank,
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
  open_suggestion_on_done_checkpoint: {
    state: checkpoint({ ruleResults: [triggered(AGE_RULE, AGE_SUGGESTION)] }),
    expected: { ruleKey: AGE_RULE, deviationId: null, missing: [] },
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
  it("CHECKPOINT_WARNING_CODES er uendret, med de nye sist", () => {
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
      "open_suggestion_on_done_checkpoint",
    ]);
  });
});

// --- rett-forslag-og-avvik (T-0115, T-0117, A492, A495) ------------------------------------------

const TG3_RULE = "rule.membrane_before_2000";
const TG3_SUGGESTION = {
  kind: "outcome",
  checkpoint_key: "cp.membrane",
  question_key: "cp.membrane.age",
  outcome_key: "tg3",
} as const;
const TG0_RULE = "rule.adjacent_ok";
const TG0_SUGGESTION = { kind: "tg0", checkpoint_key: ADJACENT } as const;
const TGIU_SUGGESTION = { kind: "tgiu", checkpoint_key: ADJACENT } as const;

describe("FA-L12–L15 suggestion_no_longer_applies gjelder bare gjeldende beslutninger (T-0115)", () => {
  it("FA-L12 avviket fra beslutningen er slettet: ingen advarsel", () => {
    const state = checkpoint({
      ruleResults: [notTriggered(AGE_RULE)],
      decisions: [decision({ deviationId: null, madeDeviation: true })],
    });
    expect(codes(computeCheckpointWarnings(state))).not.toContain("suggestion_no_longer_applies");
  });

  it("FA-L12 det samme for endret beslutning med slettet avvik", () => {
    const state = checkpoint({
      ruleResults: [notTriggered(AGE_RULE)],
      decisions: [decision({ decision: "changed", deviationId: null, madeDeviation: true })],
    });
    expect(computeCheckpointWarnings(state)).toEqual([]);
  });

  it.each<["0" | "IU", RuleResult["suggestion"]]>([
    ["0", TG0_SUGGESTION],
    ["IU", TGIU_SUGGESTION],
  ])(
    "FA-L13 godtatt TG%s uten avvik, regelen slår ikke til, TG står: advarsel uten avvik",
    (tg, suggestion) => {
      const d = decision({
        ruleKey: TG0_RULE,
        suggestion: suggestion!,
        chosenTg: tg,
        madeDeviation: false,
        deviationId: null,
      });
      const state = checkpoint({
        tgDirect: tg,
        tgiu: tg === "IU" ? fullTgiu() : null,
        ruleResults: [notTriggered(TG0_RULE)],
        decisions: [d],
      });
      const warnings = computeCheckpointWarnings(state);
      expect(warnings).toEqual([
        { code: "suggestion_no_longer_applies", deviationId: null, ruleKey: TG0_RULE, missing: [] },
      ]);
      const label = tg === "IU" ? "TGIU" : "TG0";
      expect(warningText(warnings[0]!, { chosenTg: d.chosenTg })).toBe(
        `Forslaget gjelder ikke lenger. Punktet har fortsatt ${label} fra forslaget. Sjekk at graden stemmer.`,
      );
    },
  );

  it("FA-L13 TG på punktet er endret bort fra godtatt TG0: ingen «gjelder ikke lenger»", () => {
    const state = checkpoint({
      tgDirect: "1",
      done: false,
      ruleResults: [notTriggered(TG0_RULE)],
      decisions: [
        decision({
          ruleKey: TG0_RULE,
          suggestion: TG0_SUGGESTION,
          chosenTg: "0",
          madeDeviation: false,
          deviationId: null,
        }),
      ],
    });
    expect(computeCheckpointWarnings(state)).toEqual([]);
  });

  it("FA-L14 utfallsforslag med levende avvik og regelen slår ikke til: som før", () => {
    const state = checkpoint({
      deviations: [deviation()],
      ruleResults: [notTriggered(AGE_RULE)],
      decisions: [decision()],
    });
    const warnings = computeCheckpointWarnings(state);
    expect(warnings).toEqual([
      {
        code: "suggestion_no_longer_applies",
        deviationId: "dev-1",
        ruleKey: AGE_RULE,
        missing: [],
      },
    ]);
    expect(warningText(warnings[0]!, { chosenTg: "2" })).toBe(
      "Et forslag fra reglene gjelder ikke lenger.",
    );
  });

  it("FA-L15 alt er løst: «Å se over» er tom", () => {
    // Godtatt TG3 med avviket fylt ut, et avvist forslag og et godtatt TG0 som fortsatt står.
    const state = checkpoint({
      tgDirect: null,
      deviations: [
        deviation({ id: "dev-3", tg: 3, outcomeTg: 3, costType: "approx", costAmount: 40000 }),
      ],
      ruleResults: [
        triggered(TG3_RULE, TG3_SUGGESTION),
        triggered(AGE_RULE, AGE_SUGGESTION),
        notTriggered(NOT_DONE_RULE),
      ],
      decisions: [
        decision({
          ruleKey: TG3_RULE,
          suggestion: TG3_SUGGESTION,
          chosenTg: "3",
          deviationId: "dev-3",
        }),
        decision({ decision: "rejected", chosenTg: null, madeDeviation: false, deviationId: null }),
      ],
    });
    expect(computeCheckpointWarnings(state)).toEqual([]);
  });

  it("FA-L15 T-0115: avvikene er fjernet og TGIU satt med alt fylt ut gir tom liste", () => {
    const state = checkpoint({
      tgDirect: "IU",
      tgiu: fullTgiu(),
      ruleResults: [
        notTriggered(TG3_RULE),
        triggered(NOT_DONE_RULE, TGIU_SUGGESTION, "suggest_tgiu"),
      ],
      decisions: [
        decision({
          ruleKey: TG3_RULE,
          suggestion: TG3_SUGGESTION,
          chosenTg: "3",
          deviationId: null,
        }),
        decision({
          ruleKey: NOT_DONE_RULE,
          suggestion: TGIU_SUGGESTION,
          chosenTg: "IU",
          madeDeviation: false,
          deviationId: null,
        }),
      ],
    });
    expect(computeCheckpointWarnings(state)).toEqual([]);
  });
});

describe("FA-L16–L23 open_suggestion_on_done_checkpoint (A492)", () => {
  const openCodes = (overrides: Partial<CheckpointState>) =>
    computeCheckpointWarnings(checkpoint(overrides)).filter(
      (w) => w.code === "open_suggestion_on_done_checkpoint",
    );

  it("FA-L16 ferdig punkt med åpent TG3-forslag gir advarsel med regelen og teksten", () => {
    const warnings = openCodes({
      tgDirect: null,
      ruleResults: [triggered(TG3_RULE, TG3_SUGGESTION)],
    });
    expect(warnings).toEqual([
      {
        code: "open_suggestion_on_done_checkpoint",
        deviationId: null,
        ruleKey: TG3_RULE,
        missing: [],
      },
    ]);
    expect(warningText(warnings[0]!, { suggestionTg: 3 })).toBe(
      "Punktet er ferdig, men forslaget om TG3 er ikke avgjort.",
    );
  });

  it("FA-L16 T-0117: godtatt TG3 der avviket er fjernet, gir advarsel", () => {
    const warnings = openCodes({
      tgDirect: null,
      ruleResults: [triggered(TG3_RULE, TG3_SUGGESTION)],
      decisions: [
        decision({
          ruleKey: TG3_RULE,
          suggestion: TG3_SUGGESTION,
          chosenTg: "3",
          deviationId: null,
        }),
      ],
    });
    expect(warnings.map((w) => w.ruleKey)).toEqual([TG3_RULE]);
  });

  it.each<[string, Partial<CheckpointState>]>([
    ["annet avvik med TG2", { tgDirect: null, deviations: [deviation({ tg: 2 })] }],
    ["TG1 satt direkte", { tgDirect: "1" }],
  ])("FA-L17 TG fra før stopper ikke advarselen: %s", (_name, overrides) => {
    const warnings = openCodes({
      ...overrides,
      ruleResults: [triggered(TG3_RULE, TG3_SUGGESTION)],
    });
    expect(warnings.map((w) => w.ruleKey)).toEqual([TG3_RULE]);
  });

  it("FA-L18 punktet er ikke ferdig: ingen advarsel", () => {
    expect(
      openCodes({
        done: false,
        tgDirect: null,
        ruleResults: [triggered(TG3_RULE, TG3_SUGGESTION)],
      }),
    ).toEqual([]);
  });

  it("FA-L19 åpent TGIU-forslag gir bare tgiu_suggested_not_set", () => {
    const state = checkpoint({
      tgDirect: "1",
      ruleResults: [triggered(NOT_DONE_RULE, TGIU_SUGGESTION, "suggest_tgiu")],
    });
    expect(codes(computeCheckpointWarnings(state))).toEqual(["tgiu_suggested_not_set"]);
  });

  it("FA-L20 åpent TG0-forslag på ferdig punkt gir advarsel med TG0", () => {
    const warnings = openCodes({
      tgDirect: "1",
      ruleResults: [triggered(TG0_RULE, TG0_SUGGESTION, "suggest_tg0")],
    });
    expect(warnings.map((w) => w.ruleKey)).toEqual([TG0_RULE]);
    expect(warningText(warnings[0]!, { suggestionTg: "0" })).toBe(
      "Punktet er ferdig, men forslaget om TG0 er ikke avgjort.",
    );
  });

  it("FA-L20 A495: godtatt TG0, TG på punktet endret: forslaget er åpent igjen", () => {
    const warnings = openCodes({
      tgDirect: "1",
      ruleResults: [triggered(TG0_RULE, TG0_SUGGESTION, "suggest_tg0")],
      decisions: [
        decision({
          ruleKey: TG0_RULE,
          suggestion: TG0_SUGGESTION,
          chosenTg: "0",
          madeDeviation: false,
          deviationId: null,
        }),
      ],
    });
    expect(warnings.map((w) => w.ruleKey)).toEqual([TG0_RULE]);
  });

  it.each<[string, DecisionState, Partial<CheckpointState>]>([
    [
      "godtatt med levende avvik",
      decision({
        ruleKey: TG3_RULE,
        suggestion: TG3_SUGGESTION,
        chosenTg: "3",
        deviationId: "dev-3",
      }),
      { deviations: [deviation({ id: "dev-3", tg: 3, outcomeTg: 3 })] },
    ],
    [
      "endret til TG2 med levende avvik",
      decision({
        ruleKey: TG3_RULE,
        suggestion: TG3_SUGGESTION,
        decision: "changed",
        chosenTg: "2",
        deviationId: "dev-3",
      }),
      { deviations: [deviation({ id: "dev-3", tg: 2, outcomeTg: 3 })] },
    ],
    [
      "endret til TG1 uten avvik, TG1 står",
      decision({
        ruleKey: TG3_RULE,
        suggestion: TG3_SUGGESTION,
        decision: "changed",
        chosenTg: "1",
        madeDeviation: false,
        deviationId: null,
      }),
      { tgDirect: "1" },
    ],
    [
      "avvist",
      decision({
        ruleKey: TG3_RULE,
        suggestion: TG3_SUGGESTION,
        decision: "rejected",
        chosenTg: null,
        madeDeviation: false,
        deviationId: null,
      }),
      { tgDirect: "1" },
    ],
  ])("FA-L21 gjeldende beslutning (%s): ingen advarsel", (_name, d, overrides) => {
    expect(
      openCodes({
        tgDirect: null,
        ...overrides,
        ruleResults: [triggered(TG3_RULE, TG3_SUGGESTION)],
        decisions: [d],
      }),
    ).toEqual([]);
  });

  it("regel som ikke slår til eller ikke er vurdert, gir ingen advarsel", () => {
    expect(
      openCodes({
        ruleResults: [
          notTriggered(TG3_RULE),
          { ...triggered(AGE_RULE, null), state: "not_evaluated" },
        ],
      }),
    ).toEqual([]);
  });

  it("FA-L22 advarselen er aldri sperre: bare kode og id-er, og punktet står som ferdig", () => {
    const state = checkpoint({
      tgDirect: null,
      ruleResults: [triggered(TG3_RULE, TG3_SUGGESTION)],
    });
    for (const w of computeCheckpointWarnings(state)) {
      expect(Object.keys(w).sort()).toEqual(["code", "deviationId", "missing", "ruleKey"]);
    }
    expect(computeCheckpointStatus(state)).toBe("done");
  });

  it("FA-L23 på punktet: utfall (TG2/TG3) står foran TG0, ellers regelsvarenes rekkefølge", () => {
    const warnings = openCodes({
      tgDirect: "1",
      ruleResults: [
        triggered(TG0_RULE, TG0_SUGGESTION, "suggest_tg0"),
        triggered(AGE_RULE, AGE_SUGGESTION),
        triggered(TG3_RULE, TG3_SUGGESTION),
      ],
    });
    expect(warnings.map((w) => w.ruleKey)).toEqual([AGE_RULE, TG3_RULE, TG0_RULE]);
  });

  it("FA-L23 i «Å se over»: åpne forslag øverst, TG3 foran TG2 og TG0", () => {
    const tgByRule: Record<string, SuggestionTg> = {
      [AGE_RULE]: 2,
      [TG3_RULE]: 3,
      [TG0_RULE]: "0",
      "rule.choose": "choose",
    };
    const open = (ruleKey: string): CheckpointWarning => ({
      code: "open_suggestion_on_done_checkpoint",
      deviationId: null,
      ruleKey,
      missing: [],
    });
    const other: CheckpointWarning = {
      code: "tg3_missing_cost",
      deviationId: "dev-1",
      ruleKey: null,
      missing: [],
    };
    const sorted = sortReviewWarnings(
      [
        other,
        open(TG0_RULE),
        open(AGE_RULE),
        open("rule.unknown"),
        open("rule.choose"),
        open(TG3_RULE),
      ],
      (w) => (w.ruleKey ? (tgByRule[w.ruleKey] ?? null) : null),
    );
    expect(sorted.map((w) => w.ruleKey ?? w.code)).toEqual([
      TG3_RULE,
      "rule.choose",
      AGE_RULE,
      TG0_RULE,
      "rule.unknown",
      "tg3_missing_cost",
    ]);
  });

  it("FA-L23 rangen: TG3 < velg < TG2 < TG0 < TGIU < ukjent", () => {
    const ranks = ([3, "choose", 2, "0", "IU", null] as (SuggestionTg | null)[]).map(
      suggestionTgRank,
    );
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(new Set(ranks).size).toBe(ranks.length);
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
