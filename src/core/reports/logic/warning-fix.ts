import type { DecisionState, NextCheckpointToReview, WarningFix, WarningFixAction } from "./types";

/**
 * «Rett nå» og «x å se over – gå til neste» (A381, A388). Funksjonene sier bare hva knappen gjør.
 * Ingenting skjer uten trykk, og advarslene sperrer aldri.
 */

/** Avviket som et godtatt eller endret forslag laget, når det ikke er slettet. */
function deviationFromDecision(
  ruleKey: string,
  decisions: readonly DecisionState[],
): string | null {
  const decision = decisions.find((d) => d.ruleKey === ruleKey && d.decision !== "rejected");
  return decision?.deviationId ?? null;
}

/** Handlingen bak «Rett nå», eller `null` når advarselen ikke har én opplagt retting. */
export const warningFix: WarningFix = (warning, { decisions }): WarningFixAction | null => {
  switch (warning.code) {
    case "no_findings_with_reading_over_limit":
      return { kind: "change_answer" };
    case "tg3_missing_cost":
      return { kind: "focus_field", deviationId: warning.deviationId, field: "cost" };
    case "tg2_tg3_missing_cause_or_consequence":
    case "tg2_tg3_missing_measure":
    case "tgiu_details_missing": {
      const field = warning.missing[0];
      return field ? { kind: "focus_field", deviationId: warning.deviationId, field } : null;
    }
    case "suggestion_no_longer_applies": {
      if (warning.ruleKey === null) return null;
      return {
        kind: "scroll_to_suggestion",
        ruleKey: warning.ruleKey,
        deviationId: warning.deviationId ?? deviationFromDecision(warning.ruleKey, decisions),
      };
    }
    case "checkpoint_done_without_tg":
      return { kind: "focus_tg_choice" };
    default:
      return null;
  }
};

/**
 * Neste punkt med advarsel etter det åpne, i malens rekkefølge. Går rundt til starten og tar det
 * åpne punktet sist. `count` teller punkter med advarsel, ikke advarsler.
 */
export const nextCheckpointToReview: NextCheckpointToReview = (checkpoints, openCheckpointKey) => {
  const count = checkpoints.filter((c) => c.warningCount > 0).length;
  if (count === 0) return { next: null, count };
  const openIndex = checkpoints.findIndex((c) => c.checkpointKey === openCheckpointKey);
  for (let step = 1; step <= checkpoints.length; step++) {
    const candidate = checkpoints[(openIndex + step + checkpoints.length) % checkpoints.length];
    if (candidate && candidate.warningCount > 0) return { next: candidate.checkpointKey, count };
  }
  return { next: null, count };
};
