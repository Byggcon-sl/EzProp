import type { Metadata } from "next";
import Link from "next/link";
import { getAdminContext } from "../admin-context";
import { EmptyList, RowList } from "../admin-list";
import { CertificationStatusBadge } from "../ansatte/[id]/certification-section";
import { formatIsoDate } from "../labels";
import { NoAccess } from "../no-access";
import { CERTIFICATION_AREAS, listExpiringCertifications } from "@/core/organization";

export const metadata: Metadata = { title: "Sertifiseringer" };

function areaLabel(key: string): string {
  return CERTIFICATION_AREAS.find((area) => area.key === key)?.label ?? key;
}

/**
 * Aktive ansatte der den nyeste sertifiseringen per område har gått ut eller går ut de neste 60
 * dagene, tidligst først (oppgavekortet, Omfang 7). Bare admin. Ingen handlinger her: navnet
 * lenker til den ansatte, der fornyelsen legges inn.
 */
export default async function CertificationsPage() {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const rows = await listExpiringCertifications(context.actor, context.organizationId);

  return (
    <main className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Sertifiseringer</h1>
      <p className="mt-1 text-slate-600">
        De som har gått ut, eller går ut de neste 60 dagene. Fornyelse legges inn på den ansatte.
      </p>
      {rows.length === 0 ? (
        <EmptyList text="Ingen sertifiseringer går ut de neste 60 dagene." />
      ) : (
        <RowList>
          {rows.map((row) => (
            <li key={row.certificationId} className="border-t border-slate-200 first:border-t-0">
              <Link
                href={`/admin/ansatte/${row.employeeId}`}
                className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-brand-50 focus-visible:-outline-offset-2"
              >
                <span className="min-w-0 flex-1 break-words">
                  <span className="block font-medium text-slate-900">{row.employeeName}</span>
                  <span className="block text-sm text-slate-600">
                    {areaLabel(row.area)} · gyldig til {formatIsoDate(row.validTo)}
                  </span>
                </span>
                <CertificationStatusBadge status={row.status} />
                <span aria-hidden="true" className="text-sm font-medium text-brand-700">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </RowList>
      )}
    </main>
  );
}
