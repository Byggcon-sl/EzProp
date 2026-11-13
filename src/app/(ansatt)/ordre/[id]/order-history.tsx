import type { OrderHistoryEntry } from "@/core/orders";
import { Card } from "@/shared/ui/card";
import { formatOsloDateTime } from "../received-at";
import { formatHistoryChange } from "./history-format";

/**
 * Delen «Endringer» under ordren: én linje per hendelse, nyeste først (rekkefølgen kommer fra
 * kjernen), med dato og klokkeslett, navnet og handlingen. Ved endring står én underlinje per
 * felt med gammel og ny verdi. Teksten bryter, så lange adresser aldri gir vannrett rulling.
 */
export function OrderHistory({ entries }: { entries: readonly OrderHistoryEntry[] }) {
  return (
    <section aria-labelledby="order-history-heading" className="mt-8">
      <h2 id="order-history-heading" className="mb-3 text-lg font-medium text-slate-900">
        Endringer
      </h2>
      <Card>
        {entries.length === 0 ? (
          <p className="text-slate-600">Ingen endringer er registrert.</p>
        ) : (
          <ol className="divide-y divide-slate-200">
            {entries.map((entry) => (
              <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                <p className="break-words text-slate-900">
                  <span className="font-medium">{entry.actionLabel}</span>
                  {" · "}
                  <time
                    dateTime={new Date(entry.occurredAt).toISOString()}
                    className="tabular-nums"
                  >
                    {formatOsloDateTime(entry.occurredAt)}
                  </time>
                  {" · "}
                  {entry.actorName ?? "Ukjent ansatt"}
                </p>
                {entry.changes.length > 0 && (
                  <ul className="mt-1 space-y-1 text-sm text-slate-700">
                    {entry.changes.map((change) => (
                      <li key={change.field} className="break-words">
                        {formatHistoryChange(change)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}
