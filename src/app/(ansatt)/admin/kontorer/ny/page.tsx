import type { Metadata } from "next";
import { getAdminContext } from "../../admin-context";
import { FormHeader } from "../../admin-list";
import { NoAccess } from "../../no-access";
import { saveOfficeAction } from "../actions";
import { OfficeForm } from "../office-form";

export const metadata: Metadata = { title: "Nytt kontor" };

export default async function NewOfficePage() {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  return (
    <main className="max-w-2xl">
      <FormHeader title="Nytt kontor" backHref="/admin/kontorer" backLabel="Tilbake til kontorer" />
      <OfficeForm action={saveOfficeAction.bind(null, null)} />
    </main>
  );
}
