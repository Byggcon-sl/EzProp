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
 * Feltene som kan endres på en lagret ordre (T1, A250), i fast rekkefølge. Rekkefølgen brukes i
 * `fields` i revisjonsloggen og i hendelsen `order.updated`. Kodene er navnene i koden og endres
 * aldri (regel 6). `orderedByFirmId` står her fordi firmaet kan endres, men det settes bare av
 * serveren fra kontakten, aldri fra skjemaet.
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
  orderedByText: "Bestilt av (tekst)",
  orderedByContactId: "Bestiller",
  orderedByFirmId: "Firma",
  addressText: "Adresse",
  gnr: "Gnr",
  bnr: "Bnr",
  snr: "Snr",
  housingAssociationName: "Borettslag",
  sellerDeclarationReceived: "Egenerklæring mottatt",
};

/** Sant hvis koden er et felt som kan endres på ordren. */
export function isOrderEditableField(code: unknown): code is OrderEditableField {
  return typeof code === "string" && (ORDER_EDITABLE_FIELDS as readonly string[]).includes(code);
}

/** Norsk etikett for et ordrefelt. Ukjent kode gir koden tilbake, aldri unntak. */
export function orderFieldLabel(code: string): string {
  return isOrderEditableField(code) ? ORDER_FIELD_LABELS[code] : String(code);
}
