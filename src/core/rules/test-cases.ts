import { evaluateRules } from "./evaluate";
import type { OutcomeRef, RuleResult, RuleTestCaseResult, RunRuleTestCases } from "./types";

/**
 * Kjører testsakene i maldokumentet (docs/adr/0008-regelmotoren.md). Hver testsak kjører bare sin
 * egen regel, med testsakens svar og befaringsår. Ren funksjon.
 */

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sameOutcome(result: RuleResult, expected: OutcomeRef): boolean {
  const suggestion = result.suggestion;
  return (
    suggestion?.kind === "outcome" &&
    suggestion.checkpoint_key === expected.checkpoint_key &&
    suggestion.question_key === expected.question_key &&
    suggestion.outcome_key === expected.outcome_key
  );
}

export const runRuleTestCases: RunRuleTestCases = ({
  template,
  document,
  lifespans,
  thresholds,
}) => {
  const testCases = [...document.rule_test_cases].sort(
    (a, b) =>
      compareText(a.rule_key, b.rule_key) ||
      a.sort_order - b.sort_order ||
      compareText(a.name, b.name),
  );

  return testCases.map((testCase): RuleTestCaseResult => {
    const base = {
      rule_key: testCase.rule_key,
      name: testCase.name,
      sort_order: testCase.sort_order,
      expected_state: testCase.expected_state,
      expected_outcome: testCase.expected_outcome,
    };
    const rules = document.rules.filter((r) => r.key === testCase.rule_key && r.active);
    const result = evaluateRules({
      template,
      document: { ...document, rules },
      answers: testCase.input,
      inspectionYear: testCase.inspection_year,
      lifespans,
      thresholds,
    }).find((r) => r.rule_key === testCase.rule_key);

    if (!result) return { ...base, passed: false, failure: "rule_missing", result: null };
    if (result.state !== testCase.expected_state) {
      return { ...base, passed: false, failure: "state_mismatch", result };
    }
    if (
      result.state === "triggered" &&
      testCase.expected_outcome &&
      !sameOutcome(result, testCase.expected_outcome)
    ) {
      return { ...base, passed: false, failure: "outcome_mismatch", result };
    }
    return { ...base, passed: true, failure: null, result };
  });
};
