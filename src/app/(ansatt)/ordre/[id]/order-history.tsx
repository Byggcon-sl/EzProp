import { orderFieldLabel, orderHistoryActionLabel, type listOrderHistory } from "@/core/orders";
import { Card } from "@/shared/ui/card";
import { formatOsloDateTime } from "../received-at";

type OrderHistoryEntry = Awaited<ReturnType<typeof listOrderHistory>>[number];

/**
 * Én verdi i «Endringer» som tekst: tom blir «(tom)», ja/nei «Ja»/«Nei», mottatt som norsk dato og
 * klokkeslett. Bestilleren kommer som navn (eller «(fjernet kontakt)») fra kjernen.
 */
function valueText(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "(tom)";
  if (typeof value === "boolean") return value ? "Ja" : "Nei";
  if (value instanceof Date) return formatOsloDateTime(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (field === "receivedAt" && !Number.isNaN(new Date(value).getTime())) {
      return formatOsloDateTime(value);
    }
    return value;
  }
  return "(tom)";
}

/**
 * «Endringer» under ordren (T1): hvem som gjorde hva og når, nyeste først. For «Endret» står én
 * linje per felt med gammel og ny verdi. Vises bare per ordre; siden har allerede sjekket tilgangen
 * med `getOrder`, og kjernen sjekker den igjen i `listOrderHistory`.
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
          <ol>
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0 last:pb-0"
              >
                <p className="break-words text-slate-900">
                  <time
                    dateTime={new Date(entry.occurredAt).toISOString()}
                    className="tabular-nums"
                  >
                    {formatOsloDateTime(entry.occurredAt)}
                  </time>
                  {" · "}
                  {entry.actorName ?? "(ukjent)"}
                  {" · "}
                  <span className="font-medium">{orderHistoryActionLabel(entry.action)}</span>
                </p>
                {entry.values.length > 0 && (
                  <ul className="mt-1 space-y-1 text-sm text-slate-700">
                    {entry.values.map((value) => (
                      <li key={value.field} className="[overflow-wrap:anywhere]">
                        {orderFieldLabel(value.field)}: {valueText(value.field, value.from)} →{" "}
                        {valueText(value.field, value.to)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </section>
  );
}
