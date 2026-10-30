import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { db } from "@/db/client";
import { offices, type EmployeeRole } from "@/db/schema";
import {
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listOffices } from "./index";

beforeEach(resetDatabase);

const roles: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

describe("listOffices", () => {
  it("viser aldri kontorer fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createOffice(grantA.organizationId, { name: "Testkontor Nord" });
        const b = await createOffice(grantB.organizationId, { name: "Testkontor Nord" });
        return { a: [a.id], b: [b.id] };
      },
      query: listOffices,
      idOf: (row) => row.id,
    });
  });

  it("gir nøyaktig de lovede feltene, uten sporingsfelt", async () => {
    const org = await createOrganization();
    await createOffice(org.id, { name: "Testkontor Nord" });
    const person = await createUser();
    await createEmployee(person, org.id, ["admin"]);

    const rows = await listOffices(person, org.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["address", "id", "name", "sortOrder"]);
    }
  });

  it.each(roles)("rollen %s kan lese kontorene", async (role) => {
    const org = await createOrganization();
    const office = await createOffice(org.id);
    const person = await createUser();
    await createEmployee(person, org.id, [role]);

    const rows = await listOffices(person, org.id);
    expect(rows.map((row) => row.id)).toEqual([office.id]);
  });

  it("ansatt uten roller får AccessDeniedError", async () => {
    const org = await createOrganization();
    await createOffice(org.id);
    const person = await createUser();
    await createEmployee(person, org.id, []);

    await expect(listOffices(person, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("viser ikke slettede kontorer", async () => {
    const org = await createOrganization();
    const kept = await createOffice(org.id, { name: "Testkontor Nord" });
    const removed = await createOffice(org.id, { name: "Testkontor Sør" });
    await db.update(offices).set({ deletedAt: new Date() }).where(eq(offices.id, removed.id));
    const person = await createUser();
    await createEmployee(person, org.id, ["admin"]);

    const rows = await listOffices(person, org.id);
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it("sorterer på rekkefølge og så navn", async () => {
    const org = await createOrganization();
    await createOffice(org.id, { name: "Ckontor", sortOrder: 2 });
    await createOffice(org.id, { name: "Bkontor", sortOrder: 1 });
    await createOffice(org.id, { name: "Akontor", sortOrder: 1 });
    const person = await createUser();
    await createEmployee(person, org.id, ["inspector"]);

    const rows = await listOffices(person, org.id);
    expect(rows.map((row) => row.name)).toEqual(["Akontor", "Bkontor", "Ckontor"]);
  });
});
