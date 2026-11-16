import type { listOrderHistory } from "@/core/orders";
import { Card } from "@/shared/ui/card";
import { BookingHistoryList } from "../../booking-history";

type OfferHistoryEntry = Awaited<ReturnType<typeof listOrderHistory>>[number];

/**
 * «Endringer» under tilbudet (T1): hvem som gjorde hva og når, nyeste først. For «Endret» står én
 * linje per felt med gammel og ny verdi, også «Gyldig til» (`validUntil`). Vises bare per tilbud;
 * siden har allerede sjekket tilgangen med `getOrder`, og kjernen sjekker den igjen i
 * `listOrderHistory`. Listen er felles med oppdraget (`BookingHistoryList`).
 */
export function OfferHistory({ entries }: { entries: readonly OfferHistoryEntry[] }) {
  return (
    <section aria-labelledby="offer-history-heading" className="mt-8">
      <h2 id="offer-history-heading" className="mb-3 text-lg font-medium text-slate-900">
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
