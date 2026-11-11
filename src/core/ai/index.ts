/*
 * KI-modulen: den ene veien inn til all KI (docs/adr/0006-ki-i-bunnen.md, arkitekturregel 11).
 * Modulene kaller bare `requestSuggestion`, `recordDecision`, statusoppslaget `getSuggestionStatus`
 * og sperren `checkAiTextApproved`. Ingenting her lister eller teller rader per ansatt
 * (spørsmål 57).
 */

export { requestSuggestion } from "./request-suggestion";
export { recordDecision } from "./record-decision";
export { getSuggestionStatus, type AiSuggestionStatusResult } from "./suggestion-status";
export { AI_APPROVAL_CHECK_MAX, checkAiTextApproved, type AiApprovalItem } from "./approval-check";
export {
  AI_DECISION_ERROR_MESSAGE,
  AI_REQUEST_REJECTED_MESSAGE,
  AiDecisionError,
  AiRequestRejectedError,
} from "./errors";
export {
  AI_FEATURES,
  AI_TRIAL_TARGET_TYPE,
  FREE_TEXT_SOURCE,
  findFieldSourceViolations,
  getFeatureDefinition,
  type AiFeatureDefinition,
  type AiFieldSource,
  type AiFieldSourceCheckInput,
  type AiTargetSpec,
} from "./features";
export { NEVER_FIELDS } from "./never-fields";
export { AI_ENABLED_SETTING_KEY } from "./provider-resolution";
export {
  FAKE_ERROR_CODE,
  FAKE_ERROR_INPUT,
  FAKE_MODEL,
  FAKE_NO_MATCH_INPUT,
} from "./providers/fake";
export type { AiProvider, AiProviderRequest, AiProviderResult } from "./providers/types";
export { AI_FIELD_MAX_LENGTH } from "./request";
export {
  AI_DECISIONS,
  type AiDecision,
  type AiErrorCode,
  type AiFeatureCode,
  type AiOutcome,
  type AiSuggestionRequest,
  type AiSuggestionResult,
  type AiSuggestionStatus,
  type AiTargetRef,
} from "./types";
