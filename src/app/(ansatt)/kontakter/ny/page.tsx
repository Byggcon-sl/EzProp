import type { Metadata } from "next";
import { contactSourceLabel, listFirms } from "@/core/contacts";
import { BackLink } from "../../detail";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { createContactAction } from "../actions";
import { ContactForm } from "../contact-form";

export const metadata: Metadata = { title: "Ny kontakt" };

/** Ny kontakt. «Lagre» går til kontaktsiden. Kjernen sjekker `assignment.edit` og setter kilden. */
export default async function NewContactPage() {
  const context = await getEmployeeContext();
  if (!context || !context.canEditOrders) return <NoAccess />;
  const firms = await listFirms(context.actor, context.organizationId);

  return (
    <main className="max-w-2xl">
      <BackLink href="/kontakter">Tilbake til kontakter</BackLink>
      <h1 className="mt-2 mb-6 text-2xl font-semibold text-slate-900">Ny kontakt</h1>
      <ContactForm
        action={createContactAction}
        initial={{ firstName: "", lastName: "", email: "", phone: "", firmId: "", notes: "" }}
        firms={firms.map((firm) => ({ id: firm.id, name: firm.name }))}
        sourceLabel={contactSourceLabel("manual")}
        cancelHref="/kontakter"
      />
    </main>
  );
}
