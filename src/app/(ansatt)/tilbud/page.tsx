import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormMessage } from "@/shared/ui/form";
import { todayInOslo } from "@/shared/lib/dates";
import {
  canExtendOffer,
  listOrders,
  offerExpiresLabel,
  orderListSummary,
  parseOfferListFilter,
} from "@/core/orders";
import { getEmployeeContext } from "../employee-context";
import { loadListOrError } from "../list-error";
import { NoAccess } from "../no-access";
import { SearchBox, searchQuery } from "../search-box";
import { extendOfferAction } from "./actions";
import {
  OFFER_LIST_PATH,
  OfferFilterNav,
  emptyOfferListText,
  offerListHref,
  offerListParams,
} from "./offer-filters";
import { OfferList, type OfferRow } from "./offer-list";
import { formatIsoDate, formatOsloDate } from "./received-at";

export const metadata: Metadata = { title: "Tilbud" };

/**
 * Tilbudene i organisasjonen (mulige jobber som ikke er oppdrag ennå), høyst 50 (ADR 0010, 0012).
 * Filter (`?status=`) og søk (`?q=`) står i adressen og skjer i kjernen; tallene på knappene
 * kommer fra samme spørring (F3). «Åpne» er sortert etter «Gyldig til». «Nytt tilbud» er en
 * sekundærknapp (A371) og vises bare for dem som kan legge inn. Ingen autofokus i søkefeltet.
 */
export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[] }>;
}) {
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  const params = await searchParams;
  const query = searchQuery(params.q);
  const requested = parseOfferListFilter(
    Array.isArray(params.status) ? params.status[0] : params.status,
  );
  const now = new Date();
  const today = todayInOslo(now);
  const result = await loadListOrError(OFFER_LIST_PATH, context.actor.id, () =>
    listOrders(context.actor, context.organizationId, {
      query: query || undefined,
      status: requested,
      now,
    }),
  );
  const filter = result.ok ? result.value.status : requested;
  const items = result.ok ? result.value.items : [];
  const summary = result.ok ? orderListSummary(items.length, result.value.total) : null;

  const rows: OfferRow[] = items.map((item) => {
    const showValidUntil = item.displayStatus === "open" || item.displayStatus === "expired";
    return {
      id: item.id,
      addressText: item.addressText,
      receivedText: formatOsloDate(item.receivedAt),
      orderedByText: item.orderedByText,
      externalRef: item.externalRef,
      displayStatus: item.displayStatus,
      validUntil: item.validUntil,
      validUntilText: showValidUntil ? `Gyldig til ${formatIsoDate(item.validUntil)}` : null,
      expiryText: offerExpiresLabel(item.status, item.validUntil, today),
      assignmentNumber: item.assignmentNumber,
      assignmentCancelled: item.assignmentCancelled,
      canExtend: context.canEditOrders && canExtendOffer(item.status, item.validUntil, today),
    };
  });

  return (
    <main className="max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Tilbud</h1>
          <p className="mt-1 text-sm text-slate-600">Mulige jobber som ikke er oppdrag ennå.</p>
        </div>
        {context.canEditOrders && (
          <Link href="/tilbud/ny" className={buttonVariants({ variant: "secondary", size: "md" })}>
            Nytt tilbud
          </Link>
        )}
      </div>
      <OfferFilterNav
        current={filter}
        query={query}
        counts={result.ok ? result.value.counts : undefined}
      />
      <SearchBox
        label="Søk på adresse, nummer, megler eller gnr/bnr"
        query={query}
        hidden={offerListParams(filter, "")}
      />
      {query && (
        <p className="mt-2">
          <Link
            href={offerListHref(filter, "")}
            className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-2"
          >
            Tøm søk
          </Link>
        </p>
      )}
      {summary && <p className="mt-4 text-sm text-slate-700">{summary}</p>}
      {!result.ok ? (
        <div className="mt-6">
          <FormMessage message={result.message} />
        </div>
      ) : rows.length === 0 ? (
        <Card className="mt-6">
          <p className="text-slate-600">{emptyOfferListText(filter, query)}</p>
        </Card>
      ) : (
        <OfferList rows={rows} extendAction={extendOfferAction} />
      )}
    </main>
  );
}
