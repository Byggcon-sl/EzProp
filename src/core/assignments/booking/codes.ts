/**
 * Faste koder for bestillingsopplysningene (ADR 0011, docs/05-domenemodell.md 4.3). De gjelder
 * både ordren og oppdraget, og står bare her; `@/core/orders/codes` gir dem videre under de gamle
 * navnene. En kode endres aldri; skal den få ny betydning, arkiveres den og det lages en ny
 * (regel 6). Nye koder kan legges til. CHECK-reglene `orders_source_check` og
 * `assignments_source_check` må ha de samme kildekodene.
 */

/**
 * Hvor bestillingen kom fra. Bare `manual` brukes nå. `email` er kroken for e-post til oppdrag
 * (KI lager forslaget, den ansatte godkjenner).
 */
export const BOOKING_SOURCES = ["manual", "email"] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

/**
 * Bestillingsfeltene som kan endres etter lagring, i fast rekkefølge. Samme liste for ordre
 * (`order.updated`) og oppdrag (`assignment.booking_updated`). Bare disse kodene står i `fields`
 * og `values` i revisjonsloggen. Kilde, status og nummer er bevisst ikke med.
 */
export const BOOKING_EDITABLE_FIELDS = [
  "receivedAt",
  "externalRef",
  "orderedByText",
  "orderedByContactId",
  "orderedByFirmId",
  "addressText",
  "gnr",
  "bnr",
  "snr",
  "housingAssociationName",
  "sellerDeclarationReceived",
] as const;
export type BookingEditableField = (typeof BOOKING_EDITABLE_FIELDS)[number];

const BOOKING_FIELD_LABELS = new Map<string, string>([
  ["receivedAt", "Mottatt"],
  ["externalRef", "Ekstern referanse"],
  ["orderedByText", "Hvem bestilte"],
  ["orderedByContactId", "Bestiller"],
  ["orderedByFirmId", "Firma"],
  ["addressText", "Adresse"],
  ["gnr", "Gårdsnummer"],
  ["bnr", "Bruksnummer"],
  ["snr", "Seksjonsnummer"],
  ["housingAssociationName", "Borettslag"],
  ["sellerDeclarationReceived", "Egenerklæring mottatt"],
] satisfies [BookingEditableField, string][]);

/**
 * Norsk etikett for en feltkode i bestillingen. Ukjent kode gir koden tilbake (også `__proto__`
 * og `toString`; oppslaget er en `Map`, ikke et vanlig objekt).
 */
export function bookingFieldLabel(code: string): string {
  return BOOKING_FIELD_LABELS.get(code) ?? code;
}

/** Er koden en av feltkodene som kan endres? */
export function isBookingEditableField(code: unknown): code is BookingEditableField {
  return typeof code === "string" && (BOOKING_EDITABLE_FIELDS as readonly string[]).includes(code);
}

/**
 * Grunnene til at en annen ordre eller et annet oppdrag er en mulig dublett (T3), i fast
 * rekkefølge.
 */
export const DUPLICATE_REASONS = ["address", "cadastre"] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

const DUPLICATE_REASON_LABELS = new Map<string, string>([
  ["address", "samme adresse"],
  ["cadastre", "samme matrikkel"],
] satisfies [DuplicateReason, string][]);

/** Norsk tekst for en grunn til mulig dublett. Ukjent kode gir koden tilbake. */
export function duplicateReasonLabel(code: string): string {
  return DUPLICATE_REASON_LABELS.get(code) ?? code;
}

/** Hva et dubletttreff er: en ordre som ikke er gjort om, eller et oppdrag. */
export const DUPLICATE_KINDS = ["order", "assignment"] as const;
export type DuplicateKind = (typeof DUPLICATE_KINDS)[number];
