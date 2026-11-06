import Link from "next/link";
import { Card } from "@/shared/ui/card";

/** Treffene i søket. Hvert treff er en lenke som velger den andre (`?med=<id>`). */
export function MergeHits({
  hits,
  query,
  emptyText,
}: {
  hits: readonly { id: string; title: string; detail: string }[];
  query: string;
  emptyText: string;
}) {
  if (hits.length === 0) {
    return (
      <Card className="mt-6">
        <p className="text-slate-600">{emptyText}</p>
      </Card>
    );
  }
  return (
    <Card className="mt-6 overflow-hidden p-0">
      <ul aria-label="Treff">
        {hits.map((hit) => (
          <li key={hit.id} className="border-t border-slate-200 first:border-t-0">
            <Link
              href={`?${new URLSearchParams({ q: query, med: hit.id }).toString()}`}
              className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-brand-50 focus-visible:-outline-offset-2"
            >
              <span className="min-w-0 flex-1 basis-48 font-medium break-words text-slate-900">
                {hit.title}
              </span>
              {hit.detail && (
                <span className="min-w-0 basis-48 text-sm break-words text-slate-700 sm:text-right">
                  {hit.detail}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
