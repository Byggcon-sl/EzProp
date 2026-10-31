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

// Testplan: docs/funksjoner/fase0b-admin-organisasjon-testplan.md, avsnitt 1.
// Testdata er oppdiktet (org.nr. 000000001–000000009, polise TEST-0001, «Testforsikring»).

/** Alle feltene i skjemaet, med oppdiktede verdier. */
const fullCompany = {
  legalName: "Testselskap Nord AS",
  orgNumber: "000000001",
  vatRegistered: false,
  address: "Testveien 1",
  postalCode: "0001",
  city: "Teststed",
  companyText: "Oppdiktet firmatekst til testene.",
  liabilityInsurer: "Testforsikring",
  liabilityPolicyNumber: "TEST-0001",
  liabilityValidTo: "2027-06-30",
};

const changedCompany = {
  legalName: "Testselskap Sør AS",
  orgNumber: "000000002",
  vatRegistered: true,
  address: "Testgata 2",
  postalCode: "0002",
  city: "Testby",
  companyText: "Endret oppdiktet firmatekst.",
  liabilityInsurer: "Testforsikring Ny",
  liabilityPolicyNumber: "TEST-0002",
  liabilityValidTo: "2028-01-31",
};

async function adminIn(organizationId: string) {
  const admin = await createUser({ name: "Admin Testesen" });
  const employee = await createEmployee(admin, organizationId, ["admin"]);
  return { admin, employee };
}

async function countCompanies() {
  return (await db.select({ id: companies.id }).from(companies)).length;
}

async function countAudit() {
  return (await db.select({ id: auditLog.id }).from(auditLog)).length;
}

async function companyRow(id: string) {
  const [row] = await db.select().from(companies).where(eq(companies.id, id));
  if (!row) throw new Error("fant ikke selskapet");
  return row;
}

/** Fanger feilen fra et kall som skal feile. */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("createCompany og updateCompany", () => {
  it("createCompany lagrer alle feltene i organisasjonen fra tilgangssjekken", async () => {
    const org = await createOrganization();
    const { admin } = await adminIn(org.id);

    const created = await adminCreateCompany(admin, org.id, fullCompany);

    expect(created).toMatchObject({ ...fullCompany, organizationId: org.id, rowVersion: 1 });
    expect(await companyRow(created.id)).toMatchObject({ ...fullCompany, organizationId: org.id });
  });

  it("updateCompany endrer alle feltene og øker row_version med 1", async () => {
    const org = await createOrganization();
    const { admin } = await adminIn(org.id);
    const created = await adminCreateCompany(admin, org.id, fullCompany);

    const updated = await adminUpdateCompany(admin, org.id, created.id, changedCompany);

    expect(updated).toMatchObject({ ...changedCompany, id: created.id, rowVersion: 2 });
    expect(await companyRow(created.id)).toMatchObject({ ...changedCompany, rowVersion: 2 });
  });

  it.each(["inspector", "office", "manager"] as const)(
    "rollen %s får AccessDeniedError, og ingenting skrives",
    async (role) => {
      const org = await createOrganization();
      const existing = await createCompany(org.id, { legalName: "Testselskap A AS" });
      const person = await createUser();
      await createEmployee(person, org.id, [role]);
      const companiesBefore = await countCompanies();
      const auditBefore = await countAudit();

      await expect(adminCreateCompany(person, org.id, fullCompany)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(adminUpdateCompany(person, org.id, existing.id, changedCompany)).rejects.toThrow(
        AccessDeniedError,
      );

      expect(await countCompanies()).toBe(companiesBefore);
      expect(await countAudit()).toBe(auditBefore);
      expect((await companyRow(existing.id)).rowVersion).toBe(1);
    },
  );

  it("admin lykkes (positiv kontroll for rolletesten)", async () => {
    const org = await createOrganization();
    const { admin } = await adminIn(org.id);
    const created = await adminCreateCompany(admin, org.id, fullCompany);
    await adminUpdateCompany(admin, org.id, created.id, changedCompany);
    expect(await countCompanies()).toBe(1);
  });

  it.each([
    ["ansatt uten roller", "none"],
    ["admin som har sluttet", "deactivated"],
  ] as const)("%s får AccessDeniedError", async (_label, variant) => {
    const org = await createOrganization();
    const existing = await createCompany(org.id);
    const person = await createUser();
    const employee = await createEmployee(person, org.id, variant === "none" ? [] : ["admin"]);
    if (variant === "deactivated") {
      await db
        .update(employees)
        .set({ deactivatedAt: new Date() })
        .where(eq(employees.id, employee.id));
    }

    await expect(adminCreateCompany(person, org.id, fullCompany)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(adminUpdateCompany(person, org.id, existing.id, changedCompany)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await countCompanies()).toBe(1);
    expect(await countAudit()).toBe(0);
  });

  it("createCompany: raden havner i egen organisasjon, og kall mot den andre avvises", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor: Actor, organizationId: string) => [
        await adminCreateCompany(actor, organizationId, {
          legalName: `Testselskap laget av ${actor.id}`,
        }),
      ],
      idOf: (row) => row.organizationId,
    });

    const rowsInB = await db.select().from(companies).where(eq(companies.organizationId, orgB));
    expect(rowsInB).toHaveLength(1);
  });

  it("updateCompany: endrer bare raden i egen organisasjon", async () => {
    const companyByOrg = new Map<string, string>();
    const callerByOrg = new Map<string, string>();
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
        const row = await adminUpdateCompany(
          actor,
          organizationId,
          companyByOrg.get(organizationId) ?? randomUUID(),
          { legalName: `Endret av ${actor.id}` },
        );
        callerByOrg.set(organizationId, actor.id);
        return [row];
      },
      idOf: (row) => row.id,
    });

    const rowB = await companyRow(companyByOrg.get(orgB) ?? "");
    expect(rowB.legalName).toBe(`Endret av ${callerByOrg.get(orgB)}`);
    expect(rowB.rowVersion).toBe(2);
  });

  it.each([
    ["id fra en annen organisasjon", "foreign"],
    ["id som ikke er uuid", "invalid"],
    ["tilfeldig uuid", "random"],
  ] as const)("updateCompany med %s gir AccessDeniedError (regel 2)", async (_label, kind) => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { admin: adminA } = await adminIn(orgA.id);
    const companyB = await createCompany(orgB.id, { legalName: "Testselskap B AS" });
    const id = kind === "foreign" ? companyB.id : kind === "invalid" ? "ikke-en-id" : randomUUID();

    await expect(adminUpdateCompany(adminA, orgA.id, id, changedCompany)).rejects.toThrow(
      AccessDeniedError,
    );

    const after = await companyRow(companyB.id);
    expect(after.rowVersion).toBe(1);
    expect(after.legalName).toBe("Testselskap B AS");
    expect(await countAudit()).toBe(0);
  });

  it("slettet selskap kan ikke endres", async () => {
    const org = await createOrganization();
    const { admin } = await adminIn(org.id);
    const removed = await createCompany(org.id, { deletedAt: new Date() });

    await expect(adminUpdateCompany(admin, org.id, removed.id, changedCompany)).rejects.toThrow(
      AccessDeniedError,
    );
    expect((await companyRow(removed.id)).rowVersion).toBe(1);
    expect(await countAudit()).toBe(0);
  });

  it("create og update gir én loggrad hver for selskapet", async () => {
    const org = await createOrganization();
    const { admin, employee } = await adminIn(org.id);

    const created = await adminCreateCompany(admin, org.id, fullCompany);
    await adminUpdateCompany(admin, org.id, created.id, changedCompany);

    const rows = await auditRows(org.id);
    expect(rows.map((row) => row.action).sort()).toEqual(["create", "update"]);
    for (const row of rows) {
      expect(row).toMatchObject({
        entityType: "company",
        entityId: created.id,
        organizationId: org.id,
        actorEmployeeId: employee.id,
      });
    }
  });

  describe("validering (regeltester som data)", () => {
    it.each([
      ["org.nr. med 8 siffer", { orgNumber: "12345678" }],
      ["org.nr. med 10 siffer", { orgNumber: "1234567890" }],
      ["org.nr. med bokstav", { orgNumber: "12345678A" }],
      ["org.nr. med mellomrom", { orgNumber: "123 456 789" }],
      ["tomt juridisk navn", { legalName: "" }],
      ["juridisk navn med bare mellomrom", { legalName: "   " }],
      ["gyldig til med måned 13", { liabilityValidTo: "31.13.2026" }],
      ["gyldig til som ikke er en dato", { liabilityValidTo: "ikke-dato" }],
    ])("avviser %s uten rad og uten loggrad", async (_label, override) => {
      const org = await createOrganization();
      const { admin } = await adminIn(org.id);

      const error = await caught(
        adminCreateCompany(admin, org.id, { legalName: "Testselskap A AS", ...override }),
      );

      expect(error).toBeInstanceOf(ZodError);
      expect(await countCompanies()).toBe(0);
      expect(await countAudit()).toBe(0);
    });

    it.each([
      ["org.nr. tomt (null)", { orgNumber: null }, { orgNumber: null }],
      ["org.nr. tom tekst", { orgNumber: "" }, { orgNumber: null }],
      ["org.nr. med 9 siffer", { orgNumber: "000000001" }, { orgNumber: "000000001" }],
      [
        "gyldig til som dato (ÅÅÅÅ-MM-DD)",
        { liabilityValidTo: "2027-06-30" },
        { liabilityValidTo: "2027-06-30" },
      ],
    ])("godtar %s", async (_label, override, expected) => {
      const org = await createOrganization();
      const { admin } = await adminIn(org.id);

      const created = await adminCreateCompany(admin, org.id, {
        legalName: "Testselskap A AS",
        ...override,
      });

      expect(await companyRow(created.id)).toMatchObject(expected);
    });

    it("updateCompany avviser ugyldig org.nr. og lar raden stå", async () => {
      const org = await createOrganization();
      const { admin } = await adminIn(org.id);
      const created = await adminCreateCompany(admin, org.id, fullCompany);

      const error = await caught(
        adminUpdateCompany(admin, org.id, created.id, { ...fullCompany, orgNumber: "12345678" }),
      );

      expect(error).toBeInstanceOf(ZodError);
      expect(await companyRow(created.id)).toMatchObject({ orgNumber: "000000001", rowVersion: 1 });
      expect(await countAudit()).toBe(1);
    });
  });
});
