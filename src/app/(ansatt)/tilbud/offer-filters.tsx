import Link from "next/link";
import {
  DEFAULT_OFFER_LIST_FILTER,
  OFFER_LIST_FILTERS,
  type OfferListFilter,
} from "@/core/orders/codes";
import { cn } from "@/shared/lib/cn";
import { segmentClass, segmentCount, segmentCountCurrent, segmentList } from "../segments";

/*
 * Filterknappene i tilbudslisten (docs/funksjoner/fase2a-tilbud-design.md avsnitt 3.2): lenker i
 * `<nav aria-label="Status">` med samme utseende som fanene i arbeidskøen, minst 44 px høye.
 * Valgt filter står i adressen (`?status=`), så «Tilbake» virker. «Åpne» er standard og skrives
 * ikke i adressen, slik at menylenken og «Åpne» er samme side.
 */

export const OFFER_LIST_PATH = "/tilbud";

/** Rekkefølgen og etikettene på knappene. */
export const OFFER_FILTER_OPTIONS: readonly { filter: OfferListFilter; label: string }[] = [
  { filter: "open", label: "Åpne" },
  { filter: "expired", label: "Utløpt" },
  { filter: "rejected", label: "Avslått" },
  { filter: "converted", label: "Gjort om til oppdrag" },
  { filter: "all", label: "Alle" },
];

/** Filteret fra adressen. Utelatt eller ukjent verdi gir «Åpne» (kjernen gjør det samme). */
export function offerFilterFromParam(value: string | string[] | undefined): OfferListFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return (OFFER_LIST_FILTERS as readonly string[]).includes(first ?? "")
    ? (first as OfferListFilter)
    : DEFAULT_OFFER_LIST_FILTER;
}

/** Teksten i en tom liste per filter, uten søk. Med søk: «Ingen tilbud passer søket.» */
const EMPTY_TEXTS: Record<OfferListFilter, string> = {
  open: "Ingen åpne tilbud.",
  expired: "Ingen utløpte tilbud.",
  rejected: "Ingen avslåtte tilbud.",
  converted: "Ingen tilbud er gjort om til oppdrag.",
  all: "Ingen tilbud er lagt inn ennå.",
};

export function emptyOfferListText(filter: OfferListFilter, query: string): string {
  return query ? "Ingen tilbud passer søket." : EMPTY_TEXTS[filter];
}

/** Parametrene i adressen for filteret og søket. «Åpne» og tomt søk skrives ikke. */
export function offerListParams(filter: OfferListFilter, query: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (filter !== "open") params.status = filter;
  if (query) params.q = query;
  return params;
}

/** Adressen til listen med filteret og søket. */
export function offerListHref(filter: OfferListFilter, query: string): string {
  const search = new URLSearchParams(offerListParams(filter, query)).toString();
  return search ? `${OFFER_LIST_PATH}?${search}` : OFFER_LIST_PATH;
}

/**
 * Knappene med antall. Uten `counts` (listen kunne ikke hentes) vises de uten tall, så ingen ser
 * «0» som ikke stemmer. Skjermleseren leser «Åpne, 3 tilbud».
 */
export function OfferFilterNav({
  current,
  query,
  counts,
}: {
  current: OfferListFilter;
  query: string;
  counts?: Readonly<Record<OfferListFilter, number>>;
}) {
  return (
    <nav aria-label="Status" className="mt-6">
      <ul className={segmentList}>
        {OFFER_FILTER_OPTIONS.map(({ filter, label }) => {
          const selected = filter === current;
          return (
            <li key={filter}>
              <Link
                href={offerListHref(filter, query)}
                aria-current={selected ? "page" : undefined}
                className={segmentClass(selected)}
              >
                {label}
                {counts && (
                  <>
                    <span className="sr-only">,</span>{" "}
                    <span
                      data-testid={`offer-count-${filter}`}
                      className={cn(segmentCount, selected && segmentCountCurrent)}
                    >
                      {counts[filter]}
                    </span>
                    <span className="sr-only"> tilbud</span>
                  </>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
