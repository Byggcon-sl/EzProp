import type { Metadata } from "next";
import { requireActor } from "@/core/auth/session";
import { TrialFormList } from "./trial-form-list";

export const metadata: Metadata = { title: "Testskjema" };

/**
 * Prøve fase 1: listen over testskjemaer. Leses bare fra den lokale databasen på enheten.
 * Organisasjonen hentes i layout.tsx (tilgangen sjekkes på serveren ved hvert synkkall).
 */
export default async function TrialFormListRoute() {
  await requireActor();
  return <TrialFormList />;
}
