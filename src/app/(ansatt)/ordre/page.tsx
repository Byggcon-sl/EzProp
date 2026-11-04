import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { listOrders } from "@/core/orders";
import { getEmployeeContext } from "../employee-context";
import { NoAccess } from "../no-access";
import { OrderStatusBadge } from "./order-status-badge";
import { formatOsloDate } from "./received-at";

export const metadata: Metadata = { title: "Ordre" };

/**
 * Ordrene i organisasjonen, nyeste først. Alle ansatte ser listen; «Ny ordre» vises bare for dem
 * som kan legge inn (sjekken skjer i kjernen). Ingen faner, filtre eller søk ennå.
 */
export default async function OrdersPage() {
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  const orders = await listOrders(context.actor, context.organizationId);

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
      {orders.length === 0 ? (
        <Card className="mt-6">
          <p className="text-slate-600">Ingen ordre er lagt inn ennå.</p>
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
