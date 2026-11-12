import { orderFieldLabel, orderHistoryActionLabel } from "@/core/orders";
import { Card } from "@/shared/ui/card";
import { formatOsloDateTime } from "../received-at";

export type OrderHistoryEntry = {
  id: string;
  action: string;
  changedFields: string[] | null;
  actorName: string | null;
  createdAt: Date;
};

/** «Rettet: adresse, gårdsnummer» ved retting, ellers etiketten for handlingen. */
function describe(entry: OrderHistoryEntry): string {
  if (entry.action === "update") {
    return `Rettet: ${(entry.changedFields ?? []).map(orderFieldLabel).join(", ")}`;
  }
  return orderHistoryActionLabel(entry.action);
}

/**
 * «Endringer» under ordren: når, hvem og hva, nyeste først (rekkefølgen fra kjernen). Loggen har
 * bare feltkoder, aldri verdiene (A252).
 */
export function OrderHistory({ entries }: { entries: readonly OrderHistoryEntry[] }) {
  return (
    <section aria-labelledby="order-history-heading" className="mt-6">
      <h2 id="order-history-heading" className="mb-3 text-lg font-medium text-slate-900">
        Endringer
      </h2>
      <Card>
        {entries.length === 0 ? (
          <p className="text-slate-600">Ingen endringer.</p>
        ) : (
          <ol>
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0 last:pb-0"
              >
                <p className="text-sm break-words text-slate-600">
                  <time dateTime={entry.createdAt.toISOString()} className="tabular-nums">
                    {formatOsloDateTime(entry.createdAt)}
                  </time>
                  {" · "}
                  {entry.actorName ?? "Ukjent"}
                </p>
                <p className="mt-0.5 break-words text-slate-900">{describe(entry)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}
