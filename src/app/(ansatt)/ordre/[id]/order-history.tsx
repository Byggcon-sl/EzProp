import type { listOrderHistory } from "@/core/orders";
import { Card } from "@/shared/ui/card";
import { BookingHistoryList } from "../../booking-history";

type OrderHistoryEntry = Awaited<ReturnType<typeof listOrderHistory>>[number];

/**
 * «Endringer» under ordren (T1): hvem som gjorde hva og når, nyeste først. For «Endret» står én
 * linje per felt med gammel og ny verdi. Vises bare per ordre; siden har allerede sjekket tilgangen
 * med `getOrder`, og kjernen sjekker den igjen i `listOrderHistory`. Listen er felles med
 * oppdraget (`BookingHistoryList`).
 */
export function OrderHistory({ entries }: { entries: readonly OrderHistoryEntry[] }) {
  return (
    <section aria-labelledby="order-history-heading" className="mt-8">
      <h2 id="order-history-heading" className="mb-3 text-lg font-medium text-slate-900">
        Endringer
      </h2>
      {entries.length === 0 ? (
        <p className="text-slate-600">Ingen endringer ennå.</p>
      ) : (
        <Card>
          <BookingHistoryList entries={entries} />
        </Card>
      )}
    </section>
  );
}
