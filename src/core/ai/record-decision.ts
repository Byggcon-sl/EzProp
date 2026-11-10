import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { aiUsageLog } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { AiDecisionError, AiRequestRejectedError } from "./errors";
import { getFeatureDefinition } from "./features";
import { AI_USAGE_ENTITY_TYPE, sameTargetCondition } from "./request-suggestion";
import type { AiDecision, AiSuggestionStatus } from "./types";

/*
 * Den ansattes avgjørelse på et forslag (kortet Omfang 4, A162). Hvem som avgjorde, kommer alltid
 * fra `grant`. Virker også når KI er av. Statusendringen og linjen i revisjonsloggen skrives i
 * samme transaksjon, med bare gammel og ny status.
 */

const DECISIONS: readonly AiDecision[] = ["accepted", "edited", "rejected", "undo"];

type Transition =
  { kind: "change"; to: AiSuggestionStatus } | { kind: "same" } | { kind: "invalid" };

/** Tabellen over lovlige endringer (16 ruter). */
function transitionFor(from: AiSuggestionStatus, decision: AiDecision): Transition {
  if (from === "suggested") {
    return decision === "undo" ? { kind: "invalid" } : { kind: "change", to: decision };
  }
  if (decision === "undo") return { kind: "change", to: "suggested" };
  return decision === from ? { kind: "same" } : { kind: "invalid" };
}

export async function recordDecision(
  grant: EmployeeGrant,
  usageId: string,
  decision: AiDecision,
): Promise<void> {
  if (typeof usageId !== "string" || !isUuid(usageId)) throw new AiRequestRejectedError();
  if (!DECISIONS.includes(decision)) throw new AiDecisionError();

  const [row] = await db
    .select()
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.id, usageId),
        eq(aiUsageLog.organizationId, grant.organizationId),
        isNull(aiUsageLog.deletedAt),
      ),
    );
  if (!row) throw new AiRequestRejectedError();

  // Rettigheten følger funksjonen på raden, aldri en verdi fra kalleren
  const definition = getFeatureDefinition(row.feature);
  if (!definition) throw new AiRequestRejectedError();
  if (!grantHasPermission(grant, definition.permission)) throw new AccessDeniedError();

  if (row.outcome !== "ok" || row.status === null) throw new AiDecisionError();
  // CHECK-regelen i databasen sikrer at statusen er en av de faste kodene
  const from = row.status as AiSuggestionStatus;
  const transition = transitionFor(from, decision);
  if (transition.kind === "invalid") throw new AiDecisionError();
  // Gjentatt samme avgjørelse (for eksempel fra iPaden): ingen endring, ingen linje i loggen
  if (transition.kind === "same") return;
  const to = transition.to;

  await db.transaction(async (tx) => {
    if (to === "suggested") {
      // Angre (fra godtatt, endret eller avvist) er bare lov når det ikke finnes et nyere forslag
      // på samme mål (A162, A164 D), ellers kan det bli to åpne forslag på samme mål:
      // serverens `created_at`, bare `ok` og ikke slettet. Aldri sammenligning på id.
      const [newer] = await tx
        .select({ found: sql<number>`1` })
        .from(aiUsageLog)
        .where(
          and(
            sameTargetCondition(grant.organizationId, row.feature, row.targetRef),
            eq(aiUsageLog.outcome, "ok"),
            isNull(aiUsageLog.deletedAt),
            ne(aiUsageLog.id, row.id),
            gt(aiUsageLog.createdAt, row.createdAt),
          ),
        )
        .limit(1);
      if (newer) throw new AiDecisionError();
    }

    const decided = to === "suggested" ? null : new Date();
    const updated = await tx
      .update(aiUsageLog)
      .set({
        status: to,
        decidedBy: decided ? grant.employeeId : null,
        decidedAt: decided,
        updatedBy: grant.employeeId,
      })
      .where(
        and(
          eq(aiUsageLog.id, row.id),
          eq(aiUsageLog.organizationId, grant.organizationId),
          isNull(aiUsageLog.deletedAt),
          // Endret av en annen i mellomtiden: ingen endring
          eq(aiUsageLog.status, from),
        ),
      )
      .returning({ id: aiUsageLog.id });
    if (updated.length === 0) throw new AiDecisionError();

    await recordAuditEvent(tx, grant, {
      entityType: AI_USAGE_ENTITY_TYPE,
      entityId: row.id,
      action: "update",
      changes: { status: { from, to } },
    });
  });
}
