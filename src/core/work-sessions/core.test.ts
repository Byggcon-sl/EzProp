import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { organizations, type EmployeeRole } from "@/db/schema";
import {
  auditRows,
  createAssignment,
  createEmployee,
  createOrganization,
  createUser,
  createWorkSession,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  getTimeStatistics,
  phaseForAssignment,
  saveTimeTrackingSettings,
  shouldSendActivity,
  summarizeTimeStatistics,
  TimeTrackingValidationError,
} from "./index";
import { loadTimeStatisticsRows } from "./statistics-db";

/*
 * Grunntester fra utvikleren for fase, måler, utregning, statistikk og innstillinger
 * (docs/funksjoner/fase2a-tidsmaling.md). Testplanen dekkes av testskriveren.
 * Støtter hovedmål: tid.
 */

beforeEach(resetDatabase);

const NOW = new Date("2026-11-03T10:00:00Z");
const BASELINE = { preparation: 60, inspection: 60, office: 60, delivery: 0, source: "Test" };

async function setup(roles: EmployeeRole[]) {
  const organization = await createOrganization();
  const actor = await createUser();
  const employee = await createEmployee(actor, organization.id, roles);
  return { organization, actor, employee };
}

describe("rene funksjoner", () => {
  it("faseregelen bruker Oslo-dato, også om sommeren", () => {
    expect(
      phaseForAssignment(
        { status: "in_progress", inspectionAt: new Date("2026-06-14T22:30:00Z") },
        new Date("2026-06-15T08:00:00Z"),
      ),
    ).toBe("inspection");
    expect(
      phaseForAssignment(
        { status: "in_progress", inspectionAt: new Date("2026-11-02T22:59:00Z") },
        NOW,
      ),
    ).toBe("office");
    expect(phaseForAssignment({ status: "in_progress", inspectionAt: null }, NOW)).toBe(
      "preparation",
    );
    expect(phaseForAssignment({ status: "invoiced", inspectionAt: null }, NOW)).toBe("delivery");
  });

  it("måleren sender første gang, så høyst hvert 60. sekund med ny aktivitet", () => {
    const sent = new Date(NOW.getTime() - 60_000);
    expect(
      shouldSendActivity({ lastSentAt: null, lastActivityAt: null, visible: true, now: NOW }),
    ).toBe(true);
    expect(
      shouldSendActivity({ lastSentAt: null, lastActivityAt: null, visible: false, now: NOW }),
    ).toBe(false);
    expect(
      shouldSendActivity({ lastSentAt: sent, lastActivityAt: sent, visible: true, now: NOW }),
    ).toBe(false);
    expect(
      shouldSendActivity({
        lastSentAt: sent,
        lastActivityAt: new Date(sent.getTime() + 1),
        visible: true,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("utregningen gir fasitsvaret og ingen tall uten oppdrag", () => {
    const summary = summarizeTimeStatistics(
      [
        { assignmentId: "x", phase: "preparation", seconds: 600 },
        { assignmentId: "x", phase: "inspection", seconds: 3600 },
        { assignmentId: "y", phase: "office", seconds: 1800 },
        { assignmentId: "y", phase: "delivery", seconds: 300 },
      ],
      BASELINE,
    );
    expect(summary.assignmentCount).toBe(2);
    expect(summary.phases.map((phase) => phase.averageSeconds)).toEqual([300, 1800, 900, 150]);
    expect(summary.phases.map((phase) => phase.differencePercent)).toEqual([-92, -50, -75, null]);
    expect(summary.total).toEqual({
      averageSeconds: 3150,
      baselineMinutes: 180,
      differencePercent: -71,
    });
    const empty = summarizeTimeStatistics([], BASELINE);
    expect(empty.assignmentCount).toBe(0);
    expect(empty.total.averageSeconds).toBe(0);
    expect(empty.total.differencePercent).toBeNull();
  });
});

describe("getTimeStatistics", () => {
  it("teller bare ferdige og fakturerte oppdrag med økter som ikke er slettet", async () => {
    const { organization, actor } = await setup(["manager"]);
    const done = await createAssignment(organization.id, { status: "completed" });
    const open = await createAssignment(organization.id, { status: "in_progress" });
    const deletedAssignment = await createAssignment(organization.id, {
      status: "invoiced",
      deletedAt: NOW,
    });
    await createWorkSession(organization.id, { assignmentId: done.id });
    await createWorkSession(organization.id, { assignmentId: done.id, deletedAt: NOW });
    await createWorkSession(organization.id, { assignmentId: open.id });
    await createWorkSession(organization.id, { assignmentId: deletedAssignment.id });
    const result = await getTimeStatistics(actor, organization.id);
    expect(result.assignmentCount).toBe(1);
    expect(result.total.averageSeconds).toBe(1800);
    expect(JSON.stringify(result)).not.toMatch(/employee/i);
  });

  it.each<[EmployeeRole[], boolean]>([
    [["inspector"], false],
    [["office"], false],
    [["manager"], true],
    [["admin"], true],
  ])("tilgang for %j: %s", async (roles, allowed) => {
    const { organization, actor } = await setup(roles);
    const call = getTimeStatistics(actor, organization.id);
    if (allowed) await expect(call).resolves.toBeDefined();
    else await expect(call).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it("statistics.read kan ikke gis som enkeltrettighet (A21)", async () => {
    const { organization, actor, employee } = await setup(["inspector"]);
    await grantPermission(employee, "statistics.read");
    await expect(getTimeStatistics(actor, organization.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("tenant-isolasjon: bare oppdrag i egen organisasjon telles", async () => {
    await expectTenantIsolation({
      seed: async (grantA: EmployeeGrant, grantB: EmployeeGrant) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [grant, list] of [
          [grantA, ids.a],
          [grantB, ids.b],
        ] as const) {
          const assignment = await createAssignment(grant.organizationId, { status: "completed" });
          await createWorkSession(grant.organizationId, { assignmentId: assignment.id });
          list.push(assignment.id);
        }
        return ids;
      },
      query: async (actor: Actor, organizationId: string) => {
        await getTimeStatistics(actor, organizationId);
        const rows = await loadTimeStatisticsRows(db, organizationId);
        return [...new Set(rows.map((row) => row.assignmentId))];
      },
      idOf: (id) => id,
    });
  });
});

describe("saveTimeTrackingSettings", () => {
  it("slår sammen og beholder andre nøkler, og skriver revisjonslogg med nøkkelnavn", async () => {
    const { organization, actor } = await setup(["admin"]);
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false, "test.annet": "x" } })
      .where(eq(organizations.id, organization.id));
    await saveTimeTrackingSettings(actor, organization.id, { enabled: false });
    const row = await saveTimeTrackingSettings(actor, organization.id, { baseline: BASELINE });
    expect(row.settings).toEqual({
      "access.inspectors_edit_all": false,
      "test.annet": "x",
      "time_tracking.enabled": false,
      "time_tracking.baseline": BASELINE,
    });
    const audits = await auditRows(organization.id);
    expect(audits.map((audit) => audit.changes)).toEqual([
      { settings: ["time_tracking.enabled"] },
      { settings: ["time_tracking.baseline"] },
    ]);
  });

  it("samtidig lagring av bryter og nullpunkt mister ingen nøkkel", async () => {
    const { organization, actor } = await setup(["admin"]);
    await Promise.all([
      saveTimeTrackingSettings(actor, organization.id, { enabled: true }),
      saveTimeTrackingSettings(actor, organization.id, { baseline: BASELINE }),
    ]);
    const [row] = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organization.id));
    expect(Object.keys(row?.settings ?? {}).sort()).toEqual([
      "time_tracking.baseline",
      "time_tracking.enabled",
    ]);
  });

  it.each<EmployeeRole>(["manager", "inspector", "office"])(
    "%s får AccessDeniedError og ingen logg",
    async (role) => {
      const { organization, actor } = await setup([role]);
      await expect(
        saveTimeTrackingSettings(actor, organization.id, { enabled: false }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      expect(await auditRows(organization.id)).toHaveLength(0);
    },
  );

  it("ugyldig input gir valideringsfeil og ingenting lagres", async () => {
    const { organization, actor } = await setup(["admin"]);
    for (const input of [
      {},
      { baseline: { ...BASELINE, office: 10_001 } },
      { baseline: { ...BASELINE, office: 12.5 } },
      { baseline: { ...BASELINE, source: "x".repeat(201) } },
      { enabled: "ja" },
    ]) {
      await expect(saveTimeTrackingSettings(actor, organization.id, input)).rejects.toBeInstanceOf(
        TimeTrackingValidationError,
      );
    }
    expect(await auditRows(organization.id)).toHaveLength(0);
  });

  it("tenant-isolasjon: lagringen endrer bare egen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => ({ a: [grantA.organizationId], b: [grantB.organizationId] }),
      query: async (actor, organizationId) => [
        await saveTimeTrackingSettings(actor, organizationId, { enabled: true }),
      ],
      idOf: (row) => row.id,
    });
  });
});

describe("myk sletting", () => {
  it("ingen fil i modulen sletter permanent", () => {
    const dir = path.resolve(process.cwd(), "src/core/work-sessions");
    for (const file of readdirSync(dir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    )) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/\b(db|tx)\.delete\(|DELETE FROM/i);
    }
  });
});
