import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, companies, employees, type EmployeeRole } from "@/db/schema";
import {
  auditRows,
  createCompany,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  createCompany as adminCreateCompany,
  listCompanies,
  updateCompany as adminUpdateCompany,
} from "./index";

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

  it("gir nøyaktig de lovede feltene, uten sporingsfelt", async () => {
    const org = await createOrganization();
    await createCompany(org.id);
    const admin = await createUser();
    await createEmployee(admin, org.id, ["admin"]);

    const rows = await listCompanies(admin, org.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "address",
        "city",
        "companyText",
        "id",
        "legalName",
        "liabilityInsurer",
        "liabilityPolicyNumber",
        "liabilityValidTo",
        "orgNumber",
        "postalCode",
        "vatRegistered",
      ]);
    }
  });
});

// Admin: opprette og endre selskaper.
// Testplan: docs/funksjoner/fase0b-admin-organisasjon-testplan.md, avsnitt 1. Testdata er oppdiktet.

type CompanyInput = Parameters<typeof adminCreateCompany>[2];
type CompanyUpdate = Parameters<typeof adminUpdateCompany>[3];

/** Alle feltene i selskapet, oppdiktede verdier. */
function companyInput(overrides: Record<string, unknown> = {}): CompanyInput {
  return {
    legalName: "Testselskap Nord AS",
    orgNumber: "000000001",
    vatRegistered: true,
    address: "Testveien 1",
    postalCode: "0001",
    city: "Testby",
    companyText: "Firmatekst for testselskapet.",
    liabilityInsurer: "Testforsikring",
    liabilityPolicyNumber: "TEST-0001",
    liabilityValidTo: "2027-06-30",
    ...overrides,
  } as CompanyInput;
}

function companyUpdate(overrides: Record<string, unknown> = {}): CompanyUpdate {
  return companyInput(overrides) as unknown as CompanyUpdate;
}

async function companyCount() {
  return (await db.select({ id: companies.id }).from(companies)).length;
}

async function companyRow(id: string) {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  if (!row) throw new Error("fant ikke selskapet");
  return row;
}

async function orgWithAdmin() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

const nonAdminRoles: EmployeeRole[] = ["inspector", "office", "manager"];

describe("createCompany og updateCompany (admin)", () => {
  it("1. createCompany lagrer alle feltene på organisasjonen fra tilgangssjekken", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await adminCreateCompany(admin, org.id, companyInput());

    const row = await companyRow(created.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      legalName: "Testselskap Nord AS",
      orgNumber: "000000001",
      vatRegistered: true,
      address: "Testveien 1",
      postalCode: "0001",
      city: "Testby",
      companyText: "Firmatekst for testselskapet.",
      liabilityInsurer: "Testforsikring",
      liabilityPolicyNumber: "TEST-0001",
      liabilityValidTo: "2027-06-30",
      deletedAt: null,
    });
  });

  it("2. updateCompany endrer alle feltene og øker row_version med 1", async () => {
    const { org, admin } = await orgWithAdmin();
    const company = await createCompany(org.id, { legalName: "Testselskap Gammel AS" });
    const before = await companyRow(company.id);

    await adminUpdateCompany(
      admin,
      org.id,
      company.id,
      companyUpdate({
        legalName: "Testselskap Ny AS",
        orgNumber: "000000002",
        vatRegistered: false,
        address: "Testgata 2",
        postalCode: "0002",
        city: "Testvik",
        companyText: "Ny firmatekst.",
        liabilityInsurer: "Testforsikring to",
        liabilityPolicyNumber: "TEST-0002",
        liabilityValidTo: "2028-01-31",
      }),
    );

    const after = await companyRow(company.id);
    expect(after).toMatchObject({
      organizationId: org.id,
      legalName: "Testselskap Ny AS",
      orgNumber: "000000002",
      vatRegistered: false,
      address: "Testgata 2",
      postalCode: "0002",
      city: "Testvik",
      companyText: "Ny firmatekst.",
      liabilityInsurer: "Testforsikring to",
      liabilityPolicyNumber: "TEST-0002",
      liabilityValidTo: "2028-01-31",
    });
    expect(after.rowVersion).toBe(before.rowVersion + 1);
  });

  describe("3. tilgang per rolle", () => {
    it.each(nonAdminRoles)("rollen %s får AccessDeniedError og ingen endring", async (role) => {
      const org = await createOrganization();
      const company = await createCompany(org.id);
      const person = await createUser();
      await createEmployee(person, org.id, [role]);
      const countBefore = await companyCount();
      const rowBefore = await companyRow(company.id);

      await expect(adminCreateCompany(person, org.id, companyInput())).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        adminUpdateCompany(person, org.id, company.id, companyUpdate({ legalName: "Endret AS" })),
      ).rejects.toThrow(AccessDeniedError);

      expect(await companyCount()).toBe(countBefore);
      expect(await companyRow(company.id)).toEqual(rowBefore);
      expect(await auditRows(org.id)).toHaveLength(0);
    });

    it("admin lykkes (positiv kontroll)", async () => {
      const { org, admin } = await orgWithAdmin();
      const created = await adminCreateCompany(admin, org.id, companyInput());
      await adminUpdateCompany(
        admin,
        org.id,
        created.id,
        companyUpdate({ legalName: "Endret AS" }),
      );
      expect((await companyRow(created.id)).legalName).toBe("Endret AS");
    });
  });

  describe("4. uten roller og sluttet admin", () => {
    it("ansatt uten roller får AccessDeniedError", async () => {
      const org = await createOrganization();
      const company = await createCompany(org.id);
      const person = await createUser();
      await createEmployee(person, org.id, []);

      await expect(adminCreateCompany(person, org.id, companyInput())).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(adminUpdateCompany(person, org.id, company.id, companyUpdate())).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await companyCount()).toBe(1);
    });

    it("admin som har sluttet får AccessDeniedError", async () => {
      const { org, admin, adminEmployee } = await orgWithAdmin();
      const company = await createCompany(org.id);
      await db
        .update(employees)
        .set({ deactivatedAt: new Date() })
        .where(eq(employees.id, adminEmployee.id));

      await expect(adminCreateCompany(admin, org.id, companyInput())).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(adminUpdateCompany(admin, org.id, company.id, companyUpdate())).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await companyCount()).toBe(1);
    });
  });

  it("5. tenant-isolasjon: createCompany legger raden i egen organisasjon", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor: Actor, organizationId: string) => {
        const row = await adminCreateCompany(
          actor,
          organizationId,
          companyInput({ legalName: `Testselskap ${actor.id} AS`, orgNumber: null }),
        );
        // Leser raden fra databasen, så det er den lagrede organisasjonen som sammenlignes
        return [await companyRow(row.id)];
      },
      idOf: (row) => row.organizationId,
    });
    const inB = await db.select().from(companies).where(eq(companies.organizationId, orgB));
    expect(inB).toHaveLength(1);
  });

  it("6. tenant-isolasjon: updateCompany endrer bare raden i egen organisasjon", async () => {
    const companyByOrg = new Map<string, string>();
    const actorByOrg = new Map<string, Actor>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await createCompany(grantA.organizationId, { legalName: "Testselskap A AS" });
        const b = await createCompany(grantB.organizationId, { legalName: "Testselskap B AS" });
        companyByOrg.set(grantA.organizationId, a.id);
        companyByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor: Actor, organizationId: string) => {
        const companyId = companyByOrg.get(organizationId) ?? randomUUID();
        await adminUpdateCompany(
          actor,
          organizationId,
          companyId,
          companyUpdate({ legalName: `Endret av ${actor.id}`, orgNumber: null }),
        );
        actorByOrg.set(organizationId, actor);
        return [await companyRow(companyId)];
      },
      idOf: (row) => row.id,
    });
    const rowB = await companyRow(companyByOrg.get(orgB)!);
    expect(rowB.legalName).toBe(`Endret av ${actorByOrg.get(orgB)!.id}`);
    expect(rowB.rowVersion).toBe(2);
  });

  describe("7. fremmed, ugyldig og ukjent id (regel 2)", () => {
    it.each([
      ["id fra en annen organisasjon", "foreign"],
      ["id som ikke er uuid", "ikke-en-id"],
      ["tilfeldig uuid", "random"],
    ])("%s gir AccessDeniedError, og B-raden er uendret", async (_label, kind) => {
      const { org: orgA, admin: adminA } = await orgWithAdmin();
      const orgB = await createOrganization("Organisasjon B");
      const companyB = await createCompany(orgB.id, { legalName: "Testselskap B AS" });
      const before = await companyRow(companyB.id);
      const id = kind === "foreign" ? companyB.id : kind === "random" ? randomUUID() : kind;

      await expect(
        adminUpdateCompany(adminA, orgA.id, id, companyUpdate({ legalName: "Kapret AS" })),
      ).rejects.toThrow(AccessDeniedError);

      const after = await companyRow(companyB.id);
      expect(after).toEqual(before);
      expect(after.rowVersion).toBe(1);
      expect(await db.select().from(auditLog)).toHaveLength(0);
    });
  });

  it("8. slettet selskap kan ikke endres", async () => {
    const { org, admin } = await orgWithAdmin();
    const company = await createCompany(org.id, { deletedAt: new Date() });
    const before = await companyRow(company.id);

    await expect(
      adminUpdateCompany(admin, org.id, company.id, companyUpdate({ legalName: "Endret AS" })),
    ).rejects.toThrow(AccessDeniedError);
    expect(await companyRow(company.id)).toEqual(before);
  });

  it("9. revisjonslogg: én rad for create og én for update, på riktig organisasjon", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const created = await adminCreateCompany(admin, org.id, companyInput());
    await adminUpdateCompany(admin, org.id, created.id, companyUpdate({ city: "Testvik" }));

    const rows = await auditRows(org.id);
    expect(rows.map((row) => row.action).sort()).toEqual(["create", "update"]);
    for (const row of rows) {
      expect(row.organizationId).toBe(org.id);
      expect(row.entityId).toBe(created.id);
      expect(row.entityType).toMatch(/compan/);
      expect(row.actorEmployeeId).toBe(adminEmployee.id);
    }
  });

  describe("10. validering (Zod), regeltester som data", () => {
    it.each([
      ["org.nr. med 8 siffer", { orgNumber: "12345678" }],
      ["org.nr. med 10 siffer", { orgNumber: "1234567890" }],
      ["org.nr. med bokstav", { orgNumber: "12345678A" }],
      ["org.nr. med mellomrom", { orgNumber: "123 456 789" }],
      ["tomt juridisk navn", { legalName: "" }],
      ["juridisk navn med bare mellomrom", { legalName: "   " }],
      ["«Gyldig til» med måned 13", { liabilityValidTo: "31.13.2026" }],
      ["«Gyldig til» som ikke er en dato", { liabilityValidTo: "ikke-dato" }],
    ])("%s avvises med ZodError, uten rad og uten loggrad", async (_label, overrides) => {
      const { org, admin } = await orgWithAdmin();
      await expect(adminCreateCompany(admin, org.id, companyInput(overrides))).rejects.toThrow(
        ZodError,
      );
      expect(await companyCount()).toBe(0);
      expect(await auditRows(org.id)).toHaveLength(0);
    });

    it.each([
      ["org.nr. null", { orgNumber: null }, null],
      ["tomt org.nr.", { orgNumber: "" }, null],
      ["org.nr. 000000001", { orgNumber: "000000001" }, "000000001"],
    ])("%s godtas", async (_label, overrides, expected) => {
      const { org, admin } = await orgWithAdmin();
      const created = await adminCreateCompany(admin, org.id, companyInput(overrides));
      expect((await companyRow(created.id)).orgNumber).toBe(expected);
    });

    it("«Gyldig til» 2027-06-30 godtas", async () => {
      const { org, admin } = await orgWithAdmin();
      const created = await adminCreateCompany(
        admin,
        org.id,
        companyInput({ liabilityValidTo: "2027-06-30" }),
      );
      expect((await companyRow(created.id)).liabilityValidTo).toBe("2027-06-30");
    });

    it("ugyldig verdi i updateCompany avvises også, og raden er uendret", async () => {
      const { org, admin } = await orgWithAdmin();
      const company = await createCompany(org.id);
      const before = await companyRow(company.id);
      await expect(
        adminUpdateCompany(admin, org.id, company.id, companyUpdate({ orgNumber: "12345678" })),
      ).rejects.toThrow(ZodError);
      expect(await companyRow(company.id)).toEqual(before);
      expect(await auditRows(org.id)).toHaveLength(0);
    });
  });
});
