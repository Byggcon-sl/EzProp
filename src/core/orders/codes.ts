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
 * Feltene som kan endres på en lagret ordre (T1, Ståle 12.11.2026), i fast rekkefølge. Dette er
 * de eneste feltkodene i `fields` og `values` i revisjonsloggen for `order`/`update`. Kodene er
 * navnene i koden og endres aldri (regel 6).
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

const ORDER_FIELD_LABELS: Record<OrderEditableField, string> = {
  receivedAt: "Mottatt",
  externalRef: "Ekstern referanse",
  orderedByText: "Bestilt av (fritekst)",
  orderedByContactId: "Bestiller",
  orderedByFirmId: "Bestillers firma",
  addressText: "Adresse",
  gnr: "Gårdsnummer",
  bnr: "Bruksnummer",
  snr: "Seksjonsnummer",
  housingAssociationName: "Borettslag/sameie",
  sellerDeclarationReceived: "Egenerklæring mottatt",
};

/** Er koden et felt som kan endres på ordren? */
export function isOrderEditableField(code: unknown): code is OrderEditableField {
  return typeof code === "string" && (ORDER_EDITABLE_FIELDS as readonly string[]).includes(code);
}

/** Norsk etikett for et ordrefelt. Ukjent kode gir koden tilbake, aldri unntak. */
export function orderFieldLabel(code: string): string {
  return isOrderEditableField(code) ? ORDER_FIELD_LABELS[code] : code;
}
