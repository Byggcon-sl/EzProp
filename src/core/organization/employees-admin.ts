import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  AccessDeniedError,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import {
  companies,
  employeePermissions,
  employeeRoleAssignments,
  employeeRoles,
  employees,
  offices,
  users,
  type EmployeeRole,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { DuplicateEmployeeEmailError, LastAdminError, isUniqueViolation } from "./errors";
import {
  employeeCreateSchema,
  employeeRolesSchema,
  employeeUpdateSchema,
  type EmployeeCreateInput,
  type EmployeeUpdateInput,
} from "./schemas";

/*
 * Ansatte i adminområdet (docs/funksjoner/fase0b-admin-organisasjon.md, Omfang 2–7).
 * Alt krever `organization.manage` og filtrerer på `grant.organizationId`. Revisjonsloggen for
 * ansatte får bare id-er, rollenavn og navn på felt, aldri navn, e-post eller stilling.
 */

/** Den ansatte slik admin ser den. Ingen `userId` eller `organizationId`. */
export type AdminEmployee = {
  id: string;
  name: string;
  email: string | null;
  jobTitle: string | null;
  companyId: string | null;
  companyName: string | null;
  officeId: string | null;
  officeName: string | null;
  roles: EmployeeRole[];
  permissions: string[];
  deactivatedAt: Date | null;
};

function sortRoles(roles: Iterable<EmployeeRole>): EmployeeRole[] {
  return [...new Set(roles)].sort((a, b) => employeeRoles.indexOf(a) - employeeRoles.indexOf(b));
}

/**
 * Henter den ansatte i organisasjonen fra tilgangssjekken (ikke slettet; kan ha sluttet).
 * Fremmed, ukjent, slettet og ugyldig id gir `AccessDeniedError`.
 */
async function requireEmployee(executor: DbExecutor, grant: EmployeeGrant, employeeId: string) {
  if (!isUuid(employeeId)) throw new AccessDeniedError();
  const [employee] = await executor
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.id, employeeId),
        eq(employees.organizationId, grant.organizationId),
        isNull(employees.deletedAt),
      ),
    );
  if (!employee) throw new AccessDeniedError();
  return employee;
}

/**
 * Selskap og kontor fra skjemaet må finnes i organisasjonen og ikke være slettet. Ellers
 * `AccessDeniedError`, også når id-en har feil format. `null` er lov.
 */
async function requireCompanyAndOffice(
  executor: DbExecutor,
  grant: EmployeeGrant,
  companyId: string | null,
  officeId: string | null,
) {
  if (companyId !== null) {
    if (!isUuid(companyId)) throw new AccessDeniedError();
    const [company] = await executor
      .select({ id: companies.id })
      .from(companies)
      .where(
        and(
          eq(companies.id, companyId),
          eq(companies.organizationId, grant.organizationId),
          isNull(companies.deletedAt),
        ),
      );
    if (!company) throw new AccessDeniedError();
  }
  if (officeId !== null) {
    if (!isUuid(officeId)) throw new AccessDeniedError();
    const [office] = await executor
      .select({ id: offices.id })
      .from(offices)
      .where(
        and(
          eq(offices.id, officeId),
          eq(offices.organizationId, grant.organizationId),
          isNull(offices.deletedAt),
        ),
      );
    if (!office) throw new AccessDeniedError();
  }
}

/**
 * Lås per organisasjon for alt som kan fjerne en admin. Må være første setning i transaksjonen,
 * før tellingen (Omfang 4). Radlås holder ikke, fordi «sluttet» endrer en annen tabell enn rollen.
 */
async function lockAdminChanges(executor: DbExecutor, grant: EmployeeGrant) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`admin:${grant.organizationId}`}))`,
  );
}

/**
 * Antall aktive admin: rollen admin uten `deleted_at`, og den ansatte er ikke slettet, har ikke
 * sluttet og har innlogging.
 */
async function countActiveAdmins(executor: DbExecutor, grant: EmployeeGrant): Promise<number> {
  const [result] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(employeeRoleAssignments)
    .innerJoin(employees, eq(employees.id, employeeRoleAssignments.employeeId))
    .where(
      and(
        eq(employeeRoleAssignments.organizationId, grant.organizationId),
        eq(employeeRoleAssignments.role, "admin"),
        isNull(employeeRoleAssignments.deletedAt),
        eq(employees.organizationId, grant.organizationId),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
        sql`${employees.userId} is not null`,
      ),
    );
  return result?.count ?? 0;
}

async function activeRoles(
  executor: DbExecutor,
  grant: EmployeeGrant,
  employeeId: string,
): Promise<EmployeeRole[]> {
  const rows = await executor
    .select({ role: employeeRoleAssignments.role })
    .from(employeeRoleAssignments)
    .where(
      and(
        eq(employeeRoleAssignments.organizationId, grant.organizationId),
        eq(employeeRoleAssignments.employeeId, employeeId),
        isNull(employeeRoleAssignments.deletedAt),
      ),
    );
  return sortRoles(rows.map((row) => row.role));
}

/** Leser ansatte med e-post, roller og enkeltrettigheter. Sluttede sist, slettede aldri. */
async function selectAdminEmployees(
  grant: EmployeeGrant,
  employeeId?: string,
): Promise<AdminEmployee[]> {
  const rows = await db
    .select({
      id: employees.id,
      name: employees.name,
      email: users.email,
      jobTitle: employees.jobTitle,
      companyId: employees.companyId,
      companyName: companies.legalName,
      officeId: employees.officeId,
      officeName: offices.name,
      deactivatedAt: employees.deactivatedAt,
    })
    .from(employees)
    .leftJoin(users, eq(users.id, employees.userId))
    // De sammensatte fremmednøklene sikrer at selskap og kontor hører til samme organisasjon.
    .leftJoin(companies, and(eq(companies.id, employees.companyId), isNull(companies.deletedAt)))
    .leftJoin(offices, and(eq(offices.id, employees.officeId), isNull(offices.deletedAt)))
    .where(
      and(
        eq(employees.organizationId, grant.organizationId),
        isNull(employees.deletedAt),
        employeeId === undefined ? undefined : eq(employees.id, employeeId),
      ),
    )
    .orderBy(sql`${employees.deactivatedAt} is not null`, asc(employees.name), asc(employees.id));
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [roleRows, permissionRows] = await Promise.all([
    db
      .select({
        employeeId: employeeRoleAssignments.employeeId,
        role: employeeRoleAssignments.role,
      })
      .from(employeeRoleAssignments)
      .where(
        and(
          eq(employeeRoleAssignments.organizationId, grant.organizationId),
          inArray(employeeRoleAssignments.employeeId, ids),
          isNull(employeeRoleAssignments.deletedAt),
        ),
      ),
    db
      .select({
        employeeId: employeePermissions.employeeId,
        permission: employeePermissions.permission,
      })
      .from(employeePermissions)
      .where(
        and(
          eq(employeePermissions.organizationId, grant.organizationId),
          inArray(employeePermissions.employeeId, ids),
          isNull(employeePermissions.deletedAt),
        ),
      ),
  ]);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    jobTitle: row.jobTitle,
    companyId: row.companyId,
    companyName: row.companyName,
    officeId: row.officeId,
    officeName: row.officeName,
    roles: sortRoles(roleRows.filter((r) => r.employeeId === row.id).map((r) => r.role)),
    permissions: [
      ...new Set(permissionRows.filter((p) => p.employeeId === row.id).map((p) => p.permission)),
    ].sort(),
    deactivatedAt: row.deactivatedAt,
  }));
}

/**
 * Alle ansatte i organisasjonen med e-post, roller og enkeltrettigheter, også de som har sluttet
 * (nederst). Bare admin. Slettede vises ikke.
 */
export async function listEmployeesForAdmin(
  actor: Actor,
  organizationId: string,
): Promise<AdminEmployee[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  return selectAdminEmployees(grant);
}

/** Én ansatt slik admin ser den. Fremmed, ukjent, slettet og ugyldig id gir `AccessDeniedError`. */
export async function getEmployeeForAdmin(
  actor: Actor,
  organizationId: string,
  employeeId: string,
): Promise<AdminEmployee> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  if (!isUuid(employeeId)) throw new AccessDeniedError();
  const [employee] = await selectAdminEmployees(grant, employeeId);
  if (!employee) throw new AccessDeniedError();
  return employee;
}

/**
 * Legger inn en ny ansatt med roller (A26). E-posten trimmes og gjøres om til små bokstaver.
 * Finnes en innlogging med e-posten, kobles den ansatte til den (navnet på innloggingen endres
 * ikke); ellers lages en ny. Finnes det alt en ansatt i organisasjonen med den innloggingen
 * (også om hen har sluttet), kastes `DuplicateEmployeeEmailError`. Ingen e-post sendes.
 */
export async function createEmployee(
  actor: Actor,
  organizationId: string,
  input: EmployeeCreateInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = employeeCreateSchema.parse(input);
  const roles = sortRoles(values.roles);

  try {
    return await db.transaction(async (tx) => {
      await requireCompanyAndOffice(tx, grant, values.companyId, values.officeId);

      const userId = await findOrCreateUser(tx, values.email, values.name);

      // Svaret er det samme uansett hva som finnes i andre organisasjoner.
      const [existing] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(eq(employees.userId, userId), eq(employees.organizationId, grant.organizationId)),
        );
      if (existing) throw new DuplicateEmployeeEmailError();

      const [row] = await tx
        .insert(employees)
        .values({
          organizationId: grant.organizationId,
          userId,
          name: values.name,
          jobTitle: values.jobTitle,
          companyId: values.companyId,
          officeId: values.officeId,
          createdBy: grant.employeeId,
        })
        .returning();
      if (!row) throw new Error("Fant ikke den ansatte etter at den ble lagret. Prøv igjen.");

      if (roles.length > 0) {
        await tx.insert(employeeRoleAssignments).values(
          roles.map((role) => ({
            organizationId: grant.organizationId,
            employeeId: row.id,
            role,
            createdBy: grant.employeeId,
          })),
        );
      }

      const fields = (["name", "email", "jobTitle", "companyId", "officeId"] as const).filter(
        (field) => values[field] !== null,
      );
      await recordAuditEvent(tx, grant, {
        entityType: "employee",
        entityId: row.id,
        action: "create",
        changes: { fields, roles, companyId: values.companyId, officeId: values.officeId },
      });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error, "employees_user_id_organization_id_idx")) {
      throw new DuplicateEmployeeEmailError();
    }
    throw error;
  }
}

/** Finner innloggingen med e-posten (små bokstaver), eller lager en ny. Gir bare id-en. */
async function findOrCreateUser(executor: DbExecutor, email: string, name: string) {
  const findExisting = async () => {
    const [user] = await executor
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .orderBy(asc(users.createdAt))
      .limit(1);
    return user?.id;
  };

  const existingId = await findExisting();
  if (existingId) return existingId;

  const [inserted] = await executor
    .insert(users)
    .values({ id: randomUUID(), email, name })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (inserted) return inserted.id;

  // Noen andre la inn samme e-post akkurat nå.
  const raceId = await findExisting();
  if (!raceId) throw new Error("Fant ikke innloggingen etter at den ble lagret. Prøv igjen.");
  return raceId;
}

/**
 * Endrer navn, stilling, selskap og kontor. Bare admin. Revisjonsloggen får bare navnene på
 * feltene som er endret. Ingen endring gir ingen ny loggrad.
 */
export async function updateEmployee(
  actor: Actor,
  organizationId: string,
  employeeId: string,
  input: EmployeeUpdateInput,
) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const values = employeeUpdateSchema.parse(input);

  return db.transaction(async (tx) => {
    const before = await requireEmployee(tx, grant, employeeId);
    await requireCompanyAndOffice(tx, grant, values.companyId, values.officeId);

    const fields = (["name", "jobTitle", "companyId", "officeId"] as const).filter(
      (field) => before[field] !== values[field],
    );
    if (fields.length === 0) return before;

    const [row] = await tx
      .update(employees)
      .set({ ...values, updatedBy: grant.employeeId })
      .where(
        and(
          eq(employees.id, before.id),
          eq(employees.organizationId, grant.organizationId),
          isNull(employees.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new AccessDeniedError();

    await recordAuditEvent(tx, grant, {
      entityType: "employee",
      entityId: row.id,
      action: "update",
      changes: { fields },
    });
    return row;
  });
}

/**
 * Setter rollene til den ansatte. Nye roller får en ny rad, roller som ikke er med, tas bort med
 * myk sletting (A27). Den siste aktive admin kan ikke miste rollen (`LastAdminError`, A25).
 * Returnerer de aktive rollene etter endringen. Ingen endring gir ingen loggrad.
 */
export async function setEmployeeRoles(
  actor: Actor,
  organizationId: string,
  employeeId: string,
  roles: EmployeeRole[],
): Promise<EmployeeRole[]> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");
  const wanted = sortRoles(employeeRolesSchema.parse(roles));

  return db.transaction(async (tx) => {
    await lockAdminChanges(tx, grant);
    const employee = await requireEmployee(tx, grant, employeeId);
    const current = await activeRoles(tx, grant, employee.id);

    const added = wanted.filter((role) => !current.includes(role));
    const removed = current.filter((role) => !wanted.includes(role));
    if (added.length === 0 && removed.length === 0) return current;

    if (added.length > 0) {
      await tx.insert(employeeRoleAssignments).values(
        added.map((role) => ({
          organizationId: grant.organizationId,
          employeeId: employee.id,
          role,
          createdBy: grant.employeeId,
        })),
      );
    }
    if (removed.length > 0) {
      await tx
        .update(employeeRoleAssignments)
        .set({ deletedAt: new Date(), deletedBy: grant.employeeId, updatedBy: grant.employeeId })
        .where(
          and(
            eq(employeeRoleAssignments.organizationId, grant.organizationId),
            eq(employeeRoleAssignments.employeeId, employee.id),
            inArray(employeeRoleAssignments.role, removed),
            isNull(employeeRoleAssignments.deletedAt),
          ),
        );
    }

    if (removed.includes("admin") && (await countActiveAdmins(tx, grant)) === 0) {
      throw new LastAdminError();
    }

    await recordAuditEvent(tx, grant, {
      entityType: "employee",
      entityId: employee.id,
      action: "role_change",
      changes: { added, removed },
    });
    return wanted;
  });
}

/**
 * Markerer at den ansatte har sluttet (`deactivated_at`). Personen avvises i neste tilgangssjekk,
 * men står fortsatt på gamle rapporter. Den siste aktive admin kan ikke markeres som sluttet
 * (`LastAdminError`). Har personen alt sluttet, skjer ingenting.
 */
export async function deactivateEmployee(actor: Actor, organizationId: string, employeeId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");

  return db.transaction(async (tx) => {
    await lockAdminChanges(tx, grant);
    const employee = await requireEmployee(tx, grant, employeeId);
    if (employee.deactivatedAt) return employee;

    const [row] = await tx
      .update(employees)
      .set({ deactivatedAt: new Date(), updatedBy: grant.employeeId })
      .where(
        and(
          eq(employees.id, employee.id),
          eq(employees.organizationId, grant.organizationId),
          isNull(employees.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new AccessDeniedError();

    if ((await countActiveAdmins(tx, grant)) === 0) throw new LastAdminError();

    await recordAuditEvent(tx, grant, {
      entityType: "employee",
      entityId: row.id,
      action: "deactivate",
      changes: { employeeId: row.id },
    });
    return row;
  });
}

/**
 * Angrer «sluttet». Bare når den ansatte har innlogging (`user_id`); ellers `AccessDeniedError`.
 * Er personen ikke markert som sluttet, skjer ingenting.
 */
export async function reactivateEmployee(actor: Actor, organizationId: string, employeeId: string) {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.manage");

  return db.transaction(async (tx) => {
    const employee = await requireEmployee(tx, grant, employeeId);
    if (!employee.userId) throw new AccessDeniedError();
    if (!employee.deactivatedAt) return employee;

    const [row] = await tx
      .update(employees)
      .set({ deactivatedAt: null, updatedBy: grant.employeeId })
      .where(
        and(
          eq(employees.id, employee.id),
          eq(employees.organizationId, grant.organizationId),
          isNull(employees.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new AccessDeniedError();

    await recordAuditEvent(tx, grant, {
      entityType: "employee",
      entityId: row.id,
      action: "reactivate",
      changes: { employeeId: row.id },
    });
    return row;
  });
}
