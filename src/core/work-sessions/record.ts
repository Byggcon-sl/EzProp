import { and, desc, eq, isNull } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import type { AssignmentStatus } from "@/core/assignments/codes";
import { db } from "@/db/client";
import { assignments, organizations, workSessions } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { NotFoundError } from "./errors";
import { IDLE_GAP_MINUTES, phaseForAssignment } from "./phase";
import { readTimeTrackingEnabled } from "./settings";

export type RecordWorkActivityResult = { recorded: boolean };

/**
 * Registrerer at den innloggede ansatte jobber i oppdraget nå (docs/funksjoner/fase2a-tidsmaling.md
 * punkt 3). Alle med `organization.read`. Gjør ingenting når målingen er slått av.
 *
 * Oppdragsraden låses (`FOR UPDATE`), så samtidige kall gir én økt. Den ansattes siste økt på
 * oppdraget som ikke er slettet, forlenges når den sluttet høyst `IDLE_GAP_MINUTES` før `now` og
 * fasen er den samme. Ellers lages en ny økt. Ingen hendelse og ingen revisjonslogg (for mye
 * støy). `organizationId` brukes bare i tilgangssjekken.
 */
export async function recordWorkActivity(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  now: Date = new Date(),
): Promise<RecordWorkActivityResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(assignmentId)) throw new NotFoundError();

  const [organization] = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, grant.organizationId));
  if (!readTimeTrackingEnabled(grant.organizationId, organization?.settings)) {
    return { recorded: false };
  }

  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select({ status: assignments.status, inspectionAt: assignments.inspectionAt })
      .from(assignments)
      .where(
        and(
          eq(assignments.organizationId, grant.organizationId),
          eq(assignments.id, assignmentId),
          isNull(assignments.deletedAt),
        ),
      )
      .for("update");
    if (!assignment) throw new NotFoundError();

    const phase = phaseForAssignment(
      { status: assignment.status as AssignmentStatus, inspectionAt: assignment.inspectionAt },
      now,
    );

    const [last] = await tx
      .select({ id: workSessions.id, phase: workSessions.phase, endedAt: workSessions.endedAt })
      .from(workSessions)
      .where(
        and(
          eq(workSessions.organizationId, grant.organizationId),
          eq(workSessions.assignmentId, assignmentId),
          eq(workSessions.employeeId, grant.employeeId),
          isNull(workSessions.deletedAt),
        ),
      )
      .orderBy(desc(workSessions.endedAt))
      .limit(1);

    const gapStart = now.getTime() - IDLE_GAP_MINUTES * 60 * 1000;
    if (
      last &&
      last.phase === phase &&
      last.endedAt.getTime() >= gapStart &&
      last.endedAt.getTime() <= now.getTime()
    ) {
      await tx
        .update(workSessions)
        .set({ endedAt: now, updatedBy: actor.id })
        .where(
          and(eq(workSessions.organizationId, grant.organizationId), eq(workSessions.id, last.id)),
        );
      return { recorded: true };
    }

    // En slettet økt forlenges aldri. Er den siste økten slettet, lages en ny.
    await tx.insert(workSessions).values({
      organizationId: grant.organizationId,
      assignmentId,
      employeeId: grant.employeeId,
      phase,
      startedAt: now,
      endedAt: now,
      createdBy: actor.id,
    });
    return { recorded: true };
  });
}
