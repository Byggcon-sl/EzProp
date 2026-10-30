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

// Testplan docs/funksjoner/fase0b-organisasjon-selskap-kontor-testplan.md avsnitt 1.

beforeEach(resetDatabase);

const ROLES: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

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

  it.each(ROLES)("rollen %s kan lese kontorene", async (role) => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, [role]);
    const office = await createOffice(org.id, { name: "Testkontor Nord" });

    const rows = await listOffices(user, org.id);
    expect(rows.map((row) => row.id)).toEqual([office.id]);
  });

  it("en ansatt uten roller får AccessDeniedError", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, []);
    await createOffice(org.id, { name: "Testkontor Nord" });

    await expect(listOffices(user, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("viser ikke slettede kontorer", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, ["inspector"]);
    const kept = await createOffice(org.id, { name: "Testkontor Nord" });
    const removed = await createOffice(org.id, { name: "Testkontor Sør" });
    await db.update(offices).set({ deletedAt: new Date() }).where(eq(offices.id, removed.id));

    const rows = await listOffices(user, org.id);
    expect(rows.map((row) => row.id)).toEqual([kept.id]);
  });

  it("sorterer på sort_order, så navn", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, ["inspector"]);
    await createOffice(org.id, { name: "Ckontor", sortOrder: 2 });
    await createOffice(org.id, { name: "Bkontor", sortOrder: 1 });
    await createOffice(org.id, { name: "Akontor", sortOrder: 1 });

    const rows = await listOffices(user, org.id);
    expect(rows.map((row) => row.name)).toEqual(["Akontor", "Bkontor", "Ckontor"]);
  });
});
