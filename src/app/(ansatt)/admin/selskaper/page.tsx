import type { Metadata } from "next";
import { Badge } from "@/shared/ui/badge";
import { getAdminContext } from "../admin-context";
import { EmptyList, ListHeader, Row, RowList } from "../admin-list";
import { formatIsoDate, formatOrgNumber, noticeText, todayInNorway } from "../labels";
import { NoAccess } from "../no-access";
import { listCompanies } from "@/core/organization";

export const metadata: Metadata = { title: "Selskaper" };

/** Selskapene i organisasjonen. Bare admin. Mangler og utløpt forsikring vises med tekst. */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const companies = await listCompanies(context.actor, context.organizationId);
  const notice = noticeText((await searchParams).lagret);
  const today = todayInNorway();

  return (
    <main className="max-w-4xl">
      <ListHeader
        title="Selskaper"
        actionLabel="Nytt selskap"
        actionHref="/admin/selskaper/ny"
        notice={notice}
      />
      {companies.length === 0 ? (
        <EmptyList text="Ingen selskaper ennå." />
      ) : (
        <RowList>
          {companies.map((company) => {
            const insuranceMissing = !company.liabilityInsurer || !company.liabilityValidTo;
            const missingInfo = !company.orgNumber || insuranceMissing;
            const expired = company.liabilityValidTo !== null && company.liabilityValidTo < today;
            const details = [
              company.orgNumber
                ? `Org.nr. ${formatOrgNumber(company.orgNumber)}`
                : "Org.nr. mangler",
              company.liabilityValidTo
                ? `Forsikring gyldig til ${formatIsoDate(company.liabilityValidTo)}`
                : "Forsikring mangler",
            ];
            return (
              <Row
                key={company.id}
                href={`/admin/selskaper/${company.id}`}
                title={company.legalName}
              >
                <span className="block text-sm text-slate-600">{details.join(" · ")}</span>
                {(missingInfo || expired) && (
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {missingInfo && <Badge tone="warning">Mangler opplysninger</Badge>}
                    {expired && <Badge tone="warning">Forsikring utløpt</Badge>}
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
