import {
  bookingFieldLabel,
  bookingHistoryActionLabel,
  type BookingHistoryEntry,
} from "@/core/assignments";
import { formatOsloDateTime } from "./ordre/received-at";

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
 * Listen i «Endringer», felles for ordren og oppdraget: tid, hvem og handling, og for «Endret» én
 * linje per felt med gammel og ny verdi. Bare visning; kjernen har sjekket tilgangen og gir
 * bare kjente feltkoder.
 */
export function BookingHistoryList({ entries }: { entries: readonly BookingHistoryEntry[] }) {
  return (
    <ol>
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0 last:pb-0"
        >
          <p className="break-words text-slate-900">
            <time dateTime={new Date(entry.occurredAt).toISOString()} className="tabular-nums">
              {formatOsloDateTime(entry.occurredAt)}
            </time>
            {" · "}
            {entry.actorName ?? "(ukjent)"}
            {" · "}
            <span className="font-medium">{bookingHistoryActionLabel(entry.action)}</span>
          </p>
          {entry.values.length > 0 && (
            <ul className="mt-1 space-y-1 text-sm text-slate-700">
              {entry.values.map((value) => (
                <li key={value.field} className="[overflow-wrap:anywhere]">
                  {bookingFieldLabel(value.field)}: {valueText(value.field, value.from)} →{" "}
                  {valueText(value.field, value.to)}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
