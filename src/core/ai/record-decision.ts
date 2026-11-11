import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { aiUsageLog, type AiSuggestionStatus } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { AiDecisionError, AiRequestRejectedError } from "./errors";
import { AI_FEATURES, getFeatureDefinition } from "./features";
import { AI_DECISIONS, type AiDecision } from "./types";
import { lockTarget, recordStatusChange, sameTargetWhere } from "./usage-log";

/*
 * Registrer hva den ansatte gjorde med et KI-forslag (docs/funksjoner/fase2a-ki-modul-logg.md
 * Omfang 4, A162). Hvem som avgjorde, kommer bare fra `grant`. Rettigheten hentes fra funksjonen
 * på raden. Virker også når KI er av.
 *
 * Rekkefølgen for tilgang (docs/funksjoner/fase2a-forslagsmonster.md Omfang 7):
 * 1. Før noe leses: uten rettigheten til minst én KI-funksjon gir `AccessDeniedError`, også for
 *    ugyldig og ukjent id.
 * 2. Etter lesing: manglende rettighet for akkurat funksjonen på raden gir samme nøytrale avslag
 *    som «finnes ikke», så svaret ikke røper hva raden gjelder.
 * Ved avslag endres verken raden eller `audit_log`. Admin har alle rettigheter.
 */

/** Om `grant` har rettigheten til minst én KI-funksjon. */
function hasAnyAiPermission(grant: EmployeeGrant): boolean {
  return Object.values(AI_FEATURES).some((definition) =>
    grantHasPermission(grant, definition.permission),
  );
}

type Transition = { kind: "change"; to: AiSuggestionStatus } | { kind: "none" } | { kind: "error" };

/** Tabellen over lovlige endringer. Alt som ikke står her, er feil. */
function transitionFor(from: AiSuggestionStatus, decision: AiDecision): Transition {
  if (from === "suggested") {
    return decision === "undo" ? { kind: "error" } : { kind: "change", to: decision };
  }
  if (decision === "undo") return { kind: "change", to: "suggested" };
  if (decision === from) return { kind: "none" };
  return { kind: "error" };
}

function isDecision(value: unknown): value is AiDecision {
  return typeof value === "string" && (AI_DECISIONS as readonly string[]).includes(value);
}

export async function recordDecision(
  grant: EmployeeGrant,
  usageId: string,
  decision: AiDecision,
): Promise<void> {
  if (!hasAnyAiPermission(grant)) throw new AccessDeniedError();
  if (typeof usageId !== "string" || !isUuid(usageId) || !isDecision(decision)) {
    throw new AiRequestRejectedError();
  }

  await db.transaction(async (tx) => {
    const ownRow = and(
      eq(aiUsageLog.id, usageId),
      eq(aiUsageLog.organizationId, grant.organizationId),
      isNull(aiUsageLog.deletedAt),
    );
    const [found] = await tx
      .select({
        feature: aiUsageLog.feature,
        targetRef: aiUsageLog.targetRef,
      })
      .from(aiUsageLog)
      .where(ownRow);
    if (!found) throw new AiRequestRejectedError();

    const definition = getFeatureDefinition(found.feature);
    if (!definition) throw new AiRequestRejectedError();
    if (!grantHasPermission(grant, definition.permission)) throw new AiRequestRejectedError();

    // Samme lås som nytt forslag på samme mål, så angre og nytt forslag ikke krysser hverandre
    await lockTarget(tx, grant.organizationId, found.feature, found.targetRef);
    const [row] = await tx
      .select({
        id: aiUsageLog.id,
        outcome: aiUsageLog.outcome,
        status: aiUsageLog.status,
        createdAt: aiUsageLog.createdAt,
      })
      .from(aiUsageLog)
      .where(ownRow)
      .for("update");
    if (!row) throw new AiRequestRejectedError();
    // En sperret forespørsel (ad-1) er ikke et forslag og kan aldri avgjøres
    if (row.outcome === "blocked") throw new AiDecisionError();
    if (row.outcome !== "ok" || row.status === null) throw new AiDecisionError();

    const transition = transitionFor(row.status, decision);
    if (transition.kind === "none") return;
    if (transition.kind === "error") throw new AiDecisionError();

    // Avklaring D: angre fra avvist er feil når det finnes et nyere forslag på samme mål
    if (decision === "undo" && row.status === "rejected") {
      const [newer] = await tx
        .select({ id: aiUsageLog.id })
        .from(aiUsageLog)
        .where(
          and(
            sameTargetWhere(grant.organizationId, found.feature, found.targetRef),
            eq(aiUsageLog.outcome, "ok"),
            ne(aiUsageLog.id, row.id),
            gt(aiUsageLog.createdAt, row.createdAt),
          ),
        )
        .limit(1);
      if (newer) throw new AiDecisionError();
    }

    const undo = transition.to === "suggested";
    const [updated] = await tx
      .update(aiUsageLog)
      .set({
        status: transition.to,
        decidedBy: undo ? null : grant.employeeId,
        decidedAt: undo ? null : new Date(),
        updatedBy: grant.employeeId,
      })
      .where(ownRow)
      .returning({ id: aiUsageLog.id });
    if (!updated) throw new AiRequestRejectedError();
    await recordStatusChange(tx, grant, updated.id, row.status, transition.to);
  });
}
