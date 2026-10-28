import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { employeeRoleAssignments, employees, organizations } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { AccessDeniedError } from "./errors";
import {
  rolesHavePermission,
  type Actor,
  type EmployeeGrant,
  type Permission,
} from "./permissions";

/**
 * Finner den ansatte bak innloggingen i organisasjonen, med roller. Kaster `AccessDeniedError`
 * når personen ikke er ansatt der, er deaktivert, eller organisasjonen er slettet.
 */
async function findGrant(actor: Actor, organizationId: string): Promise<EmployeeGrant> {
  if (!isUuid(organizationId)) throw new AccessDeniedError();
  const [employee] = await db
    .select({ id: employees.id, organizationId: employees.organizationId })
    .from(employees)
    .innerJoin(organizations, eq(organizations.id, employees.organizationId))
    .where(
      and(
        eq(employees.organizationId, organizationId),
        eq(employees.userId, actor.id),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
        isNull(organizations.deletedAt),
      ),
    );
  if (!employee) throw new AccessDeniedError();
  const roles = await db
    .select({ role: employeeRoleAssignments.role })
    .from(employeeRoleAssignments)
    .where(
      and(
        eq(employeeRoleAssignments.employeeId, employee.id),
        eq(employeeRoleAssignments.organizationId, organizationId),
        isNull(employeeRoleAssignments.deletedAt),
      ),
    );
  return {
    employeeId: employee.id,
    organizationId: employee.organizationId,
    roles: roles.map((r) => r.role),
  };
}

/**
 * Sjekker at brukeren er ansatt i organisasjonen og har `permission`. Kaster `AccessDeniedError`
 * ellers. Kall denne først i all lesing og skriving. Spørringen som følger, filtrerer alltid på
 * `grant.organizationId`, aldri på en id fra adressen eller skjemaet.
 */
export async function requireOrganizationAccess(
  actor: Actor,
  organizationId: string,
  permission: Permission = "organization.read",
): Promise<EmployeeGrant> {
  const grant = await findGrant(actor, organizationId);
  if (!rolesHavePermission(grant.roles, permission)) throw new AccessDeniedError();
  return grant;
}

/**
 * Organisasjonene brukeren er ansatt i (i dag alltid én: Byggcon). Brukes av startsiden for å
 * finne hvor personen skal, uten en organisasjons-id i adressen.
 */
export async function listOrganizationsForActor(actor: Actor) {
  return db
    .select({ id: organizations.id, name: organizations.name })
    .from(employees)
    .innerJoin(organizations, eq(organizations.id, employees.organizationId))
    .where(
      and(
        eq(employees.userId, actor.id),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
        isNull(organizations.deletedAt),
      ),
    )
    .orderBy(organizations.name);
}
