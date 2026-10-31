import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { events, type EmployeeRole } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { recordEvent } from "./index";

/*
 * Skriving av hendelser (docs/05-domenemodell.md 4.9).
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md, avsnitt 2.
 * Testdata er oppdiktet («Kari Testdatter», example.com).
 */

beforeEach(resetDatabase);

async function personIn(organizationId: string, roles: EmployeeRole[], name = "Kari Testdatter") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  const grant = await requireOrganizationAccess(actor, organizationId);
  return { actor, employee, grant };
}

async function eventRows(organizationId?: string) {
  const query = db.select().from(events);
  return organizationId ? query.where(eq(events.organizationId, organizationId)) : query;
}

class Rollback extends Error {}

describe("recordEvent: lagring", () => {
  it("1. organisasjonen og den ansatte kommer fra tilgangssjekken", async () => {
    const org = await createOrganization();
    const { grant } = await personIn(org.id, ["inspector"]);

    await recordEvent(db, grant, { type: "inspection.started" });

    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: grant.organizationId,
      actorType: "employee",
      actorId: grant.employeeId,
      createdBy: grant.employeeId,
      type: "inspection.started",
    });
  });

  it("2. tomme koblinger og standard data", async () => {
    const org = await createOrganization();
    const { grant } = await personIn(org.id, ["inspector"]);

    await recordEvent(db, grant, { type: "inspection.started" });

    const [row] = await eventRows();
    expect(row?.assignmentId).toBeNull();
    expect(row?.reportId).toBeNull();
    expect(row?.data).toEqual({});
    expect(row?.occurredAt).toBeInstanceOf(Date);
    expect(row?.receivedAt).toBeInstanceOf(Date);
    expect(row?.deletedAt).toBeNull();
    expect(row?.deletedBy).toBeNull();
  });

  it("3. koblinger og data lagres uendret (ingen fremmednøkkel ennå, A33)", async () => {
    const org = await createOrganization();
    const { grant } = await personIn(org.id, ["office"]);
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
      assignmentId,
      reportId,
      data: { from: "bestilt", to: "under_arbeid" },
    });
  });

  it("4. i en transaksjon som rulles tilbake lagres ingenting", async () => {
    const org = await createOrganization();
    const { grant } = await personIn(org.id, ["inspector"]);

    await expect(
      db.transaction(async (tx) => {
        await recordEvent(tx, grant, { type: "inspection.finished" });
        throw new Rollback("endringen feilet");
      }),
    ).rejects.toThrow(Rollback);

    expect(await eventRows()).toHaveLength(0);
  });

  it("5. i en transaksjon som lykkes finnes raden etterpå", async () => {
    const org = await createOrganization();
    const { grant } = await personIn(org.id, ["inspector"]);

    await db.transaction(async (tx) => {
      await recordEvent(tx, grant, { type: "inspection.finished" });
    });

    const rows = await eventRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("inspection.finished");
  });
});

describe("recordEvent: tilgang per rolle", () => {
  it.each<EmployeeRole>(["inspector", "office", "manager", "admin"])(
    "1. %s kan skrive (kallet ligger bak handlinger de har lov til)",
    async (role) => {
      const org = await createOrganization();
      const { grant } = await personIn(org.id, [role]);

      await recordEvent(db, grant, { type: "document.received" });

      const rows = await eventRows(org.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.actorId).toBe(grant.employeeId);
    },
  );
});

describe("recordEvent: tenant-isolasjon (regel 2)", () => {
  async function samePersonInTwoOrganizations() {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const person: Actor = await createUser({ name: "Kari Testdatter" });
    await createEmployee(person, orgA.id, ["inspector"]);
    await createEmployee(person, orgB.id, ["inspector"]);
    const grantA = await requireOrganizationAccess(person, orgA.id);
    const grantB = await requireOrganizationAccess(person, orgB.id);
    return { orgA, orgB, grantA, grantB };
  }

  it("1. samme person i A og B: hendelsen havner bare i organisasjonen fra grant", async () => {
    const { orgA, orgB, grantA } = await samePersonInTwoOrganizations();

    await recordEvent(db, grantA, { type: "assignment.created" });

    const rowsA = await eventRows(orgA.id);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0]?.actorId).toBe(grantA.employeeId);
    expect(await eventRows(orgB.id)).toHaveLength(0);
  });

  it("2. innsmuglet organisasjon, aktør og aktørtype i input overstyres av grant", async () => {
    const { orgA, orgB, grantA, grantB } = await samePersonInTwoOrganizations();

    await recordEvent(db, grantA, {
      type: "assignment.created",
      organizationId: orgB.id,
      actorId: grantB.employeeId,
      actorType: "system",
      createdBy: grantB.employeeId,
    } as never);

    expect(await eventRows(orgB.id)).toHaveLength(0);
    const rows = await eventRows(orgA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: orgA.id,
      actorId: grantA.employeeId,
      actorType: "employee",
      createdBy: grantA.employeeId,
    });
  });

  it("3. input med organizationId eller ukjent type gir typefeil (fanges av pnpm typecheck)", async () => {
    const { orgB, grantA } = await samePersonInTwoOrganizations();

    await recordEvent(db, grantA, {
      type: "assignment.created",
      // @ts-expect-error organisasjonen kommer bare fra tilgangssjekken
      organizationId: orgB.id,
    });
    await recordEvent(db, grantA, {
      // @ts-expect-error ukjent hendelseskode
      type: "ukjent.kode",
    });

    expect(await eventRows(orgB.id)).toHaveLength(0);
  });
});

describe("events i databasen", () => {
  it("1. actor_type utenfor de tre verdiene avvises", async () => {
    const org = await createOrganization();
    await expect(
      db.insert(events).values({
        organizationId: org.id,
        type: "assignment.created",
        actorType: "robot",
      }),
    ).rejects.toThrow();
    expect(await eventRows()).toHaveLength(0);
  });

  it("2. employee, system og integration godtas; system uten actor_id godtas", async () => {
    const org = await createOrganization();
    const { grant } = await personIn(org.id, ["inspector"]);

    await db.insert(events).values([
      {
        organizationId: org.id,
        type: "inspection.started",
        actorType: "employee",
        actorId: grant.employeeId,
      },
      {
        organizationId: org.id,
        type: "certification.expiring",
        actorType: "system",
        actorId: null,
      },
      {
        organizationId: org.id,
        type: "invoice.paid",
        actorType: "integration",
        actorId: randomUUID(),
      },
    ]);

    const rows = await eventRows(org.id);
    expect(rows.map((row) => row.actorType).sort()).toEqual(["employee", "integration", "system"]);
    expect(rows.find((row) => row.actorType === "system")?.actorId).toBeNull();
  });

  it("3. organization_id er påkrevd", async () => {
    await expect(
      db.execute(
        sql`insert into events (type, actor_type) values ('assignment.created', 'employee')`,
      ),
    ).rejects.toThrow();
    expect(await eventRows()).toHaveLength(0);
  });

  it("4. type er påkrevd", async () => {
    const org = await createOrganization();
    await expect(
      db.execute(
        sql`insert into events (organization_id, actor_type) values (${org.id}, 'employee')`,
      ),
    ).rejects.toThrow();
    expect(await eventRows()).toHaveLength(0);
  });

  it("5. resetDatabase tømmer events", async () => {
    const org = await createOrganization();
    const { grant } = await personIn(org.id, ["inspector"]);
    await recordEvent(db, grant, { type: "inspection.started" });
    expect(await eventRows()).toHaveLength(1);

    await resetDatabase();

    expect(await eventRows()).toHaveLength(0);
  });
});
