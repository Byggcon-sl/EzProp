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
