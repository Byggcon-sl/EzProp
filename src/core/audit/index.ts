import { desc, eq } from "drizzle-orm";
import { requireOrganizationAccess, type Actor, type EmployeeGrant } from "@/core/access";
import { db, type DbExecutor } from "@/db/client";
import { auditLog } from "@/db/schema";

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

/** Siste hendelser i organisasjonen. Bare admin og leder (`staff.manage`). */
export async function listAuditEvents(actor: Actor, organizationId: string, limit = 50) {
  const grant = await requireOrganizationAccess(actor, organizationId, "staff.manage");
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      changes: auditLog.changes,
      actorEmployeeId: auditLog.actorEmployeeId,
      occurredAt: auditLog.occurredAt,
    })
    .from(auditLog)
    .where(eq(auditLog.organizationId, grant.organizationId))
    .orderBy(desc(auditLog.occurredAt))
    .limit(limit);
}
