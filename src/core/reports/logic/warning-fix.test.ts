import { describe, expect, it } from "vitest";
import { CHECKPOINT_WARNING_CODES } from "./codes";
import { reviewCountText, WARNING_FIX_LABELS } from "./labels";
import type {
  CheckpointWarning,
  CheckpointWarningCode,
  DecisionState,
  WarningFixAction,
} from "./types";
import { nextCheckpointToReview, warningFix } from "./warning-fix";

/*
 * «Rett nå» og «x å se over – gå til neste» (testplanen B1.18, A381 og A388). Ren test.
 *
 * Hovedmål: færre reklamasjoner (advarslene blir rettet) og de ansatte (ett trykk til feltet).
 * Ingenting skjer uten trykk: funksjonene sier bare hva knappen gjør.
 */

function warning(
  code: CheckpointWarningCode,
  overrides: Partial<CheckpointWarning> = {},
): CheckpointWarning {
  return { code, deviationId: null, ruleKey: null, missing: [], ...overrides };
}

const ACCEPTED: DecisionState = {
  ruleKey: "rule.age",
  decision: "accepted",
  suggestion: { kind: "outcome", checkpoint_key: "cp", question_key: "cp.q", outcome_key: "tg2" },
  chosenTg: "2",
  madeDeviation: true,
  deviationId: "dev-9",
};

const EXPECTED: Record<
  CheckpointWarningCode,
  { warning: CheckpointWarning; fix: WarningFixAction | null }
> = {
  deviation_tg_not_chosen: {
    warning: warning("deviation_tg_not_chosen", { deviationId: "d" }),
    fix: null,
  },
  tg2_tg3_missing_cause_or_consequence: {
    warning: warning("tg2_tg3_missing_cause_or_consequence", {
      deviationId: "d",
      missing: ["consequence_text"],
    }),
    fix: { kind: "focus_field", deviationId: "d", field: "consequence_text" },
  },
  tg2_tg3_missing_measure: {
    warning: warning("tg2_tg3_missing_measure", { deviationId: "d", missing: ["measure"] }),
    fix: { kind: "focus_field", deviationId: "d", field: "measure" },
  },
  tg3_missing_cost: {
    warning: warning("tg3_missing_cost", { deviationId: "d" }),
    fix: { kind: "focus_field", deviationId: "d", field: "cost" },
  },
  cost_amount_not_rounded: {
    warning: warning("cost_amount_not_rounded", { deviationId: "d" }),
    fix: null,
  },
  hms_missing_consequence_or_measure: {
    warning: warning("hms_missing_consequence_or_measure", {
      deviationId: "d",
      missing: ["measure"],
    }),
    fix: null,
  },
  tgiu_details_missing: {
    warning: warning("tgiu_details_missing", { missing: ["risk_assessment", "how_to_examine"] }),
    fix: { kind: "focus_field", deviationId: null, field: "risk_assessment" },
  },
  tgiu_suggested_not_set: {
    warning: warning("tgiu_suggested_not_set", { ruleKey: "rule.hole" }),
    fix: null,
  },
  no_findings_with_reading_over_limit: {
    warning: warning("no_findings_with_reading_over_limit"),
    fix: { kind: "change_answer" },
  },
  suggestion_no_longer_applies: {
    warning: warning("suggestion_no_longer_applies", { ruleKey: "rule.age", deviationId: "dev-9" }),
    fix: { kind: "scroll_to_suggestion", ruleKey: "rule.age", deviationId: "dev-9" },
  },
  texts_written_for_other_tg: {
    warning: warning("texts_written_for_other_tg", { deviationId: "d" }),
    fix: null,
  },
  checkpoint_done_without_tg: {
    warning: warning("checkpoint_done_without_tg"),
    fix: { kind: "focus_tg_choice" },
  },
  tg3_on_age_only: { warning: warning("tg3_on_age_only", { deviationId: "d" }), fix: null },
};

describe("B1.18 «Rett nå»", () => {
  it.each(CHECKPOINT_WARNING_CODES.map((code) => [code]))("%s", (code) => {
    const { warning: w, fix } = EXPECTED[code];
    expect(warningFix(w, { decisions: [ACCEPTED] })).toEqual(fix);
  });

  it("forslag som ikke gjelder: uten avvik gir bare rulling (ingen «Fjern avviket»)", () => {
    const w = warning("suggestion_no_longer_applies", { ruleKey: "rule.age" });
    expect(warningFix(w, { decisions: [] })).toEqual({
      kind: "scroll_to_suggestion",
      ruleKey: "rule.age",
      deviationId: null,
    });
  });

  it("forslag som ikke gjelder: avviket hentes fra den godtatte beslutningen (A388)", () => {
    const w = warning("suggestion_no_longer_applies", { ruleKey: "rule.age" });
    expect(warningFix(w, { decisions: [ACCEPTED] })).toEqual({
      kind: "scroll_to_suggestion",
      ruleKey: "rule.age",
      deviationId: "dev-9",
    });
  });

  it("avvist beslutning gir aldri «Fjern avviket»", () => {
    const w = warning("suggestion_no_longer_applies", { ruleKey: "rule.age" });
    const rejected: DecisionState = { ...ACCEPTED, decision: "rejected", deviationId: null };
    expect(warningFix(w, { decisions: [rejected] })).toMatchObject({ deviationId: null });
  });

  it("advarsel uten det som mangler gir ingen fokus-handling", () => {
    expect(warningFix(warning("tgiu_details_missing"), { decisions: [] })).toBe(null);
  });

  it("hver handling har knappetekst", () => {
    expect(WARNING_FIX_LABELS.change_answer).toBe("Endre til utført med funn");
    expect(WARNING_FIX_LABELS.focus_field).toBe("Rett nå");
  });
});

describe("B1.18 neste å se over", () => {
  const list = (counts: number[]) =>
    counts.map((warningCount, i) => ({ checkpointKey: `cp${i}`, warningCount }));

  it("hopper til neste punkt med advarsel etter det åpne", () => {
    expect(nextCheckpointToReview(list([0, 2, 0, 1, 0]), "cp1")).toEqual({ next: "cp3", count: 2 });
  });

  it("går rundt til starten", () => {
    expect(nextCheckpointToReview(list([0, 2, 0, 1, 0]), "cp3")).toEqual({ next: "cp1", count: 2 });
  });

  it("bare det åpne har advarsel: blir stående på det", () => {
    expect(nextCheckpointToReview(list([0, 3, 0]), "cp1")).toEqual({ next: "cp1", count: 1 });
  });

  it("ingen åpent punkt starter fra begynnelsen", () => {
    expect(nextCheckpointToReview(list([0, 0, 4]), null)).toEqual({ next: "cp2", count: 1 });
    expect(nextCheckpointToReview(list([5, 0, 4]), "ukjent")).toEqual({ next: "cp0", count: 2 });
  });

  it("ingen advarsler gir null", () => {
    expect(nextCheckpointToReview(list([0, 0, 0]), "cp0")).toEqual({ next: null, count: 0 });
    expect(nextCheckpointToReview([], null)).toEqual({ next: null, count: 0 });
  });

  it("telleren teller punkter, ikke advarsler", () => {
    const { count } = nextCheckpointToReview(list([3, 0, 5, 1]), "cp0");
    expect(count).toBe(3);
    expect(reviewCountText(count)).toBe("3 å se over – gå til neste");
  });
});
