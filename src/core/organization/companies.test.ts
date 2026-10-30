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

// Testplan docs/funksjoner/fase0b-organisasjon-selskap-kontor-testplan.md avsnitt 1.
// Oppdiktede data: «Testselskap A AS», org.nr. 000000001, «Testforsikring».

beforeEach(resetDatabase);

const ROLES: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

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

  it.each(ROLES)("rollen %s kan lese selskapene", async (role) => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, [role]);
    const company = await createCompany(org.id, {
      legalName: "Testselskap A AS",
      orgNumber: "000000001",
      liabilityInsurer: "Testforsikring",
    });

    const rows = await listCompanies(user, org.id);
    expect(rows.map((row) => row.id)).toEqual([company.id]);
  });

  it("en ansatt uten roller får AccessDeniedError", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, []);
    await createCompany(org.id, { legalName: "Testselskap A AS" });

    await expect(listCompanies(user, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("en ansatt som har sluttet får AccessDeniedError", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["admin"]);
    await createCompany(org.id, { legalName: "Testselskap A AS" });
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));

    await expect(listCompanies(user, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("viser ikke slettede selskaper", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, ["inspector"]);
    const kept = await createCompany(org.id, { legalName: "Testselskap A AS" });
    const removed = await createCompany(org.id, { legalName: "Testselskap B AS" });
    await db.update(companies).set({ deletedAt: new Date() }).where(eq(companies.id, removed.id));

    const rows = await listCompanies(user, org.id);
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it("sorterer på navn", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, ["inspector"]);
    for (const legalName of ["Testselskap C AS", "Testselskap A AS", "Testselskap B AS"]) {
      await createCompany(org.id, { legalName });
    }

    const rows = await listCompanies(user, org.id);
    expect(rows.map((row) => row.legalName)).toEqual([
      "Testselskap A AS",
      "Testselskap B AS",
      "Testselskap C AS",
    ]);
  });
});
