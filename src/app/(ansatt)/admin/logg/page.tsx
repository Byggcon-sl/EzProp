import type { Metadata } from "next";
import { getAdminContext } from "../admin-context";
import { EmptyList, RowList } from "../admin-list";
import { auditActionLabel, auditEntityLabel, formatAuditChanges, formatDate } from "../labels";
import { NoAccess } from "../no-access";
import { listAuditEvents } from "@/core/audit";

export const metadata: Metadata = { title: "Logg" };

const columns = "lg:grid lg:grid-cols-[8rem_12rem_14rem_minmax(0,1fr)] lg:gap-4";

/**
 * Revisjonsloggen: de siste 50 endringene i organisasjonen, nyeste først (oppgavekortet, Omfang 4,
 * A34). Bare admin. Ingen knapper og ingen filter; søkeparametre brukes ikke. Organisasjonen kommer
 * fra `getAdminContext`, tilgangssjekken skjer i `src/core`.
 */
export default async function AuditLogPage() {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const rows = await listAuditEvents(context.actor, context.organizationId);

  return (
    <main className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Logg</h1>
      <p className="mt-1 text-slate-600">De siste 50 endringene, nyeste først.</p>
      {rows.length === 0 ? (
        <EmptyList text="Ingen endringer ennå." />
      ) : (
        <RowList>
          <li
            aria-hidden="true"
            className={`hidden px-5 py-3 text-sm font-medium text-slate-600 ${columns}`}
          >
            <span>Tidspunkt</span>
            <span>Hvem</span>
            <span>Hva</span>
            <span>Endringer</span>
          </li>
          {rows.map((row) => {
            const lines = formatAuditChanges(row.changes);
            return (
              <li
                key={row.id}
                className={`min-h-14 border-t border-slate-200 px-5 py-3 break-words first:border-t-0 ${columns}`}
              >
                <span className="block text-sm text-slate-600">
                  <span className="sr-only">Tidspunkt: </span>
                  {formatDate(row.occurredAt)}
                </span>
                <span className="block font-medium text-slate-900">
                  <span className="sr-only">Hvem: </span>
                  {row.actorName ?? "Ukjent"}
                </span>
                <span className="block text-slate-900">
                  <span className="sr-only">Hva: </span>
                  {auditEntityLabel(row.entityType)} – {auditActionLabel(row.action)}
                </span>
                <span className="block min-w-0 text-sm text-slate-600">
                  {lines.map((line, index) => (
                    <span key={index} className="block">
                      {line}
                    </span>
                  ))}
                </span>
              </li>
            );
          })}
        </RowList>
      )}
    </main>
  );
}
