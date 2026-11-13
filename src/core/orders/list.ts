import type { Actor } from "@/core/access";
import type { OrderSource, OrderStatus } from "./codes";

/*
 * Grensesnittet for ordrelisten med søk og grense (docs/funksjoner/fase2a-sok-ordre-arbeidsko.md,
 * ADR 0010). Søkevilkåret står i `@/core/assignments` (`orderFieldsMatch`,
 * `assignmentFieldsMatch`).
 */

/** Ordrelisten viser høyst så mange rader. Søket er veien til eldre ordre. */
export const ORDER_LIST_LIMIT = 50;

/** `query` er søketeksten fra `?q=`. Tom, `null` eller utelatt gir hele listen (opp til grensen). */
export type ListOrdersOptions = { query?: string | null };

/** Én rad i ordrelisten. Fast feltliste, ingen sporingsfelt. */
export type OrderListItem = {
  id: string;
  receivedAt: Date;
  source: OrderSource;
  /** Meglerens ordrenummer. Vises på raden når det finnes. */
  externalRef: string | null;
  orderedByText: string | null;
  addressText: string;
  status: OrderStatus;
  assignmentId: string | null;
  /** Nummeret vises også når oppdraget er kansellert. */
  assignmentNumber: string | null;
};

/** `total` er antallet som passer søket, også når listen er kuttet ved `ORDER_LIST_LIMIT`. */
export type OrderListResult = { items: OrderListItem[]; total: number };

/**
 * Kontrakten for `listOrders`:
 * - Krever `organization.read`. Filtrerer på `grant.organizationId`, aldri på parameteren.
 *   Ansatt i en annen organisasjon gir `AccessDeniedError`.
 * - Bare ordrer som ikke er slettet. Ordre med kansellert oppdrag er med, også i søket.
 * - Sortering `received_at desc, id desc`, høyst `ORDER_LIST_LIMIT` rader.
 * - `total` telles med samme WHERE som listen.
 * - Søket er `or` av `orderFieldsMatch(query)` og `assignmentFieldsMatch(grant.organizationId,
 *   query)`. Én rad per ordre, aldri doble rader.
 * - Bare lesing: ingen rader i `audit_log`, hendelsene eller `ai_usage_log`, og søketeksten
 *   logges ikke.
 */
export type ListOrders = (
  actor: Actor,
  organizationId: string,
  options?: ListOrdersOptions,
) => Promise<OrderListResult>;

/**
 * Meldingen over ordrelisten når den er kuttet: «Viser 50 av 73. Bruk søket for å finne flere.»
 * Gir `null` når alle radene vises. Ren funksjon, slik at den kan testes uten nettleser.
 */
export function orderListSummary(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return `Viser ${shown} av ${total}. Bruk søket for å finne flere.`;
}
