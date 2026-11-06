import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessDeniedError } from "@/core/access";
import { getFirm, getFirmUsage, listFirms } from "@/core/contacts";
import { isUuid } from "@/shared/lib/uuid";
import { Card } from "@/shared/ui/card";
import { BackLink } from "../../../detail";
import { getEmployeeContext } from "../../../employee-context";
import { MergeHits } from "../../../merge-hits";
import { MergeForm, type MergeCandidate } from "../../../remove-merge-actions";
import { SearchBox, searchQuery } from "../../../search-box";
import { mergeFirmsAction } from "../../actions";

export const metadata: Metadata = { title: "Slå sammen firma" };

/** Søket viser høyst så mange treff (som kontaktvelgeren). */
const MAX_HITS = 10;

const NOT_GIVEN = "Ikke oppgitt";

type Firm = Awaited<ReturnType<typeof getFirm>>;
type Context = NonNullable<Awaited<ReturnType<typeof getEmployeeContext>>>;

/** Firmaet fra adressen, eller `null` når det er ugyldig, fjernet eller fremmed. */
async function findFirm(context: Context, id: string): Promise<Firm | null> {
  if (!isUuid(id)) return null;
  try {
    return await getFirm(context.actor, context.organizationId, id);
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
 * Slå sammen to like firma: søk etter det andre, velg, se de to side om side, velg hvilket som
 * beholdes (standard: det åpne) og bekreft. Bare med `canManageContacts`; ellers, og for
 * ugyldig, fjernet eller fremmed id, «Fant ikke siden». Treffene kommer fra det vanlige søket i
 * kjernen (egen organisasjon, ikke fjernede), og det åpne firmaet tas ut her på serveren.
 * `?q=` er søket og `?med=<id>` det valgte.
 */
export default async function MergeFirmsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string | string[]; med?: string | string[] }>;
}) {
  const { id } = await params;
  const context = await getEmployeeContext();
  if (!context || !context.canManageContacts) notFound();
  const firm = await findFirm(context, id);
  if (!firm) notFound();

  const search = await searchParams;
  const query = searchQuery(search.q);
  const otherId = firstParam(search.med);
  const other = otherId && otherId !== firm.id ? await findFirm(context, otherId) : null;

  const hits = query
    ? (await listFirms(context.actor, context.organizationId, { query, limit: MAX_HITS + 1 }))
        .filter((row) => row.id !== firm.id)
        .slice(0, MAX_HITS)
    : [];

  let candidates: [MergeCandidate, MergeCandidate] | null = null;
  if (other) {
    const usage = await getFirmUsage(context.actor, context.organizationId, [firm.id, other.id]);
    const candidate = (row: Firm): MergeCandidate => ({
      id: row.id,
      name: row.name,
      details: [
        { label: "Organisasjonsnummer", value: row.orgNumber ?? NOT_GIVEN },
        { label: "Kontakter", value: String(usage[row.id]?.contactCount ?? 0) },
        { label: "Oppdrag", value: String(usage[row.id]?.assignmentCount ?? 0) },
        { label: "Ordrer", value: String(usage[row.id]?.orderCount ?? 0) },
      ],
    });
    candidates = [candidate(firm), candidate(other)];
  }

  const backHref = `/firma/${firm.id}`;

  return (
    <main className="max-w-4xl">
      <BackLink href={backHref}>Tilbake til {firm.name}</BackLink>
      <h1 className="mt-2 mb-2 min-w-0 text-2xl font-semibold break-words text-slate-900">
        Slå sammen {firm.name} med …
      </h1>
      <p className="text-slate-700">
        Søk etter firmaet som er lagt inn to ganger. Det som beholdes, endres ikke.
      </p>

      <SearchBox label="Søk på navn eller organisasjonsnummer" query={query} />

      {query && !candidates && (
        <MergeHits
          hits={hits.map((row) => ({
            id: row.id,
            title: row.name,
            detail: row.orgNumber ?? "",
          }))}
          query={query}
          emptyText="Ingen andre firma passer med søket."
        />
      )}

      {otherId && !other && (
        <Card className="mt-6">
          <p className="text-slate-700">Firmaet finnes ikke. Søk på nytt.</p>
        </Card>
      )}

      {candidates && (
        <MergeForm candidates={candidates} action={mergeFirmsAction} cancelHref={backHref} />
      )}
    </main>
  );
}
