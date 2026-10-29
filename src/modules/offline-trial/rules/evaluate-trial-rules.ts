import type { TrialAnswers } from "../answers";
import type { TrialRule, TrialRuleState } from "./trial-rules";

export type TrialRuleResult = { key: string; state: TrialRuleState; message: string };

function stateFor(rule: TrialRule, value: unknown): TrialRuleState {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "not_evaluated";
  return value > rule.limit ? "triggered" : "not_triggered";
}

/**
 * Regelmotoren i prøve E. Ren funksjon uten tilstand: samme kode kjører i skjemaet uten nett
 * og i serverruten. Gir én oppføring per regel, i samme rekkefølge som `rules`.
 */
export function evaluateTrialRules(
  rules: readonly TrialRule[],
  answers: TrialAnswers,
): TrialRuleResult[] {
  return rules.map((rule) => {
    const state = stateFor(rule, answers[rule.field]);
    return { key: rule.key, state, message: rule.messages[state] };
  });
}
