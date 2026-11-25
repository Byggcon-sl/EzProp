import { and, eq, isNull, or, type SQL } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import {
  assignments,
  checkpointResults,
  deviationMeasures,
  deviations,
  overrideSummaries,
  reportBuildings,
  reports,
  rooms,
} from "@/db/schema";
import { isResolvedTargetType } from "./request";
import type { AiTargetRef, ResolveAiTarget, ResolvedAiTarget } from "./types";

/*
 * Oppslaget av målet (docs/funksjoner/fase2a-ki-i-veien.md «Målet slås opp i kjernen», ADR 0006,
 * tillegg 17.11.2026, del 1). For måltypene i `RESOLVED_AI_TARGET_TYPES` følger kjernen kjeden
 * målrad → (tiltak → avvik → kontrollpunktresultat →) rapport → oppdrag via `@/db/schema`, med
 * `grant.organizationId` og `deleted_at is null` i alle ledd, og rapporten i `draft`. Står
 * kontrollpunktresultatet i et rom eller en bygning, må også den ikke være slettet.
 *
 * `report_id` og `assignment_id` i loggen og de kjente verdiene til vasken kommer herfra, aldri fra
 * forespørselen. Leser bare id-er, aldri tekstkolonner. Låser aldri rader: låserekkefølgen står i
 * `RecordDecisionIn` (types.ts). `null` for alt som ikke finnes for organisasjonen, så kalleren gir
 * samme nøytrale avslag uansett grunn.
 *
 * Organisasjonsmålet `override_summary` (ADR 0006, tillegg 24.11.2026): målraden er
 * `override_summaries`, slått opp på `grant.organizationId` og `deleted_at is null`, uten kjede
 * videre. Svaret er `{ reportId: null, assignmentId: null }`. Ukjent id, annen organisasjon og
 * slettet rad gir `null`, som for de andre målene.
 *
 * Importerer aldri `@/core/reports`, `@/core/claims` eller `@/core/templates` (statisk test).
 */

/** Rapporten er i organisasjonen, ikke slettet og i `draft`; oppdraget likeså. */
function reportChain(organizationId: string): SQL {
  return and(
    eq(reports.organizationId, organizationId),
    isNull(reports.deletedAt),
    eq(reports.status, "draft"),
    eq(assignments.organizationId, organizationId),
    isNull(assignments.deletedAt),
  ) as SQL;
}

/** Kontrollpunktresultatet og stedet det står (rom eller bygning) er ikke slettet. */
function checkpointResultChain(organizationId: string): SQL {
  return and(
    eq(checkpointResults.organizationId, organizationId),
    isNull(checkpointResults.deletedAt),
    or(isNull(checkpointResults.roomId), isNull(rooms.deletedAt)),
    or(isNull(checkpointResults.reportBuildingId), isNull(reportBuildings.deletedAt)),
    reportChain(organizationId),
  ) as SQL;
}

const resolvedColumns = { reportId: reports.id, assignmentId: assignments.id };

async function resolveReport(organizationId: string, id: string) {
  return db
    .select(resolvedColumns)
    .from(reports)
    .innerJoin(assignments, eq(assignments.id, reports.assignmentId))
    .where(and(eq(reports.id, id), reportChain(organizationId)))
    .limit(1);
}

async function resolveCheckpointResult(organizationId: string, id: string) {
  return db
    .select(resolvedColumns)
    .from(checkpointResults)
    .innerJoin(reports, eq(reports.id, checkpointResults.reportId))
    .innerJoin(assignments, eq(assignments.id, reports.assignmentId))
    .leftJoin(
      rooms,
      and(eq(rooms.id, checkpointResults.roomId), eq(rooms.organizationId, organizationId)),
    )
    .leftJoin(
      reportBuildings,
      and(
        eq(reportBuildings.id, checkpointResults.reportBuildingId),
        eq(reportBuildings.organizationId, organizationId),
      ),
    )
    .where(and(eq(checkpointResults.id, id), checkpointResultChain(organizationId)))
    .limit(1);
}

async function resolveDeviation(organizationId: string, id: string) {
  return db
    .select(resolvedColumns)
    .from(deviations)
    .innerJoin(checkpointResults, eq(checkpointResults.id, deviations.checkpointResultId))
    .innerJoin(reports, eq(reports.id, deviations.reportId))
    .innerJoin(assignments, eq(assignments.id, reports.assignmentId))
    .leftJoin(
      rooms,
      and(eq(rooms.id, checkpointResults.roomId), eq(rooms.organizationId, organizationId)),
    )
    .leftJoin(
      reportBuildings,
      and(
        eq(reportBuildings.id, checkpointResults.reportBuildingId),
        eq(reportBuildings.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(deviations.id, id),
        eq(deviations.organizationId, organizationId),
        isNull(deviations.deletedAt),
        eq(checkpointResults.reportId, deviations.reportId),
        checkpointResultChain(organizationId),
      ),
    )
    .limit(1);
}

async function resolveDeviationMeasure(organizationId: string, id: string) {
  return db
    .select(resolvedColumns)
    .from(deviationMeasures)
    .innerJoin(deviations, eq(deviations.id, deviationMeasures.deviationId))
    .innerJoin(checkpointResults, eq(checkpointResults.id, deviations.checkpointResultId))
    .innerJoin(reports, eq(reports.id, deviationMeasures.reportId))
    .innerJoin(assignments, eq(assignments.id, reports.assignmentId))
    .leftJoin(
      rooms,
      and(eq(rooms.id, checkpointResults.roomId), eq(rooms.organizationId, organizationId)),
    )
    .leftJoin(
      reportBuildings,
      and(
        eq(reportBuildings.id, checkpointResults.reportBuildingId),
        eq(reportBuildings.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(deviationMeasures.id, id),
        eq(deviationMeasures.organizationId, organizationId),
        isNull(deviationMeasures.deletedAt),
        eq(deviations.organizationId, organizationId),
        isNull(deviations.deletedAt),
        eq(deviations.reportId, deviationMeasures.reportId),
        eq(checkpointResults.reportId, deviationMeasures.reportId),
        checkpointResultChain(organizationId),
      ),
    )
    .limit(1);
}

const NO_SCOPE: ResolvedAiTarget = { reportId: null, assignmentId: null };

/** Månedsoppsummeringen i organisasjonen, ikke slettet. Leser bare id-en. */
async function resolveOverrideSummary(organizationId: string, id: string) {
  const rows = await db
    .select({ id: overrideSummaries.id })
    .from(overrideSummaries)
    .where(
      and(
        eq(overrideSummaries.id, id),
        eq(overrideSummaries.organizationId, organizationId),
        isNull(overrideSummaries.deletedAt),
      ),
    )
    .limit(1);
  return rows.map(() => NO_SCOPE);
}

export const resolveAiTarget: ResolveAiTarget = async (
  grant: EmployeeGrant,
  target: AiTargetRef,
): Promise<ResolvedAiTarget | null> => {
  if (!isResolvedTargetType(target.type)) return null;
  const organizationId = grant.organizationId;
  const id = target.id.toLowerCase();
  let rows: ResolvedAiTarget[];
  switch (target.type) {
    case "report":
      rows = await resolveReport(organizationId, id);
      break;
    case "checkpoint_result":
      rows = await resolveCheckpointResult(organizationId, id);
      break;
    case "deviation":
      rows = await resolveDeviation(organizationId, id);
      break;
    case "deviation_measure":
      rows = await resolveDeviationMeasure(organizationId, id);
      break;
    case "override_summary":
      // Bare feltet `text` (den faste listen i `@/shared/config/ai-targets`)
      if (target.fieldKey !== "text") return null;
      rows = await resolveOverrideSummary(organizationId, id);
      break;
    default:
      return null;
  }
  return rows[0] ?? null;
};
