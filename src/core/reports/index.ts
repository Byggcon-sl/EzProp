import "server-only";

/**
 * Rapportkjernen (ADR 0013, docs/funksjoner/fase2a-badet-pc.md). Bare for serveren:
 * `server-only` stopper bygget hvis en klientkomponent importerer herfra. Klientkomponenter
 * importerer fra `@/core/reports/logic`.
 *
 * Tilgang sjekkes bare via `@/core/access`; spørringene filtrerer på `grant.organizationId`.
 * Ingen tjeneste her kaller KI (gjelder til «KI i veien»), og reglene setter aldri TG.
 */
export type * from "./publish-types";
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
export { setCheckpointDone, setTgDirect } from "./tgiu";
export {
  getPublishCheck,
  isReportPublishedForAssignment,
  listPendingAiSuggestions,
  listReleases,
  publishReport,
  startNewVersion,
} from "./publish";
export {
  REPORT_VALIDATION_CODES,
  ReportStorageError,
  ReportTemplateMissingError,
  ReportValidationError,
  type ReportValidationCode,
} from "./errors";
