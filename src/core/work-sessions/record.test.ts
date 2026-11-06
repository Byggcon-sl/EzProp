import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, organizations, workSessions } from "@/db/schema";
import {
  createAssignment,
  createEmployee,
  createOrganization,
  createUser,
  createWorkSession,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { NotFoundError, recordWorkActivity } from "./index";

/*
 * Kjernen i tidsmålingen: recordWorkActivity (docs/funksjoner/fase2a-tidsmaling.md punkt 3).
 * Grunntestene fra utvikleren; testplanen avsnitt 5 dekkes av testskriveren.
 * Støtter hovedmål: tid (målestokken for 50 % mindre tid mot IVIT).
 */

beforeEach(resetDatabase);

/** 03.11.2026 kl. 11 i Oslo. */
const NOW = new Date("2026-11-03T10:00:00Z");
const minutes = (value: number) => value * 60 * 1000;

async function setup(roles: Parameters<typeof createEmployee>[2] = ["inspector"]) {
  const organization = await createOrganization();
  const actor = await createUser();
  const employee = await createEmployee(actor, organization.id, roles);
  return { organization, actor, employee };
}

async function sessionsIn(organizationId: string) {
  return db
    .select()
    .from(workSessions)
    .where(eq(workSessions.organizationId, organizationId))
    .orderBy(asc(workSessions.startedAt), asc(workSessions.createdAt));
}

describe("recordWorkActivity", () => {
  it("første aktivitet lager én økt med fase, organisasjon og ansatt fra tilgangssjekken", async () => {
    const { organization, actor, employee } = await setup();
    const assignment = await createAssignment(organization.id, { status: "ordered" });
    await expect(recordWorkActivity(actor, organization.id, assignment.id, NOW)).resolves.toEqual({
      recorded: true,
    });
    const rows = await sessionsIn(organization.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      assignmentId: assignment.id,
      employeeId: employee.id,
      phase: "preparation",
      startedAt: NOW,
      endedAt: NOW,
    });
  });

  it("forlenger innen 10 minutter, også nøyaktig 10, og lager ny økt etter mer enn 10", async () => {
    const { organization, actor } = await setup();
    const assignment = await createAssignment(organization.id);
    await recordWorkActivity(actor, organization.id, assignment.id, NOW);
    const later = new Date(NOW.getTime() + minutes(10));
    await recordWorkActivity(actor, organization.id, assignment.id, later);
    let rows = await sessionsIn(organization.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.endedAt).toEqual(later);

    const afterPause = new Date(later.getTime() + minutes(10) + 1000);
    await recordWorkActivity(actor, organization.id, assignment.id, afterPause);
    rows = await sessionsIn(organization.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ startedAt: afterPause, endedAt: afterPause });
  });

  it("ny fase etter statusendring gir ny økt, den gamle er uendret", async () => {
    const { organization, actor } = await setup();
    const assignment = await createAssignment(organization.id, {
      status: "in_progress",
      inspectionAt: new Date("2026-11-02T13:00:00Z"),
    });
    await recordWorkActivity(actor, organization.id, assignment.id, NOW);
    await db
      .update(assignments)
      .set({ status: "completed" })
      .where(eq(assignments.id, assignment.id));
    const later = new Date(NOW.getTime() + minutes(2));
    await recordWorkActivity(actor, organization.id, assignment.id, later);
    const rows = await sessionsIn(organization.id);
    expect(rows.map((row) => row.phase)).toEqual(["office", "delivery"]);
    expect(rows[0]?.endedAt).toEqual(NOW);
  });

  it("over midnatt Oslo-tid gir ny økt i kontorarbeid", async () => {
    const { organization, actor } = await setup();
    const assignment = await createAssignment(organization.id, {
      status: "in_progress",
      inspectionAt: new Date("2026-11-03T08:00:00Z"),
    });
    await recordWorkActivity(actor, organization.id, assignment.id, new Date("2026-11-03T22:55Z"));
    await recordWorkActivity(actor, organization.id, assignment.id, new Date("2026-11-03T23:02Z"));
    expect((await sessionsIn(organization.id)).map((row) => row.phase)).toEqual([
      "inspection",
      "office",
    ]);
  });

  it("en slettet økt forlenges aldri", async () => {
    const { organization, actor, employee } = await setup();
    const assignment = await createAssignment(organization.id);
    const deleted = await createWorkSession(organization.id, {
      assignmentId: assignment.id,
      employeeId: employee.id,
      endedAt: new Date(NOW.getTime() - minutes(1)),
      deletedAt: NOW,
    });
    await recordWorkActivity(actor, organization.id, assignment.id, NOW);
    const rows = await sessionsIn(organization.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === deleted.id)).toMatchObject({
      endedAt: deleted.endedAt,
      deletedAt: NOW,
    });
  });

  it("to ansatte på samme oppdrag får hver sin økt", async () => {
    const { organization, actor } = await setup();
    const other = await createUser();
    await createEmployee(other, organization.id, ["office"]);
    const assignment = await createAssignment(organization.id);
    await recordWorkActivity(actor, organization.id, assignment.id, NOW);
    await recordWorkActivity(other, organization.id, assignment.id, NOW);
    expect(await sessionsIn(organization.id)).toHaveLength(2);
  });

  it("samtidige kall gir én økt (låsen)", async () => {
    const { organization, actor } = await setup();
    const assignment = await createAssignment(organization.id);
    await Promise.all([
      recordWorkActivity(actor, organization.id, assignment.id, NOW),
      recordWorkActivity(actor, organization.id, assignment.id, NOW),
    ]);
    expect(await sessionsIn(organization.id)).toHaveLength(1);
  });

  it("målingen av gir ingen rad og ingen feil; ikke-boolsk verdi gir måling på", async () => {
    const { organization, actor } = await setup();
    const assignment = await createAssignment(organization.id);
    await db
      .update(organizations)
      .set({ settings: { "time_tracking.enabled": false } })
      .where(eq(organizations.id, organization.id));
    await expect(recordWorkActivity(actor, organization.id, assignment.id, NOW)).resolves.toEqual({
      recorded: false,
    });
    expect(await sessionsIn(organization.id)).toHaveLength(0);

    await db
      .update(organizations)
      .set({ settings: { "time_tracking.enabled": "nei" } })
      .where(eq(organizations.id, organization.id));
    await recordWorkActivity(actor, organization.id, assignment.id, NOW);
    expect(await sessionsIn(organization.id)).toHaveLength(1);
  });

  it.each([
    ["slettet oppdrag", "deleted"],
    ["tilfeldig uuid", "random"],
    ["ikke en id", "invalid"],
  ])("%s gir ikke-funnet-feil og ingen rad", async (_label, kind) => {
    const { organization, actor } = await setup();
    const assignment = await createAssignment(organization.id, { deletedAt: NOW });
    const id = kind === "deleted" ? assignment.id : kind === "random" ? randomUUID() : "ikke-en-id";
    await expect(recordWorkActivity(actor, organization.id, id, NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await sessionsIn(organization.id)).toHaveLength(0);
  });

  it("admin med bare adminrollen får registrert tid (regel 11)", async () => {
    const { organization, actor } = await setup(["admin"]);
    const assignment = await createAssignment(organization.id);
    await recordWorkActivity(actor, organization.id, assignment.id, NOW);
    expect(await sessionsIn(organization.id)).toHaveLength(1);
  });

  it("databasen avviser ukjent fase og slutt før start", async () => {
    const { organization } = await setup();
    await expect(createWorkSession(organization.id, { phase: "travel" })).rejects.toThrow();
    await expect(
      createWorkSession(organization.id, { startedAt: NOW, endedAt: new Date(NOW.getTime() - 1) }),
    ).rejects.toThrow();
  });
});

describe("tenant-isolasjon (regel 2)", () => {
  it("recordWorkActivity skriver og leser bare i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const result = { a: [] as string[], b: [] as string[] };
        for (const [grant, ids] of [
          [grantA, result.a],
          [grantB, result.b],
        ] as const) {
          const assignment = await createAssignment(grant.organizationId);
          assignmentFor.set(grant.organizationId, assignment.id);
          const session = await createWorkSession(grant.organizationId, {
            assignmentId: assignment.id,
            employeeId: grant.employeeId,
            endedAt: new Date(NOW.getTime() - minutes(60)),
          });
          ids.push(session.id);
        }
        return result;
      },
      query: async (actor: Actor, organizationId: string) => {
        await recordWorkActivity(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
          NOW,
        );
        const grant = await requireOrganizationAccess(actor, organizationId);
        return sessionsIn(grant.organizationId);
      },
      idOf: (row) => row.id,
    });
  });

  it("oppdrags-id fra en annen organisasjon gir ikke-funnet-feil og ingen ny rad", async () => {
    const a = await setup(["admin"]);
    const b = await setup(["admin"]);
    const foreign = await createAssignment(b.organization.id);
    await expect(
      recordWorkActivity(a.actor, a.organization.id, foreign.id, NOW),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(await sessionsIn(a.organization.id)).toHaveLength(0);
    expect(await sessionsIn(b.organization.id)).toHaveLength(0);
  });

  it("databasen nekter oppdrag og ansatt fra en annen organisasjon", async () => {
    const a = await setup();
    const b = await setup();
    const foreignAssignment = await createAssignment(b.organization.id);
    await expect(
      createWorkSession(a.organization.id, {
        assignmentId: foreignAssignment.id,
        employeeId: a.employee.id,
      }),
    ).rejects.toThrow();
    await expect(
      createWorkSession(a.organization.id, { employeeId: b.employee.id }),
    ).rejects.toThrow();
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(workSessions)
      .where(and(eq(workSessions.organizationId, a.organization.id)));
    expect(row?.total).toBe(0);
  });
});
