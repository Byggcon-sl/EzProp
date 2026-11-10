/*
 * KI-modulen (ADR 0006). All KI går gjennom disse to funksjonene. Begge tar `EmployeeGrant` fra
 * `requireOrganizationAccess`, aldri en organisasjons-ID fra kalleren. Ingenting her lister eller
 * teller rader per ansatt (spørsmål 57).
 */
export { AiDecisionError, AiRequestRejectedError } from "./errors";
export { AI_FEATURES, getFeatureDefinition } from "./features";
export {
  FAKE_ERROR_INPUT,
  FAKE_MODEL,
  FAKE_NO_MATCH_INPUT,
  FAKE_PROVIDER_CODE,
  fakeAiProvider,
} from "./providers/fake";
export { recordDecision } from "./record-decision";
export { requestSuggestion } from "./request-suggestion";
export { AI_ENABLED_KEY } from "./resolve-provider";
export { computeAiRetainUntil } from "./retention";
export {
  AI_FEATURE_CODES,
  type AiAllowedTarget,
  type AiDecision,
  type AiErrorCode,
  type AiFeatureCode,
  type AiFeatureDefinition,
  type AiOutcome,
  type AiProvider,
  type AiProviderRequest,
  type AiProviderResult,
  type AiRequest,
  type AiResponse,
  type AiSuggestionRequest,
  type AiSuggestionResult,
  type AiSuggestionStatus,
  type AiTargetRef,
} from "./types";
