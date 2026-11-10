import { and, eq, isNull } from "drizzle-orm";
import { grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { aiUsageLog, type AiOutcome, type AiSuggestionStatus } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { getFeatureDefinition } from "./features";

/*
 * Statusoppslaget for ett KI-forslag (docs/funksjoner/fase2a-forslagsmonster.md Omfang 3).
 * Svaret er bare status og utfall, aldri teksten eller hvem som ba om eller avgjorde. Ett forslag
 * per kall, ingen liste og ingen telling (spørsmål 57). Ikke noe eierskapsfilter (A162): alle med
 * rettigheten i organisasjonen ser status.
 * Støtter hovedmål: KI i bunnen (siden viser status lest fra loggen, ikke fra nettleseren).
 */

export type AiSuggestionStatusView = {
  status: AiSuggestionStatus | null;
  outcome: AiOutcome;
};

/**
 * Status og utfall for forslaget, eller `null`. `null` er det samme svaret for «finnes ikke»,
 * «annen organisasjon», «slettet», ugyldig id og manglende rettighet for funksjonen på raden, så
 * svaret aldri røper om en id finnes.
 */
export async function getSuggestionStatus(
  grant: EmployeeGrant,
  usageId: string,
): Promise<AiSuggestionStatusView | null> {
  if (typeof usageId !== "string" || !isUuid(usageId)) return null;
  const [row] = await db
    .select({
      feature: aiUsageLog.feature,
      status: aiUsageLog.status,
      outcome: aiUsageLog.outcome,
    })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.id, usageId),
        eq(aiUsageLog.organizationId, grant.organizationId),
        isNull(aiUsageLog.deletedAt),
      ),
    );
  if (!row) return null;
  const definition = getFeatureDefinition(row.feature);
  if (!definition || !grantHasPermission(grant, definition.permission)) return null;
  return { status: row.status, outcome: row.outcome };
}
