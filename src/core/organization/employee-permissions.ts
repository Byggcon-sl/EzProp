import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AccessDeniedError,
  grantablePermissions,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { employeePermissions, employees } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";

/** Bare rettighetene i `grantablePermissions` kan gis (A21). Alt annet gir `ZodError`. */
function parseGrantablePermission(permission: string) {
  return z.enum(grantablePermissions).parse(permission);
}

/**
 * Sjekker at den ansatte finnes i organisasjonen fra tilgangssjekken, ikke er slettet og ikke
 * har sluttet. Kaster `AccessDeniedError` ellers, også når id-en har feil format.
 */
async function requireActiveEmployee(
  executor: DbExecutor,
  grant: EmployeeGrant,
  employeeId: string,
) {
  if (!isUuid(employeeId)) throw new AccessDeniedError();
  const [employee] = await executor
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, grant.organizationId),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
      ),
    );
  if (!employee) throw new AccessDeniedError();
}

/**
 * Gir en ansatt en enkeltrettighet (for eksempel maltilgang). Bare admin (`organization.manage`).
 * Har personen rettigheten alt, skjer ingenting: ingen ny rad og ingen ny linje i
 * revisjonsloggen. Returnerer alltid den aktive raden.
 */
export async function grantEmployeePermission(
  actor: Actor,
  organizationId: string,
  employeeId: string,
  permission: string,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const validPermission = parseGrantablePermission(permission);

  return db.transaction(async (tx) => {
    await requireActiveEmployee(tx, grant, employeeId);

    // To samtidige kall gir én rad: den delvise unike indeksen stopper den andre uten feil.
    const [inserted] = await tx
      .insert(employeePermissions)
      .values({
        organizationId: grant.organizationId,
        employeeId,
        permission: validPermission,
        createdBy: grant.employeeId,
      })
      .onConflictDoNothing({
        target: [employeePermissions.employeeId, employeePermissions.permission],
        where: isNull(employeePermissions.deletedAt),
      })
      .returning();

    if (inserted) {
      await recordAuditEvent(tx, grant, {
        entityType: "employee_permission",
        entityId: inserted.id,
        action: "permission_change",
        changes: { permission: validPermission, employeeId, granted: true },
      });
      return inserted;
    }

    const [existing] = await tx
      .select()
      .from(employeePermissions)
      .where(
        and(
          eq(employeePermissions.organizationId, grant.organizationId),
          eq(employeePermissions.employeeId, employeeId),
          eq(employeePermissions.permission, validPermission),
          isNull(employeePermissions.deletedAt),
        ),
      );
    // Bare mulig hvis noen tok bort rettigheten mellom de to spørringene.
    if (!existing) throw new Error("Fant ikke rettigheten etter at den ble gitt. Prøv igjen.");
    return existing;
  });
}

/**
 * Tar bort en enkeltrettighet med myk sletting (`deleted_at`). Bare admin (`organization.manage`).
 * Er rettigheten ikke gitt, skjer ingenting. Raden slettes aldri; gis den på nytt, lages en ny rad.
 */
export async function revokeEmployeePermission(
  actor: Actor,
  organizationId: string,
  employeeId: string,
  permission: string,
): Promise<void> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const validPermission = parseGrantablePermission(permission);

  await db.transaction(async (tx) => {
    await requireActiveEmployee(tx, grant, employeeId);

    // `updated_at` og `row_version` økes av `baseColumns` ved hver oppdatering.
    const revoked = await tx
      .update(employeePermissions)
      .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
      .where(
        and(
          eq(employeePermissions.organizationId, grant.organizationId),
          eq(employeePermissions.employeeId, employeeId),
          eq(employeePermissions.permission, validPermission),
          isNull(employeePermissions.deletedAt),
        ),
      )
      .returning({ id: employeePermissions.id });

    for (const row of revoked) {
      await recordAuditEvent(tx, grant, {
        entityType: "employee_permission",
        entityId: row.id,
        action: "permission_change",
        changes: { permission: validPermission, employeeId, revoked: true },
      });
    }
  });
}
