import type { Metadata } from "next";
import { getAdminContext } from "../../admin-context";
import { FormHeader } from "../../admin-list";
import { NoAccess } from "../../../no-access";
import { listFirms } from "@/core/contacts";
import { saveAgreementAction } from "../actions";
import { AgreementForm } from "../agreement-form";

export const metadata: Metadata = { title: "Ny avtale" };

export default async function NewAgreementPage() {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const firms = await listFirms(context.actor, context.organizationId);
  return (
    <main className="max-w-2xl">
      <FormHeader title="Ny avtale" backHref="/admin/avtaler" backLabel="Tilbake til avtaler" />
      <AgreementForm firms={firms} action={saveAgreementAction} />
    </main>
  );
}
