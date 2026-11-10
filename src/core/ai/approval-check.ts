import { and, eq, inArray, isNull } from "drizzle-orm";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { aiUsageLog, type AiTargetRef } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { AiRequestRejectedError } from "./errors";
import { getFeatureDefinition, isAllowedTarget } from "./features";
import { sameTarget } from "./usage-log";

/*
 * Publiseringssperren for KI-tekst (docs/funksjoner/fase2a-forslagsmonster.md Omfang 6, ad-6).
 * Ingen KI-tekst kommer i en rapport uten at takstmannen har godkjent akkurat den, for akkurat det
 * feltet. Leser bare id, funksjon, mål, utfall og status, aldri teksten.
 *
 * Tjenesten sjekker bare det den får. Når publisering bygges (2a-2), hentes listen fra serverens
 * data, aldri fra klienten.
 *
 * Støtter hovedmål: færre reklamasjoner (ikke-godkjent KI-tekst stopper publiseringen) og KI i
 * bunnen (samme sperre for alle KI-funksjoner).
 */

/** Høyeste antall elementer per kall. Flere gir avslag, aldri et delvis svar. */
export const AI_APPROVAL_CHECK_MAX = 500;

/** Rettigheten som kreves for å kjøre sperren. */
const APPROVAL_CHECK_PERMISSION = "report.edit";

export type AiApprovalItem = { aiUsageId: string; target: AiTargetRef };

function isTarget(value: unknown): value is AiTargetRef {
  if (value === null || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  return (
    typeof target.type === "string" &&
    typeof target.id === "string" &&
    typeof target.fieldKey === "string"
  );
}

/**
 * Elementene som ikke er godkjent, hver med sin `target`. Godkjent er bare en rad i
 * `grant.organizationId`, ikke slettet, med `outcome = ok`, status `accepted` eller `edited`, et mål
 * som står i `allowedTargets` for funksjonen, og samme type, id og felt som elementet. Svaret
 * skiller ikke grunner. Tom liste gir tom liste uten oppslag.
 */
export async function checkAiTextApproved(
  grant: EmployeeGrant,
  items: readonly AiApprovalItem[],
): Promise<AiApprovalItem[]> {
  if (!grantHasPermission(grant, APPROVAL_CHECK_PERMISSION)) throw new AccessDeniedError();
  if (!Array.isArray(items) || items.length > AI_APPROVAL_CHECK_MAX) {
    throw new AiRequestRejectedError();
  }
  if (items.length === 0) return [];

  const ids = [
    ...new Set(
      items
        .map((item) => item?.aiUsageId)
        .filter((id): id is string => typeof id === "string" && isUuid(id))
        .map((id) => id.toLowerCase()),
    ),
  ];

  // Ett oppslag for hele listen
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: aiUsageLog.id,
            feature: aiUsageLog.feature,
            targetRef: aiUsageLog.targetRef,
          })
          .from(aiUsageLog)
          .where(
            and(
              inArray(aiUsageLog.id, ids),
              eq(aiUsageLog.organizationId, grant.organizationId),
              isNull(aiUsageLog.deletedAt),
              eq(aiUsageLog.outcome, "ok"),
              inArray(aiUsageLog.status, ["accepted", "edited"]),
            ),
          );
  const approved = new Map(rows.map((row) => [row.id.toLowerCase(), row]));

  return items
    .filter((item) => {
      const id = typeof item?.aiUsageId === "string" ? item.aiUsageId.toLowerCase() : null;
      const row = id === null ? undefined : approved.get(id);
      if (!row || !isTarget(item.target)) return true;
      const definition = getFeatureDefinition(row.feature);
      if (!definition || !isAllowedTarget(definition, row.targetRef)) return true;
      return !sameTarget(row.targetRef, item.target);
    })
    .map((item) => ({ aiUsageId: item?.aiUsageId, target: item?.target }));
}
