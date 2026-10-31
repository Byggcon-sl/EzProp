import type { Metadata } from "next";
import { isUuid } from "@/shared/lib/uuid";
import { getAdminContext } from "../../admin-context";
import { FormHeader } from "../../admin-list";
import { NoAccess } from "../../no-access";
import { listCompanies } from "@/core/organization";
import { saveCompanyAction } from "../actions";
import { CompanyForm } from "../company-form";

export const metadata: Metadata = { title: "Endre selskap" };

/** Ugyldig, ukjent og fremmed id gir samme svar som manglende tilgang. */
export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getAdminContext();
  if (!context || !isUuid(id)) return <NoAccess />;
  const companies = await listCompanies(context.actor, context.organizationId);
  const company = companies.find((row) => row.id === id);
  if (!company) return <NoAccess />;

  return (
    <main className="max-w-2xl">
      <FormHeader
        title="Endre selskap"
        backHref="/admin/selskaper"
        backLabel="Tilbake til selskaper"
      />
      <CompanyForm company={company} action={saveCompanyAction.bind(null, company.id)} />
    </main>
  );
}
