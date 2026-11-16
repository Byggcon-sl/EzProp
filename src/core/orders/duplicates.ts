/**
 * Regelen for mulig dublett er felles for ordre og oppdrag og står i
 * `@/core/assignments/booking/duplicates` (ADR 0011). Gis videre her under de samme navnene.
 */
export {
  MAX_DUPLICATE_WINDOW_DAYS,
  MAX_DUPLICATE_WINDOW_MS,
  cadastreKey,
  duplicateReasons,
  isWithinDuplicateWindow,
  normalizeAddressKey,
  normalizeCadastreNumber,
  type DuplicateCandidateFields,
} from "@/core/assignments/booking/duplicates";
