import { and, eq, isNull } from "drizzle-orm";
import { grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { aiUsageLog } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { getFeatureDefinition } from "./features";
import type { AiOutcome, AiSuggestionStatus } from "./types";

/*
 * Statusoppslaget for ett KI-forslag (docs/funksjoner/fase2a-forslagsmonster.md Omfang 3).
 * Forslagskortet og KI-merket viser status lest herfra, aldri fra tilstand i nettleseren.
 *
 * - Ett forslag per kall. Ingen liste og ingen telling (spørsmål 57).
 * - Filtrerer på `grant.organizationId` og `deleted_at is null`. Ingen eierskapsfilter (A162):
 *   alle med rettigheten i organisasjonen ser status.
 * - Svaret er bare status og utfall. Teksten, hvem som ba om forslaget og hvem som avgjorde det,
 *   leses ikke.
 * - Avklaring A: `null` for alt som ikke kan vises (finnes ikke, annen organisasjon, mykt
 *   slettet, ugyldig id og manglende rettighet for funksjonen på raden), så svaret aldri røper
 *   om en id finnes.
 */

export type AiSuggestionStatusResult = {
  status: AiSuggestionStatus | null;
  outcome: AiOutcome;
};

export async function getSuggestionStatus(
  grant: EmployeeGrant,
  usageId: string,
): Promise<AiSuggestionStatusResult | null> {
  if (typeof usageId !== "string" || !isUuid(usageId)) return null;

  const [row] = await db
    .select({
      status: aiUsageLog.status,
      outcome: aiUsageLog.outcome,
      feature: aiUsageLog.feature,
    })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.id, usageId.toLowerCase()),
        eq(aiUsageLog.organizationId, grant.organizationId),
        isNull(aiUsageLog.deletedAt),
      ),
    );
  if (!row) return null;

  const definition = getFeatureDefinition(row.feature);
  if (!definition || !grantHasPermission(grant, definition.permission)) return null;
  return { status: row.status, outcome: row.outcome };
}
