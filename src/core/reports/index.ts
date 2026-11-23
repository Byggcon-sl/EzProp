import "server-only";

/**
 * Rapportkjernen (ADR 0013, docs/funksjoner/fase2a-badet-pc.md). Bare for serveren:
 * `server-only` stopper bygget hvis en klientkomponent importerer herfra. Klientkomponenter
 * importerer fra `@/core/reports/logic`.
 *
 * Tilgang sjekkes bare via `@/core/access`; spørringene filtrerer på `grant.organizationId`.
 * Fra «KI i veien» kaller fraseforslag, språkvask og sammendrag KI gjennom `@/core/ai`, aldri
 * motsatt. Verken reglene eller KI setter TG.
 */
export type * from "./types";
export { startReport } from "./reports";
export { getRoomView } from "./room-view";
export { saveField } from "./save-field";
export {
  addDeviation,
  addMeasure,
  removeDeviation,
  removeMeasure,
  restoreDeviation,
} from "./deviations";
export { decideSuggestion } from "./suggestions";
export { applyPhrase, suggestPhrases } from "./phrase-suggest";
export { decideAiText } from "./decide-ai";
export { loadPhraseCandidates, loadPhraseUsage } from "./phrase-source";
export { polishDescription, polishDeviation } from "./polish";
export { draftSummary, getReportSummary, saveSummary } from "./summary";
export { setCheckpointDone, setTgDirect } from "./tgiu";
export {
  REPORT_VALIDATION_CODES,
  ReportStorageError,
  ReportTemplateMissingError,
  ReportValidationError,
  type ReportValidationCode,
} from "./errors";
