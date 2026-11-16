import { and, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { orders } from "@/db/schema";
import {
  DEFAULT_OFFER_LIST_FILTER,
  isOfferListFilter,
  type OfferDisplayStatus,
  type OfferListFilter,
  type OrderStatus,
} from "./codes";
import {
  OFFER_EXPIRING_SOON_DAYS,
  type IsOfferExpired,
  type OfferDaysLeft,
  type OfferDisplayStatusOf,
  type OfferExpiredSql,
  type OfferListFilterSql,
} from "./contract";

/*
 * Utløpsregelen for tilbud (ADR 0012 punkt 4 og 5, A320). Står bare her: som ren funksjon og som
 * SQL-uttrykk med samme regel (paritetstest i `offer-status-parity.test.ts`). «Utløpt» lagres
 * aldri; det regnes ut fra `valid_until` og dagens dato. Dagens dato kommer alltid som parameter
 * (`todayInOslo(now)`), aldri fra klokka i databasen.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Dagnummer (dager siden 1970-01-01) for en ren dato. Regnes i UTC, så sommertid spiller ingen rolle. */
function dayNumber(isoDate: string): number {
  const match = ISO_DATE.exec(isoDate);
  if (!match) throw new Error("Ugyldig dato.");
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

/**
 * Sant når tilbudet er åpent (`received`) og «Gyldig til» er før i dag. Samme dag er ikke utløpt.
 * Gjort om og avslått er aldri utløpt. Datoene er «ÅÅÅÅ-MM-DD» og sammenlignes som tekst.
 */
export const isOfferExpired: IsOfferExpired = (status, validUntil, today) =>
  status === "received" && validUntil < today;

/** Visningsstatusen: `expired` når tilbudet er utløpt, ellers `open`, `converted` eller `rejected`. */
export const offerDisplayStatus: OfferDisplayStatusOf = (status, validUntil, today) => {
  if (status === "received") return isOfferExpired(status, validUntil, today) ? "expired" : "open";
  return status;
};

/** Dager igjen: `validUntil − today` i hele kalenderdager (0 = i dag, negativt = utløpt). */
export const offerDaysLeft: OfferDaysLeft = (validUntil, today) =>
  Math.round(dayNumber(validUntil) - dayNumber(today));

/**
 * Går tilbudet ut snart? Sant for åpne tilbud med 0–`OFFER_EXPIRING_SOON_DAYS` dager igjen
 * (merket «Går ut …», F3).
 */
export function isOfferExpiringSoon(status: OrderStatus, validUntil: string, today: string) {
  if (offerDisplayStatus(status, validUntil, today) !== "open") return false;
  return offerDaysLeft(validUntil, today) <= OFFER_EXPIRING_SOON_DAYS;
}

/**
 * Kan «Gyldig til» forlenges (F1, «Forleng 30 dager»)? Sant for utløpte tilbud og for åpne som
 * går ut snart. Aldri for gjort om og avslått.
 */
export function canExtendOffer(status: OrderStatus, validUntil: string, today: string) {
  const display = offerDisplayStatus(status, validUntil, today);
  return display === "expired" || isOfferExpiringSoon(status, validUntil, today);
}

/**
 * Teksten på merket «Går ut …» (F3), eller `null` når merket ikke skal vises (ikke åpent, eller
 * mer enn `OFFER_EXPIRING_SOON_DAYS` dager igjen).
 */
export function offerExpiresLabel(
  status: OrderStatus,
  validUntil: string,
  today: string,
): string | null {
  if (!isOfferExpiringSoon(status, validUntil, today)) return null;
  const days = offerDaysLeft(validUntil, today);
  if (days === 0) return "Går ut i dag";
  if (days === 1) return "Går ut i morgen";
  return `Går ut om ${days} dager`;
}

/**
 * Filteret fra adressen (`?status=`). Utelatt, tom eller ukjent verdi gir standarden `open`,
 * aldri en feil.
 */
export function parseOfferListFilter(value: unknown): OfferListFilter {
  return isOfferListFilter(value) ? value : DEFAULT_OFFER_LIST_FILTER;
}

/** SQL med samme regel som `isOfferExpired`: `status = 'received' and valid_until < $today`. */
export const offerExpiredSql: OfferExpiredSql = (today) =>
  and(eq(orders.status, "received"), lt(orders.validUntil, today)) as SQL;

/** SQL for åpent og ikke utløpt: `status = 'received' and valid_until >= $today`. */
function offerOpenSql(today: string): SQL {
  return and(eq(orders.status, "received"), gte(orders.validUntil, today)) as SQL;
}

/**
 * WHERE-vilkåret for et filter i tilbudslisten. Brukes både av listen og av tellingen per filter
 * (`count(*) filter (where …)`), så tallene alltid stemmer med listen. `all` gir `undefined`.
 */
export const offerListFilterSql: OfferListFilterSql = (filter, today) => {
  switch (filter) {
    case "open":
      return offerOpenSql(today);
    case "expired":
      return offerExpiredSql(today);
    case "converted":
      return eq(orders.status, "converted");
    case "rejected":
      return eq(orders.status, "rejected");
    case "all":
      return undefined;
  }
};

/** `count(*) filter (where …)` for ett filter, med samme uttrykk som listen. */
export function offerCountSql(filter: OfferListFilter, today: string): SQL<number> {
  const where = offerListFilterSql(filter, today);
  return where === undefined
    ? sql<number>`count(*)::int`
    : sql<number>`(count(*) filter (where ${where}))::int`;
}

export type { OfferDisplayStatus };
