import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db, type DbExecutor } from "@/db/client";
import { assignments, organizations, workSessions } from "@/db/schema";
import { WORK_PHASES, type WorkPhase } from "./phase";
import type { TimeTrackingBaseline } from "./schemas";
import { readTimeTrackingBaseline, readTimeTrackingEnabled } from "./settings";
import {
  summarizeTimeStatistics,
  type TimeStatisticsRow,
  type TimeStatisticsSummary,
} from "./statistics";

/** Statusene som telles i statistikken (A122). */
const COUNTED_STATUSES = ["completed", "invoiced"] as const;

export type TimeStatistics = TimeStatisticsSummary & {
  baseline: TimeTrackingBaseline | null;
  enabled: boolean;
};

function isWorkPhase(value: string): value is WorkPhase {
  return (WORK_PHASES as readonly string[]).includes(value);
}

/**
 * Sum sekunder per oppdrag og fase for økter som ikke er slettet, på oppdrag som ikke er slettet
 * og er ferdige eller fakturerte. Grupperes aldri på ansatt, og ansatt-id hentes aldri. Ingen
 * tilgangssjekk her: kalles bare med `grant.organizationId` (og fra testene).
 */
export async function loadTimeStatisticsRows(
  executor: DbExecutor,
  organizationId: string,
): Promise<TimeStatisticsRow[]> {
  const rows = await executor
    .select({
      assignmentId: workSessions.assignmentId,
      phase: workSessions.phase,
      seconds: sql<number>`coalesce(sum(extract(epoch from (${workSessions.endedAt} - ${workSessions.startedAt}))), 0)::float8`,
    })
    .from(workSessions)
    .innerJoin(
      assignments,
      and(
        eq(assignments.organizationId, workSessions.organizationId),
        eq(assignments.id, workSessions.assignmentId),
      ),
    )
    .where(
      and(
        eq(workSessions.organizationId, organizationId),
        isNull(workSessions.deletedAt),
        isNull(assignments.deletedAt),
        inArray(assignments.status, [...COUNTED_STATUSES]),
      ),
    )
    .groupBy(workSessions.assignmentId, workSessions.phase);
  return rows
    .filter((row): row is typeof row & { phase: WorkPhase } => isWorkPhase(row.phase))
    .map((row) => ({
      assignmentId: row.assignmentId,
      phase: row.phase,
      seconds: Number(row.seconds),
    }));
}

/**
 * Samlet tid per fase for ferdige og fakturerte oppdrag (A122, A124), med nullpunktet fra IVIT
 * og bryteren. Bare leder og admin (`statistics.read`). Aldri per person.
 */
export async function getTimeStatistics(
  actor: Actor,
  organizationId: string,
): Promise<TimeStatistics> {
  const grant = await requireOrganizationAccess(actor, organizationId, "statistics.read");
  const [organization] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, grant.organizationId));
  const settings = organization?.settings ?? {};
  const baseline = readTimeTrackingBaseline(settings);
  const rows = await loadTimeStatisticsRows(db, grant.organizationId);
  return {
    ...summarizeTimeStatistics(rows, baseline),
    baseline,
    enabled: readTimeTrackingEnabled(grant.organizationId, settings),
  };
}
