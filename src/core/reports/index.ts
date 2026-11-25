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
export type * from "./pdf-types";
export type * from "./publish-types";
export type * from "./types";
export { isReportPublishedForAssignment, REPORT_PUBLISHED_MESSAGE } from "./published-lock";
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
export { changeSuggestedDeviationTg } from "./suggested-tg";
export { applyPhrase, suggestPhrases } from "./phrase-suggest";
export { decideAiText } from "./decide-ai";
export { loadPhraseCandidates, loadPhraseUsage } from "./phrase-source";
export { polishDescription, polishDeviation } from "./polish";
export { draftSummary, getReportSummary, saveSummary } from "./summary";
export { setCheckpointDone, setTgDirect } from "./tgiu";
export {
  getPublishCheck,
  listPendingAiSuggestions,
  listReleases,
  publishReport,
  startNewVersion,
} from "./publish";
export { HOLE_DRILLING_SIGNAL } from "./signals";
export { buildReportPdfData } from "./pdf-data-build";
export { getReportDraftPdfData } from "./pdf-data";
export { getReleasePdfData } from "./release-pdf";
export { TG_EXPLANATION } from "./tg-explanation";
export { hasReportForPdf, listCheckpointAnchors, type CheckpointAnchor } from "./pdf-screen";
export {
  REPORT_VALIDATION_CODES,
  ReportStorageError,
  ReportTemplateMissingError,
  ReportValidationError,
  type ReportValidationCode,
} from "./errors";
