import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employeeRoleAssignments, users, type EmployeeRole } from "@/db/schema";
import {
  createCompany as insertCompany,
  createEmployee as insertEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  createCompany,
  createEmployee,
  createOffice,
  deactivateEmployee,
  findAdminOrganizationId,
  getEmployeeForAdmin,
  listEmployeesForAdmin,
  setEmployeeRoles,
  updateCompany,
} from "./index";

/*
 * Røyktest for kjernen i adminområdet (utviklerens egen). De fulle testene står i
 * companies.test.ts, offices.test.ts og employees-admin.test.ts.
 */

beforeEach(resetDatabase);

async function adminInNewOrganization() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Admin Testesen" });
  const employee = await insertEmployee(admin, org.id, ["admin"]);
  return { org, admin, employee };
}

describe("selskap og kontor", () => {
  it("oppretter og endrer et selskap, og tom tekst blir null", async () => {
    const { org, admin } = await adminInNewOrganization();
    const created = await createCompany(admin, org.id, {
      legalName: "  Oppdiktet Takst AS ",
      orgNumber: "000000001",
      city: "",
      liabilityValidTo: "2027-06-30",
    });
    expect(created).toMatchObject({
      legalName: "Oppdiktet Takst AS",
      orgNumber: "000000001",
      city: null,
      liabilityValidTo: "2027-06-30",
      rowVersion: 1,
    });
    const updated = await updateCompany(admin, org.id, created.id, {
      legalName: "Oppdiktet Takst AS",
      liabilityPolicyNumber: "TEST-1",
    });
    expect(updated.rowVersion).toBe(2);
    await expect(updateCompany(admin, org.id, "ikke-en-id", { legalName: "X" })).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it.each([["12345678"], ["1234567890"], ["12345678A"], ["123 456 789"]])(
    "org.nr. %s avvises med ZodError",
    async (orgNumber) => {
      const { org, admin } = await adminInNewOrganization();
      await expect(createCompany(admin, org.id, { legalName: "X", orgNumber })).rejects.toThrow(
        ZodError,
      );
    },
  );

  it("gir norsk feil ved samme kontornavn og samme org.nr.", async () => {
    const { org, admin } = await adminInNewOrganization();
    await createOffice(admin, org.id, { name: "Testkontor Sør" });
    await expect(createOffice(admin, org.id, { name: "Testkontor Sør" })).rejects.toThrow(
      "Det finnes alt et kontor med dette navnet",
    );
    await createCompany(admin, org.id, { legalName: "A", orgNumber: "000000002" });
    await expect(
      createCompany(admin, org.id, { legalName: "B", orgNumber: "000000002" }),
    ).rejects.toThrow("Det finnes alt et selskap med dette org.nr.");
  });
});

describe("ansatte", () => {
  it("viser aldri ansatte fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await insertEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        return { a: [a.id], b: [b.id] };
      },
      query: listEmployeesForAdmin,
      idOf: (row) => row.id,
    });
  });

  it("kobler ny ansatt til eksisterende innlogging uten å endre navnet", async () => {
    const { org, admin } = await adminInNewOrganization();
    const existing = await createUser({ name: "Ola Innlogging", email: "ola@eksempel.no" });
    const company = await insertCompany(org.id);

    const row = await createEmployee(admin, org.id, {
      name: "Ola Skjema",
      email: "  Ola@Eksempel.NO ",
      companyId: company.id,
      roles: ["inspector"],
    });
    expect(row.userId).toBe(existing.id);
    const [user] = await db.select().from(users).where(eq(users.id, existing.id));
    expect(user?.name).toBe("Ola Innlogging");

    const view = await getEmployeeForAdmin(admin, org.id, row.id);
    expect(Object.keys(view).sort()).toEqual(
      [
        "companyId",
        "companyName",
        "deactivatedAt",
        "email",
        "id",
        "jobTitle",
        "name",
        "officeId",
        "officeName",
        "permissions",
        "roles",
      ].sort(),
    );
    expect(view).toMatchObject({ email: "ola@eksempel.no", roles: ["inspector"] });

    await expect(
      createEmployee(admin, org.id, { name: "Ola", email: "ola@eksempel.no" }),
    ).rejects.toThrow("Det finnes alt en ansatt med denne e-posten");

    const [event] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, row.id), eq(auditLog.action, "create")));
    const changes = JSON.stringify(event?.changes);
    expect(changes).not.toContain("Ola");
    expect(changes.toLowerCase()).not.toContain("ola@eksempel.no");
  });

  it("avviser selskap fra en annen organisasjon", async () => {
    const { org, admin } = await adminInNewOrganization();
    const other = await createOrganization("Annen");
    const foreign = await insertCompany(other.id);
    await expect(
      createEmployee(admin, org.id, {
        name: "Kari",
        email: "kari@eksempel.no",
        companyId: foreign.id,
      }),
    ).rejects.toThrow(AccessDeniedError);
  });

  it("tar bort og gir en rolle på nytt med myk sletting", async () => {
    const { org, admin } = await adminInNewOrganization();
    const person = await insertEmployee(await createUser(), org.id, ["inspector"]);
    await setEmployeeRoles(admin, org.id, person.id, []);
    await setEmployeeRoles(admin, org.id, person.id, ["inspector"]);
    expect(await setEmployeeRoles(admin, org.id, person.id, ["inspector"])).toEqual(["inspector"]);

    const rows = await db
      .select()
      .from(employeeRoleAssignments)
      .where(eq(employeeRoleAssignments.employeeId, person.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(1);
    await expect(
      setEmployeeRoles(admin, org.id, person.id, ["superadmin" as EmployeeRole]),
    ).rejects.toThrow(ZodError);
  });

  it("finner organisasjonen der personen er admin", async () => {
    const { org, admin } = await adminInNewOrganization();
    const inspector = await createUser();
    await insertEmployee(inspector, org.id, ["inspector"]);
    expect(await findAdminOrganizationId(admin)).toBe(org.id);
    expect(await findAdminOrganizationId(inspector)).toBeNull();
  });
});

// Admin stenges aldri ute (A25, CLAUDE.md regel 11). Disse testene skal aldri fjernes.
describe("minst én admin", () => {
  it("siste admin kan ikke miste rollen eller markeres som sluttet, og ingen loggrad skrives", async () => {
    const { org, admin, employee } = await adminInNewOrganization();
    const before = await db.select().from(auditLog);

    await expect(setEmployeeRoles(admin, org.id, employee.id, [])).rejects.toThrow(
      "Organisasjonen må ha minst én admin.",
    );
    await expect(deactivateEmployee(admin, org.id, employee.id)).rejects.toThrow(
      "Organisasjonen må ha minst én admin.",
    );
    expect(await db.select().from(auditLog)).toHaveLength(before.length);
    await expect(
      requireOrganizationAccess(admin, org.id, "organization.manage"),
    ).resolves.toBeDefined();
  });

  it("to admin som fjerner hverandre samtidig: nøyaktig ett kall lykkes", async () => {
    for (let round = 0; round < 3; round += 1) {
      await resetDatabase();
      const { org, admin: adminA, employee: employeeA } = await adminInNewOrganization();
      const adminB = await createUser({ name: "Admin B" });
      const employeeB = await insertEmployee(adminB, org.id, ["admin"]);

      const results = await Promise.allSettled([
        setEmployeeRoles(adminA, org.id, employeeB.id, ["inspector"]),
        deactivateEmployee(adminB, org.id, employeeA.id),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected?.reason).toHaveProperty("message", "Organisasjonen må ha minst én admin.");

      const activeAdmins = await db
        .select()
        .from(employeeRoleAssignments)
        .where(
          and(
            eq(employeeRoleAssignments.organizationId, org.id),
            eq(employeeRoleAssignments.role, "admin"),
            isNull(employeeRoleAssignments.deletedAt),
          ),
        );
      expect(activeAdmins.length).toBeGreaterThanOrEqual(1);
    }
  });
});
