"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useSyncExternalStore } from "react";
import { Button, buttonVariants } from "@/shared/ui/button";

function subscribeToNetwork(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const getOnline = () => navigator.onLine;
const getServerOnline = () => true;

/**
 * Norsk feilside for sidene under rotoppsettet (T-0070/T-0071, oppgavekortet punkt 9).
 * Viser aldri feilmeldingen, kjennetegnet eller stakken, og sender ingenting videre.
 * «Prøv igjen» henter siden på nytt fra serveren før feilgrensen nullstilles.
 */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const online = useSyncExternalStore(subscribeToNetwork, getOnline, getServerOnline);

  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Siden kunne ikke vises</h1>
      <p className="mt-2 text-slate-700">Noe gikk galt. Det du ikke har lagret, kan mangle.</p>
      {online ? null : (
        <p role="alert" className="mt-2 font-medium text-slate-900">
          Du er uten nett. Siden kan ikke hentes nå.
        </p>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={retry}>Prøv igjen</Button>
        <Link href="/arbeidskoe" className={buttonVariants({ variant: "secondary" })}>
          Til arbeidskøen
        </Link>
      </div>
    </main>
  );
}
