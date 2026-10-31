import type { Metadata } from "next";
import { listOrganizationsForActor } from "@/core/access";
import { requireActor } from "@/core/auth/session";
import { brand } from "@/shared/config/brand";
import { Card } from "@/shared/ui/card";

export const metadata: Metadata = { title: "Arbeidskø" };

/**
 * Startsiden etter innlogging: en tom arbeidskø i rammen ((ansatt)/layout.tsx). Her skal det som
 * venter på takstmannen stå, også KI-forslag til godkjenning. Oppdragene kommer i fase 2a.
 */
export default async function WorkQueuePage() {
  const actor = await requireActor();
  const organizations = await listOrganizationsForActor(actor);
  return (
    <main className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Arbeidskø</h1>
      <p className="mt-1 text-slate-600">Hei, {actor.name}.</p>
      <div className="mt-6">
        {organizations.length === 0 ? (
          <Card>
            <h2 className="text-lg font-medium">Du er ikke registrert som ansatt</h2>
            <p className="mt-2 text-slate-600">
              Innloggingen virker, men ingen har lagt deg inn som ansatt. Kontakt{" "}
              {brand.companyName} på {brand.supportEmail}.
            </p>
          </Card>
        ) : (
          <Card>
            <h2 className="text-lg font-medium">Ingenting venter på deg</h2>
            <p className="mt-2 text-slate-600">
              Oppdrag og befaringer kommer her når rapportdelen er bygget.
            </p>
          </Card>
        )}
      </div>
    </main>
  );
}
