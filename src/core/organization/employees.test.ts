import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { db } from "@/db/client";
import { companies, employees, offices, type EmployeeRole } from "@/db/schema";
import {
  createCompany,
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listEmployees } from "./index";

beforeEach(resetDatabase);

const roles: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

/** Organisasjon med en admin (uten selskap og kontor) som leser listen. */
async function setup() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

describe("listEmployees", () => {
  it("viser aldri ansatte fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const company = await createCompany(grant.organizationId);
          const office = await createOffice(grant.organizationId);
          const person = await createUser({ name: `Test Takstmann ${side.toUpperCase()}` });
          const employee = await createEmployee(person, grant.organizationId, ["inspector"], {
            companyId: company.id,
            officeId: office.id,
          });
          ids[side].push(employee.id);
        }
        return ids;
      },
      query: (actor, organizationId) => listEmployees(actor, organizationId),
      idOf: (row) => row.id,
    });
  });

  it.each(roles)("rollen %s kan lese de ansatte", async (role) => {
    const { org, adminEmployee } = await setup();
    const person = await createUser();
    const employee = await createEmployee(person, org.id, [role]);

    const rows = await listEmployees(person, org.id);
    expect(rows.map((row) => row.id).sort()).toEqual([adminEmployee.id, employee.id].sort());
  });

  it("ansatt uten roller får AccessDeniedError", async () => {
    const { org } = await setup();
    const person = await createUser();
    await createEmployee(person, org.id, []);

    await expect(listEmployees(person, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(listEmployees(person, org.id, { includeDeactivated: true })).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("gir nøyaktig de lovede feltene, uten e-post eller innloggings-id", async () => {
    const { org, admin } = await setup();

    const rows = await listEmployees(admin, org.id, { includeDeactivated: true });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "companyName",
        "deactivatedAt",
        "id",
        "jobTitle",
        "name",
        "officeName",
      ]);
    }
  });

  it("viser selskaps- og kontornavn, og null for en ansatt uten", async () => {
    const { org, admin, adminEmployee } = await setup();
    const company = await createCompany(org.id, { legalName: "Testselskap A AS" });
    const office = await createOffice(org.id, { name: "Testkontor Nord" });
    const person = await createUser();
    const employee = await createEmployee(person, org.id, ["inspector"], {
      companyId: company.id,
      officeId: office.id,
    });

    const rows = await listEmployees(admin, org.id);
    expect(rows.find((row) => row.id === employee.id)).toMatchObject({
      companyName: "Testselskap A AS",
      officeName: "Testkontor Nord",
    });
    expect(rows.find((row) => row.id === adminEmployee.id)).toMatchObject({
      companyName: null,
      officeName: null,
    });
  });

  it("viser ikke slettede ansatte, heller ikke med includeDeactivated", async () => {
    const { org, admin, adminEmployee } = await setup();
    const person = await createUser();
    const removed = await createEmployee(person, org.id, ["inspector"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, removed.id));

    const active = await listEmployees(admin, org.id);
    const all = await listEmployees(admin, org.id, { includeDeactivated: true });
    expect(active.map((row) => row.id)).toEqual([adminEmployee.id]);
    expect(all.map((row) => row.id)).toEqual([adminEmployee.id]);
  });

  it("slettet selskap eller kontor gir tomt navn, og den ansatte vises fortsatt", async () => {
    const { org, admin } = await setup();
    const company = await createCompany(org.id, { legalName: "Testselskap A AS" });
    const office = await createOffice(org.id, { name: "Testkontor Nord" });
    const withCompany = await createEmployee(await createUser(), org.id, ["inspector"], {
      companyId: company.id,
      officeId: office.id,
    });
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, company.id));

    let rows = await listEmployees(admin, org.id);
    expect(rows.find((row) => row.id === withCompany.id)).toMatchObject({
      companyName: null,
      officeName: "Testkontor Nord",
    });

    await db.update(offices).set({ deletedAt: new Date() }).where(eq(offices.id, office.id));
    rows = await listEmployees(admin, org.id);
    expect(rows.find((row) => row.id === withCompany.id)).toMatchObject({
      companyName: null,
      officeName: null,
    });
  });

  it("viser den som har sluttet bare med includeDeactivated, også uten innlogging", async () => {
    const { org, admin, adminEmployee } = await setup();
    const quitWithLogin = await createEmployee(await createUser(), org.id, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, quitWithLogin.id));
    const [quitWithoutLogin] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Tidligere Takstmann",
        deactivatedAt: new Date(),
      })
      .returning();

    const active = await listEmployees(admin, org.id);
    expect(active.map((row) => row.id)).toEqual([adminEmployee.id]);
    const explicitlyActive = await listEmployees(admin, org.id, { includeDeactivated: false });
    expect(explicitlyActive.map((row) => row.id)).toEqual([adminEmployee.id]);

    const all = await listEmployees(admin, org.id, { includeDeactivated: true });
    expect(all.map((row) => row.id).sort()).toEqual(
      [adminEmployee.id, quitWithLogin.id, quitWithoutLogin!.id].sort(),
    );
    expect(all.find((row) => row.id === quitWithoutLogin!.id)?.deactivatedAt).toBeInstanceOf(Date);
  });
});
