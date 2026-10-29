import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { employeeRoleAssignments, employees, users } from "@/db/schema";
import { assertLocalOrTestDatabase } from "../e2e/database-guard";
import { ADMIN_EMAIL, INSPECTOR_EMAIL, ensureInspector } from "../e2e/helpers";
import { createEmployee, createOrganization, createUser, resetDatabase } from "./factories";

// Testplan docs/agenter/oppgaver/fase1-smafunn-synkstatus-testplan.md avsnitt 3 (I1–I7).
// setup-env setter DATABASE_URL lik TEST_DATABASE_URL, så vakten i ensureInspector slipper gjennom.
// Alle data er oppdiktet.

const DELETED_AT = new Date("2026-10-01T10:00:00.000Z");

/** Alle rader ensureInspector kan røre, sortert, så to øyeblikksbilder kan sammenlignes. */
async function snapshot() {
  return {
    users: await db.select().from(users).orderBy(asc(users.id)),
    employees: await db.select().from(employees).orderBy(asc(employees.id)),
    roles: await db.select().from(employeeRoleAssignments).orderBy(asc(employeeRoleAssignments.id)),
  };
}

/** Organisasjon med admin fra seed (ADMIN_EMAIL, rolle admin). */
async function createAdminOrganization() {
  const admin = await createUser({ name: "Oppdiktet admin", email: ADMIN_EMAIL });
  const organization = await createOrganization("Oppdiktet takst AS");
  const employee = await createEmployee(admin, organization.id, ["admin"]);
  return { admin, organization, employee };
}

/** Takstmannen med INSPECTOR_EMAIL som ansatt med rollen inspector. */
async function createInspector(organizationId: string) {
  const user = await createUser({ name: "Oppdiktet takstmann", email: INSPECTOR_EMAIL });
  return createEmployee(user, organizationId, ["inspector"]);
}

/** Aktive ansatte med INSPECTOR_EMAIL og deres aktive roller. */
async function activeInspectorRows() {
  const rows = await db
    .select({
      employeeId: employees.id,
      organizationId: employees.organizationId,
      employeeDeletedAt: employees.deletedAt,
      deactivatedAt: employees.deactivatedAt,
      role: employeeRoleAssignments.role,
      roleOrganizationId: employeeRoleAssignments.organizationId,
      roleDeletedAt: employeeRoleAssignments.deletedAt,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .leftJoin(employeeRoleAssignments, eq(employeeRoleAssignments.employeeId, employees.id))
    .where(eq(users.email, INSPECTOR_EMAIL));
  return rows;
}

describe("ensureInspector (e2e-hjelper)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("I1: lager takstmannen med rollen inspector i adminens organisasjon", async () => {
    const { organization } = await createAdminOrganization();

    await ensureInspector();

    const rows = await activeInspectorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: organization.id,
      employeeDeletedAt: null,
      deactivatedAt: null,
      role: "inspector",
      roleOrganizationId: organization.id,
      roleDeletedAt: null,
    });
  });

  it("I2: to kall gir ingen dobbeltrader", async () => {
    await createAdminOrganization();

    await ensureInspector();
    const first = await snapshot();
    await ensureInspector();
    const second = await snapshot();

    expect(second.users).toHaveLength(first.users.length);
    expect(second.employees).toHaveLength(first.employees.length);
    expect(second.roles).toHaveLength(first.roles.length);
    expect(second).toEqual(first);
  });

  it("I3: slettet takstmann gir klar feil og ingen rader endres", async () => {
    const { organization } = await createAdminOrganization();
    const inspector = await createInspector(organization.id);
    await db.update(employees).set({ deletedAt: DELETED_AT }).where(eq(employees.id, inspector.id));
    const before = await snapshot();

    await expect(ensureInspector()).rejects.toThrow(Error);

    const after = await snapshot();
    expect(after).toEqual(before);
    const [row] = await db.select().from(employees).where(eq(employees.id, inspector.id));
    expect(row!.deletedAt).toEqual(DELETED_AT);
  });

  it("I4: deaktivert takstmann gir klar feil og ingen rader endres", async () => {
    const { organization } = await createAdminOrganization();
    const inspector = await createInspector(organization.id);
    await db
      .update(employees)
      .set({ deactivatedAt: DELETED_AT })
      .where(eq(employees.id, inspector.id));
    const before = await snapshot();

    await expect(ensureInspector()).rejects.toThrow(Error);

    const after = await snapshot();
    expect(after).toEqual(before);
    const [row] = await db.select().from(employees).where(eq(employees.id, inspector.id));
    expect(row!.deactivatedAt).toEqual(DELETED_AT);
    expect(row!.deletedAt).toBeNull();
  });

  it("I5: slettet inspector-rolle gir klar feil og gjenopprettes ikke", async () => {
    const { organization } = await createAdminOrganization();
    const inspector = await createInspector(organization.id);
    await db
      .update(employeeRoleAssignments)
      .set({ deletedAt: DELETED_AT })
      .where(eq(employeeRoleAssignments.employeeId, inspector.id));
    const before = await snapshot();

    await expect(ensureInspector()).rejects.toThrow(Error);

    const after = await snapshot();
    expect(after).toEqual(before);
    const roles = await db
      .select()
      .from(employeeRoleAssignments)
      .where(eq(employeeRoleAssignments.employeeId, inspector.id));
    expect(roles).toHaveLength(1);
    expect(roles[0]!.deletedAt).toEqual(DELETED_AT);
  });

  it("I6: slettet admin brukes ikke, takstmannen lages i organisasjonen med aktiv admin", async () => {
    const admin = await createUser({ name: "Oppdiktet admin", email: ADMIN_EMAIL });
    const organizationA = await createOrganization("Oppdiktet takst A AS");
    const organizationB = await createOrganization("Oppdiktet takst B AS");
    const adminInA = await createEmployee(admin, organizationA.id, ["admin"]);
    await db.update(employees).set({ deletedAt: DELETED_AT }).where(eq(employees.id, adminInA.id));
    await createEmployee(admin, organizationB.id, ["admin"]);

    await ensureInspector();

    const rows = await activeInspectorRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: organizationB.id,
      role: "inspector",
      roleOrganizationId: organizationB.id,
    });
    expect(rows.some((row) => row.organizationId === organizationA.id)).toBe(false);
  });

  it("I6: bare slettet admin gir «Fant ikke admin …» og ingen rader skrives", async () => {
    const { employee } = await createAdminOrganization();
    await db.update(employees).set({ deletedAt: DELETED_AT }).where(eq(employees.id, employee.id));
    const before = await snapshot();

    await expect(ensureInspector()).rejects.toThrow(/Fant ikke admin/);

    expect(await snapshot()).toEqual(before);
  });

  it("I7: adresse som ikke er lokal eller testdatabasen stopper før tilkobling", async () => {
    // .invalid finnes aldri i DNS, så et forsøk på å koble til gir en annen feil enn vakten.
    const external = "postgres://u:hemmelig-pw@ekstern-db.eksempel.invalid:5432/ezprop";
    const expected = (() => {
      try {
        assertLocalOrTestDatabase(external, process.env.TEST_DATABASE_URL);
      } catch (error) {
        return (error as Error).message;
      }
      throw new Error("vakten slapp gjennom en ekstern adresse");
    })();
    vi.stubEnv("DATABASE_URL", external);

    const started = Date.now();
    const error = await ensureInspector().then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(expected);
    expect((error as Error).message).not.toContain("hemmelig-pw");
    expect((error as Error).message).not.toContain("ekstern-db.eksempel.invalid");
    expect(Date.now() - started).toBeLessThan(1_000);
  }, 5_000);
});
