import { and, eq, inArray, isNull } from "drizzle-orm";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { aiUsageLog } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { AiRequestRejectedError } from "./errors";
import { getFeatureDefinition } from "./features";
import type { AiTargetRef } from "./types";
import { sameTarget } from "./usage-log";

/*
 * Publiseringssperren for KI-tekst som tjeneste (docs/funksjoner/fase2a-forslagsmonster.md
 * Omfang 6, ad-6). Svarer med de innsendte elementene som ikke er godkjent, så publiseringen kan
 * si hvor mange tekster fra KI som mangler godkjenning og gå rett til feltet.
 *
 * Tjenesten sjekker bare det den får. Når publisering bygges (2a-2), hentes listen fra serverens
 * data, aldri fra klienten.
 *
 * - Krever `report.edit`, også for en tom liste.
 * - Over taket gir avslag (avklaring C), aldri et delvis svar, så publiseringen aldri tror alt er
 *   godkjent.
 * - Ett oppslag for hele listen, filtrert på `grant.organizationId` og `deleted_at is null`.
 * - `aiUsageId` og målets id sammenlignes med små bokstaver. Ugyldig uuid er «ikke godkjent».
 * - Svaret har ingen grunn, så det aldri røper om en id finnes hos en annen organisasjon.
 */

/** Høyeste antall elementer per kall. */
export const AI_APPROVAL_CHECK_MAX = 500;

export type AiApprovalItem = { aiUsageId: string; target: AiTargetRef };

type StoredRow = {
  feature: string;
  targetRef: AiTargetRef;
  outcome: string;
  status: string | null;
};

function isTargetRef(value: unknown): value is AiTargetRef {
  if (value === null || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  return (
    typeof target.type === "string" &&
    typeof target.id === "string" &&
    typeof target.fieldKey === "string"
  );
}

function usageIdOf(item: unknown): string | null {
  if (item === null || typeof item !== "object") return null;
  const id = (item as Record<string, unknown>).aiUsageId;
  return typeof id === "string" && isUuid(id) ? id.toLowerCase() : null;
}

/** Om elementet er godkjent KI-tekst for akkurat dette målet. */
function isApproved(item: AiApprovalItem, row: StoredRow | undefined): boolean {
  if (!row || !isTargetRef(item.target) || !isTargetRef(row.targetRef)) return false;
  // Sperret forespørsel (ad-1), ingen treff og feil er aldri godkjent KI-tekst
  if (row.outcome === "blocked") return false;
  if (row.outcome !== "ok") return false;
  if (row.status !== "accepted" && row.status !== "edited") return false;
  const definition = getFeatureDefinition(row.feature);
  if (!definition) return false;
  const stored = row.targetRef;
  const allowed = definition.allowedTargets.some(
    (spec) => spec.type === stored.type && spec.fieldKey === stored.fieldKey,
  );
  // ad-6: raden må gjelde samme type, id og felt som elementet
  return allowed && sameTarget(stored, item.target);
}

/** Kopi av elementet slik det ble sendt inn: bare id og mål. */
function echo(item: AiApprovalItem): AiApprovalItem {
  const target = isTargetRef(item.target)
    ? { type: item.target.type, id: item.target.id, fieldKey: item.target.fieldKey }
    : item.target;
  return { aiUsageId: item.aiUsageId, target };
}

export async function checkAiTextApproved(
  grant: EmployeeGrant,
  items: readonly AiApprovalItem[],
): Promise<AiApprovalItem[]> {
  if (!grantHasPermission(grant, "report.edit")) throw new AccessDeniedError();
  if (!Array.isArray(items) || items.length > AI_APPROVAL_CHECK_MAX) {
    throw new AiRequestRejectedError();
  }
  if (items.length === 0) return [];

  const ids = [...new Set(items.map(usageIdOf).filter((id): id is string => id !== null))];
  const rows = new Map<string, StoredRow>();
  if (ids.length > 0) {
    const found = await db
      .select({
        id: aiUsageLog.id,
        feature: aiUsageLog.feature,
        targetRef: aiUsageLog.targetRef,
        outcome: aiUsageLog.outcome,
        status: aiUsageLog.status,
      })
      .from(aiUsageLog)
      .where(
        and(
          inArray(aiUsageLog.id, ids),
          eq(aiUsageLog.organizationId, grant.organizationId),
          isNull(aiUsageLog.deletedAt),
        ),
      );
    for (const row of found) rows.set(row.id.toLowerCase(), row);
  }

  return items
    .filter((item) => {
      const id = usageIdOf(item);
      return !isApproved(item, id === null ? undefined : rows.get(id));
    })
    .map(echo);
}
