/**
 * Faste koder for ordre, som heter «Tilbud» i grensesnittet (ADR 0012, docs/05-domenemodell.md
 * 4.3). Kodene beholdes: `received` vises som «Åpent», `rejected` som «Avslått». Kodene står bare her og i CHECK-reglene i
 * `src/db/schema/orders.ts`. En kode endres aldri; skal den få ny betydning, arkiveres den og det
 * lages en ny (regel 6). Nye koder kan legges til.
 */

import {
  BOOKING_EDITABLE_FIELDS,
  BOOKING_SOURCES,
  bookingFieldLabel,
  isBookingEditableField,
  type BookingEditableField,
  type BookingSource,
} from "@/core/assignments/booking/codes";

export {
  DUPLICATE_REASONS,
  duplicateReasonLabel,
  type DuplicateReason,
} from "@/core/assignments/booking/codes";

/**
 * Hvor ordren kom fra. Bare `manual` brukes nå. `email` er kroken for e-post-til-ordre (KI
 * lager forslaget, kontoret godkjenner). `broker_system` legges til når meglersystemet kobles på.
 */
export const ORDER_SOURCES = BOOKING_SOURCES;
export type OrderSource = BookingSource;

/** Mottatt (åpent tilbud) → gjort om til oppdrag eller avslått. Aldri videre. */
export const ORDER_STATUSES = ["received", "converted", "rejected"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_STATUS_LABELS = new Map<string, string>([
  ["received", "Åpent"],
  ["converted", "Gjort om til oppdrag"],
  ["rejected", "Avslått"],
] satisfies [OrderStatus, string][]);

/**
 * Norsk etikett for en lagret status (ADR 0012). Ukjent kode gir koden tilbake. Sier ikke om et
 * åpent tilbud er utløpt; bruk `offerDisplayStatusLabel` med visningsstatusen for det.
 */
export function orderStatusLabel(code: string): string {
  return ORDER_STATUS_LABELS.get(code) ?? code;
}

/**
 * Visningsstatusen for et tilbud (ADR 0012). «Utløpt» (`expired`) regnes ut fra `valid_until` og
 * dagens dato og lagres aldri i `orders.status`; CHECK-regelen har bare `ORDER_STATUSES`.
 * `open` er `received` som ikke er utløpt. Kodene står i adressen (`?status=`) og er faste.
 */
export const OFFER_DISPLAY_STATUSES = ["open", "expired", "converted", "rejected"] as const;
export type OfferDisplayStatus = (typeof OFFER_DISPLAY_STATUSES)[number];

/** Filtrene i tilbudslisten: hver visningsstatus og `all`. Standard er `open`. */
export const OFFER_LIST_FILTERS = [...OFFER_DISPLAY_STATUSES, "all"] as const;
export type OfferListFilter = (typeof OFFER_LIST_FILTERS)[number];
export const DEFAULT_OFFER_LIST_FILTER: OfferListFilter = "open";

const OFFER_DISPLAY_STATUS_LABELS = new Map<string, string>([
  ["open", "Åpent"],
  ["expired", "Utløpt"],
  ["converted", "Gjort om til oppdrag"],
  ["rejected", "Avslått"],
] satisfies [OfferDisplayStatus, string][]);

/** Norsk etikett for en visningsstatus («Åpent», «Utløpt» …). Ukjent kode gir koden tilbake. */
export function offerDisplayStatusLabel(code: string): string {
  return OFFER_DISPLAY_STATUS_LABELS.get(code) ?? code;
}

const OFFER_LIST_FILTER_LABELS = new Map<string, string>([
  ["open", "Åpne"],
  ["expired", "Utløpt"],
  ["rejected", "Avslått"],
  ["converted", "Gjort om til oppdrag"],
  ["all", "Alle"],
] satisfies [OfferListFilter, string][]);

/** Norsk tekst på filterknappen. Ukjent kode gir koden tilbake. */
export function offerListFilterLabel(code: string): string {
  return OFFER_LIST_FILTER_LABELS.get(code) ?? code;
}

/** Er verdien et filter i tilbudslisten? */
export function isOfferListFilter(value: unknown): value is OfferListFilter {
  return typeof value === "string" && (OFFER_LIST_FILTERS as readonly string[]).includes(value);
}

/**
 * Faste grunner for avslag (F4, A361), i den rekkefølgen de vises. Kodene står i CHECK-regelen
 * `orders_rejected_reason_key_check` (migrering 0035). En kode endres aldri; arkiveres den, blir
 * den stående i CHECK-regelen. Fritekst er påkrevd bare ved `other`.
 */
export const OFFER_REJECTION_REASON_KEYS = [
  "price",
  "timing",
  "chose_other",
  "customer_withdrew",
  "other",
] as const;
export type OfferRejectionReasonKey = (typeof OFFER_REJECTION_REASON_KEYS)[number];

/** Koden der fritekst er påkrevd. */
export const OFFER_REJECTION_OTHER: OfferRejectionReasonKey = "other";

const OFFER_REJECTION_REASON_LABELS = new Map<string, string>([
  ["price", "Pris"],
  ["timing", "Tidspunkt passet ikke"],
  ["chose_other", "Valgte en annen"],
  ["customer_withdrew", "Kunden trakk seg"],
  ["other", "Annet"],
] satisfies [OfferRejectionReasonKey, string][]);

/** Norsk etikett for en avslagsgrunn. Ukjent kode gir koden tilbake. */
export function offerRejectionReasonLabel(code: string): string {
  return OFFER_REJECTION_REASON_LABELS.get(code) ?? code;
}

/** Er verdien en av de faste avslagsgrunnene? */
export function isOfferRejectionReasonKey(value: unknown): value is OfferRejectionReasonKey {
  return (
    typeof value === "string" && (OFFER_REJECTION_REASON_KEYS as readonly string[]).includes(value)
  );
}

/** Feltkoden for «Gyldig til» (ADR 0012). Fast fra merge. Bare på tilbudet, aldri på oppdraget. */
export const VALID_UNTIL_FIELD = "validUntil";

/**
 * Feltene på et lagret tilbud som kan endres (T1, Ståle 12.11.2026), i fast rekkefølge:
 * bestillingsfeltene (felles med oppdraget, `@/core/assignments/booking/codes`, ADR 0011) og
 * `validUntil` sist (ADR 0012). `validUntil` legges aldri i bestillingslisten, så oppdraget
 * godtar den ikke. Status, avslagsgrunn, oppdrag, kilde og ønsket rapport er bevisst ikke med.
 */
export const ORDER_EDITABLE_FIELDS = [...BOOKING_EDITABLE_FIELDS, VALID_UNTIL_FIELD] as const;
export type OrderEditableField = BookingEditableField | typeof VALID_UNTIL_FIELD;

/** Norsk etikett for en feltkode på tilbudet. Ukjent kode gir koden tilbake. */
export function orderFieldLabel(code: string): string {
  return code === VALID_UNTIL_FIELD ? "Gyldig til" : bookingFieldLabel(code);
}

/** Er koden en av feltkodene som kan endres på tilbudet? */
export function isOrderEditableField(code: unknown): code is OrderEditableField {
  return code === VALID_UNTIL_FIELD || isBookingEditableField(code);
}
