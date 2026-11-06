import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { getContact, getContactUsage, listContacts } from "@/core/contacts";
import { isUuid } from "@/shared/lib/uuid";
import { Card } from "@/shared/ui/card";
import { BackLink } from "../../../detail";
import { getEmployeeContext } from "../../../employee-context";
import { MergeHits } from "../../../merge-hits";
import { MergeForm, type MergeCandidate } from "../../../remove-merge-actions";
import { SearchBox, searchQuery } from "../../../search-box";
import { mergeContactsAction } from "../../actions";
import { contactName } from "../../contact-name";

export const metadata: Metadata = { title: "Slå sammen kontakter" };

/** Søket viser høyst så mange treff (som kontaktvelgeren). */
const MAX_HITS = 10;

const NOT_GIVEN = "Ikke oppgitt";

type Contact = Awaited<ReturnType<typeof getContact>>;
type Context = NonNullable<Awaited<ReturnType<typeof getEmployeeContext>>>;

/** Kontakten fra adressen, eller `null` når den er ugyldig, fjernet eller fremmed. */
async function findContact(context: Context, id: string): Promise<Contact | null> {
  if (!isUuid(id)) return null;
  try {
    return await getContact(context.actor, context.organizationId, id);
  } catch (error) {
    if (error instanceof AccessDeniedError) return null;
    throw error;
  }
}

/** Første verdi fra adressen. */
function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * Slå sammen to like kontakter: søk etter den andre, velg, se de to side om side, velg hvem som
 * beholdes (standard: den åpne) og bekreft. Bare med `canManageContacts`; ellers, og for
 * ugyldig, fjernet eller fremmed id, «Fant ikke siden». Treffene kommer fra det vanlige søket i
 * kjernen (egen organisasjon, ikke fjernede), og den åpne kontakten tas ut her på serveren.
 * `?q=` er søket og `?med=<id>` den valgte.
 */
export default async function MergeContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string | string[]; med?: string | string[] }>;
}) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context || !context.canManageContacts) notFound();
  const contact = await findContact(context, id);
  if (!contact) notFound();

  const search = await searchParams;
  const query = searchQuery(search.q);
  const otherId = firstParam(search.med);
  const other = otherId && otherId !== contact.id ? await findContact(context, otherId) : null;

  const hits = query
    ? (
        await listContacts(context.actor, context.organizationId, {
          query,
          limit: MAX_HITS + 1,
        })
      )
        .filter((row) => row.id !== contact.id)
        .slice(0, MAX_HITS)
    : [];

  let candidates: [MergeCandidate, MergeCandidate] | null = null;
  if (other) {
    const usage = await getContactUsage(context.actor, context.organizationId, [
      contact.id,
      other.id,
    ]);
    const candidate = (row: Contact): MergeCandidate => ({
      id: row.id,
      name: contactName(row),
      details: [
        { label: "Firma", value: row.firmName ?? NOT_GIVEN },
        { label: "E-post", value: row.email ?? NOT_GIVEN },
        { label: "Telefon", value: row.phone ?? NOT_GIVEN },
        { label: "Oppdrag", value: String(usage[row.id]?.assignmentCount ?? 0) },
        { label: "Ordrer", value: String(usage[row.id]?.orderCount ?? 0) },
      ],
    });
    candidates = [candidate(contact), candidate(other)];
  }

  const name = contactName(contact);
  const backHref = `/kontakter/${contact.id}`;

  return (
    <main className="max-w-4xl">
      <BackLink href={backHref}>Tilbake til {name}</BackLink>
      <h1 className="mt-2 mb-2 min-w-0 text-2xl font-semibold break-words text-slate-900">
        Slå sammen {name} med …
      </h1>
      <p className="text-slate-700">
        Søk etter kontakten som er lagt inn to ganger. Den som beholdes, endres ikke.
      </p>

      <SearchBox label="Søk på navn, e-post eller firma" query={query} />

      {query && !candidates && (
        <MergeHits
          hits={hits.map((row) => ({
            id: row.id,
            title: contactName(row),
            detail: [row.firmName, row.email].filter(Boolean).join(" · "),
          }))}
          query={query}
          emptyText="Ingen andre kontakter passer med søket."
        />
      )}

      {otherId && !other && (
        <Card className="mt-6">
          <p className="text-slate-700">Kontakten finnes ikke. Søk på nytt.</p>
        </Card>
      )}

      {candidates && (
        <MergeForm candidates={candidates} action={mergeContactsAction} cancelHref={backHref} />
      )}
    </main>
  );
}
