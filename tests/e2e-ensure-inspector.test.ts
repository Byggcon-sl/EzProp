/**
 * `ensureInspector` i e2e mot testdatabasen (docs/agenter/oppgaver/fase1-smafunn-synkstatus.md
 * pkt. 2b, testplanen avsnitt 3). `setup-env` setter `DATABASE_URL` til testdatabasen, så vakten
 * slipper gjennom. Slettede eller deaktiverte ansatte og slettede roller brukes aldri, og
 * ingenting gjenopprettes. Oppdiktede data.
 */
import { and, count, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { employeeRoleAssignments, employees, users } from "@/db/schema";
import { ADMIN_EMAIL, ensureInspector, INSPECTOR_EMAIL } from "../e2e/helpers";
import { createEmployee, createOrganization, createUser, resetDatabase } from "./factories";

async function rowCounts() {
  const [u] = await db.select({ n: count() }).from(users);
  const [e] = await db.select({ n: count() }).from(employees);
  const [r] = await db.select({ n: count() }).from(employeeRoleAssignments);
  return { users: u!.n, employees: e!.n, roles: r!.n };
}

async function inspectorEmployees() {
  return db
    .select({
      id: employees.id,
      organizationId: employees.organizationId,
      deletedAt: employees.deletedAt,
      deactivatedAt: employees.deactivatedAt,
    })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(users.email, INSPECTOR_EMAIL));
}

async function rolesOf(employeeId: string) {
  return db
    .select({
      id: employeeRoleAssignments.id,
      role: employeeRoleAssignments.role,
      deletedAt: employeeRoleAssignments.deletedAt,
    })
    .from(employeeRoleAssignments)
    .where(eq(employeeRoleAssignments.employeeId, employeeId));
}

async function expectError(promise: Promise<unknown>): Promise<Error> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message.length).toBeGreaterThan(0);
  return caught as Error;
}

/** Organisasjon med admin fra seed og en takstmann med rollen `inspector`. */
async function seedWithInspector() {
  const organization = await createOrganization("Oppdiktet takst AS");
  const admin = await createUser({ name: "Oppdiktet admin", email: ADMIN_EMAIL });
  await createEmployee(admin, organization.id, ["admin"]);
  const inspector = await createUser({ name: "Oppdiktet takstmann", email: INSPECTOR_EMAIL });
  const employee = await createEmployee(inspector, organization.id, ["inspector"]);
  return { organization, employee };
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ensureInspector", () => {
  it("lager takstmannen med rollen inspector i adminens organisasjon", async () => {
    const organization = await createOrganization("Oppdiktet takst AS");
    const admin = await createUser({ name: "Oppdiktet admin", email: ADMIN_EMAIL });
    await createEmployee(admin, organization.id, ["admin"]);

    await ensureInspector();

    const found = await inspectorEmployees();
    expect(found).toHaveLength(1);
    expect(found[0]!.organizationId).toBe(organization.id);
    expect(found[0]!.deletedAt).toBeNull();
    expect(found[0]!.deactivatedAt).toBeNull();
    const roles = await rolesOf(found[0]!.id);
    expect(roles.map((role) => role.role)).toEqual(["inspector"]);
    expect(roles[0]!.deletedAt).toBeNull();
  });

  it("to kall gir ingen dobbeltrader", async () => {
    const organization = await createOrganization("Oppdiktet takst AS");
    const admin = await createUser({ name: "Oppdiktet admin", email: ADMIN_EMAIL });
    await createEmployee(admin, organization.id, ["admin"]);

    await ensureInspector();
    const after1 = await rowCounts();
    await ensureInspector();

    expect(await rowCounts()).toEqual(after1);
  });

  it("slettet takstmann gir klar feil og ingen rader endres", async () => {
    const { employee } = await seedWithInspector();
    const deletedAt = new Date("2026-10-01T10:00:00.000Z");
    await db.update(employees).set({ deletedAt }).where(eq(employees.id, employee.id));
    const before = await rowCounts();

    await expectError(ensureInspector());

    expect(await rowCounts()).toEqual(before);
    const found = await inspectorEmployees();
    expect(found).toHaveLength(1);
    expect(found[0]!.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it("deaktivert takstmann gir klar feil og ingen rader endres", async () => {
    const { employee } = await seedWithInspector();
    const deactivatedAt = new Date("2026-10-02T10:00:00.000Z");
    await db.update(employees).set({ deactivatedAt }).where(eq(employees.id, employee.id));
    const before = await rowCounts();

    await expectError(ensureInspector());

    expect(await rowCounts()).toEqual(before);
    const found = await inspectorEmployees();
    expect(found).toHaveLength(1);
    expect(found[0]!.deactivatedAt?.toISOString()).toBe(deactivatedAt.toISOString());
    expect(found[0]!.deletedAt).toBeNull();
  });

  it("slettet inspector-rolle gir klar feil og gjenopprettes ikke", async () => {
    const { employee } = await seedWithInspector();
    const deletedAt = new Date("2026-10-03T10:00:00.000Z");
    await db
      .update(employeeRoleAssignments)
      .set({ deletedAt })
      .where(
        and(
          eq(employeeRoleAssignments.employeeId, employee.id),
          eq(employeeRoleAssignments.role, "inspector"),
        ),
      );
    const before = await rowCounts();

    await expectError(ensureInspector());

    expect(await rowCounts()).toEqual(before);
    const roles = await rolesOf(employee.id);
    expect(roles).toHaveLength(1);
    expect(roles[0]!.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it("slettet admin brukes ikke", async () => {
    const orgA = await createOrganization("Oppdiktet takst A");
    const orgB = await createOrganization("Oppdiktet takst B");
    const admin = await createUser({ name: "Oppdiktet admin", email: ADMIN_EMAIL });
    const adminInA = await createEmployee(admin, orgA.id, ["admin"]);
    await createEmployee(admin, orgB.id, ["admin"]);
    await db
      .update(employees)
      .set({ deletedAt: new Date("2026-10-04T10:00:00.000Z") })
      .where(eq(employees.id, adminInA.id));

    await ensureInspector();

    const found = await inspectorEmployees();
    expect(found).toHaveLength(1);
    expect(found[0]!.organizationId).toBe(orgB.id);
    const inA = await db
      .select({ n: count() })
      .from(employees)
      .where(and(eq(employees.organizationId, orgA.id), isNull(employees.deletedAt)));
    expect(inA[0]!.n).toBe(0);
  });

  it("bare slettet admin: kaster og skriver ingen rader", async () => {
    const organization = await createOrganization("Oppdiktet takst AS");
    const admin = await createUser({ name: "Oppdiktet admin", email: ADMIN_EMAIL });
    const adminEmployee = await createEmployee(admin, organization.id, ["admin"]);
    await db
      .update(employees)
      .set({ deletedAt: new Date("2026-10-04T10:00:00.000Z") })
      .where(eq(employees.id, adminEmployee.id));
    const before = await rowCounts();

    const error = await expectError(ensureInspector());

    expect(error.message).toMatch(/Fant ikke admin/);
    expect(await rowCounts()).toEqual(before);
  });

  it("adresse som ikke er lokal eller testdatabasen stopper før tilkobling", async () => {
    const outside = "postgres://u:hemmelig-pw@db.eksempel.no:5432/ezprop";
    vi.stubEnv("DATABASE_URL", outside);

    const started = Date.now();
    const error = await expectError(ensureInspector());

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(error.message).not.toContain("hemmelig-pw");
    expect(error.message).not.toContain("db.eksempel.no");
    expect(error.message).toMatch(/lokal database|testdatabasen/i);
  }, 5_000);
});
