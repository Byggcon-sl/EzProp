import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employees, offices, type EmployeeRole } from "@/db/schema";
import {
  auditRows,
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  createOffice as adminCreateOffice,
  listOffices,
  updateOffice as adminUpdateOffice,
} from "./index";

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

  it("gir nøyaktig de lovede feltene, uten sporingsfelt", async () => {
    const org = await createOrganization();
    await createOffice(org.id);
    const admin = await createUser();
    await createEmployee(admin, org.id, ["admin"]);

    const rows = await listOffices(admin, org.id);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(["address", "id", "name", "sortOrder"]);
    }
  });
});

// Testplan: docs/funksjoner/fase0b-admin-organisasjon-testplan.md, avsnitt 2. Oppdiktede data.

const fullOffice = { name: "Testkontor Vest", address: "Testveien 3, 0003 Teststed", sortOrder: 3 };
const changedOffice = { name: "Testkontor Øst", address: "Testgata 4, 0004 Testby", sortOrder: 5 };

async function adminIn(organizationId: string) {
  const admin = await createUser({ name: "Admin Testesen" });
  const employee = await createEmployee(admin, organizationId, ["admin"]);
  return { admin, employee };
}

async function countOffices() {
  return (await db.select({ id: offices.id }).from(offices)).length;
}

async function countAudit() {
  return (await db.select({ id: auditLog.id }).from(auditLog)).length;
}

async function officeRow(id: string) {
  const [row] = await db.select().from(offices).where(eq(offices.id, id));
  if (!row) throw new Error("fant ikke kontoret");
  return row;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("createOffice og updateOffice", () => {
  it("lagrer navn, adresse og rekkefølge, og updateOffice øker row_version", async () => {
    const org = await createOrganization();
    const { admin } = await adminIn(org.id);

    const created = await adminCreateOffice(admin, org.id, fullOffice);
    expect(created).toMatchObject({ ...fullOffice, organizationId: org.id, rowVersion: 1 });

    const updated = await adminUpdateOffice(admin, org.id, created.id, changedOffice);
    expect(updated).toMatchObject({ ...changedOffice, id: created.id, rowVersion: 2 });
    expect(await officeRow(created.id)).toMatchObject({ ...changedOffice, rowVersion: 2 });
  });

  it.each(["inspector", "office", "manager"] as const)(
    "rollen %s får AccessDeniedError, og ingenting skrives",
    async (role) => {
      const org = await createOrganization();
      const existing = await createOffice(org.id);
      const person = await createUser();
      await createEmployee(person, org.id, [role]);

      await expect(adminCreateOffice(person, org.id, fullOffice)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(adminUpdateOffice(person, org.id, existing.id, changedOffice)).rejects.toThrow(
        AccessDeniedError,
      );

      expect(await countOffices()).toBe(1);
      expect(await countAudit()).toBe(0);
      expect((await officeRow(existing.id)).rowVersion).toBe(1);
    },
  );

  it("admin lykkes (positiv kontroll for rolletesten)", async () => {
    const org = await createOrganization();
    const { admin } = await adminIn(org.id);
    const created = await adminCreateOffice(admin, org.id, fullOffice);
    await adminUpdateOffice(admin, org.id, created.id, changedOffice);
    expect(await countOffices()).toBe(1);
  });

  it.each([
    ["ansatt uten roller", "none"],
    ["admin som har sluttet", "deactivated"],
  ] as const)("%s får AccessDeniedError", async (_label, variant) => {
    const org = await createOrganization();
    const existing = await createOffice(org.id);
    const person = await createUser();
    const employee = await createEmployee(person, org.id, variant === "none" ? [] : ["admin"]);
    if (variant === "deactivated") {
      await db
        .update(employees)
        .set({ deactivatedAt: new Date() })
        .where(eq(employees.id, employee.id));
    }

    await expect(adminCreateOffice(person, org.id, fullOffice)).rejects.toThrow(AccessDeniedError);
    await expect(adminUpdateOffice(person, org.id, existing.id, changedOffice)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await countOffices()).toBe(1);
    expect(await countAudit()).toBe(0);
  });

  it("createOffice: raden havner i egen organisasjon, og kall mot den andre avvises", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor: Actor, organizationId: string) => [
        await adminCreateOffice(actor, organizationId, { name: `Testkontor ${actor.id}` }),
      ],
      idOf: (row) => row.organizationId,
    });

    const rowsInB = await db.select().from(offices).where(eq(offices.organizationId, orgB));
    expect(rowsInB).toHaveLength(1);
  });

  it("updateOffice: endrer bare raden i egen organisasjon", async () => {
    const officeByOrg = new Map<string, string>();
    const callerByOrg = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await createOffice(grantA.organizationId, { name: "Testkontor Nord" });
        const b = await createOffice(grantB.organizationId, { name: "Testkontor Nord" });
        officeByOrg.set(grantA.organizationId, a.id);
        officeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor: Actor, organizationId: string) => {
        const row = await adminUpdateOffice(
          actor,
          organizationId,
          officeByOrg.get(organizationId) ?? randomUUID(),
          { name: `Endret av ${actor.id}` },
        );
        callerByOrg.set(organizationId, actor.id);
        return [row];
      },
      idOf: (row) => row.id,
    });

    const rowB = await officeRow(officeByOrg.get(orgB) ?? "");
    expect(rowB.name).toBe(`Endret av ${callerByOrg.get(orgB)}`);
    expect(rowB.rowVersion).toBe(2);
  });

  it.each([
    ["id fra en annen organisasjon", "foreign"],
    ["id som ikke er uuid", "invalid"],
    ["tilfeldig uuid", "random"],
    ["slettet kontor i egen organisasjon", "deleted"],
  ] as const)("updateOffice med %s gir AccessDeniedError", async (_label, kind) => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { admin: adminA } = await adminIn(orgA.id);
    const officeB = await createOffice(orgB.id, { name: "Testkontor B" });
    const deletedA = await createOffice(orgA.id, { name: "Testkontor A", deletedAt: new Date() });
    const id = {
      foreign: officeB.id,
      invalid: "ikke-en-id",
      random: randomUUID(),
      deleted: deletedA.id,
    }[kind];

    await expect(adminUpdateOffice(adminA, orgA.id, id, changedOffice)).rejects.toThrow(
      AccessDeniedError,
    );

    expect(await officeRow(officeB.id)).toMatchObject({ name: "Testkontor B", rowVersion: 1 });
    expect(await officeRow(deletedA.id)).toMatchObject({ name: "Testkontor A", rowVersion: 1 });
    expect(await countAudit()).toBe(0);
  });

  it("samme navn som et aktivt kontor i egen organisasjon gir en feil, ikke en databasefeil", async () => {
    const org = await createOrganization();
    const { admin } = await adminIn(org.id);
    await adminCreateOffice(admin, org.id, { name: "Testkontor Vest" });
    const other = await adminCreateOffice(admin, org.id, { name: "Testkontor Øst" });

    const onCreate = await caught(adminCreateOffice(admin, org.id, { name: "Testkontor Vest" }));
    const onUpdate = await caught(
      adminUpdateOffice(admin, org.id, other.id, { name: "Testkontor Vest" }),
    );

    for (const error of [onCreate, onUpdate]) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/kontor/i);
      expect((error as Error).message).not.toMatch(/duplicate|insert|update|offices_/i);
    }
    expect(await countOffices()).toBe(2);
    expect((await officeRow(other.id)).name).toBe("Testkontor Øst");
  });

  it("samme navn i en annen organisasjon er lov", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { admin: adminA } = await adminIn(orgA.id);
    await createOffice(orgB.id, { name: "Testkontor Vest" });

    const created = await adminCreateOffice(adminA, orgA.id, { name: "Testkontor Vest" });
    expect(created.organizationId).toBe(orgA.id);
  });

  it("create og update gir én loggrad hver for kontoret", async () => {
    const org = await createOrganization();
    const { admin, employee } = await adminIn(org.id);

    const created = await adminCreateOffice(admin, org.id, fullOffice);
    await adminUpdateOffice(admin, org.id, created.id, changedOffice);

    const rows = await auditRows(org.id);
    expect(rows.map((row) => row.action).sort()).toEqual(["create", "update"]);
    for (const row of rows) {
      expect(row).toMatchObject({
        entityType: "office",
        entityId: created.id,
        organizationId: org.id,
        actorEmployeeId: employee.id,
      });
    }
  });

  it.each([
    ["tomt navn", { name: "" }],
    ["navn med bare mellomrom", { name: "   " }],
    ["rekkefølge som ikke er et heltall", { name: "Testkontor Vest", sortOrder: 1.5 }],
    ["rekkefølge som tekst", { name: "Testkontor Vest", sortOrder: "første" as unknown as number }],
  ])("avviser %s med ZodError uten rad og loggrad", async (_label, input) => {
    const org = await createOrganization();
    const { admin } = await adminIn(org.id);

    expect(await caught(adminCreateOffice(admin, org.id, input))).toBeInstanceOf(ZodError);
    expect(await countOffices()).toBe(0);
    expect(await countAudit()).toBe(0);
  });
});
