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

beforeEach(resetDatabase);

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

/*
 * Utvidelsen for revisjonsloggen i adminområdet.
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md, avsnitt 3.
 * Testdata er oppdiktet («Kari Testdatter», example.com).
 */

async function personIn(organizationId: string, roles: EmployeeRole[], name = "Kari Testdatter") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/** En rad satt inn direkte, slik at testen styrer ansatt og tidspunkt. */
async function insertAuditRow(
  organizationId: string,
  overrides: { actorEmployeeId?: string | null; occurredAt?: Date; entityId?: string } = {},
) {
  const [row] = await db
    .insert(auditLog)
    .values({
      organizationId,
      actorEmployeeId: overrides.actorEmployeeId ?? null,
      entityType: "office",
      entityId: overrides.entityId ?? "kontor-1",
      action: "update",
      changes: { street: { from: "Storgata 1", to: "Storgata 2" } },
      occurredAt: overrides.occurredAt,
    })
    .returning();
  if (!row) throw new Error("kunne ikke legge inn rad i revisjonsloggen");
  return row;
}

describe("revisjonslogg: navn på den ansatte (left join)", () => {
  it("1. navnet på den ansatte kommer med", async () => {
    const org = await createOrganization();
    const { actor: admin } = await personIn(org.id, ["admin"], "Kari Testdatter");
    const grant = await requireOrganizationAccess(admin, org.id);
    await recordAuditEvent(db, grant, { entityType: "office", entityId: "1", action: "update" });

    const rows = await listAuditEvents(admin, org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorName).toBe("Kari Testdatter");
  });

  it("2. rad uten ansatt kommer med, uten navn", async () => {
    const org = await createOrganization();
    const { actor: admin } = await personIn(org.id, ["admin"]);
    const row = await insertAuditRow(org.id, { actorEmployeeId: null });

    const rows = await listAuditEvents(admin, org.id);
    expect(rows.map((r) => r.id)).toEqual([row.id]);
    expect(rows[0]?.actorName).toBeNull();
  });

  it.each([
    ["har sluttet", { deactivatedAt: new Date() }],
    ["er mykt slettet", { deletedAt: new Date() }],
  ])("3. ansatt som %s: raden og navnet står (historikken mister aldri navn)", async (_, set) => {
    const org = await createOrganization();
    const { actor: admin } = await personIn(org.id, ["admin"], "Test Admin");
    const { employee } = await personIn(org.id, ["inspector"], "Kari Testdatter");
    const row = await insertAuditRow(org.id, { actorEmployeeId: employee.id });
    await db.update(employees).set(set).where(eq(employees.id, employee.id));

    const rows = await listAuditEvents(admin, org.id);
    expect(rows.map((r) => r.id)).toEqual([row.id]);
    expect(rows[0]?.actorName).toBe("Kari Testdatter");
  });

  it("4. ansatt-id fra en annen organisasjon gir aldri navnet derfra", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { actor: adminA } = await personIn(orgA.id, ["admin"], "Admin A");
    const { employee: employeeB } = await personIn(orgB.id, ["inspector"], "Kari Annen");
    const row = await insertAuditRow(orgA.id, { actorEmployeeId: employeeB.id });

    const rows = await listAuditEvents(adminA, orgA.id);
    expect(rows.map((r) => r.id)).toEqual([row.id]);
    expect(rows[0]?.actorName).toBeNull();
  });
});

describe("revisjonslogg: rekkefølge og grense", () => {
  it("1. nyeste først", async () => {
    const org = await createOrganization();
    const { actor: admin } = await personIn(org.id, ["admin"]);
    const oldest = await insertAuditRow(org.id, { occurredAt: new Date("2026-10-01T08:00:00Z") });
    const middle = await insertAuditRow(org.id, { occurredAt: new Date("2026-10-02T08:00:00Z") });
    const newest = await insertAuditRow(org.id, { occurredAt: new Date("2026-10-03T08:00:00Z") });

    const rows = await listAuditEvents(admin, org.id);
    expect(rows.map((r) => r.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  it("2. standardgrensen er 50: av 51 rader mangler den eldste", async () => {
    const org = await createOrganization();
    const { actor: admin } = await personIn(org.id, ["admin"]);
    const start = Date.parse("2026-10-01T08:00:00Z");
    const inserted = [];
    for (let i = 0; i < 51; i += 1) {
      inserted.push(
        await insertAuditRow(org.id, {
          occurredAt: new Date(start + i * 60_000),
          entityId: `kontor-${i}`,
        }),
      );
    }

    const rows = await listAuditEvents(admin, org.id);
    expect(rows).toHaveLength(50);
    expect(rows.map((r) => r.id)).not.toContain(inserted[0]?.id);
    expect(rows[0]?.id).toBe(inserted[50]?.id);
  });
});

describe("revisjonslogg: tilgang per rolle", () => {
  it.each<EmployeeRole>(["inspector", "office"])("1. %s får AccessDeniedError", async (role) => {
    const org = await createOrganization();
    const { actor } = await personIn(org.id, [role]);
    await insertAuditRow(org.id);

    await expect(listAuditEvents(actor, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it.each<EmployeeRole>(["manager", "admin"])("2. %s kan lese", async (role) => {
    const org = await createOrganization();
    const { actor } = await personIn(org.id, [role]);
    const row = await insertAuditRow(org.id);

    const rows = await listAuditEvents(actor, org.id);
    expect(rows.map((r) => r.id)).toEqual([row.id]);
  });

  it("3. admin som har sluttet og ansatt uten roller får AccessDeniedError", async () => {
    const org = await createOrganization();
    await personIn(org.id, ["admin"], "Andre Admin");
    const { actor: formerAdmin, employee } = await personIn(org.id, ["admin"], "Kari Testdatter");
    const { actor: noRoles } = await personIn(org.id, [], "Ola Testsønn");
    await insertAuditRow(org.id);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));

    await expect(listAuditEvents(formerAdmin, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(listAuditEvents(noRoles, org.id)).rejects.toThrow(AccessDeniedError);
  });

  // Admin stenges aldri ute (regel 11). Denne testen skal aldri fjernes.
  it("4. admin uten sertifisering og uten enkeltrettigheter kan lese", async () => {
    const org = await createOrganization();
    const { actor: admin } = await personIn(org.id, ["admin"]);
    const row = await insertAuditRow(org.id);

    const rows = await listAuditEvents(admin, org.id);
    expect(rows.map((r) => r.id)).toEqual([row.id]);
  });
});

describe("revisjonslogg: tenant-isolasjon med navn", () => {
  it("1–2. ingen rader og ingen navn fra den andre organisasjonen", async () => {
    let organizationA = "";
    const namesInA = new Set<string>();
    const listedInA: Array<{ actorName: string | null }> = [];

    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        organizationA = grantA.organizationId;
        const inspectorA = await personIn(grantA.organizationId, ["inspector"], "Kari Testdatter");
        namesInA.add("Admin A").add("Kari Testdatter");
        await recordAuditEvent(db, grantA, { entityType: "x", entityId: "1", action: "create" });
        await insertAuditRow(grantA.organizationId, { actorEmployeeId: inspectorA.employee.id });
        // Ansatt-id fra B på en rad i A: navnet fra B skal aldri vises i A.
        await insertAuditRow(grantA.organizationId, { actorEmployeeId: grantB.employeeId });
        await recordAuditEvent(db, grantB, { entityType: "x", entityId: "2", action: "create" });
        const rows = await db
          .select({ id: auditLog.id, organizationId: auditLog.organizationId })
          .from(auditLog);
        return {
          a: rows.filter((r) => r.organizationId === grantA.organizationId).map((r) => r.id),
          b: rows.filter((r) => r.organizationId === grantB.organizationId).map((r) => r.id),
        };
      },
      query: async (actor: Actor, organizationId: string) => {
        const rows = await listAuditEvents(actor, organizationId);
        if (organizationId === organizationA) listedInA.push(...rows);
        return rows;
      },
      idOf: (row) => row.id,
    });

    expect(listedInA.length).toBeGreaterThan(0);
    expect(listedInA.map((row) => row.actorName)).not.toContain("Admin B");
    for (const row of listedInA) {
      if (row.actorName !== null) expect(namesInA).toContain(row.actorName);
    }
  });
});
