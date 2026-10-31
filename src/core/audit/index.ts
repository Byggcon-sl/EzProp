import { and, desc, eq } from "drizzle-orm";
import { requireOrganizationAccess, type Actor, type EmployeeGrant } from "@/core/access";
import { db, type DbExecutor } from "@/db/client";
import { auditLog, employees } from "@/db/schema";

export type AuditEventInput = {
  entityType: string;
  entityId: string;
  /** `create`, `update`, `delete`, `restore`, `permission_change` … */
  action: string;
  /** Gammel og ny verdi per felt. Aldri passord, nøkler eller mer enn nødvendig. */
  changes?: Record<string, unknown>;
  /** Tiden på enheten. Tom = nå. */
  occurredAt?: Date;
  deviceId?: string;
};

/**
 * Skriver en hendelse til revisjonsloggen. Kall den i samme transaksjon som endringen.
 * Organisasjonen og den ansatte kommer fra tilgangssjekken, aldri fra skjemaet.
 */
export async function recordAuditEvent(
  executor: DbExecutor,
  grant: EmployeeGrant,
  event: AuditEventInput,
) {
  await executor.insert(auditLog).values({
    organizationId: grant.organizationId,
    actorEmployeeId: grant.employeeId,
    createdBy: grant.employeeId,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    changes: event.changes ?? {},
    occurredAt: event.occurredAt,
    deviceId: event.deviceId,
  });
}

/**
 * Siste hendelser i organisasjonen, nyeste først. Bare admin og leder (`staff.manage`).
 * Bare lesing: ingen kode endrer eller sletter rader i revisjonsloggen.
 */
export async function listAuditEvents(actor: Actor, organizationId: string, limit = 50) {
  const grant = await requireOrganizationAccess(actor, organizationId, "staff.manage");
  // Left join: rader uten ansatt forsvinner ikke, de får `actorName = null` («Ukjent»).
  // Join krever samme organisasjon, så et navn fra en annen organisasjon vises aldri.
  // Ansatte som har sluttet eller er mykt slettet, er bevisst med: historikken skal ikke miste
  // navnet på den som gjorde endringen.
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      changes: auditLog.changes,
      actorEmployeeId: auditLog.actorEmployeeId,
      actorName: employees.name,
      occurredAt: auditLog.occurredAt,
    })
    .from(auditLog)
    .leftJoin(
      employees,
      and(
        eq(employees.id, auditLog.actorEmployeeId),
        eq(employees.organizationId, grant.organizationId),
      ),
    )
    .where(eq(auditLog.organizationId, grant.organizationId))
    .orderBy(desc(auditLog.occurredAt))
    .limit(limit);
}
