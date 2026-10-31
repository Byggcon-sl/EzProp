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

// Admin: opprette og endre kontorer.
// Testplan: docs/funksjoner/fase0b-admin-organisasjon-testplan.md, avsnitt 2. Testdata er oppdiktet.

type OfficeInput = Parameters<typeof adminCreateOffice>[2];
type OfficeUpdate = Parameters<typeof adminUpdateOffice>[3];

function officeInput(overrides: Record<string, unknown> = {}): OfficeInput {
  return {
    name: "Testkontor Vest",
    address: "Testveien 3",
    sortOrder: 2,
    ...overrides,
  } as OfficeInput;
}

function officeUpdate(overrides: Record<string, unknown> = {}): OfficeUpdate {
  return officeInput(overrides) as unknown as OfficeUpdate;
}

async function officeCount() {
  return (await db.select({ id: offices.id }).from(offices)).length;
}

async function officeRow(id: string) {
  const [row] = await db.select().from(offices).where(eq(offices.id, id));
  if (!row) throw new Error("fant ikke kontoret");
  return row;
}

async function orgWithAdmin() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

const nonAdminRoles: EmployeeRole[] = ["inspector", "office", "manager"];

describe("createOffice og updateOffice (admin)", () => {
  it("1. createOffice lagrer navn, adresse og rekkefølge; updateOffice endrer dem og øker row_version", async () => {
    const { org, admin } = await orgWithAdmin();
    const created = await adminCreateOffice(admin, org.id, officeInput());
    const row = await officeRow(created.id);
    expect(row).toMatchObject({
      organizationId: org.id,
      name: "Testkontor Vest",
      address: "Testveien 3",
      sortOrder: 2,
      deletedAt: null,
    });

    await adminUpdateOffice(
      admin,
      org.id,
      created.id,
      officeUpdate({ name: "Testkontor Øst", address: "Testgata 4", sortOrder: 5 }),
    );
    const after = await officeRow(created.id);
    expect(after).toMatchObject({ name: "Testkontor Øst", address: "Testgata 4", sortOrder: 5 });
    expect(after.rowVersion).toBe(row.rowVersion + 1);
  });

  describe("2. tilgang per rolle", () => {
    it.each(nonAdminRoles)("rollen %s får AccessDeniedError og ingen endring", async (role) => {
      const org = await createOrganization();
      const office = await createOffice(org.id);
      const person = await createUser();
      await createEmployee(person, org.id, [role]);
      const before = await officeRow(office.id);

      await expect(adminCreateOffice(person, org.id, officeInput())).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        adminUpdateOffice(person, org.id, office.id, officeUpdate({ name: "Endret" })),
      ).rejects.toThrow(AccessDeniedError);

      expect(await officeCount()).toBe(1);
      expect(await officeRow(office.id)).toEqual(before);
      expect(await auditRows(org.id)).toHaveLength(0);
    });

    it("ansatt uten roller får AccessDeniedError", async () => {
      const org = await createOrganization();
      const office = await createOffice(org.id);
      const person = await createUser();
      await createEmployee(person, org.id, []);

      await expect(adminCreateOffice(person, org.id, officeInput())).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(adminUpdateOffice(person, org.id, office.id, officeUpdate())).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await officeCount()).toBe(1);
    });

    it("admin som har sluttet får AccessDeniedError", async () => {
      const { org, admin, adminEmployee } = await orgWithAdmin();
      const office = await createOffice(org.id);
      await db
        .update(employees)
        .set({ deactivatedAt: new Date() })
        .where(eq(employees.id, adminEmployee.id));

      await expect(adminCreateOffice(admin, org.id, officeInput())).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(adminUpdateOffice(admin, org.id, office.id, officeUpdate())).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await officeCount()).toBe(1);
    });

    it("admin lykkes (positiv kontroll)", async () => {
      const { org, admin } = await orgWithAdmin();
      const created = await adminCreateOffice(admin, org.id, officeInput());
      await adminUpdateOffice(admin, org.id, created.id, officeUpdate({ name: "Endret" }));
      expect((await officeRow(created.id)).name).toBe("Endret");
    });
  });

  it("3a. tenant-isolasjon: createOffice legger raden i egen organisasjon", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor: Actor, organizationId: string) => {
        const row = await adminCreateOffice(
          actor,
          organizationId,
          officeInput({ name: `Testkontor ${actor.id}` }),
        );
        return [await officeRow(row.id)];
      },
      idOf: (row) => row.organizationId,
    });
    const inB = await db.select().from(offices).where(eq(offices.organizationId, orgB));
    expect(inB).toHaveLength(1);
  });

  it("3b. tenant-isolasjon: updateOffice endrer bare raden i egen organisasjon", async () => {
    const officeByOrg = new Map<string, string>();
    const actorByOrg = new Map<string, Actor>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await createOffice(grantA.organizationId, { name: "Testkontor A" });
        const b = await createOffice(grantB.organizationId, { name: "Testkontor B" });
        officeByOrg.set(grantA.organizationId, a.id);
        officeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor: Actor, organizationId: string) => {
        const officeId = officeByOrg.get(organizationId) ?? randomUUID();
        await adminUpdateOffice(
          actor,
          organizationId,
          officeId,
          officeUpdate({ name: `Endret av ${actor.id}` }),
        );
        actorByOrg.set(organizationId, actor);
        return [await officeRow(officeId)];
      },
      idOf: (row) => row.id,
    });
    const rowB = await officeRow(officeByOrg.get(orgB)!);
    expect(rowB.name).toBe(`Endret av ${actorByOrg.get(orgB)!.id}`);
    expect(rowB.rowVersion).toBe(2);
  });

  describe("4. fremmed, ugyldig, ukjent og slettet id", () => {
    it.each([
      ["id fra en annen organisasjon", "foreign"],
      ["id som ikke er uuid", "ikke-en-id"],
      ["tilfeldig uuid", "random"],
    ])("%s gir AccessDeniedError, og B-raden er uendret", async (_label, kind) => {
      const { org: orgA, admin: adminA } = await orgWithAdmin();
      const orgB = await createOrganization("Organisasjon B");
      const officeB = await createOffice(orgB.id, { name: "Testkontor B" });
      const before = await officeRow(officeB.id);
      const id = kind === "foreign" ? officeB.id : kind === "random" ? randomUUID() : kind;

      await expect(
        adminUpdateOffice(adminA, orgA.id, id, officeUpdate({ name: "Kapret" })),
      ).rejects.toThrow(AccessDeniedError);

      expect(await officeRow(officeB.id)).toEqual(before);
      expect(await db.select().from(auditLog)).toHaveLength(0);
    });

    it("slettet kontor kan ikke endres", async () => {
      const { org, admin } = await orgWithAdmin();
      const office = await createOffice(org.id, { deletedAt: new Date() });
      const before = await officeRow(office.id);
      await expect(
        adminUpdateOffice(admin, org.id, office.id, officeUpdate({ name: "Endret" })),
      ).rejects.toThrow(AccessDeniedError);
      expect(await officeRow(office.id)).toEqual(before);
    });
  });

  describe("5. samme navn", () => {
    it("samme navn som et aktivt kontor i egen organisasjon gir en feil, og ingen ny rad", async () => {
      const { org, admin } = await orgWithAdmin();
      await createOffice(org.id, { name: "Testkontor Vest" });
      await expect(
        adminCreateOffice(admin, org.id, officeInput({ name: "Testkontor Vest" })),
      ).rejects.toThrow();
      expect(await officeCount()).toBe(1);
      expect(await auditRows(org.id)).toHaveLength(0);
    });

    it("samme navn i en annen organisasjon er lov", async () => {
      const { org, admin } = await orgWithAdmin();
      const other = await createOrganization("Organisasjon B");
      await createOffice(other.id, { name: "Testkontor Vest" });
      const created = await adminCreateOffice(
        admin,
        org.id,
        officeInput({ name: "Testkontor Vest" }),
      );
      expect((await officeRow(created.id)).organizationId).toBe(org.id);
    });
  });

  it("6. revisjonslogg: én rad for create og én for update", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const created = await adminCreateOffice(admin, org.id, officeInput());
    await adminUpdateOffice(admin, org.id, created.id, officeUpdate({ address: "Testgata 9" }));

    const rows = await auditRows(org.id);
    expect(rows.map((row) => row.action).sort()).toEqual(["create", "update"]);
    for (const row of rows) {
      expect(row.organizationId).toBe(org.id);
      expect(row.entityId).toBe(created.id);
      expect(row.entityType).toMatch(/office/);
      expect(row.actorEmployeeId).toBe(adminEmployee.id);
    }
  });

  describe("7. validering (Zod)", () => {
    it.each([
      ["tomt navn", { name: "" }],
      ["navn med bare mellomrom", { name: "   " }],
      ["rekkefølge som ikke er et heltall", { sortOrder: 1.5 }],
      ["rekkefølge som tekst", { sortOrder: "først" }],
    ])("%s avvises med ZodError, uten rad og uten loggrad", async (_label, overrides) => {
      const { org, admin } = await orgWithAdmin();
      await expect(adminCreateOffice(admin, org.id, officeInput(overrides))).rejects.toThrow(
        ZodError,
      );
      expect(await officeCount()).toBe(0);
      expect(await auditRows(org.id)).toHaveLength(0);
    });
  });
});
