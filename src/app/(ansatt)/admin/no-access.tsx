import Link from "next/link";

/**
 * Samme svar for alle som ikke er admin, og for ugyldig, ukjent eller fremmed id.
 * Ingen data og ingen navn.
 */
export function NoAccess() {
  return (
    <main className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-slate-900">Ingen tilgang</h1>
      <p className="mt-2 text-slate-600">Du har ikke tilgang til denne siden.</p>
      <Link
        href="/arbeidskoe"
        className="mt-4 inline-flex min-h-11 items-center font-medium text-brand-700 underline"
      >
        Til arbeidskøen
      </Link>
    </main>
  );
}
