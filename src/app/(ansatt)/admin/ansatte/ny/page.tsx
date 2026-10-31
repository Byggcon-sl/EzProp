import type { Metadata } from "next";
import { LOGIN_PATH } from "@/core/auth/session";
import { getAdminContext } from "../../admin-context";
import { FormHeader } from "../../admin-list";
import { NoAccess } from "../../no-access";
import { listCompanies, listOffices } from "@/core/organization";
import { createEmployeeAction } from "../actions";
import { EmployeeDetailsForm } from "../employee-forms";

export const metadata: Metadata = { title: "Ny ansatt" };

export default async function NewEmployeePage() {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const [companies, offices] = await Promise.all([
    listCompanies(context.actor, context.organizationId),
    listOffices(context.actor, context.organizationId),
  ]);
  const loginUrl = `${process.env.BETTER_AUTH_URL || "http://localhost:3000"}${LOGIN_PATH}`;

  return (
    <main className="max-w-2xl">
      <FormHeader title="Ny ansatt" backHref="/admin/ansatte" backLabel="Tilbake til ansatte" />
      <EmployeeDetailsForm
        companies={companies.map((company) => ({ id: company.id, name: company.legalName }))}
        offices={offices.map((office) => ({ id: office.id, name: office.name }))}
        action={createEmployeeAction}
        loginUrl={loginUrl}
      />
    </main>
  );
}
