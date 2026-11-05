import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import { assignments, assignmentTeamMembers, employees } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { TEAM_ROLES, type TeamRole } from "./codes";
import { EmployeeNotFoundError } from "./errors";
import { teamChangeReasonSchema } from "./schemas";
import { lockAssignment } from "./shared";

/*
 * Teamet på oppdraget (A61). Endring med `assignment.edit`. Et bytte avslutter den aktive raden
 * (`to_at`, valgfri grunn) og lager en ny; ingenting skrives over eller slettes, så det alltid
 * står hvem som hadde ansvaret (reklamasjoner). Hendelse og revisjonslogg har bare id-er og
 * rollekoden, aldri grunnen eller navn.
 *
 * Utstedende selskap (A65–A68): når ansvarlig settes eller byttes, får oppdraget den ansattes
 * selskap i samme transaksjon. Ingen ansvarlig, eller ansvarlig uten selskap, gir tomt selskap.
 * Andre roller rører aldri selskapet.
 */

const teamRoleSchema = z.enum(TEAM_ROLES, { error: "Velg en rolle." });

export type SetTeamMemberInput = {
  teamRole: TeamRole;
  /** Den ansatte som skal ha rollen. `null` fjerner personen fra rollen. */
  employeeId: string | null;
  /** Grunnen ved bytte, for eksempel ferie. Lagres på raden som avsluttes. */
  reason?: string | null;
  /** Tiden for byttet. Standard: nå. */
  now?: Date;
};

/**
 * Setter, bytter eller fjerner personen i en rolle i teamet. Oppdragsraden låses først
 * (`FOR UPDATE`), så samtidige bytter på samme oppdrag går etter hverandre og aldri gir to aktive
 * i samme rolle. Samme ansatt som den aktive, eller «ingen» når ingen er satt, gir ingen endring
 * og ingen hendelse.
 */
export async function setTeamMember(
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  input: SetTeamMemberInput,
): Promise<{ changed: boolean }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "assignment.edit");
  const teamRole = teamRoleSchema.parse(input.teamRole);
  const reason = teamChangeReasonSchema.parse(input.reason);
  if (!isUuid(assignmentId)) throw new AccessDeniedError();
  const employeeId = input.employeeId ?? null;
  if (employeeId !== null && !isUuid(employeeId)) throw new EmployeeNotFoundError();

  return db.transaction(async (tx) => {
    // (1) Lås oppdraget (organisasjonen og ikke slettet)
    const assignment = await lockAssignment(tx, grant, assignmentId);

    // (2) Den ansatte finnes i organisasjonen, er ikke slettet og har ikke sluttet. Selskapet
    // hentes i samme oppslag (også et mykt slettet selskap, A68).
    let employeeCompanyId: string | null = null;
    if (employeeId !== null) {
      const [employee] = await tx
        .select({ id: employees.id, companyId: employees.companyId })
        .from(employees)
        .where(
          and(
            eq(employees.id, employeeId),
            eq(employees.organizationId, grant.organizationId),
            isNull(employees.deletedAt),
            isNull(employees.deactivatedAt),
          ),
        );
      if (!employee) throw new EmployeeNotFoundError();
      employeeCompanyId = employee.companyId;
    }

    // (3) Den aktive raden for rollen
    const [active] = await tx
      .select({
        id: assignmentTeamMembers.id,
        employeeId: assignmentTeamMembers.employeeId,
        fromAt: assignmentTeamMembers.fromAt,
      })
      .from(assignmentTeamMembers)
      .where(
        and(
          eq(assignmentTeamMembers.organizationId, grant.organizationId),
          eq(assignmentTeamMembers.assignmentId, assignment.id),
          eq(assignmentTeamMembers.teamRole, teamRole),
          isNull(assignmentTeamMembers.toAt),
          isNull(assignmentTeamMembers.deletedAt),
        ),
      );

    const fromEmployeeId = active?.employeeId ?? null;
    if (fromEmployeeId === employeeId) return { changed: false };

    // Tiden tas etter låsen. Aldri før den aktive raden startet, så `to_at >= from_at` holder
    // også når et samtidig bytte med senere klokkeslett kom først.
    let at = input.now ?? new Date();
    if (active && at.getTime() < active.fromAt.getTime()) at = active.fromAt;

    // (4) Avslutt den aktive raden
    if (active) {
      await tx
        .update(assignmentTeamMembers)
        .set({ toAt: at, handedOverReason: reason, updatedBy: grant.employeeId })
        .where(
          and(
            eq(assignmentTeamMembers.id, active.id),
            eq(assignmentTeamMembers.organizationId, grant.organizationId),
          ),
        );
      await recordAuditEvent(tx, grant, {
        entityType: "assignment_team_member",
        entityId: active.id,
        action: "end",
        changes: { assignmentId: assignment.id, teamRole, employeeId: active.employeeId },
      });
    }

    // (5) Ny aktiv rad
    if (employeeId !== null) {
      const [row] = await tx
        .insert(assignmentTeamMembers)
        .values({
          organizationId: grant.organizationId,
          assignmentId: assignment.id,
          employeeId,
          teamRole,
          fromAt: at,
          createdBy: grant.employeeId,
        })
        .returning({ id: assignmentTeamMembers.id });
      if (!row) throw new Error("Fant ikke teamraden etter at den ble lagret. Prøv igjen.");
      await recordAuditEvent(tx, grant, {
        entityType: "assignment_team_member",
        entityId: row.id,
        action: "create",
        changes: { assignmentId: assignment.id, teamRole, employeeId },
      });
    }

    // (6) Hendelse
    await recordEvent(tx, grant, {
      type: "assignment.team_changed",
      assignmentId: assignment.id,
      data: { teamRole, fromEmployeeId, toEmployeeId: employeeId },
    });

    // (7) Utstedende selskap følger ansvarlig takstmann (A65–A68), bare ved faktisk endring
    if (teamRole === "responsible") {
      const [current] = await tx
        .select({ companyId: assignments.companyId })
        .from(assignments)
        .where(
          and(
            eq(assignments.id, assignment.id),
            eq(assignments.organizationId, grant.organizationId),
          ),
        );
      const fromCompanyId = current?.companyId ?? null;
      const toCompanyId = employeeCompanyId;
      if (fromCompanyId !== toCompanyId) {
        await tx
          .update(assignments)
          .set({ companyId: toCompanyId, updatedBy: grant.employeeId })
          .where(
            and(
              eq(assignments.id, assignment.id),
              eq(assignments.organizationId, grant.organizationId),
            ),
          );
        await recordEvent(tx, grant, {
          type: "assignment.company_changed",
          assignmentId: assignment.id,
          data: { fromCompanyId, toCompanyId },
        });
        await recordAuditEvent(tx, grant, {
          entityType: "assignment",
          entityId: assignment.id,
          action: "update",
          changes: { companyId: { from: fromCompanyId, to: toCompanyId } },
        });
      }
    }
    return { changed: true };
  });
}
