import type { Metadata } from "next";
import { isUuid } from "@/shared/lib/uuid";
import { getAdminContext } from "../../admin-context";
import { FormHeader } from "../../admin-list";
import { NoAccess } from "../../no-access";
import { listOffices } from "../../organization";
import { saveOfficeAction } from "../actions";
import { OfficeForm } from "../office-form";

export const metadata: Metadata = { title: "Endre kontor" };

/** Ugyldig, ukjent og fremmed id gir samme svar som manglende tilgang. */
export default async function EditOfficePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getAdminContext();
  if (!context || !isUuid(id)) return <NoAccess />;
  const offices = await listOffices(context.actor, context.organizationId);
  const office = offices.find((row) => row.id === id);
  if (!office) return <NoAccess />;

  return (
    <main className="max-w-2xl">
      <FormHeader
        title="Endre kontor"
        backHref="/admin/kontorer"
        backLabel="Tilbake til kontorer"
      />
      <OfficeForm office={office} action={saveOfficeAction.bind(null, office.id)} />
    </main>
  );
}
