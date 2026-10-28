import type { Metadata } from "next";
import Link from "next/link";
import { listOrganizationsForActor } from "@/core/access";
import { requireActor } from "@/core/auth/session";
import { brand } from "@/shared/config/brand";
import { Card } from "@/shared/ui/card";
import { LogOutButton } from "./log-out-button";

export const metadata: Metadata = { title: "Arbeidskø" };

/**
 * Startsiden etter innlogging: en tom arbeidskø (fase 0a). Grunnlayouten i design A med meny
 * kommer i fase 0b, oppdragene i fase 2a.
 */
export default async function WorkQueuePage() {
  const actor = await requireActor();
  const organizations = await listOrganizationsForActor(actor);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-700">{brand.productName}</p>
          <h1 className="text-2xl font-semibold text-slate-900">Arbeidskø</h1>
          <p className="mt-1 text-slate-600">Hei, {actor.name}.</p>
        </div>
        <LogOutButton />
      </header>
      {organizations.length === 0 ? (
        <Card>
          <h2 className="text-lg font-medium">Du er ikke registrert som ansatt</h2>
          <p className="mt-2 text-slate-600">
            Innloggingen virker, men ingen har lagt deg inn som ansatt. Kontakt {brand.companyName}{" "}
            på {brand.supportEmail}.
          </p>
        </Card>
      ) : (
        <Card>
          <h2 className="text-lg font-medium">Ingenting venter på deg</h2>
          <p className="mt-2 text-slate-600">
            Oppdrag og befaringer kommer her når rapportdelen er bygget. Du jobber for{" "}
            {organizations.map((o) => o.name).join(", ")}.
          </p>
        </Card>
      )}
      <p className="mt-6">
        <Link
          href="/prove/testskjema"
          className="inline-flex min-h-11 min-w-11 items-center font-medium text-brand-700 underline"
        >
          Prøve uten nett: testskjema
        </Link>
      </p>
    </main>
  );
}
