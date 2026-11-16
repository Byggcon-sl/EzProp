import type { BookingHistoryEntry } from "@/core/assignments";
import { Card } from "@/shared/ui/card";
import { BookingHistoryList } from "../../booking-history";

/**
 * «Endringer» under kortet «Bestilling» (docs/funksjoner/fase2a-nytt-oppdrag-design.md 6.3):
 * sammenfoldet, fordi oppdragssiden er lang. Viser hvem, når og feltkodene som ble endret, nyeste
 * først. Bare per oppdrag; kjernen har sjekket tilgangen i `listAssignmentBookingHistory`.
 */
export function AssignmentBookingHistory({ entries }: { entries: readonly BookingHistoryEntry[] }) {
  return (
    <details className="group -mt-5 mb-8">
      <summary className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-lg font-medium text-brand-700">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        Endringer ({entries.length})
      </summary>
      <div className="mt-2">
        {entries.length === 0 ? (
          <p className="text-slate-600">Ingen endringer ennå.</p>
        ) : (
          <Card>
            <BookingHistoryList entries={entries} />
          </Card>
        )}
      </div>
    </details>
  );
}
