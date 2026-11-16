import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { FormMessage } from "@/shared/ui/form";
import { listOrders, orderListSummary } from "@/core/orders";
import { getEmployeeContext } from "../employee-context";
import { loadListOrError } from "../list-error";
import { NoAccess } from "../no-access";
import { SearchBox, searchQuery } from "../search-box";
import { OrderStatusBadge } from "./order-status-badge";
import { formatOsloDate } from "./received-at";

export const metadata: Metadata = { title: "Ordre" };

/**
 * Ordrene i organisasjonen, nyeste først, høyst 50 (ADR 0010). Alle ansatte ser listen og kan
 * søke (`?q=`) på adresse, oppdragsnummer, ordrenummer, megler, parter og gnr/bnr; søket skjer
 * i kjernen. «Ny ordre» vises bare for dem som kan legge inn. Ingen autofokus i søkefeltet, så
 * tastaturet ikke spretter opp på iPaden.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  const query = searchQuery((await searchParams).q);
  const result = await loadListOrError("/ordre", context.actor.id, () =>
    listOrders(context.actor, context.organizationId, { query: query || undefined }),
  );
  const { items: orders, total } = result.ok ? result.value : { items: [], total: 0 };
  const summary = result.ok ? orderListSummary(orders.length, total) : null;

  return (
    <main className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Ordre</h1>
        {context.canEditOrders && (
          <Link href="/ordre/ny" className={buttonVariants({ variant: "primary", size: "md" })}>
            Ny ordre
          </Link>
        )}
      </div>
      <SearchBox label="Søk på adresse, nummer, megler eller gnr/bnr" query={query} />
      {query && (
        <p className="mt-2">
          <Link
            href="/ordre"
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
      ) : orders.length === 0 ? (
        <Card className="mt-6">
          <p className="text-slate-600">
            {query ? "Ingen ordre passer søket." : "Ingen ordre er lagt inn ennå."}
          </p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden p-0">
          <ul>
            {orders.map((order) => (
              <li key={order.id} className="border-t border-slate-200 first:border-t-0">
                <Link
                  href={`/ordre/${order.id}`}
                  className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-brand-50 focus-visible:-outline-offset-2"
                >
                  <span className="min-w-0 flex-1 basis-48 break-words">
                    <span className="block font-medium text-slate-900">{order.addressText}</span>
                    <span className="block text-sm text-slate-600">
                      Mottatt {formatOsloDate(order.receivedAt)}
                      {order.orderedByText && <> · {order.orderedByText}</>}
                      {order.externalRef && <> · Ordrenr. {order.externalRef}</>}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-2">
                    {order.assignmentNumber && (
                      <span className="text-sm font-medium text-slate-900 tabular-nums">
                        {order.assignmentNumber}
                      </span>
                    )}
                    <OrderStatusBadge status={order.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
