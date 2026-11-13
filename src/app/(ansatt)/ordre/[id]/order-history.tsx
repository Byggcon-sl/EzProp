import { Card } from "@/shared/ui/card";
import { formatOsloDateTime } from "../received-at";
import { formatHistoryValue } from "./history-format";

export type OrderHistoryEntry = {
  id: string;
  occurredAt: Date | string;
  actorName: string | null;
  actionLabel: string;
  changes: ReadonlyArray<{ field: string; label: string; from: unknown; to: unknown }>;
};

/**
 * «Endringer» under ordren: én linje per hendelse, nyeste først (rekkefølgen fra kjernen), med
 * tidspunkt, navn og handling. For en endring står én underlinje per felt, «Adresse: gammel → ny».
 * Lange verdier bryter, så det blir ingen vannrett rulling på iPad.
 */
export function OrderHistory({ entries }: { entries: readonly OrderHistoryEntry[] }) {
  return (
    <section aria-labelledby="order-history-heading" className="mt-6">
      <Card>
        <h2 id="order-history-heading" className="mb-3 text-lg font-medium text-slate-900">
          Endringer
        </h2>
        {entries.length === 0 ? (
          <p className="text-slate-600">Ingen endringer er registrert.</p>
        ) : (
          <ol>
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="border-t border-slate-200 py-3 first:border-t-0 first:pt-0 last:pb-0"
              >
                <p className="min-w-0 break-words text-slate-900">
                  <span className="font-medium">{entry.actionLabel}</span>
                  <span className="text-slate-600">
                    {" "}
                    · {formatOsloDateTime(entry.occurredAt)} · {entry.actorName ?? "Ukjent"}
                  </span>
                </p>
                {entry.changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-sm text-slate-700">
                    {entry.changes.map((change) => (
                      <li key={change.field} className="min-w-0 [overflow-wrap:anywhere]">
                        {change.label}: {formatHistoryValue(change.from)} →{" "}
                        {formatHistoryValue(change.to)}
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
