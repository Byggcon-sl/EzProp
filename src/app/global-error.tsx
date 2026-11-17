"use client";

import "./globals.css";
import { useRouter } from "next/navigation";
import { startTransition } from "react";
import { Button, buttonVariants } from "@/shared/ui/button";

/**
 * Norsk feilside når selve rotoppsettet feiler (T-0070/T-0071, oppgavekortet punkt 9).
 * Har egen html og body og henter ingenting fra andre nettsteder.
 * Viser aldri feilmeldingen, kjennetegnet eller stakken, og sender ingenting videre.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <html lang="nb">
      <body className="bg-white text-slate-900 antialiased">
        <main className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="text-2xl font-semibold">Siden kunne ikke vises</h1>
          <p className="mt-2 text-slate-700">Noe gikk galt. Det du ikke har lagret, kan mangle.</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button onClick={retry}>Prøv igjen</Button>
            {/* Vanlig lenke: rotoppsettet har feilet, så siden lastes helt på nytt. */}
            <a href="/arbeidskoe" className={buttonVariants({ variant: "secondary" })}>
              Til arbeidskøen
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
