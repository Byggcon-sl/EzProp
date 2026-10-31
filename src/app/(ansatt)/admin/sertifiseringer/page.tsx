import type { Metadata } from "next";
import { CERTIFICATION_EXPIRY_WARNING_DAYS, todayInOslo } from "@/core/access";
import { listExpiringCertifications } from "@/core/organization";
import { Badge } from "@/shared/ui/badge";
import { getAdminContext } from "../admin-context";
import { EmptyList, Row, RowList } from "../admin-list";
import {
  certificationAreaLabels,
  certificationStatus,
  certificationStatusLabels,
  formatIsoDate,
} from "../labels";
import { NoAccess } from "../no-access";

export const metadata: Metadata = { title: "Sertifiseringer" };

/**
 * Ansatte som har gått ut eller går ut innen 60 dager, tidligst først. Bare en liste; navnet
 * lenker til den ansatte, der fornyelsen legges inn. Bare admin.
 */
export default async function CertificationsPage() {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const rows = await listExpiringCertifications(context.actor, context.organizationId);
  const today = todayInOslo(new Date());

  return (
    <main className="max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">Sertifiseringer</h1>
      <p className="mt-2 text-slate-600">
        Har gått ut eller går ut de neste {CERTIFICATION_EXPIRY_WARNING_DAYS} dagene. Bare den som
        har gyldig sertifisering, kan publisere rapporter.
      </p>
      {rows.length === 0 ? (
        <EmptyList
          text={`Ingen sertifiseringer går ut de neste ${CERTIFICATION_EXPIRY_WARNING_DAYS} dagene.`}
        />
      ) : (
        <RowList>
          {rows.map((row) => {
            const status =
              certificationStatus(row.validTo, today, CERTIFICATION_EXPIRY_WARNING_DAYS) ??
              "expiring";
            return (
              <Row
                key={row.certificationId}
                href={`/admin/ansatte/${row.employeeId}`}
                title={row.employeeName}
              >
                <span className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span>{certificationAreaLabels[row.area]}</span>
                  <span>Gyldig til {formatIsoDate(row.validTo)}</span>
                  <Badge tone={status === "expired" ? "warning" : "brand"}>
                    {certificationStatusLabels[status]}
                  </Badge>
                </span>
              </Row>
            );
          })}
        </RowList>
      )}
    </main>
  );
}
