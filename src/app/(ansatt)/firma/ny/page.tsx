import type { Metadata } from "next";
import { BackLink } from "../../detail";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { createFirmAction } from "../actions";
import { FirmForm } from "../firm-form";
import { firmTypeOptions } from "../firm-types";

export const metadata: Metadata = { title: "Nytt firma" };

/** Nytt firma. «Lagre» går til firmasiden. Kjernen sjekker `assignment.edit`. */
export default async function NewFirmPage() {
  const context = await getEmployeeContext();
  if (!context || !context.canEditOrders) return <NoAccess />;

  return (
    <main className="max-w-2xl">
      <BackLink href="/firma">Tilbake til firma</BackLink>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">Nytt firma</h1>
      <FirmForm
        action={createFirmAction}
        initial={{ name: "", orgNumber: "", firmType: "broker_firm", notes: "" }}
        firmTypes={firmTypeOptions()}
        cancelHref="/firma"
      />
    </main>
  );
}
