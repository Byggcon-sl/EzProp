/**
 * Faste koder for ordre (docs/05-domenemodell.md 4.3). Kodene står bare her og i CHECK-reglene i
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

/** Mottatt → gjort om til oppdrag eller avvist. Aldri videre. */
export const ORDER_STATUSES = ["received", "converted", "rejected"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  received: "Mottatt",
  converted: "Gjort om til oppdrag",
  rejected: "Avvist",
};

/** Norsk etikett for en ordrestatus. Ukjent kode gir koden tilbake. */
export function orderStatusLabel(code: string): string {
  return (ORDER_STATUS_LABELS as Record<string, string>)[code] ?? code;
}

/**
 * Feltene på en lagret ordre som kan endres (T1, Ståle 12.11.2026), i fast rekkefølge. Listen er
 * felles for ordre og oppdrag og står i `@/core/assignments/booking/codes` (ADR 0011). Status,
 * avvisningsgrunn, oppdrag, kilde og ønsket rapport er bevisst ikke med.
 */
export const ORDER_EDITABLE_FIELDS = BOOKING_EDITABLE_FIELDS;
export type OrderEditableField = BookingEditableField;

/** Norsk etikett for en feltkode på ordren. Ukjent kode gir koden tilbake. */
export const orderFieldLabel = bookingFieldLabel;

/** Er koden en av feltkodene som kan endres? */
export const isOrderEditableField = isBookingEditableField;
