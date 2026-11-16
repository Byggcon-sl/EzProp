import { bookingFieldLabel, bookingHistoryActionLabel } from "@/core/assignments";
import { formatIsoDate, formatOsloDateTime } from "./tilbud/received-at";

/**
 * Én rad i «Endringer», felles for tilbudet og oppdraget. Feltkoden er tekst, fordi tilbudet har
 * én kode mer enn oppdraget («Gyldig til», `validUntil`, ADR 0012).
 */
export type HistoryListEntry = {
  id: string;
  action: string;
  actorName: string | null;
  occurredAt: Date;
  values: readonly { field: string; from: unknown; to: unknown }[];
};

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
    // «Gyldig til» er en ren dato («2026-12-03» → «03.12.2026»).
    if (field === "validUntil") return formatIsoDate(value);
    return value;
  }
  return "(tom)";
}

/**
 * Listen i «Endringer», felles for tilbudet og oppdraget: tid, hvem og handling, og for «Endret» én
 * linje per felt med gammel og ny verdi. Bare visning; kjernen har sjekket tilgangen og gir
 * bare kjente feltkoder. Tilbudet sender sine egne etiketter (`orderFieldLabel` og
 * `orderHistoryActionLabel` fra kjernen), så «Gyldig til» og «Avslått» står riktig.
 */
export function BookingHistoryList({
  entries,
  fieldLabel = bookingFieldLabel,
  actionLabel = bookingHistoryActionLabel,
}: {
  entries: readonly HistoryListEntry[];
  fieldLabel?: (field: string) => string;
  actionLabel?: (action: string) => string;
}) {
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
            <span className="font-medium">{actionLabel(entry.action)}</span>
          </p>
          {entry.values.length > 0 && (
            <ul className="mt-1 space-y-1 text-sm text-slate-700">
              {entry.values.map((value) => (
                <li key={value.field} className="[overflow-wrap:anywhere]">
                  {fieldLabel(value.field)}: {valueText(value.field, value.from)} →{" "}
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
