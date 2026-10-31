import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import { events, type EmployeeRole } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Hendelsesloggen: skriving med recordEvent og tabellen events (docs/05-domenemodell.md 4.9).
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md avsnitt 2.
 * Oppgavekort: docs/funksjoner/fase0b-revisjon-hendelser.md (Omfang 1 og 3).
 * Testdata er oppdiktet («Kari Testdatter», example.com).
 *
 * recordEvent tar ingen organizationId, så expectTenantIsolation passer ikke her (ingen
 * lesespørring før listEvents i fase 2a). Isolasjonen vises i 2.3 i stedet.
 */

beforeEach(resetDatabase);

async function orgWithEmployee(role: EmployeeRole = "inspector", orgName = "Organisasjon A") {
  const org = await createOrganization(orgName);
  const actor = await createUser({ name: "Kari Testdatter" });
  const employee = await createEmployee(actor, org.id, [role]);
  const grant = await requireOrganizationAccess(actor, org.id);
  return { org, actor, employee, grant };
}

async function eventRows(organizationId?: string) {
  const query = db.select().from(events);
  return organizationId ? query.where(eq(events.organizationId, organizationId)) : query;
}

/** Postgres-feilen bak en avvist rå insert (drizzle pakker den inn som `cause`). */
async function expectDbRejects(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow();
}

// ---------------------------------------------------------------------------------------------
// 2.1 Lagring

describe("recordEvent: lagring", () => {
  it("2.1.1 lagrer organisasjonen og den ansatte fra tilgangssjekken", async () => {
    const { org, grant } = await orgWithEmployee();
    await recordEvent(db, grant, { type: "inspection.started" });

    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      actorType: "employee",
      actorId: grant.employeeId,
      createdBy: grant.employeeId,
      type: "inspection.started",
    });
    expect(grant.organizationId).toBe(org.id);
  });

  it("2.1.2 godtar tomme koblinger og gir data {} som standard", async () => {
    const { grant } = await orgWithEmployee();
    const before = Date.now();
    await recordEvent(db, grant, { type: "inspection.started" });

    const [row] = await eventRows();
    expect(row).toBeDefined();
    expect(row!.assignmentId).toBeNull();
    expect(row!.reportId).toBeNull();
    expect(row!.data).toEqual({});
    expect(row!.deletedAt).toBeNull();
    expect(row!.occurredAt).toBeInstanceOf(Date);
    expect(row!.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 60_000);
    if ("receivedAt" in row!) {
      expect((row as { receivedAt: unknown }).receivedAt).toBeInstanceOf(Date);
    }
  });

  it("2.1.3 lagrer koblinger og data uendret (ingen fremmednøkkel ennå, A33)", async () => {
    const { grant } = await orgWithEmployee();
    const assignmentId = randomUUID();
    const reportId = randomUUID();
    await recordEvent(db, grant, {
      type: "assignment.status_changed",
      assignmentId,
      reportId,
      data: { from: "bestilt", to: "under_arbeid" },
    });

    const [row] = await eventRows();
    expect(row).toMatchObject({
      type: "assignment.status_changed",
      assignmentId,
      reportId,
      data: { from: "bestilt", to: "under_arbeid" },
    });
  });

  it("2.1.4 lagrer ingenting når transaksjonen rulles tilbake", async () => {
    const { grant } = await orgWithEmployee();
    await expect(
      db.transaction(async (tx) => {
        await recordEvent(tx, grant, { type: "inspection.finished" });
        throw new Error("endringen feilet");
      }),
    ).rejects.toThrow("endringen feilet");

    expect(await eventRows()).toHaveLength(0);
  });

  it("2.1.5 lagrer hendelsen når transaksjonen lykkes", async () => {
    const { grant } = await orgWithEmployee();
    await db.transaction(async (tx) => {
      await recordEvent(tx, grant, { type: "inspection.finished" });
    });

    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.type).toBe("inspection.finished");
  });
});

// ---------------------------------------------------------------------------------------------
// 2.2 Tilgang per rolle

describe("recordEvent: roller", () => {
  it.each<EmployeeRole>(["inspector", "office", "manager", "admin"])(
    "2.2.1 %s kan skrive en hendelse",
    async (role) => {
      const { org, grant } = await orgWithEmployee(role);
      await recordEvent(db, grant, { type: "document.received" });

      const rows = await eventRows(org.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorId).toBe(grant.employeeId);
      expect(rows[0]!.actorType).toBe("employee");
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 2.3 Tenant-isolasjon (regel 2)

describe("recordEvent: tenant-isolasjon", () => {
  it("2.3.1 samme person i A og B: hendelsen havner bare i organisasjonen fra grant", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const person = await createUser({ name: "Kari Testdatter" });
    const employeeA = await createEmployee(person, orgA.id, ["inspector"]);
    await createEmployee(person, orgB.id, ["inspector"]);
    const grantA = await requireOrganizationAccess(person, orgA.id);

    await recordEvent(db, grantA, { type: "inspection.started" });

    const rowsA = await eventRows(orgA.id);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]!.actorId).toBe(employeeA.id);
    expect(await eventRows(orgB.id)).toHaveLength(0);
  });

  it("2.3.2 organisasjon, aktør og aktørtype i input overstyrer aldri tilgangssjekken", async () => {
    const { org: orgA, grant: grantA } = await orgWithEmployee("admin", "Organisasjon A");
    const { org: orgB, employee: employeeB } = await orgWithEmployee("admin", "Organisasjon B");

    await recordEvent(db, grantA, {
      type: "assignment.created",
      organizationId: orgB.id,
      actorId: employeeB.id,
      actorType: "system",
      createdBy: employeeB.id,
    } as never);

    const rowsA = await eventRows(orgA.id);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]).toMatchObject({
      organizationId: orgA.id,
      actorId: grantA.employeeId,
      actorType: "employee",
      createdBy: grantA.employeeId,
    });
    expect(await eventRows(orgB.id)).toHaveLength(0);
  });

  it("2.3.3 input med organizationId eller ukjent type gir typefeil (fanges av pnpm typecheck)", () => {
    // Kalles aldri; bare typesjekken teller.
    const typeChecks = async (grant: Awaited<ReturnType<typeof requireOrganizationAccess>>) => {
      await recordEvent(db, grant, {
        type: "inspection.started",
        // @ts-expect-error input har ikke organizationId; organisasjonen kommer fra grant
        organizationId: randomUUID(),
      });
      await recordEvent(db, grant, {
        // @ts-expect-error ukjent hendelseskode
        type: "ukjent.kode",
      });
    };
    expect(typeof typeChecks).toBe("function");
  });
});

// ---------------------------------------------------------------------------------------------
// 2.4 Databasen

describe("tabellen events", () => {
  it("2.4.1 avviser actor_type utenfor employee, system og integration", async () => {
    const { org } = await orgWithEmployee();
    await expectDbRejects(
      db.execute(
        sql`insert into events (organization_id, type, actor_type) values (${org.id}, 'inspection.started', 'robot')`,
      ),
    );
    expect(await eventRows()).toHaveLength(0);
  });

  it.each(["employee", "system", "integration"])(
    "2.4.2 godtar actor_type %s ved rå insert",
    async (actorType) => {
      const { org, employee } = await orgWithEmployee();
      const actorId = actorType === "employee" ? employee.id : null;
      await db.execute(
        sql`insert into events (organization_id, type, actor_type, actor_id) values (${org.id}, 'inspection.started', ${actorType}, ${actorId})`,
      );
      const rows = await eventRows(org.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actorType).toBe(actorType);
      expect(rows[0]!.actorId).toBe(actorId);
      expect(rows[0]!.assignmentId).toBeNull();
      expect(rows[0]!.reportId).toBeNull();
      expect(rows[0]!.data).toEqual({});
    },
  );

  it("2.4.3 krever organization_id", async () => {
    await orgWithEmployee();
    await expectDbRejects(
      db.execute(
        sql`insert into events (type, actor_type) values ('inspection.started', 'system')`,
      ),
    );
  });

  it("2.4.4 krever type", async () => {
    const { org } = await orgWithEmployee();
    await expectDbRejects(
      db.execute(
        sql`insert into events (organization_id, actor_type) values (${org.id}, 'system')`,
      ),
    );
  });

  it("2.4.5 resetDatabase tømmer events", async () => {
    const { grant } = await orgWithEmployee();
    await recordEvent(db, grant, { type: "inspection.started" });
    expect(await eventRows()).toHaveLength(1);

    await resetDatabase();
    expect(await eventRows()).toHaveLength(0);
  });
});
