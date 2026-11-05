import type { Metadata } from "next";
import Link from "next/link";
import { AccessDeniedError } from "@/core/access";
import { firmTypeLabel, getFirm } from "@/core/contacts";
import { isUuid } from "@/shared/lib/uuid";
import { Card } from "@/shared/ui/card";
import { BackLink, Detail, EMPTY } from "../../detail";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { contactName } from "../../kontakter/contact-name";
import { updateFirmAction } from "../actions";
import { FirmForm } from "../firm-form";
import { firmTypeOptions } from "../firm-types";

export const metadata: Metadata = { title: "Firma" };

/**
 * Firmaet med skjema for dem som kan endre, ellers bare opplysningene. Under står kontaktene i
 * firmaet. Ugyldig, ukjent, slettet og fremmed id gir samme svar som manglende tilgang.
 */
export default async function FirmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context || !isUuid(id)) return <NoAccess />;

  let firm: Awaited<ReturnType<typeof getFirm>>;
  try {
    firm = await getFirm(context.actor, context.organizationId, id);
  } catch (error) {
    if (error instanceof AccessDeniedError) return <NoAccess />;
    throw error;
  }

  return (
    <main className="max-w-2xl">
      <BackLink href="/firma">Tilbake til firma</BackLink>
      <h1 className="mt-2 mb-6 min-w-0 text-2xl font-semibold break-words text-slate-900">
        {firm.name}
      </h1>

      {context.canEditOrders ? (
        <FirmForm
          action={updateFirmAction}
          firmId={firm.id}
          initial={{
            name: firm.name,
            orgNumber: firm.orgNumber ?? "",
            firmType: firm.firmType,
            notes: firm.notes ?? "",
          }}
          firmTypes={firmTypeOptions()}
          cancelHref="/firma"
        />
      ) : (
        <Card>
          <dl>
            <Detail label="Navn">{firm.name}</Detail>
            <Detail label="Organisasjonsnummer">
              {firm.orgNumber ? <span className="tabular-nums">{firm.orgNumber}</span> : EMPTY}
            </Detail>
            <Detail label="Type">{firmTypeLabel(firm.firmType)}</Detail>
            <Detail label="Notat">{firm.notes || EMPTY}</Detail>
          </dl>
        </Card>
      )}

      <h2 className="mt-8 mb-3 text-lg font-semibold text-slate-900">Kontakter i firmaet</h2>
      {firm.contacts.length === 0 ? (
        <Card>
          <p className="text-slate-600">Ingen kontakter er knyttet til firmaet.</p>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <ul>
            {firm.contacts.map((contact) => (
              <li key={contact.id} className="border-t border-slate-200 first:border-t-0">
                <Link
                  href={`/kontakter/${contact.id}`}
                  className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-brand-50 focus-visible:-outline-offset-2"
                >
                  <span className="min-w-0 flex-1 basis-48 font-medium break-words text-slate-900">
                    {contactName(contact)}
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
