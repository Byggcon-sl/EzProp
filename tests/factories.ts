import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { addDaysToIsoDate, todayInOslo, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  auditLog,
  certifications,
  companies,
  employeePermissions,
  employeeRoleAssignments,
  employees,
  offices,
  organizations,
  users,
  type EmployeeRole,
} from "@/db/schema";

/** Tømmer alle tabeller i testdatabasen. Ny tabell? Legg den til her. */
export async function resetDatabase() {
  await db.execute(
    sql`truncate table certifications, trial_photos, trial_answers, trial_forms, audit_log, employee_permissions, employee_roles, employees, companies, offices, organizations, sessions, accounts, verifications, users restart identity cascade`,
  );
}

/** En innlogging (Better Auth-bruker). Oppdiktet e-post. */
export async function createUser(
  overrides: { name?: string; email?: string } = {},
): Promise<Actor> {
  const id = randomUUID();
  const actor: Actor = {
    id,
    name: overrides.name ?? "Test Takstmann",
    email: overrides.email ?? `${id}@example.com`,
  };
  await db.insert(users).values(actor);
  return actor;
}

export async function createOrganization(name = "Testfirma takst") {
  const [organization] = await db
    .insert(organizations)
    .values({ name, brandName: name })
    .returning();
  if (!organization) throw new Error("kunne ikke opprette organisasjon");
  return organization;
}

type CompanyOverrides = Partial<Omit<typeof companies.$inferInsert, "organizationId">>;
type OfficeOverrides = Partial<Omit<typeof offices.$inferInsert, "organizationId">>;

/**
 * Et selskap i organisasjonen. Oppdiktet navn; org.nr. og forsikring er tomme med mindre
 * testen ber om dem (org.nr. er unikt blant aktive per organisasjon).
 */
export async function createCompany(organizationId: string, overrides: CompanyOverrides = {}) {
  const [company] = await db
    .insert(companies)
    .values({ legalName: "Testselskap A AS", orgNumber: null, ...overrides, organizationId })
    .returning();
  if (!company) throw new Error("kunne ikke opprette selskap");
  return company;
}

let officeCounter = 0;

/** Et kontor i organisasjonen. Standardnavnet får et løpenummer, fordi navnet er unikt blant aktive. */
export async function createOffice(organizationId: string, overrides: OfficeOverrides = {}) {
  officeCounter += 1;
  const [office] = await db
    .insert(offices)
    .values({ name: `Testkontor Nord ${officeCounter}`, ...overrides, organizationId })
    .returning();
  if (!office) throw new Error("kunne ikke opprette kontor");
  return office;
}

/** Ansetter personen i organisasjonen med rollene, eventuelt i et selskap og på et kontor. */
export async function createEmployee(
  actor: Actor,
  organizationId: string,
  roles: EmployeeRole[],
  options: { companyId?: string; officeId?: string } = {},
) {
  const [employee] = await db
    .insert(employees)
    .values({
      organizationId,
      userId: actor.id,
      name: actor.name,
      createdBy: actor.id,
      companyId: options.companyId ?? null,
      officeId: options.officeId ?? null,
    })
    .returning();
  if (!employee) throw new Error("kunne ikke opprette ansatt");
  if (roles.length > 0) {
    await db
      .insert(employeeRoleAssignments)
      .values(roles.map((role) => ({ organizationId, employeeId: employee.id, role })));
  }
  return employee;
}

/**
 * Gir den ansatte én enkeltrettighet (som admin gjør). Tar fri tekst, slik at tester kan sette
 * inn ukjente navn og vise at de ikke gir tilgang. `createdBy` er bruker-id-en til den som ga
 * rettigheten (admin), som i `createEmployee`.
 */
export async function grantPermission(
  employee: { id: string; organizationId: string },
  permission: string,
  createdBy: string | null = null,
) {
  const [row] = await db
    .insert(employeePermissions)
    .values({
      organizationId: employee.organizationId,
      employeeId: employee.id,
      permission,
      createdBy,
    })
    .returning();
  if (!row) throw new Error("kunne ikke gi enkeltrettighet");
  return row;
}

type CertificationOverrides = Partial<
  Omit<typeof certifications.$inferInsert, "organizationId" | "employeeId">
>;

/**
 * Gir den ansatte en sertifisering direkte i databasen (uten tilgangssjekk). Standard er område
 * `condition_report`, gyldig til ett år frem fra i dag i norsk tid. Heter `createCertification`
 * her; kjernefunksjonen med samme navn importeres fra `@/core/organization`.
 */
export async function createCertification(
  employee: { id: string; organizationId: string },
  overrides: CertificationOverrides = {},
) {
  const [row] = await db
    .insert(certifications)
    .values({
      area: "condition_report",
      validTo: addDaysToIsoDate(todayInOslo(), 365),
      ...overrides,
      organizationId: employee.organizationId,
      employeeId: employee.id,
    })
    .returning();
  if (!row) throw new Error("kunne ikke opprette sertifisering");
  return row;
}

/**
 * Antall aktive admin i organisasjonen, etter definisjonen i
 * docs/funksjoner/fase0b-admin-organisasjon.md (Omfang 4): rollen `admin` uten `deleted_at`, og
 * ansatt-raden har `deleted_at`, `deactivated_at` tomme og `user_id` satt.
 */
export async function activeAdminCount(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(employeeRoleAssignments)
    .innerJoin(employees, eq(employees.id, employeeRoleAssignments.employeeId))
    .where(
      and(
        eq(employeeRoleAssignments.organizationId, organizationId),
        eq(employees.organizationId, organizationId),
        eq(employeeRoleAssignments.role, "admin"),
        isNull(employeeRoleAssignments.deletedAt),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
        isNotNull(employees.userId),
      ),
    );
  return row?.count ?? 0;
}

/** Radene i revisjonsloggen for organisasjonen, eldste først. */
export async function auditRows(organizationId: string) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId))
    .orderBy(asc(auditLog.receivedAt), asc(auditLog.createdAt));
}
