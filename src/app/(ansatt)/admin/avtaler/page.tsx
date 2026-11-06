import type { Metadata } from "next";
import { Badge } from "@/shared/ui/badge";
import { getAdminContext } from "../admin-context";
import { EmptyList, ListHeader, Row, RowList } from "../admin-list";
import { formatIsoDate, noticeText } from "../labels";
import { NoAccess } from "../../no-access";
import { listAgreements } from "@/core/agreements";
import { todayInOslo } from "@/shared/lib/dates";

export const metadata: Metadata = { title: "Avtaler" };

/** Avtalene med oppdragsgivere. Bare admin. Utløpte avtaler vises med merket «Utløpt». */
export default async function AgreementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const agreements = await listAgreements(context.actor, context.organizationId);
  const notice = noticeText((await searchParams).lagret);
  const today = todayInOslo();

  return (
    <main className="max-w-4xl">
      <ListHeader
        title="Avtaler"
        actionLabel="Ny avtale"
        actionHref="/admin/avtaler/ny"
        notice={notice}
      />
      {agreements.length === 0 ? (
        <EmptyList text="Ingen avtaler ennå." />
      ) : (
        <RowList>
          {agreements.map((agreement) => {
            const expired = agreement.validTo !== null && agreement.validTo < today;
            const period = agreement.validTo
              ? `${formatIsoDate(agreement.validFrom)}–${formatIsoDate(agreement.validTo)}`
              : `Fra ${formatIsoDate(agreement.validFrom)}`;
            return (
              <Row
                key={agreement.id}
                href={`/admin/avtaler/${agreement.id}`}
                title={agreement.name}
              >
                <span className="block text-sm text-slate-600">
                  {[agreement.firmName ?? "Ukjent firma", period].join(" · ")}
                </span>
                {expired && (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone="warning">Utløpt</Badge>
                  </span>
                )}
              </Row>
            );
          })}
        </RowList>
      )}
    </main>
  );
}
