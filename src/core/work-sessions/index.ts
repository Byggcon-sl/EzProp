/*
 * Tidsmåling per oppdrag og fase (docs/funksjoner/fase2a-tidsmaling.md). Klientkomponenter
 * importerer `./activity` direkte, ikke denne filen (den drar med seg databasen).
 */
export { ACTIVITY_INTERVAL_SECONDS, shouldSendActivity } from "./activity";
export { NotFoundError, TimeTrackingValidationError } from "./errors";
export { IDLE_GAP_MINUTES, WORK_PHASES, phaseForAssignment, type WorkPhase } from "./phase";
export { recordWorkActivity, type RecordWorkActivityResult } from "./record";
export {
  BASELINE_MAX_MINUTES,
  BASELINE_SOURCE_MAX_LENGTH,
  timeTrackingBaselineSchema,
  timeTrackingSettingsSchema,
  type TimeTrackingBaseline,
  type TimeTrackingSettings,
  type TimeTrackingSettingsInput,
} from "./schemas";
export {
  TIME_TRACKING_BASELINE_KEY,
  TIME_TRACKING_ENABLED_KEY,
  readTimeTrackingBaseline,
  readTimeTrackingEnabled,
  saveTimeTrackingSettings,
} from "./settings";
export {
  secondsToDisplayMinutes,
  summarizeTimeStatistics,
  type PhaseStatistics,
  type TimeStatisticsRow,
  type TimeStatisticsSummary,
} from "./statistics";
export { getTimeStatistics, type TimeStatistics } from "./statistics-db";
