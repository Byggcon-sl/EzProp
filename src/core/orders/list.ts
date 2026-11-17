import type { ListOffers, ListOffersOptions, OfferListItem, OfferListResult } from "./contract";

/*
 * Grensesnittet for tilbudslisten (ordre i koden, ADR 0012) med filter, søk og grense
 * (docs/funksjoner/fase2a-sok-ordre-arbeidsko.md, ADR 0010). Søkevilkåret står i
 * `@/core/assignments` (`orderFieldsMatch`, `assignmentFieldsMatch`).
 */

/** Tilbudslisten viser høyst så mange rader. Søket er veien til eldre tilbud. */
export const ORDER_LIST_LIMIT = 50;

/** `query` er søketeksten fra `?q=`, `status` filteret fra `?status=` (ADR 0012). */
export type ListOrdersOptions = ListOffersOptions;

/** Én rad i tilbudslisten. Fast feltliste, ingen sporingsfelt. */
export type OrderListItem = OfferListItem;

/** Svaret fra `listOrders`: radene, `total`, filteret og antall per filter (F3). */
export type OrderListResult = OfferListResult;

/** Kontrakten for `listOrders` står i `./contract.ts` (`ListOffers`). */
export type ListOrders = ListOffers;

/**
 * Meldingen over ordrelisten når den er kuttet: «Viser 50 av 73. Bruk søket for å finne flere.»
 * Gir `null` når alle radene vises. Ren funksjon, slik at den kan testes uten nettleser.
 */
export function orderListSummary(shown: number, total: number): string | null {
  if (total <= shown) return null;
  return `Viser ${shown} av ${total}. Bruk søket for å finne flere.`;
}
