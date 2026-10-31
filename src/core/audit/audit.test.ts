import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employees, type EmployeeRole } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listAuditEvents, recordAuditEvent } from "./index";

/*
 * Revisjonsloggen (docs/05-domenemodell.md 4.12).
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md avsnitt 3.
 * Testdata er oppdiktet («Kari Testdatter», example.com).
 */

beforeEach(resetDatabase);

/** En rad satt rett inn i audit_log (som fra en rutine eller en ansatt som ikke finnes lenger). */
async function insertAuditRow(
  organizationId: string,
  overrides: Partial<typeof auditLog.$inferInsert> = {},
) {
  const [row] = await db
    .insert(auditLog)
    .values({
      organizationId,
      entityType: "office",
      entityId: randomUUID(),
      action: "update",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("kunne ikke lage rad i audit_log");
  return row;
}

async function orgWithAdmin(name = "Organisasjon A") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Kari Testdatter" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

describe("revisjonslogg", () => {
  it("lagrer hendelsen på organisasjonen fra tilgangssjekken, og bare leder og admin leser den", async () => {
    const org = await createOrganization();
    const admin = await createUser();
    const inspector = await createUser();
    await createEmployee(admin, org.id, ["admin"]);
    await createEmployee(inspector, org.id, ["inspector"]);

    const grant = await requireOrganizationAccess(inspector, org.id);
    await recordAuditEvent(db, grant, {
      entityType: "employee",
      entityId: grant.employeeId,
      action: "update",
      changes: { jobTitle: { from: null, to: "Takstingeniør" } },
    });

    const events = await listAuditEvents(admin, org.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "update", actorEmployeeId: grant.employeeId });
    await expect(listAuditEvents(inspector, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("viser aldri hendelser fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        await recordAuditEvent(db, grantA, { entityType: "x", entityId: "1", action: "create" });
        await recordAuditEvent(db, grantB, { entityType: "x", entityId: "2", action: "create" });
        const rows = await db
          .select({ id: auditLog.id, organizationId: auditLog.organizationId })
          .from(auditLog);
        return {
          a: rows.filter((r) => r.organizationId === grantA.organizationId).map((r) => r.id),
          b: rows.filter((r) => r.organizationId === grantB.organizationId).map((r) => r.id),
        };
      },
      query: listAuditEvents,
      idOf: (row) => row.id,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 3.1 Navn og left join

describe("listAuditEvents: navnet på den ansatte", () => {
  it("3.1.1 tar med navnet på den ansatte som gjorde endringen", async () => {
    const { org, admin } = await orgWithAdmin();
    const grant = await requireOrganizationAccess(admin, org.id);
    await recordAuditEvent(db, grant, {
      entityType: "office",
      entityId: randomUUID(),
      action: "update",
      changes: { address: { from: "Testveien 1", to: "Testveien 2" } },
    });

    const rows = await listAuditEvents(admin, org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorEmployeeId: grant.employeeId,
      actorName: "Kari Testdatter",
    });
  });

  it("3.1.2 tar med rader uten ansatt, med actorName null (left join)", async () => {
    const { org, admin } = await orgWithAdmin();
    const row = await insertAuditRow(org.id, { actorEmployeeId: null });

    const rows = await listAuditEvents(admin, org.id);
    expect(rows.map((r) => r.id)).toContain(row.id);
    expect(rows.find((r) => r.id === row.id)?.actorName).toBeNull();
  });

  // Valget som dokumenteres: historikken mister aldri navnet, heller ikke når den ansatte har
  // sluttet eller er mykt slettet. Raden forsvinner uansett aldri.
  it("3.1.3 viser fortsatt navnet når den ansatte har sluttet eller er mykt slettet", async () => {
    const { org, admin } = await orgWithAdmin();
    const leftActor = await createUser({ name: "Ola Sluttetsen" });
    const left = await createEmployee(leftActor, org.id, ["inspector"]);
    const deletedActor = await createUser({ name: "Per Slettetsen" });
    const deleted = await createEmployee(deletedActor, org.id, ["inspector"]);
    const leftRow = await insertAuditRow(org.id, { actorEmployeeId: left.id });
    const deletedRow = await insertAuditRow(org.id, { actorEmployeeId: deleted.id });
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, left.id));
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, deleted.id));

    const rows = await listAuditEvents(admin, org.id);
    expect(rows.find((r) => r.id === leftRow.id)?.actorName).toBe("Ola Sluttetsen");
    expect(rows.find((r) => r.id === deletedRow.id)?.actorName).toBe("Per Slettetsen");
  });

  it("3.1.4 viser aldri navnet når ansatt-id-en på raden hører til en annen organisasjon", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const personB = await createUser({ name: "Bjørn Fremmedsen" });
    const employeeB = await createEmployee(personB, orgB.id, ["admin"]);
    const row = await insertAuditRow(orgA.id, { actorEmployeeId: employeeB.id });

    const rows = await listAuditEvents(adminA, orgA.id);
    const listed = rows.find((r) => r.id === row.id);
    expect(listed).toBeDefined();
    expect(listed!.actorName).toBeNull();
    expect(rows.map((r) => r.actorName)).not.toContain("Bjørn Fremmedsen");
  });
});

// ---------------------------------------------------------------------------------------------
// 3.2 Rekkefølge og grense

describe("listAuditEvents: rekkefølge og grense", () => {
  it("3.2.1 gir nyeste først", async () => {
    const { org, admin } = await orgWithAdmin();
    const oldest = await insertAuditRow(org.id, { occurredAt: new Date("2026-10-01T08:00:00Z") });
    const middle = await insertAuditRow(org.id, { occurredAt: new Date("2026-10-02T08:00:00Z") });
    const newest = await insertAuditRow(org.id, { occurredAt: new Date("2026-10-03T08:00:00Z") });

    const rows = await listAuditEvents(admin, org.id);
    expect(rows.map((r) => r.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  it("3.2.2 gir 50 rader som standard, og den eldste faller ut", async () => {
    const { org, admin } = await orgWithAdmin();
    const start = Date.UTC(2026, 9, 1, 8, 0, 0);
    const values = Array.from({ length: 51 }, (_, i) => ({
      organizationId: org.id,
      entityType: "office",
      entityId: randomUUID(),
      action: "update",
      occurredAt: new Date(start + i * 60_000),
    }));
    const inserted = await db.insert(auditLog).values(values).returning();
    const oldest = inserted.find((r) => r.occurredAt.getTime() === start);
    expect(oldest).toBeDefined();

    const rows = await listAuditEvents(admin, org.id);
    expect(rows).toHaveLength(50);
    expect(rows.map((r) => r.id)).not.toContain(oldest!.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3 Tilgang per rolle

describe("listAuditEvents: tilgang", () => {
  it.each<EmployeeRole>(["inspector", "office"])("3.3.1 %s får AccessDeniedError", async (role) => {
    const { org } = await orgWithAdmin();
    await insertAuditRow(org.id);
    const person = await createUser({ name: "Kari Testdatter" });
    await createEmployee(person, org.id, [role]);
    await expect(listAuditEvents(person, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it.each<EmployeeRole>(["manager", "admin"])("3.3.2 %s kan lese", async (role) => {
    const org = await createOrganization("Organisasjon A");
    const row = await insertAuditRow(org.id);
    const person = await createUser({ name: "Kari Testdatter" });
    await createEmployee(person, org.id, [role]);
    const rows = await listAuditEvents(person, org.id);
    expect(rows.map((r) => r.id)).toContain(row.id);
  });

  it("3.3.3 admin som har sluttet, og ansatt uten roller, får AccessDeniedError", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    await insertAuditRow(org.id);
    const noRoles: Actor = await createUser({ name: "Uten Roller" });
    await createEmployee(noRoles, org.id, []);
    await expect(listAuditEvents(noRoles, org.id)).rejects.toThrow(AccessDeniedError);

    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, adminEmployee.id));
    await expect(listAuditEvents(admin, org.id)).rejects.toThrow(AccessDeniedError);
  });

  // Regel 11: admin stenges aldri ute. Denne testen skal aldri fjernes.
  it("3.3.4 admin uten sertifisering og uten enkeltrettigheter kan lese", async () => {
    const { org, admin } = await orgWithAdmin();
    const row = await insertAuditRow(org.id);
    const rows = await listAuditEvents(admin, org.id);
    expect(rows.map((r) => r.id)).toContain(row.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.4 Tenant-isolasjon med navn

describe("listAuditEvents: tenant-isolasjon med navn", () => {
  it("3.4 gir ingen rader og ingen navn fra en annen organisasjon", async () => {
    const seen: { organizationId: string; names: (string | null)[] }[] = [];
    let orgAId = "";
    let orgBId = "";

    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgAId = grantA.organizationId;
        orgBId = grantB.organizationId;
        await recordAuditEvent(db, grantA, {
          entityType: "office",
          entityId: "1",
          action: "create",
        });
        await recordAuditEvent(db, grantB, {
          entityType: "office",
          entityId: "2",
          action: "create",
        });
        // Rad i A som peker på admin i B: navnet fra B skal likevel aldri vises i A.
        await insertAuditRow(grantA.organizationId, { actorEmployeeId: grantB.employeeId });
        const rows = await db
          .select({ id: auditLog.id, organizationId: auditLog.organizationId })
          .from(auditLog);
        return {
          a: rows.filter((r) => r.organizationId === grantA.organizationId).map((r) => r.id),
          b: rows.filter((r) => r.organizationId === grantB.organizationId).map((r) => r.id),
        };
      },
      query: async (actor, organizationId) => {
        const rows = await listAuditEvents(actor, organizationId);
        seen.push({ organizationId, names: rows.map((r) => r.actorName) });
        return rows;
      },
      idOf: (row) => row.id,
    });

    const namesA = seen.filter((s) => s.organizationId === orgAId).flatMap((s) => s.names);
    const namesB = seen.filter((s) => s.organizationId === orgBId).flatMap((s) => s.names);
    expect(namesA).toContain("Admin A");
    expect(namesB).toContain("Admin B");
    for (const name of namesA) expect([null, "Admin A"]).toContain(name);
    for (const name of namesB) expect([null, "Admin B"]).toContain(name);
  });
});
