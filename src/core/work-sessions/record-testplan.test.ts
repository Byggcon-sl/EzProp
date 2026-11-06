import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, asc, count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  employees,
  events,
  organizations,
  workSessions,
  type EmployeeRole,
} from "@/db/schema";
import {
  createAssignment,
  createEmployee,
  createOrganization,
  createUser,
  createWorkSession,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { NotFoundError, readTimeTrackingEnabled, recordWorkActivity } from "./index";

/*
 * Automatisk registrering av arbeidsøkter (docs/funksjoner/fase2a-tidsmaling-testplan.md
 * avsnitt 5 og 10.2). Mot testdatabasen, alltid med fast `now` (TEST_NOW = 03.11.2026 11:00 Oslo).
 * Testdata er oppdiktet («Test Takstmann», oppdrag «TEST-…»).
 *
 * Avvises uten: tenant-isolasjon (5.5.1), IDOR (5.5.2), fremmednøkler (5.5.3), admin med bare
 * adminrollen (5.4.3), myk sletting (5.1.8, 5.6) og låsen (5.1.11). Regel 2, 3 og 11.
 *
 * Støtter hovedmål: tid (tiden måles uten et eneste trykk, og øktene deles riktig per fase) og
 * reklamasjoner (aldri data i feil organisasjon).
 */

beforeEach(resetDatabase);

const MIN = 60 * 1000;
const at = (ms: number) => new Date(TEST_NOW.getTime() + ms);
const YESTERDAY_OSLO = new Date("2026-11-02T13:00:00Z"); // 02.11 14:00 Oslo
const TODAY_OSLO = new Date("2026-11-03T08:00:00Z"); // 03.11 09:00 Oslo

async function person(organizationId: string, roles: EmployeeRole[], name = "Test Takstmann") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/** Organisasjon, en takstmann og et oppdrag under arbeid med befaring i går (fasen `office`). */
async function setup(
  assignment: { status?: string; inspectionAt?: Date | null } = {},
): Promise<{ orgId: string; actor: Actor; employeeId: string; assignmentId: string }> {
  const org = await createOrganization();
  const { actor, employee } = await person(org.id, ["inspector"]);
  const row = await createAssignment(org.id, {
    status: (assignment.status ?? "in_progress") as "in_progress",
    inspectionAt: assignment.inspectionAt === undefined ? YESTERDAY_OSLO : assignment.inspectionAt,
  });
  return { orgId: org.id, actor, employeeId: employee.id, assignmentId: row.id };
}

/** Alle økter i organisasjonen, også slettede, i rekkefølge. */
async function sessionRows(organizationId: string) {
  return db
    .select()
    .from(workSessions)
    .where(eq(workSessions.organizationId, organizationId))
    .orderBy(asc(workSessions.startedAt), asc(workSessions.createdAt));
}

async function allSessionCount() {
  const [row] = await db.select({ n: count() }).from(workSessions);
  return row?.n ?? 0;
}

async function setSettings(organizationId: string, settings: Record<string, unknown>) {
  await db.update(organizations).set({ settings }).where(eq(organizations.id, organizationId));
}

describe("5.1 registrering og økter", () => {
  it("5.1.1 første aktivitet lager én økt med now, riktig fase, organisasjon og ansatt", async () => {
    const { orgId, actor, employeeId, assignmentId } = await setup();
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);

    const rows = await sessionRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: orgId,
      assignmentId,
      employeeId,
      phase: "office",
      deletedAt: null,
    });
    expect(rows[0]!.startedAt.toISOString()).toBe(TEST_NOW.toISOString());
    expect(rows[0]!.endedAt.toISOString()).toBe(TEST_NOW.toISOString());
  });

  it.each([
    {
      name: "5.1.1 bestilt → preparation",
      status: "ordered",
      inspectionAt: null,
      phase: "preparation",
    },
    {
      name: "5.1.1 befaring i dag → inspection",
      status: "in_progress",
      inspectionAt: TODAY_OSLO,
      phase: "inspection",
    },
    {
      name: "5.1.1 ferdig → delivery",
      status: "completed",
      inspectionAt: YESTERDAY_OSLO,
      phase: "delivery",
    },
    {
      name: "5.1.1 fakturert → delivery",
      status: "invoiced",
      inspectionAt: YESTERDAY_OSLO,
      phase: "delivery",
    },
  ])("$name", async ({ status, inspectionAt, phase }) => {
    const { orgId, actor, assignmentId } = await setup({ status, inspectionAt });
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    const rows = await sessionRows(orgId);
    expect(rows.map((row) => row.phase)).toEqual([phase]);
  });

  it.each([
    { name: "5.1.2 9 min 59 s senere forlenger", gapMs: 9 * MIN + 59 * 1000, rows: 1 },
    { name: "5.1.4 akkurat 10 min forlenger", gapMs: 10 * MIN, rows: 1 },
    { name: "5.1.3 10 min 1 s senere gir ny økt", gapMs: 10 * MIN + 1000, rows: 2 },
  ])("$name", async ({ gapMs, rows: expectedRows }) => {
    const { orgId, actor, assignmentId } = await setup();
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    await recordWorkActivity(actor, orgId, assignmentId, at(gapMs));

    const rows = await sessionRows(orgId);
    expect(rows).toHaveLength(expectedRows);
    if (expectedRows === 1) {
      expect(rows[0]!.startedAt.toISOString()).toBe(TEST_NOW.toISOString());
      expect(rows[0]!.endedAt.toISOString()).toBe(at(gapMs).toISOString());
    } else {
      expect(rows[0]!.endedAt.toISOString()).toBe(TEST_NOW.toISOString());
      expect(rows[1]!.startedAt.toISOString()).toBe(at(gapMs).toISOString());
      expect(rows[1]!.endedAt.toISOString()).toBe(at(gapMs).toISOString());
      expect(rows[1]!.phase).toBe("office");
    }
  });

  it("5.1.2 flere aktiviteter med korte pauser blir én lang økt", async () => {
    const { orgId, actor, assignmentId } = await setup();
    for (let minute = 0; minute <= 40; minute += 5) {
      await recordWorkActivity(actor, orgId, assignmentId, at(minute * MIN));
    }
    const rows = await sessionRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.endedAt.getTime() - rows[0]!.startedAt.getTime()).toBe(40 * MIN);
  });

  it("5.1.5 statusendring innen 10 min gir ny økt i delivery, den gamle er uendret", async () => {
    const { orgId, actor, assignmentId } = await setup();
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    await recordWorkActivity(actor, orgId, assignmentId, at(2 * MIN));
    const [before] = await sessionRows(orgId);

    await db
      .update(assignments)
      .set({ status: "completed" })
      .where(eq(assignments.id, assignmentId));
    await recordWorkActivity(actor, orgId, assignmentId, at(5 * MIN));

    const rows = await sessionRows(orgId);
    expect(rows.map((row) => row.phase)).toEqual(["office", "delivery"]);
    expect(rows[0]).toEqual(before);
    expect(rows[1]!.startedAt.toISOString()).toBe(at(5 * MIN).toISOString());
  });

  it("5.1.6 befaringsdato endret til i dag innen 10 min gir ny økt i inspection", async () => {
    const { orgId, actor, assignmentId } = await setup();
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    await db
      .update(assignments)
      .set({ inspectionAt: TODAY_OSLO })
      .where(eq(assignments.id, assignmentId));
    await recordWorkActivity(actor, orgId, assignmentId, at(3 * MIN));

    const rows = await sessionRows(orgId);
    expect(rows.map((row) => row.phase)).toEqual(["office", "inspection"]);
  });

  it("5.1.7 over midnatt Oslo-tid: befaringsdagen blir office etter midnatt", async () => {
    const { orgId, actor, assignmentId } = await setup({ inspectionAt: TODAY_OSLO });
    await recordWorkActivity(actor, orgId, assignmentId, new Date("2026-11-03T22:55:00Z"));
    await recordWorkActivity(actor, orgId, assignmentId, new Date("2026-11-03T23:02:00Z"));

    const rows = await sessionRows(orgId);
    expect(rows.map((row) => row.phase)).toEqual(["inspection", "office"]);
    expect(rows[0]!.endedAt.toISOString()).toBe("2026-11-03T22:55:00.000Z");
    expect(rows[1]!.startedAt.toISOString()).toBe("2026-11-03T23:02:00.000Z");
  });

  it("5.1.8 siste økt er slettet: ny rad, den slettede er uendret", async () => {
    const { orgId, actor, assignmentId } = await setup();
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    const [first] = await sessionRows(orgId);
    await db
      .update(workSessions)
      .set({ deletedAt: at(MIN) })
      .where(eq(workSessions.id, first!.id));
    const [deleted] = await sessionRows(orgId);

    await recordWorkActivity(actor, orgId, assignmentId, at(2 * MIN));

    const rows = await sessionRows(orgId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === first!.id)).toEqual(deleted);
    const fresh = rows.find((row) => row.id !== first!.id)!;
    expect(fresh.deletedAt).toBeNull();
    expect(fresh.startedAt.toISOString()).toBe(at(2 * MIN).toISOString());
  });

  it("5.1.9 to ansatte på samme oppdrag får hver sin økt", async () => {
    const { orgId, actor, employeeId, assignmentId } = await setup();
    const other = await person(orgId, ["inspector"], "Test Takstmann To");
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    await recordWorkActivity(other.actor, orgId, assignmentId, at(MIN));
    await recordWorkActivity(actor, orgId, assignmentId, at(2 * MIN));

    const rows = await sessionRows(orgId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.employeeId).sort()).toEqual(
      [employeeId, other.employee.id].sort(),
    );
    const own = rows.find((row) => row.employeeId === employeeId)!;
    expect(own.endedAt.toISOString()).toBe(at(2 * MIN).toISOString());
  });

  it("5.1.10 samme ansatt på to oppdrag får hver sin økt", async () => {
    const { orgId, actor, assignmentId } = await setup();
    const second = await createAssignment(orgId, {
      status: "in_progress",
      inspectionAt: YESTERDAY_OSLO,
    });
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    await recordWorkActivity(actor, orgId, second.id, at(MIN));
    await recordWorkActivity(actor, orgId, assignmentId, at(2 * MIN));

    const rows = await sessionRows(orgId);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.assignmentId).sort()).toEqual([assignmentId, second.id].sort());
  });

  it("5.1.11 samtidige kall med samme now gir nøyaktig én rad (låsen)", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetDatabase();
      const { orgId, actor, assignmentId } = await setup();
      // `db` har en pool, så kallene går på hver sin forbindelse
      await Promise.all([
        recordWorkActivity(actor, orgId, assignmentId, TEST_NOW),
        recordWorkActivity(actor, orgId, assignmentId, TEST_NOW),
        recordWorkActivity(actor, orgId, assignmentId, TEST_NOW),
      ]);
      expect(await sessionRows(orgId)).toHaveLength(1);
    }
  });

  it("5.1.12 ended_at før started_at kan ikke lagres (CHECK)", async () => {
    const org = await createOrganization();
    await expect(
      createWorkSession(org.id, { startedAt: TEST_NOW, endedAt: at(-1000) }),
    ).rejects.toThrow();
    expect(await sessionRows(org.id)).toHaveLength(0);
    // Lik start og slutt er lov
    await expect(
      createWorkSession(org.id, { startedAt: TEST_NOW, endedAt: TEST_NOW }),
    ).resolves.toBeDefined();
  });

  it.each(["travel", "", "Preparation"])(
    "5.1.13 ukjent fase «%s» kan ikke lagres (CHECK)",
    async (phase) => {
      const org = await createOrganization();
      await expect(createWorkSession(org.id, { phase })).rejects.toThrow();
      expect(await sessionRows(org.id)).toHaveLength(0);
    },
  );

  it("5.1.14 ingen hendelse og ingen revisjonslogg per aktivitet", async () => {
    const { orgId, actor, assignmentId } = await setup();
    const countIn = async (table: typeof events | typeof auditLog) =>
      (await db.select({ n: count() }).from(table).where(eq(table.organizationId, orgId)))[0]!.n;
    const before = { events: await countIn(events), audit: await countIn(auditLog) };

    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    await recordWorkActivity(actor, orgId, assignmentId, at(MIN));
    await recordWorkActivity(actor, orgId, assignmentId, at(20 * MIN));

    expect({ events: await countIn(events), audit: await countIn(auditLog) }).toEqual(before);
  });
});

describe("5.2 bryteren", () => {
  it("5.2.1 time_tracking.enabled = false: ingen rad, ingen feil", async () => {
    const { orgId, actor, assignmentId } = await setup();
    await setSettings(orgId, { "time_tracking.enabled": false });
    await expect(recordWorkActivity(actor, orgId, assignmentId, TEST_NOW)).resolves.toBeDefined();
    expect(await sessionRows(orgId)).toHaveLength(0);
  });

  it("5.2.2 nøkkelen mangler: målingen er på", async () => {
    const { orgId, actor, assignmentId } = await setup();
    await setSettings(orgId, { "access.inspectors_edit_all": false });
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    expect(await sessionRows(orgId)).toHaveLength(1);
  });

  it.each([
    ["tekst «nei»", "nei"],
    ["tallet 0", 0],
    ["null", null],
    ["tekst «false»", "false"],
  ])("5.2.3 verdien er %s: målingen er på", async (_label, value) => {
    const orgId = "0190a000-0000-7000-8000-000000000001";
    expect(readTimeTrackingEnabled(orgId, { "time_tracking.enabled": value })).toBe(true);

    const setupResult = await setup();
    await setSettings(setupResult.orgId, { "time_tracking.enabled": value });
    await recordWorkActivity(
      setupResult.actor,
      setupResult.orgId,
      setupResult.assignmentId,
      TEST_NOW,
    );
    expect(await sessionRows(setupResult.orgId)).toHaveLength(1);
  });

  it.each([
    ["mangler", {}],
    ["settings er null", null],
    ["settings er en liste", []],
    ["true", { "time_tracking.enabled": true }],
  ])("5.2.3 readTimeTrackingEnabled: %s → på", (_label, settings) => {
    expect(readTimeTrackingEnabled("0190a000-0000-7000-8000-000000000001", settings)).toBe(true);
  });

  it("5.2.3 readTimeTrackingEnabled: false → av", () => {
    expect(
      readTimeTrackingEnabled("0190a000-0000-7000-8000-000000000001", {
        "time_tracking.enabled": false,
      }),
    ).toBe(false);
  });

  it("5.2.4 av og så på igjen: målingen fortsetter med ny rad", async () => {
    const { orgId, actor, assignmentId } = await setup();
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    await setSettings(orgId, { "time_tracking.enabled": false });
    await recordWorkActivity(actor, orgId, assignmentId, at(15 * MIN));
    expect(await sessionRows(orgId)).toHaveLength(1);
    await setSettings(orgId, { "time_tracking.enabled": true });
    await recordWorkActivity(actor, orgId, assignmentId, at(30 * MIN));

    const rows = await sessionRows(orgId);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.endedAt.toISOString()).toBe(TEST_NOW.toISOString());
    expect(rows[1]!.startedAt.toISOString()).toBe(at(30 * MIN).toISOString());
  });
});

describe("5.3 oppdraget", () => {
  it("5.3.1 kansellert (slettet) oppdrag gir NotFoundError og ingen rad", async () => {
    const { orgId, actor, assignmentId } = await setup();
    await db
      .update(assignments)
      .set({ deletedAt: at(-MIN) })
      .where(eq(assignments.id, assignmentId));
    await expect(recordWorkActivity(actor, orgId, assignmentId, TEST_NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await allSessionCount()).toBe(0);
  });

  it.each([
    ["tilfeldig uuid", "0190a000-0000-7000-8000-0000000000ff"],
    ["ikke-en-id", "ikke-en-id"],
    ["tom tekst", ""],
    ["SQL-tekst", "' or 1=1 --"],
  ])("5.3.2 %s gir NotFoundError, aldri databasefeil, ingen rad", async (_label, id) => {
    const { orgId, actor } = await setup();
    await expect(recordWorkActivity(actor, orgId, id, TEST_NOW)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await allSessionCount()).toBe(0);
  });
});

describe("5.4 tilgang per rolle", () => {
  it.each(["inspector", "office", "manager", "admin"] as const)(
    "5.4.1 %s får registrert tid",
    async (role) => {
      const { orgId, assignmentId } = await setup();
      const { actor, employee } = await person(orgId, [role]);
      await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
      const rows = await sessionRows(orgId);
      expect(rows.map((row) => row.employeeId)).toEqual([employee.id]);
    },
  );

  it("5.4.1 takstmann med access.inspectors_edit_all av får også registrert tid", async () => {
    const { orgId, actor, assignmentId } = await setup();
    await setSettings(orgId, { "access.inspectors_edit_all": false });
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    expect(await sessionRows(orgId)).toHaveLength(1);
  });

  it.each([
    { name: "ingen ansattrad", kind: "none" },
    { name: "deaktivert ansatt", kind: "deactivated" },
    { name: "slettet ansatt", kind: "deleted" },
    { name: "ansatt uten roller", kind: "noRoles" },
  ])("5.4.2 $name gir AccessDeniedError og ingen rad", async ({ kind }) => {
    const { orgId, assignmentId } = await setup();
    const actor = await createUser({ name: "Test Utenfor" });
    if (kind !== "none") {
      const employee = await createEmployee(actor, orgId, kind === "noRoles" ? [] : ["inspector"]);
      if (kind === "deactivated") {
        await db
          .update(employees)
          .set({ deactivatedAt: at(-MIN) })
          .where(eq(employees.id, employee.id));
      }
      if (kind === "deleted") {
        await db
          .update(employees)
          .set({ deletedAt: at(-MIN) })
          .where(eq(employees.id, employee.id));
      }
    }
    await expect(recordWorkActivity(actor, orgId, assignmentId, TEST_NOW)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await allSessionCount()).toBe(0);
  });

  it("5.4.3 admin med bare adminrollen får registrert tid (regel 11, skal aldri fjernes)", async () => {
    const { orgId, assignmentId } = await setup();
    const { actor, employee } = await person(orgId, ["admin"], "Test Admin");
    await setSettings(orgId, { "access.inspectors_edit_all": false });
    await recordWorkActivity(actor, orgId, assignmentId, TEST_NOW);
    const rows = await sessionRows(orgId);
    expect(rows.map((row) => row.employeeId)).toEqual([employee.id]);
  });
});

describe("5.5 tenant-isolasjon (regel 2)", () => {
  it("5.5.1 recordWorkActivity gir og leser bare økter i egen organisasjon", async () => {
    const assignmentByOrg = new Map<string, string>();

    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [grant, key] of [
          [grantA, "a"],
          [grantB, "b"],
        ] as const) {
          const assignment = await createAssignment(grant.organizationId, {
            status: "in_progress",
            inspectionAt: YESTERDAY_OSLO,
          });
          assignmentByOrg.set(grant.organizationId, assignment.id);
          const { actor } = await person(grant.organizationId, ["inspector"]);
          await recordWorkActivity(actor, grant.organizationId, assignment.id, TEST_NOW);
          const rows = await sessionRows(grant.organizationId);
          ids[key].push(...rows.map((row) => row.id));
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const assignmentId =
          assignmentByOrg.get(organizationId) ?? "0190a000-0000-7000-8000-0000000000ff";
        await recordWorkActivity(actor, organizationId, assignmentId, at(MIN));
        const grant = await requireOrganizationAccess(actor, organizationId);
        return sessionRows(grant.organizationId);
      },
      idOf: (row) => row.id,
    });
  });

  it("5.5.2 IDOR: admin i A med Bs oppdrags-id gir NotFoundError og ingen ny rad", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { actor: adminA } = await person(orgA.id, ["admin"], "Test Admin A");
    const { actor: inspectorB } = await person(orgB.id, ["inspector"], "Test Takstmann B");
    const assignmentB = await createAssignment(orgB.id, {
      status: "in_progress",
      inspectionAt: YESTERDAY_OSLO,
    });
    await recordWorkActivity(inspectorB, orgB.id, assignmentB.id, TEST_NOW);
    const sessionsB = await sessionRows(orgB.id);

    await expect(
      recordWorkActivity(adminA, orgA.id, assignmentB.id, at(MIN)),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(await sessionRows(orgA.id)).toHaveLength(0);
    expect(await sessionRows(orgB.id)).toEqual(sessionsB);
  });

  it("5.5.2 IDOR: admin i A med Bs organisasjons-id gir AccessDeniedError", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { actor: adminA } = await person(orgA.id, ["admin"], "Test Admin A");
    const assignmentB = await createAssignment(orgB.id, { status: "in_progress" });
    await expect(
      recordWorkActivity(adminA, orgB.id, assignmentB.id, TEST_NOW),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await allSessionCount()).toBe(0);
  });

  it("5.5.3 databasen nekter oppdrag fra en annen organisasjon", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const assignmentB = await createAssignment(orgB.id);
    await expect(createWorkSession(orgA.id, { assignmentId: assignmentB.id })).rejects.toThrow();
    expect(await allSessionCount()).toBe(0);
  });

  it("5.5.3 databasen nekter ansatt fra en annen organisasjon", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const { employee: employeeB } = await person(orgB.id, ["inspector"]);
    await expect(createWorkSession(orgA.id, { employeeId: employeeB.id })).rejects.toThrow();
    expect(await allSessionCount()).toBe(0);
  });
});

describe("5.6 myk sletting", () => {
  it("ingen kode i src/core/work-sessions sletter permanent", () => {
    const dir = path.join(process.cwd(), "src/core/work-sessions");
    const sources = readdirSync(dir).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(path.join(dir, file), "utf8");
      expect(text, file).not.toMatch(/\b(db|tx|executor)\.delete\(/);
      expect(text, file).not.toMatch(/\.delete\(\s*workSessions/);
      expect(text, file).not.toMatch(/delete\s+from/i);
      expect(text, file).not.toMatch(/\btruncate\b/i);
    }
  });
});

describe("10.2 createWorkSession", () => {
  it("lager rad i riktig organisasjon med oppdrag og ansatt fra samme organisasjon", async () => {
    const org = await createOrganization();
    const row = await createWorkSession(org.id);
    expect(row.organizationId).toBe(org.id);
    expect(row.endedAt.getTime()).toBeGreaterThanOrEqual(row.startedAt.getTime());

    const [assignment] = await db
      .select({ organizationId: assignments.organizationId })
      .from(assignments)
      .where(eq(assignments.id, row.assignmentId));
    const [employee] = await db
      .select({ organizationId: employees.organizationId })
      .from(employees)
      .where(and(eq(employees.id, row.employeeId)));
    expect(assignment?.organizationId).toBe(org.id);
    expect(employee?.organizationId).toBe(org.id);
  });

  it("tar imot oppdrag, ansatt, fase, tider og deletedAt", async () => {
    const org = await createOrganization();
    const assignment = await createAssignment(org.id);
    const { employee } = await person(org.id, ["inspector"]);
    const row = await createWorkSession(org.id, {
      assignmentId: assignment.id,
      employeeId: employee.id,
      phase: "inspection",
      startedAt: at(-30 * MIN),
      endedAt: TEST_NOW,
      deletedAt: TEST_NOW,
    });
    expect(row).toMatchObject({
      assignmentId: assignment.id,
      employeeId: employee.id,
      phase: "inspection",
    });
    expect(row.deletedAt?.toISOString()).toBe(TEST_NOW.toISOString());
  });
});
