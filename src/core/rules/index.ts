/**
 * Regelmotoren (docs/adr/0008-regelmotoren.md). Rent blad: samme kode på iPaden og på serveren.
 * `evaluateRules` og `runRuleTestCases` bygges mot typene `EvaluateRules` og `RunRuleTestCases`
 * og eksporteres herfra. Levetider og terskler ligger i `./data` og sendes alltid inn som
 * argument; motoren importerer dem aldri selv. `./data` eksporteres ikke herfra: den som kaller,
 * importerer `@/core/rules/data/lifespans` og `@/core/rules/data/thresholds` direkte.
 */
export { evaluateRules } from "./evaluate";
export { runRuleTestCases } from "./test-cases";
export {
  CONDITION_REASON_CODES,
  CONDITION_TRUTHS,
  LIFESPAN_DOCUMENTATION,
  LIFESPAN_OUTCOME_KINDS,
  RULE_REASON_CODES,
  RULE_TEST_FAILURES,
  SUPPORTED_CONDITION_TYPES,
  THRESHOLD_COMPARATORS,
} from "./codes";
export type {
  AgeVsLifespanReason,
  ConditionReasonCode,
  ConditionTruth,
  EvaluateRules,
  EvaluateRulesInput,
  JsonValue,
  LifespanDocumentation,
  LifespanEntry,
  LifespanOutcomeKind,
  LifespanSet,
  NumberVsLimitReason,
  OptionSelectedReason,
  OutcomeRef,
  RuleAnswers,
  RuleDocument,
  RuleReason,
  RuleReasonCode,
  RuleResult,
  RuleSuggestion,
  RuleTemplateInfo,
  RuleTestCaseResult,
  RuleTestFailure,
  RunRuleTestCases,
  RunRuleTestCasesInput,
  ThresholdComparator,
  ThresholdEntry,
  ThresholdSet,
  UnsupportedConditionReason,
} from "./types";
