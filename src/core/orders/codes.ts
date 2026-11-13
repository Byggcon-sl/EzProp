/**
 * Faste koder for ordre (docs/05-domenemodell.md 4.3). Kodene står bare her og i CHECK-reglene i
 * `src/db/schema/orders.ts`. En kode endres aldri; skal den få ny betydning, arkiveres den og det
 * lages en ny (regel 6). Nye koder kan legges til.
 */

/**
 * Hvor ordren kom fra. Bare `manual` brukes nå. `email` er kroken for e-post-til-ordre (KI
 * lager forslaget, kontoret godkjenner). `broker_system` legges til når meglersystemet kobles på.
 */
export const ORDER_SOURCES = ["manual", "email"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

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
 * Feltene på en lagret ordre som kan endres (T1, Ståle 12.11.2026), i fast rekkefølge. Bare disse
 * kodene står i `fields` og `values` i revisjonsloggen. Kodene endres aldri (regel 6). Status,
 * avvisningsgrunn, oppdrag, kilde og ønsket rapport er bevisst ikke med.
 */
export const ORDER_EDITABLE_FIELDS = [
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
export type OrderEditableField = (typeof ORDER_EDITABLE_FIELDS)[number];

const ORDER_FIELD_LABELS = new Map<string, string>([
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
] satisfies [OrderEditableField, string][]);

/**
 * Norsk etikett for en feltkode på ordren. Ukjent kode gir koden tilbake (også `__proto__` og
 * `toString`; oppslaget er en `Map`, ikke et vanlig objekt).
 */
export function orderFieldLabel(code: string): string {
  return ORDER_FIELD_LABELS.get(code) ?? code;
}

/** Er koden en av feltkodene som kan endres? */
export function isOrderEditableField(code: unknown): code is OrderEditableField {
  return typeof code === "string" && (ORDER_EDITABLE_FIELDS as readonly string[]).includes(code);
}

/**
 * Grunnen til at en annen ordre er en mulig dublett (T3, docs/05-domenemodell.md 4.3), i fast
 * rekkefølge. Kodene endres aldri (regel 6).
 */
export const DUPLICATE_REASONS = ["address", "cadastre"] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

/**
 * Største avstand mellom to ordres `received_at` for at en ordre som ikke lenger er åpen, regnes
 * som mulig dublett. Fast varighet: 90 × 24 timer, før eller etter, grensen teller med.
 */
export const MAX_DUPLICATE_WINDOW_DAYS = 90;

const DUPLICATE_REASON_LABELS: Record<DuplicateReason, string> = {
  address: "samme adresse",
  cadastre: "samme matrikkel",
};

/** Norsk tekst for grunnen, med liten forbokstav (står midt i en linje). Ukjent kode gir koden. */
export function duplicateReasonLabel(reason: string): string {
  return (DUPLICATE_REASON_LABELS as Record<string, string>)[reason] ?? reason;
}
