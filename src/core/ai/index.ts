/*
 * KI-modulen: den ene veien inn til all KI (docs/adr/0006-ki-i-bunnen.md, arkitekturregel 11).
 * Modulene kaller bare `requestSuggestion` (og `requestSuggestionBatch` for flere felt fra ett
 * trykk), `recordDecision` (og `recordDecisionIn` i kallerens transaksjon), statusoppslaget
 * `getSuggestionStatus` og sperren `checkAiTextApproved`. Ingenting her lister eller teller rader
 * per ansatt (spørsmål 57).
 */

export { requestSuggestion, requestSuggestionBatch } from "./request-suggestion";
export { recordDecision, recordDecisionIn } from "./record-decision";
export { getSuggestionStatus, type AiSuggestionStatusResult } from "./suggestion-status";
export { AI_APPROVAL_CHECK_MAX, checkAiTextApproved, type AiApprovalItem } from "./approval-check";
export {
  AI_DECISION_ERROR_MESSAGE,
  AI_INPUT_TOO_LARGE_MESSAGES,
  AI_INPUT_TOO_LARGE_REASONS,
  AI_REQUEST_REJECTED_MESSAGE,
  AI_RETENTION_YEARS_ERROR,
  AiDecisionError,
  AiInputTooLargeError,
  AiRequestRejectedError,
  AiRetentionValidationError,
  type AiInputTooLargeReason,
} from "./errors";
export {
  AI_BATCH_MAX_REQUESTS,
  AI_CANDIDATES_MAX,
  AI_CANDIDATE_TEXT_MAX_LENGTH,
  AI_SUMMARY_FINDINGS_MAX,
  AI_SUMMARY_INPUT_MAX_LENGTH,
  OUTCOME_MATCH_CANDIDATES_MAX,
  OUTCOME_MATCH_MAX,
  OUTCOME_MATCH_NOTE_MAX,
} from "./limits";
/** Høyeste antall kandidater i svaret. Samme tall som `candidate_refs` tåler (CHECK-regelen). */
export { AI_CANDIDATE_REFS_MAX as AI_SUGGESTED_CANDIDATES_MAX } from "@/shared/config/ai-targets";
export {
  AI_REJECTED_RETENTION_KEY,
  AI_REJECTED_RETENTION_MAX,
  AI_REJECTED_RETENTION_MIN,
  getAiRetentionSettings,
  readRejectedRetentionYears,
  retainUntilFor,
  saveAiRetentionSettings,
} from "./retention";
export {
  AI_FEATURES,
  AI_FEATURES_WITHOUT_AI_TEXT,
  AI_TRIAL_TARGET_TYPE,
  ARCHIVED_AI_TARGET_TYPES,
  FREE_TEXT_SOURCE,
  findFieldSourceViolations,
  getFeatureDefinition,
  type AiFeatureDefinition,
  type AiFieldSource,
  type AiFieldSourceCheckInput,
  type AiTargetSpec,
} from "./features";
/** Tom tekst: bare mellomrom, også ikke-brytende og nullbredde. Samme regel som vaktene. */
export { isBlankText } from "./guards";
export { NEVER_FIELDS } from "./never-fields";
export { AI_ENABLED_SETTING_KEY } from "./provider-resolution";
export {
  FAKE_ADD_NUMBER_INPUT,
  FAKE_ADD_TG_INPUT,
  FAKE_ADDED_NUMBER,
  FAKE_ADDED_TG,
  FAKE_BAD_LABELS_INPUT,
  FAKE_DROP_FINDING_INPUT,
  FAKE_DROP_PLACEHOLDER_INPUT,
  FAKE_ERROR_CODE,
  FAKE_ERROR_INPUT,
  FAKE_MODEL,
  FAKE_NO_MATCH_INPUT,
} from "./providers/fake";
export type { AiProvider, AiProviderRequest, AiProviderResult } from "./providers/types";
export { AI_FIELD_MAX_LENGTH } from "./request";
export {
  AI_DECISIONS,
  type AiCandidate,
  type AiCandidateRef,
  type AiCandidateSource,
  type AiDecision,
  type AiDecisionOptions,
  type AiErrorCode,
  type AiFeatureCode,
  type AiGuardCode,
  type AiOutcome,
  type AiServerInput,
  type AiSummaryFinding,
  type AiSummaryFixedLine,
  type AiSummaryGroup,
  type AiSuggestionRequest,
  type AiSuggestionResult,
  type AiSuggestionStatus,
  type AiTargetRef,
  type RecordDecisionIn,
  type RequestSuggestionBatch,
} from "./types";
