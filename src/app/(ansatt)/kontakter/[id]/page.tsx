import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { contactSourceLabel, getContact, listFirms } from "@/core/contacts";
import { isUuid } from "@/shared/lib/uuid";
import { Card } from "@/shared/ui/card";
import { Notice } from "@/shared/ui/notice";
import { BackLink, Detail, EMPTY } from "../../detail";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { RemoveMergeActions } from "../../remove-merge-actions";
import { removeContactAction, updateContactAction } from "../actions";
import { ContactForm } from "../contact-form";
import { contactName } from "../contact-name";

export const metadata: Metadata = { title: "Kontakt" };

/**
 * Kontakten med skjema for dem som kan endre, ellers bare opplysningene. Kilden står alltid som
 * tekst. Ugyldig, ukjent, fjernet og fremmed id gir «Fant ikke siden». «Fjern» og «Slå sammen
 * med …» vises bare med `canManageContacts`; selve sjekken skjer i kjernen.
 * `?sammenslatt=1` gir kvitteringen etter sammenslåing.
 */
export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sammenslatt?: string | string[] }>;
}) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  if (!isUuid(id)) notFound();

  let contact: Awaited<ReturnType<typeof getContact>>;
  try {
    contact = await getContact(context.actor, context.organizationId, id);
  } catch (error) {
    if (error instanceof AccessDeniedError) notFound();
    throw error;
  }
  const merged = (await searchParams).sammenslatt === "1";
  const name = contactName(contact);
  const sourceLabel = contactSourceLabel(contact.source);
  // Firmanavnet mangler når firmaet er slettet; da står «Ingen» i valget.
  const currentFirm =
    contact.firmId && contact.firmName ? { id: contact.firmId, name: contact.firmName } : null;

  let form = null;
  if (context.canEditOrders) {
    const firms = (await listFirms(context.actor, context.organizationId)).map((firm) => ({
      id: firm.id,
      name: firm.name,
    }));
    // Listen har høyst 200 firma; firmaet til kontakten skal alltid kunne velges.
    if (currentFirm && !firms.some((firm) => firm.id === currentFirm.id)) firms.push(currentFirm);
    form = (
      <ContactForm
        action={updateContactAction}
        contactId={contact.id}
        initial={{
          firstName: contact.firstName,
          lastName: contact.lastName ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          firmId: currentFirm?.id ?? "",
          notes: contact.notes ?? "",
        }}
        firms={firms}
        sourceLabel={sourceLabel}
        cancelHref="/kontakter"
      />
    );
  }

  return (
    <main className="max-w-2xl">
      <BackLink href="/kontakter">Tilbake til kontakter</BackLink>
      <h1 className="mt-2 mb-6 min-w-0 text-2xl font-semibold break-words text-slate-900">
        {name}
      </h1>
      {merged && (
        <div className="mb-4">
          <Notice message="Kontaktene er slått sammen." />
        </div>
      )}

      {form ?? (
        <Card>
          <dl>
            <Detail label="Navn">{name}</Detail>
            <Detail label="E-post">
              {contact.email ? (
                <a
                  href={`mailto:${contact.email}`}
                  className="inline-flex min-h-11 items-center text-brand-700 underline"
                >
                  {contact.email}
                </a>
              ) : (
                EMPTY
              )}
            </Detail>
            <Detail label="Telefon">
              {contact.phone ? (
                <a
                  href={`tel:${contact.phone.replace(/\s+/g, "")}`}
                  className="inline-flex min-h-11 items-center text-brand-700 tabular-nums underline"
                >
                  {contact.phone}
                </a>
              ) : (
                EMPTY
              )}
            </Detail>
            <Detail label="Firma">
              {currentFirm ? (
                <Link
                  href={`/firma/${currentFirm.id}`}
                  className="inline-flex min-h-11 items-center text-brand-700 underline"
                >
                  {currentFirm.name}
                </Link>
              ) : (
                EMPTY
              )}
            </Detail>
            <Detail label="Notat">{contact.notes || EMPTY}</Detail>
          </dl>
          <p className="mt-4 text-sm text-slate-600">Kilde: {sourceLabel}</p>
        </Card>
      )}

      {context.canManageContacts && (
        <RemoveMergeActions
          idField="contactId"
          id={contact.id}
          mergeHref={`/kontakter/${contact.id}/sla-sammen`}
          confirmLines={[
            `Fjerne ${name}?`,
            "Kontakten vises ikke lenger i listen og søket. Oppdrag og ordrer beholder navnet som står på dem.",
          ]}
          action={removeContactAction}
        />
      )}
    </main>
  );
}
