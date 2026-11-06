import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUuid } from "@/shared/lib/uuid";
import { getAdminContext } from "../../admin-context";
import { FormHeader } from "../../admin-list";
import { NoAccess } from "../../../no-access";
import { getAgreement, NotFoundError } from "@/core/agreements";
import { listFirms } from "@/core/contacts";
import { deleteAgreementAction, saveAgreementAction } from "../actions";
import { AgreementForm, DeleteAgreementForm } from "../agreement-form";

export const metadata: Metadata = { title: "Endre avtale" };

/** Ugyldig, ukjent, fjernet og fremmed id gir «Fant ikke siden», aldri 500. */
export default async function EditAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  if (!isUuid(id)) notFound();

  let agreement: Awaited<ReturnType<typeof getAgreement>>;
  try {
    agreement = await getAgreement(context.actor, context.organizationId, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const firms = await listFirms(context.actor, context.organizationId);
  // Firmaet på avtalen står i velgeren selv om det ikke er blant de første 200.
  const firmOptions = firms.some((firm) => firm.id === agreement.firmId)
    ? firms
    : [{ id: agreement.firmId, name: agreement.firmName ?? "Ukjent firma" }, ...firms];

  return (
    <main className="max-w-2xl">
      <FormHeader title="Endre avtale" backHref="/admin/avtaler" backLabel="Tilbake til avtaler" />
      <AgreementForm
        agreement={{
          id: agreement.id,
          firmId: agreement.firmId,
          name: agreement.name,
          validFrom: agreement.validFrom,
          validTo: agreement.validTo,
          premiseText: agreement.premiseText,
          reportProfileCode: agreement.reportProfileCode,
        }}
        firms={firmOptions}
        action={saveAgreementAction}
      />
      <DeleteAgreementForm agreementId={agreement.id} action={deleteAgreementAction} />
    </main>
  );
}
