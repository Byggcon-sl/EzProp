import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Fant ikke siden</h1>
      <p className="mt-2 text-slate-600">Adressen finnes ikke, eller du har ikke tilgang.</p>
      <Link href="/" className="mt-6 inline-block font-medium text-brand-700 underline">
        Til forsiden
      </Link>
    </main>
  );
}
