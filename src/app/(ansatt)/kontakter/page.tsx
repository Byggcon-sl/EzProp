import type { Metadata } from "next";
import Link from "next/link";
import { getRemovedContactName, listContacts } from "@/core/contacts";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Notice } from "@/shared/ui/notice";
import { getEmployeeContext } from "../employee-context";
import { NoAccess } from "../no-access";
import { SearchBox, searchQuery } from "../search-box";
import { contactName } from "./contact-name";

export const metadata: Metadata = { title: "Kontakter" };

/**
 * Meglerne og de andre kontaktene i organisasjonen, sortert på navn. Alle ansatte ser listen og
 * kan søke; «Ny kontakt» vises bare for dem som kan endre (sjekken skjer i kjernen).
 * `?fjernet=<id>` gir kvitteringen «<navn> er fjernet.» etter «Fjern» på kontaktsiden.
 */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; fjernet?: string | string[] }>;
}) {
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  const params = await searchParams;
  const query = searchQuery(params.q);
  // Kvitteringen etter «Fjern» (`?fjernet=<id>`). Navnet slås opp her, så det står aldri i adressen.
  const removed =
    context.canManageContacts && typeof params.fjernet === "string"
      ? await getRemovedContactName(context.actor, context.organizationId, params.fjernet)
      : null;
  const contacts = await listContacts(context.actor, context.organizationId, {
    query: query || undefined,
  });

  return (
    <main className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Kontakter</h1>
        {context.canEditOrders && (
          <Link href="/kontakter/ny" className={buttonVariants({ variant: "primary", size: "md" })}>
            Ny kontakt
          </Link>
        )}
      </div>
      {removed && (
        <div className="mt-4">
          <Notice message={`${contactName(removed)} er fjernet.`} />
        </div>
      )}
      <SearchBox label="Søk på navn, e-post eller firma" query={query} />
      {contacts.length === 0 ? (
        <Card className="mt-6">
          <p className="text-slate-600">
            {query ? "Ingen kontakter passer med søket." : "Ingen kontakter er lagt inn ennå."}
          </p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden p-0">
          <ul>
            {contacts.map((contact) => (
              <li key={contact.id} className="border-t border-slate-200 first:border-t-0">
                <Link
                  href={`/kontakter/${contact.id}`}
                  className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-brand-50 focus-visible:-outline-offset-2"
                >
                  <span className="min-w-0 flex-1 basis-48 break-words">
                    <span className="block font-medium text-slate-900">{contactName(contact)}</span>
                    {contact.firmName && (
                      <span className="block text-sm text-slate-600">{contact.firmName}</span>
                    )}
                  </span>
                  <span className="min-w-0 basis-48 text-sm break-words text-slate-700 sm:text-right">
                    {contact.email && <span className="block">{contact.email}</span>}
                    {contact.phone && <span className="block tabular-nums">{contact.phone}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
