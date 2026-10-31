import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  certifications,
  employeePermissions,
  employeeRoleAssignments,
  employees,
  organizations,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { AccessDeniedError } from "./errors";
import {
  effectivePermissions,
  grantHasPermission,
  readInspectorsEditAll,
  withPublishRequiringCertification,
  type Actor,
  type EmployeeGrant,
  type Permission,
} from "./permissions";

/**
 * Om den ansatte har minst én gyldig sertifisering på datoen `today` («ÅÅÅÅ-MM-DD», norsk tid):
 * ikke slettet, `valid_from` tom eller senest i dag, og `valid_to` i dag eller senere. Samme regel
 * som `isCertificationValid` i `src/core/organization/certification-rules.ts`. Datoen sendes inn
 * (aldri databasens egen dato), fordi databasen kan stå i UTC og testene må kunne sette den. Filtrerer på
 * både organisasjonen og id-en fra ansatt-raden, så en sertifisering i en annen organisasjon
 * aldri teller.
 */
export async function employeeHasValidCertification(
  employee: { id: string; organizationId: string },
  today: string,
): Promise<boolean> {
  const [row] = await db
    .select({ found: sql<number>`1` })
    .from(certifications)
    .where(
      and(
        eq(certifications.organizationId, employee.organizationId),
        eq(certifications.employeeId, employee.id),
        isNull(certifications.deletedAt),
        or(isNull(certifications.validFrom), lte(certifications.validFrom, today)),
        gte(certifications.validTo, today),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Finner den ansatte bak innloggingen i organisasjonen, med roller, enkeltrettigheter og
 * innstillingen `access.inspectors_edit_all`, og regner ut rettighetene. `report.publish` tas bort
 * uten gyldig sertifisering (A29). Kaster `AccessDeniedError`
 * når personen ikke er ansatt der, er deaktivert, eller organisasjonen er slettet.
 */
async function findGrant(actor: Actor, organizationId: string): Promise<EmployeeGrant> {
  if (!isUuid(organizationId)) throw new AccessDeniedError();
  const [employee] = await db
    .select({
      id: employees.id,
      organizationId: employees.organizationId,
      settings: organizations.settings,
    })
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
  // Filtrerer på organisasjonen fra den ansatt-raden, ikke på id-en fra kalleren
  const [roleRows, grantedRows, hasValidCertification] = await Promise.all([
    db
      .select({ role: employeeRoleAssignments.role })
      .from(employeeRoleAssignments)
      .where(
        and(
          eq(employeeRoleAssignments.employeeId, employee.id),
          eq(employeeRoleAssignments.organizationId, employee.organizationId),
          isNull(employeeRoleAssignments.deletedAt),
        ),
      ),
    db
      .select({ permission: employeePermissions.permission })
      .from(employeePermissions)
      .where(
        and(
          eq(employeePermissions.employeeId, employee.id),
          eq(employeePermissions.organizationId, employee.organizationId),
          isNull(employeePermissions.deletedAt),
        ),
      ),
    employeeHasValidCertification(employee, todayInOslo()),
  ]);
  const roles = roleRows.map((r) => r.role);
  const inspectorsEditAll = readInspectorsEditAll(employee.organizationId, employee.settings);
  return {
    employeeId: employee.id,
    organizationId: employee.organizationId,
    roles,
    // Regnestykket først, så kravet om sertifisering for publisering (A29). Bare
    // `report.publish` kan forsvinne her; admin beholder alt annet (regel 11).
    permissions: withPublishRequiringCertification(
      effectivePermissions(
        roles,
        grantedRows.map((r) => r.permission),
        { inspectorsEditAll },
      ),
      hasValidCertification,
    ),
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
  if (!grantHasPermission(grant, permission)) throw new AccessDeniedError();
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
