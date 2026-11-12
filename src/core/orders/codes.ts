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
 * Feltene som kan rettes på en lagret ordre (A249–A253), i samme rekkefølge som skjemaet. Denne
 * rekkefølgen er rekkefølgen i `changedFields` i revisjonsloggen og hendelsen `order.updated`.
 * Kodene er navnene på feltene i koden og endres aldri; skal et felt få ny betydning, arkiveres
 * koden og det lages en ny (regel 6). `orderedByFirmId` er ikke med: firmaet følger kontakten og
 * logges ikke som eget felt.
 */
export const ORDER_EDITABLE_FIELDS = [
  "addressText",
  "receivedAt",
  "orderedByContactId",
  "orderedByText",
  "externalRef",
  "gnr",
  "bnr",
  "snr",
  "housingAssociationName",
  "sellerDeclarationReceived",
] as const;
export type OrderEditableField = (typeof ORDER_EDITABLE_FIELDS)[number];

const ORDER_FIELD_LABELS: Record<OrderEditableField, string> = {
  addressText: "adresse",
  receivedAt: "mottatt",
  orderedByContactId: "kontakt i registeret",
  orderedByText: "hvem bestilte",
  externalRef: "ekstern referanse",
  gnr: "gårdsnummer",
  bnr: "bruksnummer",
  snr: "seksjonsnummer",
  housingAssociationName: "borettslag eller sameie",
  sellerDeclarationReceived: "egenerklæring mottatt",
};

/** Slår opp bare egne nøkler, slik at for eksempel «constructor» gir koden tilbake. */
function labelOf(labels: Record<string, string>, code: string): string {
  return Object.hasOwn(labels, code) ? (labels[code] ?? code) : code;
}

/** Liten norsk etikett for en feltkode («Rettet: adresse, gårdsnummer»). Ukjent kode gir koden. */
export function orderFieldLabel(code: string): string {
  return labelOf(ORDER_FIELD_LABELS, code);
}

const ORDER_HISTORY_ACTION_LABELS: Record<string, string> = {
  create: "Opprettet",
  update: "Rettet",
  reject: "Avvist",
  convert: "Gjort om til oppdrag",
};

/** Norsk etikett for en handling i endringsloggen til ordren. Ukjent kode gir koden. */
export function orderHistoryActionLabel(action: string): string {
  return labelOf(ORDER_HISTORY_ACTION_LABELS, action);
}
