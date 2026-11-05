import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db, type DbExecutor } from "@/db/client";
import { assignments } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import type { AssignmentStatus } from "./codes";
import {
  AssignmentCannotBeCancelledError,
  AssignmentStatusConflictError,
  AssignmentTransitionNotAllowedError,
} from "./errors";
import {
  cancelAssignmentInputSchema,
  changeAssignmentStatusInputSchema,
  statusChangeReasonSchema,
  type CancelAssignmentInput,
  type ChangeAssignmentStatusInput,
} from "./schemas";
import { canCancel, transitionKind } from "./status-flow";

/*
 * Statusflyten og kansellering (A74–A77). Begge krever `assignment.edit` og filtrerer på
 * `grant.organizationId`. Én transaksjon: oppdraget låses (`FOR UPDATE`, bare ikke slettet),
 * statusen sjekkes mot `expectedStatus` (ellers konflikt), og endring, hendelse og revisjonslogg
 * lagres sammen. Grunnen står bare i hendelsen, aldri i revisjonsloggen. Ingenting slettes
 * permanent: kansellering setter `deleted_at` (myk sletting) og beholder statusen.
 */

export type AssignmentStatusResult = {
  id: string;
  number: string;
  status: AssignmentStatus;
  deletedAt: Date | null;
};

/** Brukes for å kaste en `ZodError` ved grunnfeltet når grunnen mangler ved tilbake-steg. */
const requiredReasonSchema = z.object({ reason: statusChangeReasonSchema });

/** Låser oppdraget med status og nummer. Ukjent, fremmed eller slettet gir `AccessDeniedError`. */
async function lockAssignmentWithStatus(
  tx: DbExecutor,
  grant: EmployeeGrant,
  assignmentId: string,
) {
  const [row] = await tx
    .select({ id: assignments.id, number: assignments.number, status: assignments.status })
    .from(assignments)
    .where(
      and(
        eq(assignments.id, assignmentId),
        eq(assignments.organizationId, grant.organizationId),
        isNull(assignments.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new AccessDeniedError();
  return row;
}

/**
 * Flytter oppdraget ett steg fram (uten grunn) eller ett steg tilbake (grunn påkrevd). Hopp og
 * samme status gir `AssignmentTransitionNotAllowedError`. Annen status enn `expectedStatus` gir
 * `AssignmentStatusConflictError`.
 */
export async function changeAssignmentStatus(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: ChangeAssignmentStatusInput & { now?: Date },
): Promise<AssignmentStatusResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const { expectedStatus, toStatus, reason } = changeAssignmentStatusInputSchema.parse(input);
  const kind = transitionKind(expectedStatus, toStatus);
  // Tilbake krever grunn. Feilen kommer ved grunnfeltet, før databasen.
  if (kind === "back") requiredReasonSchema.parse({ reason });
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const assignment = await lockAssignmentWithStatus(tx, grant, assignmentId);
    if (assignment.status !== expectedStatus) throw new AssignmentStatusConflictError();
    if (kind === null) throw new AssignmentTransitionNotAllowedError(expectedStatus, toStatus);

    const [updated] = await tx
      .update(assignments)
      .set({ status: toStatus, updatedAt: now, updatedBy: grant.employeeId })
      .where(
        and(
          eq(assignments.id, assignment.id),
          eq(assignments.organizationId, grant.organizationId),
        ),
      )
      .returning({
        id: assignments.id,
        number: assignments.number,
        status: assignments.status,
        deletedAt: assignments.deletedAt,
      });
    if (!updated) throw new Error("Fant ikke oppdraget etter at det ble lagret. Prøv igjen.");

    await recordEvent(tx, grant, {
      type: "assignment.status_changed",
      assignmentId: assignment.id,
      data:
        kind === "back"
          ? { from: expectedStatus, to: toStatus, reason }
          : { from: expectedStatus, to: toStatus },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment",
      entityId: assignment.id,
      action: "update",
      changes: { status: { from: expectedStatus, to: toStatus } },
    });
    return { ...updated, status: updated.status as AssignmentStatus };
  });
}

/**
 * Kansellerer oppdraget (myk sletting, A76): bare fra Bestilt og Under arbeid, grunn påkrevd.
 * Statusen beholdes. Ordren, teamet og partene røres ikke.
 */
export async function cancelAssignment(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: CancelAssignmentInput & { now?: Date },
): Promise<AssignmentStatusResult> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const { expectedStatus, reason } = cancelAssignmentInputSchema.parse(input);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    const assignment = await lockAssignmentWithStatus(tx, grant, assignmentId);
    if (assignment.status !== expectedStatus) throw new AssignmentStatusConflictError();
    if (!canCancel(expectedStatus)) throw new AssignmentCannotBeCancelledError();

    const [updated] = await tx
      .update(assignments)
      .set({
        deletedAt: now,
        deletedBy: grant.employeeId,
        updatedAt: now,
        updatedBy: grant.employeeId,
      })
      .where(
        and(
          eq(assignments.id, assignment.id),
          eq(assignments.organizationId, grant.organizationId),
        ),
      )
      .returning({
        id: assignments.id,
        number: assignments.number,
        status: assignments.status,
        deletedAt: assignments.deletedAt,
      });
    if (!updated) throw new Error("Fant ikke oppdraget etter at det ble lagret. Prøv igjen.");

    await recordEvent(tx, grant, {
      type: "assignment.cancelled",
      assignmentId: assignment.id,
      data: { status: expectedStatus, reason },
    });
    await recordAuditEvent(tx, grant, {
      entityType: "assignment",
      entityId: assignment.id,
      action: "delete",
      changes: { status: expectedStatus },
    });
    return { ...updated, status: updated.status as AssignmentStatus };
  });
}
