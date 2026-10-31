import type { Metadata } from "next";
import { getAdminContext } from "../../admin-context";
import { FormHeader } from "../../admin-list";
import { NoAccess } from "../../no-access";
import { saveCompanyAction } from "../actions";
import { CompanyForm } from "../company-form";

export const metadata: Metadata = { title: "Nytt selskap" };

export default async function NewCompanyPage() {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  return (
    <main className="max-w-2xl">
      <FormHeader
        title="Nytt selskap"
        backHref="/admin/selskaper"
        backLabel="Tilbake til selskaper"
      />
      <CompanyForm action={saveCompanyAction.bind(null, null)} />
    </main>
  );
}
