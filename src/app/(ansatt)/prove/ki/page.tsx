import type { Metadata } from "next";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { getEmployeeContext } from "../../employee-context";
import { NoAccess } from "../../no-access";
import { AiTrialClient } from "./ai-trial-client";

export const metadata: Metadata = { title: "Prøv KI: språkvask" };

/*
 * Prøvesiden for forslagsmønsteret (docs/funksjoner/fase2a-forslagsmonster.md Omfang 4, A166).
 * Krever `report.edit` (admin kommer alltid inn, regel 11). Organisasjonen kommer fra økten.
 * Siden fjernes og `ai_trial` arkiveres når språkvask kommer på avviksteksten i 2a-2.
 * Støtter hovedmål: KI i bunnen («Ferdig når» for 2a-1: forslaget vises, takstmannen godtar
 * eller avviser, og loggen viser det) og de ansatte (samme kort som alle KI-funksjoner bruker).
 */
export default async function AiTrialPage() {
  const context = await getEmployeeContext();
  if (!context) return <NoAccess />;
  try {
    await requireOrganizationAccess(context.actor, context.organizationId, "report.edit");
  } catch (error) {
    if (error instanceof AccessDeniedError) return <NoAccess />;
    throw error;
  }
  return <AiTrialClient />;
}
