import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  employeeRoleAssignments,
  employees,
  organizations,
  users,
  type EmployeeRole,
} from "@/db/schema";

/** Tømmer alle tabeller i testdatabasen. Ny tabell? Legg den til her. */
export async function resetDatabase() {
  await db.execute(
    sql`truncate table audit_log, employee_roles, employees, organizations, sessions, accounts, verifications, users restart identity cascade`,
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

/** Ansetter personen i organisasjonen med rollene. */
export async function createEmployee(actor: Actor, organizationId: string, roles: EmployeeRole[]) {
  const [employee] = await db
    .insert(employees)
    .values({ organizationId, userId: actor.id, name: actor.name, createdBy: actor.id })
    .returning();
  if (!employee) throw new Error("kunne ikke opprette ansatt");
  if (roles.length > 0) {
    await db
      .insert(employeeRoleAssignments)
      .values(roles.map((role) => ({ organizationId, employeeId: employee.id, role })));
  }
  return employee;
}
