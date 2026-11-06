import { and, eq, exists, inArray, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { assignments, organizations, workSessions, type EmployeeRole } from "@/db/schema";
import {
  createAssignment,
  createEmployee,
  createOrganization,
  createUser,
  createWorkSession,
  grantPermission,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { getTimeStatistics, summarizeTimeStatistics, type WorkPhase } from "./index";

/*
 * Statistikken mot databasen (docs/funksjoner/fase2a-tidsmaling-testplan.md avsnitt 7, A122 og
 * A124). Øktene legges inn med `createWorkSession` og faste tider rundt TEST_NOW. Oppdiktet
 * måling, kilde «Oppdiktet måling, 3 oppdrag». Ingen ekte navn.
 *
 * Avvises uten: tenant-isolasjon (7.3.1), admin med bare adminrollen (7.2.3), at
 * `statistics.read` ikke kan gis enkeltvis (7.2.4) og ingen ansattfelt (7.1.9).
 *
 * Støtter hovedmål: tid (leder ser snittet per fase mot IVIT, regnet likt hver gang) og
 * arbeidsmiljøloven kapittel 9 (bare samlet, aldri per person).
 */

beforeEach(resetDatabase);

const MIN = 60 * 1000;
const SOURCE = "Oppdiktet måling, 3 oppdrag";

async function person(organizationId: string, roles: EmployeeRole[], name = "Test Leder") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

async function orgWithManager(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const { actor } = await person(org.id, ["manager"]);
  return { orgId: org.id, actor };
}

/** Én økt på `seconds` sekunder som slutter ved TEST_NOW. */
async function session(
  organizationId: string,
  assignmentId: string,
  phase: WorkPhase,
  seconds: number,
  extra: { employeeId?: string; deletedAt?: Date | null } = {},
) {
  return createWorkSession(organizationId, {
    assignmentId,
    phase,
    startedAt: new Date(TEST_NOW.getTime() - seconds * 1000),
    endedAt: TEST_NOW,
    ...extra,
  });
}

async function assignment(
  organizationId: string,
  status: "ordered" | "in_progress" | "completed" | "invoiced" = "completed",
  deletedAt: Date | null = null,
) {
  return createAssignment(organizationId, { status, deletedAt });
}

async function setBaseline(organizationId: string, minutes: Record<WorkPhase, number>) {
  await db
    .update(organizations)
    .set({ settings: { "time_tracking.baseline": { ...minutes, source: SOURCE } } })
    .where(eq(organizations.id, organizationId));
}

function phaseRow(stats: Awaited<ReturnType<typeof getTimeStatistics>>, phase: WorkPhase) {
  const row = stats.phases.find((candidate) => candidate.phase === phase);
  if (!row) throw new Error(`mangler fasen ${phase}`);
  return row;
}

/**
 * Intern testhjelper: id-ene til oppdragene som telles (ferdig eller fakturert, ikke slettet, minst
 * én økt som ikke er slettet). Skrevet ut fra A124, ikke hentet fra produktkoden.
 */
async function countedAssignmentIds(organizationId: string): Promise<{ id: string }[]> {
  return db
    .select({ id: assignments.id })
    .from(assignments)
    .where(
      and(
        eq(assignments.organizationId, organizationId),
        isNull(assignments.deletedAt),
        inArray(assignments.status, ["completed", "invoiced"]),
        exists(
          db
            .select({ id: workSessions.id })
            .from(workSessions)
            .where(
              and(
                eq(workSessions.organizationId, organizationId),
                eq(workSessions.assignmentId, assignments.id),
                isNull(workSessions.deletedAt),
              ),
            ),
        ),
      ),
    );
}

/** Fasitsvaret fra 4.1: X har forberedelse 600 s og befaring 3 600 s, Y kontor 1 800 s og levering 300 s. */
async function seedFasit(organizationId: string) {
  const x = await assignment(organizationId, "completed");
  const y = await assignment(organizationId, "invoiced");
  await session(organizationId, x.id, "preparation", 600);
  await session(organizationId, x.id, "inspection", 3600);
  await session(organizationId, y.id, "office", 1800);
  await session(organizationId, y.id, "delivery", 300);
  return { x, y };
}

describe("7.1 fasitsvar (A122, A124)", () => {
  it("7.1.1 samme svar som den rene funksjonen", async () => {
    const { orgId, actor } = await orgWithManager();
    await seedFasit(orgId);

    const stats = await getTimeStatistics(actor, orgId);
    expect(stats.assignmentCount).toBe(2);
    expect(phaseRow(stats, "preparation").averageSeconds).toBeCloseTo(300, 6);
    expect(phaseRow(stats, "inspection").averageSeconds).toBeCloseTo(1800, 6);
    expect(phaseRow(stats, "office").averageSeconds).toBeCloseTo(900, 6);
    expect(phaseRow(stats, "delivery").averageSeconds).toBeCloseTo(150, 6);
    expect(stats.total.averageSeconds).toBeCloseTo(3150, 6);

    const pure = summarizeTimeStatistics(
      [
        { assignmentId: "X", phase: "preparation", seconds: 600 },
        { assignmentId: "X", phase: "inspection", seconds: 3600 },
        { assignmentId: "Y", phase: "office", seconds: 1800 },
        { assignmentId: "Y", phase: "delivery", seconds: 300 },
      ],
      null,
    );
    expect({ count: stats.assignmentCount, phases: stats.phases, total: stats.total }).toEqual({
      count: pure.assignmentCount,
      phases: pure.phases,
      total: pure.total,
    });
  });

  it("7.1.1 flere økter i samme fase summeres", async () => {
    const { orgId, actor } = await orgWithManager();
    const x = await assignment(orgId);
    await session(orgId, x.id, "office", 600);
    await createWorkSession(orgId, {
      assignmentId: x.id,
      phase: "office",
      startedAt: new Date(TEST_NOW.getTime() - 120 * MIN),
      endedAt: new Date(TEST_NOW.getTime() - 100 * MIN),
    });
    const stats = await getTimeStatistics(actor, orgId);
    expect(phaseRow(stats, "office").averageSeconds).toBeCloseTo(600 + 1200, 6);
  });

  it.each(["ordered", "in_progress"] as const)(
    "7.1.2 oppdrag med status %s telles ikke",
    async (status) => {
      const { orgId, actor } = await orgWithManager();
      await seedFasit(orgId);
      const open = await assignment(orgId, status);
      await session(orgId, open.id, "preparation", 9999);

      const stats = await getTimeStatistics(actor, orgId);
      expect(stats.assignmentCount).toBe(2);
      expect(stats.total.averageSeconds).toBeCloseTo(3150, 6);
    },
  );

  it("7.1.3 fakturert telles", async () => {
    const { orgId, actor } = await orgWithManager();
    const invoiced = await assignment(orgId, "invoiced");
    await session(orgId, invoiced.id, "office", 1200);
    const stats = await getTimeStatistics(actor, orgId);
    expect(stats.assignmentCount).toBe(1);
    expect(phaseRow(stats, "office").averageSeconds).toBeCloseTo(1200, 6);
  });

  it("7.1.4 slettede økter telles ikke", async () => {
    const { orgId, actor } = await orgWithManager();
    const { x } = await seedFasit(orgId);
    await session(orgId, x.id, "office", 5000, { deletedAt: TEST_NOW });

    const stats = await getTimeStatistics(actor, orgId);
    expect(stats.assignmentCount).toBe(2);
    expect(stats.total.averageSeconds).toBeCloseTo(3150, 6);
  });

  it("7.1.4 ferdig oppdrag der alle økter er slettet, telles ikke i antallet", async () => {
    const { orgId, actor } = await orgWithManager();
    await seedFasit(orgId);
    const onlyDeleted = await assignment(orgId, "completed");
    await session(orgId, onlyDeleted.id, "office", 600, { deletedAt: TEST_NOW });
    await session(orgId, onlyDeleted.id, "delivery", 600, { deletedAt: TEST_NOW });

    const stats = await getTimeStatistics(actor, orgId);
    expect(stats.assignmentCount).toBe(2);
    expect(stats.total.averageSeconds).toBeCloseTo(3150, 6);
  });

  it("7.1.5 slettede oppdrag telles ikke", async () => {
    const { orgId, actor } = await orgWithManager();
    await seedFasit(orgId);
    const cancelled = await assignment(orgId, "completed", TEST_NOW);
    await session(orgId, cancelled.id, "office", 7200);

    const stats = await getTimeStatistics(actor, orgId);
    expect(stats.assignmentCount).toBe(2);
    expect(stats.total.averageSeconds).toBeCloseTo(3150, 6);
  });

  it("7.1.6 ferdig oppdrag uten økter telles ikke i antallet", async () => {
    const { orgId, actor } = await orgWithManager();
    await seedFasit(orgId);
    await assignment(orgId, "completed");
    await assignment(orgId, "invoiced");

    const stats = await getTimeStatistics(actor, orgId);
    expect(stats.assignmentCount).toBe(2);
    expect(phaseRow(stats, "preparation").averageSeconds).toBeCloseTo(300, 6);
  });

  it("7.1.7 flere ansatte på samme oppdrag: tiden summeres, oppdraget telles én gang", async () => {
    const { orgId, actor } = await orgWithManager();
    const x = await assignment(orgId);
    const first = await person(orgId, ["inspector"], "Test Takstmann En");
    const second = await person(orgId, ["inspector"], "Test Takstmann To");
    await session(orgId, x.id, "office", 1200, { employeeId: first.employee.id });
    await session(orgId, x.id, "office", 600, { employeeId: second.employee.id });

    const stats = await getTimeStatistics(actor, orgId);
    expect(stats.assignmentCount).toBe(1);
    expect(phaseRow(stats, "office").averageSeconds).toBeCloseTo(1800, 6);
  });

  it("7.1.7 ingen oppdrag som telles: antall 0 og ingen tall", async () => {
    const { orgId, actor } = await orgWithManager();
    const stats = await getTimeStatistics(actor, orgId);
    expect(stats.assignmentCount).toBe(0);
    expect(stats.total.averageSeconds).toBe(0);
    expect(stats.total.differencePercent).toBeNull();
  });

  it("7.1.8 nullpunktet fra innstillingen kommer med i svaret", async () => {
    const { orgId, actor } = await orgWithManager();
    await seedFasit(orgId);
    await setBaseline(orgId, { preparation: 10, inspection: 60, office: 0, delivery: 5 });

    const stats = await getTimeStatistics(actor, orgId);
    expect(phaseRow(stats, "preparation").baselineMinutes).toBe(10);
    expect(phaseRow(stats, "preparation").differencePercent).toBe(-50); // 5 min mot 10
    expect(phaseRow(stats, "inspection").differencePercent).toBe(-50); // 30 min mot 60
    expect(phaseRow(stats, "office").differencePercent).toBeNull(); // nullpunkt 0
    expect(phaseRow(stats, "delivery").differencePercent).toBe(-50); // 2,5 min mot 5
    expect(stats.total.baselineMinutes).toBe(75);
    expect(stats.total.differencePercent).toBe(-30); // 52,5 min mot 75
  });

  it("7.1.8 nullpunktet mangler: forskjellen er null", async () => {
    const { orgId, actor } = await orgWithManager();
    await seedFasit(orgId);
    const stats = await getTimeStatistics(actor, orgId);
    for (const row of [...stats.phases, stats.total]) {
      expect(row.baselineMinutes).toBeNull();
      expect(row.differencePercent).toBeNull();
    }
  });

  it("7.1.9 svaret har bare faste nøkler og ingen ansatt-id eller navn", async () => {
    const { orgId, actor } = await orgWithManager();
    const x = await assignment(orgId);
    const inspector = await person(orgId, ["inspector"], "Test Personnavn Måling");
    await session(orgId, x.id, "office", 1200, { employeeId: inspector.employee.id });
    await setBaseline(orgId, { preparation: 10, inspection: 20, office: 30, delivery: 40 });

    const stats = await getTimeStatistics(actor, orgId);
    expect(Object.keys(stats).sort()).toEqual([
      "assignmentCount",
      "baseline",
      "enabled",
      "phases",
      "total",
    ]);
    for (const row of stats.phases) {
      expect(Object.keys(row).sort()).toEqual([
        "averageSeconds",
        "baselineMinutes",
        "differencePercent",
        "phase",
      ]);
    }
    expect(Object.keys(stats.total).sort()).toEqual([
      "averageSeconds",
      "baselineMinutes",
      "differencePercent",
    ]);
    expect(Object.keys(stats.baseline ?? {}).sort()).toEqual([
      "delivery",
      "inspection",
      "office",
      "preparation",
      "source",
    ]);

    const json = JSON.stringify(stats);
    expect(json).not.toContain(inspector.employee.id);
    expect(json).not.toContain(inspector.actor.id);
    expect(json).not.toContain("Test Personnavn Måling");
    expect(json).not.toContain(inspector.actor.email);
    expect(json).not.toContain(x.id);
    expect(json).not.toMatch(/employee|userId|email/i);
  });
});

describe("7.2 tilgang per rolle", () => {
  it.each(["inspector", "office"] as const)("7.2.1 %s får AccessDeniedError", async (role) => {
    const { orgId } = await orgWithManager();
    await seedFasit(orgId);
    const { actor } = await person(orgId, [role], "Test Uten Statistikk");
    await expect(getTimeStatistics(actor, orgId)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("7.2.1 takstmann med access.inspectors_edit_all på får likevel AccessDeniedError", async () => {
    const { orgId } = await orgWithManager();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": true } })
      .where(eq(organizations.id, orgId));
    const { actor } = await person(orgId, ["inspector"], "Test Takstmann");
    await expect(getTimeStatistics(actor, orgId)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it.each(["manager", "admin"] as const)("7.2.2 %s får svar", async (role) => {
    const org = await createOrganization();
    await seedFasit(org.id);
    const { actor } = await person(org.id, [role]);
    const stats = await getTimeStatistics(actor, org.id);
    expect(stats.assignmentCount).toBe(2);
  });

  it("7.2.3 admin med bare adminrollen får svar (regel 11, skal aldri fjernes)", async () => {
    const org = await createOrganization();
    await seedFasit(org.id);
    const { actor } = await person(org.id, ["admin"], "Test Admin");
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false, "time_tracking.enabled": false } })
      .where(eq(organizations.id, org.id));
    const stats = await getTimeStatistics(actor, org.id);
    expect(stats.assignmentCount).toBe(2);
    expect(stats.enabled).toBe(false);
  });

  it.each(["inspector", "office"] as const)(
    "7.2.4 %s med enkeltrettigheten statistics.read får fortsatt AccessDeniedError (A21)",
    async (role) => {
      const org = await createOrganization();
      const { actor: admin } = await person(org.id, ["admin"], "Test Admin");
      const { actor, employee } = await person(org.id, [role], "Test Takstmann");
      await grantPermission(employee, "statistics.read", admin.id);
      await expect(getTimeStatistics(actor, org.id)).rejects.toBeInstanceOf(AccessDeniedError);
    },
  );

  it("ukjent bruker får AccessDeniedError", async () => {
    const org = await createOrganization();
    const stranger: Actor = await createUser({ name: "Test Fremmed" });
    await expect(getTimeStatistics(stranger, org.id)).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

describe("7.3 tenant-isolasjon (regel 2)", () => {
  it("7.3.1 getTimeStatistics teller bare oppdrag i egen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [grant, key] of [
          [grantA, "a"],
          [grantB, "b"],
        ] as const) {
          const done = await assignment(grant.organizationId, "completed");
          await session(grant.organizationId, done.id, "office", 1800);
          ids[key].push(done.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const stats = await getTimeStatistics(actor, organizationId);
        const grant = await requireOrganizationAccess(actor, organizationId);
        const counted = await countedAssignmentIds(grant.organizationId);
        // Antallet fra produktkoden skal stemme med oppdragene testhjelperen finner
        expect(stats.assignmentCount).toBe(counted.length);
        return counted;
      },
      idOf: (row) => row.id,
    });
  });

  it("7.3.2 tallprøve: A har 30 minutter, B har 90", async () => {
    const a = await orgWithManager("Organisasjon A");
    const b = await orgWithManager("Organisasjon B");
    const doneA = await assignment(a.orgId);
    const doneB = await assignment(b.orgId);
    await session(a.orgId, doneA.id, "office", 30 * 60);
    await session(b.orgId, doneB.id, "office", 90 * 60);

    const statsA = await getTimeStatistics(a.actor, a.orgId);
    const statsB = await getTimeStatistics(b.actor, b.orgId);
    expect(statsA.assignmentCount).toBe(1);
    expect(statsA.total.averageSeconds).toBeCloseTo(30 * 60, 6);
    expect(statsB.assignmentCount).toBe(1);
    expect(statsB.total.averageSeconds).toBeCloseTo(90 * 60, 6);

    await expect(getTimeStatistics(a.actor, b.orgId)).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
