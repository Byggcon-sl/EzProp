import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { db } from "@/db/client";
import { companies, employees, type EmployeeRole } from "@/db/schema";
import {
  createCompany,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listCompanies } from "./index";

beforeEach(resetDatabase);

const roles: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

describe("listCompanies", () => {
  it("viser aldri selskaper fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createCompany(grantA.organizationId, { legalName: "Testselskap A AS" });
        const b = await createCompany(grantB.organizationId, { legalName: "Testselskap B AS" });
        return { a: [a.id], b: [b.id] };
      },
      query: listCompanies,
      idOf: (row) => row.id,
    });
  });

  it.each(roles)("rollen %s kan lese selskapene", async (role) => {
    const org = await createOrganization();
    const company = await createCompany(org.id);
    const person = await createUser();
    await createEmployee(person, org.id, [role]);

    const rows = await listCompanies(person, org.id);
    expect(rows.map((row) => row.id)).toEqual([company.id]);
  });

  it("ansatt uten roller får AccessDeniedError", async () => {
    const org = await createOrganization();
    await createCompany(org.id);
    const person = await createUser();
    await createEmployee(person, org.id, []);

    await expect(listCompanies(person, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("ansatt som har sluttet får AccessDeniedError", async () => {
    const org = await createOrganization();
    await createCompany(org.id);
    const person = await createUser();
    const employee = await createEmployee(person, org.id, ["inspector"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));

    await expect(listCompanies(person, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("viser ikke slettede selskaper", async () => {
    const org = await createOrganization();
    const kept = await createCompany(org.id, { legalName: "Testselskap A AS" });
    const removed = await createCompany(org.id, { legalName: "Testselskap B AS" });
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, removed.id));
    const person = await createUser();
    await createEmployee(person, org.id, ["admin"]);

    const rows = await listCompanies(person, org.id);
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it("sorterer på navn", async () => {
    const org = await createOrganization();
    await createCompany(org.id, { legalName: "Testselskap C AS" });
    await createCompany(org.id, { legalName: "Testselskap A AS" });
    await createCompany(org.id, { legalName: "Testselskap B AS" });
    const person = await createUser();
    await createEmployee(person, org.id, ["inspector"]);

    const rows = await listCompanies(person, org.id);
    expect(rows.map((row) => row.legalName)).toEqual([
      "Testselskap A AS",
      "Testselskap B AS",
      "Testselskap C AS",
    ]);
  });
});
