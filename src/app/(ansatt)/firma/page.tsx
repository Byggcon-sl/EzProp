import type { Metadata } from "next";
import Link from "next/link";
import { firmTypeLabel, listFirms } from "@/core/contacts";
import { buttonVariants } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { getEmployeeContext } from "../employee-context";
import { NoAccess } from "../no-access";
import { SearchBox, searchQuery } from "../search-box";

export const metadata: Metadata = { title: "Firma" };

/**
 * Meglerforetakene og de andre firmaene i organisasjonen, sortert på navn. Alle ansatte ser
 * listen og kan søke; «Nytt firma» vises bare for dem som kan endre (sjekken skjer i kjernen).
 */
export default async function FirmsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  const query = searchQuery((await searchParams).q);
  const firms = await listFirms(context.actor, context.organizationId, {
    query: query || undefined,
  });

  return (
    <main className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Firma</h1>
        {context.canEditOrders && (
          <Link href="/firma/ny" className={buttonVariants({ variant: "primary", size: "md" })}>
            Nytt firma
          </Link>
        )}
      </div>
      <SearchBox label="Søk på navn eller organisasjonsnummer" query={query} />
      {firms.length === 0 ? (
        <Card className="mt-6">
          <p className="text-slate-600">
            {query ? "Ingen firma passer med søket." : "Ingen firma er lagt inn ennå."}
          </p>
        </Card>
      ) : (
        <Card className="mt-6 overflow-hidden p-0">
          <ul>
            {firms.map((firm) => (
              <li key={firm.id} className="border-t border-slate-200 first:border-t-0">
                <Link
                  href={`/firma/${firm.id}`}
                  className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-brand-50 focus-visible:-outline-offset-2"
                >
                  <span className="min-w-0 flex-1 basis-48 break-words">
                    <span className="block font-medium text-slate-900">{firm.name}</span>
                    <span className="block text-sm text-slate-600">
                      {firmTypeLabel(firm.firmType)}
                    </span>
                  </span>
                  {firm.orgNumber && (
                    <span className="shrink-0 text-sm text-slate-700 tabular-nums">
                      Org.nr. {firm.orgNumber}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </main>
  );
}
