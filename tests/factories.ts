import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  companies,
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
    sql`truncate table trial_photos, trial_answers, trial_forms, audit_log, employee_roles, employees, companies, offices, organizations, sessions, accounts, verifications, users restart identity cascade`,
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
