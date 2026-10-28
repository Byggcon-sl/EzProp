import type { ReactNode } from "react";
import { listOrganizationsForActor } from "@/core/access";
import { requireActor } from "@/core/auth/session";
import { TrialSyncProvider } from "./trial-sync-provider";

/**
 * Prøve fase 1: den lokale databasen åpnes én gang for listen og skjemaet. Organisasjonen er den
 * første personen er ansatt i (i dag alltid én: Byggcon); serveren sjekker tilgang på hvert kall.
 */
export default async function TrialFormLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const [organization] = await listOrganizationsForActor(actor);
  if (!organization) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-semibold text-slate-900">Testskjema</h1>
        <p className="mt-2 text-slate-600">
          Du er ikke registrert som ansatt, så testskjemaet kan ikke åpnes.
        </p>
      </main>
    );
  }
  return <TrialSyncProvider organizationId={organization.id}>{children}</TrialSyncProvider>;
}
