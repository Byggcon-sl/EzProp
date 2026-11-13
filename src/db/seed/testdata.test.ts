import { readFileSync } from "node:fs";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccessDeniedError,
  permissions,
  requireOrganizationAccess,
  type Actor,
} from "@/core/access";
import { countWorkQueueByStatus, listWorkQueue } from "@/core/assignments";
import { listClaimsForAssignment, updateClaim } from "@/core/claims";
import { listOrders } from "@/core/orders";
import { db } from "@/db/client";
import {
  accounts,
  assignmentParties,
  assignments,
  assignmentTeamMembers,
  auditLog,
  claims,
  contacts,
  employeeRoleAssignments,
  employees,
  events,
  firms,
  floorAreas,
  integrationConnections,
  orders,
  organizations,
  reportBuildings,
  rooms,
  sessions,
  users,
  workSessions,
} from "@/db/schema";
import { brand } from "@/shared/config/brand";
import { resetEnvCache } from "@/shared/config/env";
import {
  TEST_NOW,
  activeAdminCount,
  createContact,
  createEmployee,
  createFirm,
  createOrder,
  createOrganization,
  createProperty,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { runSeed } from "./run";
import { runSampleSeed } from "./sample-assignments";
import { SAMPLE_ORGANIZATION_NAME } from "./sample-assignments.data";
import {
  TESTDATA_ORGANIZATION_MISSING_MESSAGE,
  TESTDATA_USER_CONFLICT_MESSAGE,
  TestdataSetupError,
  TestdataStepError,
  anchorFromCreatedAt,
  buildTestdataPlan,
  findAnchorOrder,
  findTestdataContacts,
  findTestdataEmployees,
  findTestdataFirms,
  findTestdataOrders,
  findTestdataProperties,
  seedTestdata,
} from "./testdata";
import { TestdataNotAllowedError } from "./testdata-guard";
import { TESTDATA_SEED } from "./testdata.data";
import type { TestdataPlan } from "./testdata.types";

/*
 * Seed-steget for testdata mot testdatabasen (docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md
 * seksjon 4). En full kjøring tar noen sekunder, så hver blokk kjører den én gang i `beforeAll` og
 * prøver flere ting på samme data. Alle data er oppdiktet.
 *
 * Støtter hovedmål: de ansatte får en full, lik arbeidsdag i testmiljøet uten at ekte arbeid,
 * admin eller innstillinger røres, og færre reklamasjoner fordi lister og søk prøves med mengde.
 */

/** Feil som testene kan tvinge fram midt i en kjøring (avbrutt kjøring, 4.16 og 4.17). */
const failures = vi.hoisted(() => ({
  firm: false,
  orderRef: null as string | null,
}));

vi.mock("@/core/contacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/contacts")>();
  return {
    ...actual,
    createFirm: async (...args: Parameters<typeof actual.createFirm>) => {
      if (failures.firm) throw new Error("påtvunget feil i testen");
      return actual.createFirm(...args);
    },
  };
});

vi.mock("@/core/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/orders")>();
  return {
    ...actual,
    createOrder: async (...args: Parameters<typeof actual.createOrder>) => {
      if (failures.orderRef !== null && args[2].externalRef === failures.orderRef) {
        throw new Error("påtvunget feil i testen");
      }
      return actual.createOrder(...args);
    },
  };
});

const SEED_ENV = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };
const FULL_RUN = 120_000;

const COUNTED_TABLES = [
  "users",
  "employees",
  "employee_roles",
  "certifications",
  "firms",
  "contacts",
  "orders",
  "assignments",
  "assignment_team_members",
  "assignment_parties",
  "properties",
  "cadastral_units",
  "common_areas",
  "report_buildings",
  "floors",
  "rooms",
  "floor_areas",
  "work_sessions",
  "claims",
  "events",
  "audit_log",
  "number_sequences",
  "sessions",
  "accounts",
  "ai_usage_log",
  "organizations",
  "integration_connections",
] as const;

/** Antall rader per tabell, pluss summen i nummerserien og antall mykt slettede rader. */
async function countRows(): Promise<Record<string, number>> {
  const parts = COUNTED_TABLES.map(
    (table) => `(select count(*)::int from ${table}) as "${table}"`,
  ).join(", ");
  const [row] = (await db.execute(
    sql.raw(
      `select ${parts}, (select coalesce(sum(next_value), 0)::int from number_sequences) as "number_sequences.next_value"`,
    ),
  )) as unknown as Record<string, number>[];
  return { ...row! };
}

/** Antall rader med `deleted_at` i tabellene skriptet skriver til. */
async function countDeleted(): Promise<number> {
  const tables = COUNTED_TABLES.filter(
    (table) =>
      !["users", "sessions", "accounts", "ai_usage_log", "number_sequences"].includes(table),
  );
  const parts = tables
    .map((table) => `(select count(*)::int from ${table} where deleted_at is not null)`)
    .join(" + ");
  const [row] = (await db.execute(sql.raw(`select ${parts} as n`))) as unknown as { n: number }[];
  return row!.n;
}

/** Siste `updated_at` i tabellene med testdata (andre kjøring skal ikke endre noen rad). */
async function latestUpdate(): Promise<string> {
  const tables = COUNTED_TABLES.filter(
    (table) =>
      !["users", "sessions", "accounts", "ai_usage_log", "audit_log", "number_sequences"].includes(
        table,
      ),
  );
  const parts = tables.map((table) => `(select max(updated_at) from ${table})`).join(", ");
  const [row] = (await db.execute(
    sql.raw(`select greatest(${parts})::text as latest`),
  )) as unknown as { latest: string }[];
  return row!.latest;
}

async function byggcon() {
  const [row] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, brand.companyName));
  if (!row) throw new Error("Byggcon mangler i testen");
  return row;
}

async function seedAdmin(): Promise<Actor> {
  const [user] = await db.select().from(users).where(eq(users.email, SEED_ENV.SEED_ADMIN_EMAIL));
  if (!user) throw new Error("admin mangler i testen");
  return { id: user.id, email: user.email, name: user.name };
}

function planFor(now: Date): TestdataPlan {
  return buildTestdataPlan({ seed: TESTDATA_SEED, anchor: now });
}

function converted(plan: TestdataPlan) {
  return plan.orders.flatMap((order) =>
    order.converted ? [{ order, assignment: order.converted.assignment }] : [],
  );
}

/** Oppdrags-id per TD-nøkkel i Byggcon. */
async function assignmentIdsByRef(organizationId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ ref: orders.externalRef, assignmentId: orders.assignmentId })
    .from(orders)
    .where(and(eq(orders.organizationId, organizationId), isNotNull(orders.assignmentId)));
  return new Map(rows.map((row) => [row.ref!, row.assignmentId!]));
}

/** Aktøren for en oppdiktet ansatt (planens nøkkel er e-posten). */
async function actorFor(email: string): Promise<Actor> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error("fant ikke den oppdiktede brukeren");
  return { id: user.id, email: user.email, name: user.name };
}

beforeEach(() => {
  failures.firm = false;
  failures.orderRef = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------------------------
// 4.1, 4.2, 4.6, 4.7, 4.8, 4.10 og 4.12: første kjøring, idempotens, ekte arbeid og tilgang
// ---------------------------------------------------------------------------------------------

describe("seedTestdata: full kjøring", { timeout: FULL_RUN }, () => {
  let organizationId: string;
  let sampleOrganizationId: string;
  let plan: TestdataPlan;
  let before: Record<string, number>;
  let afterFirst: Record<string, number>;
  let afterFirstLatest: string;
  let start: Date;
  let end: Date;
  let admin: Actor;
  let adminRolesBefore: string[];
  let adminsBefore: number;
  let settingsBefore: unknown;
  let connectionsBefore: unknown[];
  let sampleBefore: Record<string, number>;
  let realWork: { orderId: string; contactId: string; employeeId: string };
  let realWorkBefore: unknown[];
  let deletedBefore: number;
  let adminPermissionsBefore: readonly string[];

  async function sampleCounts(): Promise<Record<string, number>> {
    const [row] = (await db.execute(sql`
      select
        (select count(*)::int from orders where organization_id = ${sampleOrganizationId}) as orders,
        (select count(*)::int from assignments where organization_id = ${sampleOrganizationId}) as assignments,
        (select count(*)::int from employees where organization_id = ${sampleOrganizationId}) as employees,
        (select count(*)::int from events where organization_id = ${sampleOrganizationId}) as events,
        (select count(*)::int from audit_log where organization_id = ${sampleOrganizationId}) as audit
    `)) as unknown as Record<string, number>[];
    return { ...row! };
  }

  async function realWorkRows() {
    return Promise.all([
      db.select().from(orders).where(eq(orders.id, realWork.orderId)),
      db.select().from(contacts).where(eq(contacts.id, realWork.contactId)),
      db.select().from(employees).where(eq(employees.id, realWork.employeeId)),
    ]);
  }

  async function adminRoles(): Promise<string[]> {
    const rows = await db
      .select({ role: employeeRoleAssignments.role, deletedAt: employeeRoleAssignments.deletedAt })
      .from(employeeRoleAssignments)
      .innerJoin(employees, eq(employees.id, employeeRoleAssignments.employeeId))
      .where(and(eq(employees.userId, admin.id), eq(employees.organizationId, organizationId)));
    return rows.map((row) => `${row.role}:${row.deletedAt === null}`).sort();
  }

  beforeAll(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await resetDatabase();
    await runSeed(SEED_ENV);
    await runSampleSeed(SEED_ENV, TEST_NOW);
    const organization = await byggcon();
    organizationId = organization.id;
    const [sample] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.name, SAMPLE_ORGANIZATION_NAME));
    sampleOrganizationId = sample!.id;
    admin = await seedAdmin();

    // Ekte arbeid (uten TD) i Byggcon, laget før kjøringen
    const order = await createOrder(organizationId, { externalRef: "MEGLER-77" });
    const contact = await createContact(organizationId, { email: "ekte.megler@example.com" });
    const person = await createUser({ name: "Ekte Ansatt" });
    const employee = await createEmployee(person, organizationId, ["inspector"]);
    realWork = { orderId: order.id, contactId: contact.id, employeeId: employee.id };

    plan = planFor(TEST_NOW);
    realWorkBefore = await realWorkRows();
    adminRolesBefore = await adminRoles();
    adminsBefore = await activeAdminCount(organizationId);
    adminPermissionsBefore = (await requireOrganizationAccess(admin, organizationId)).permissions;
    settingsBefore = organization.settings;
    connectionsBefore = await db.select().from(integrationConnections);
    sampleBefore = await sampleCounts();
    deletedBefore = await countDeleted();
    before = await countRows();

    start = new Date();
    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    end = new Date();
    afterFirst = await countRows();
    afterFirstLatest = await latestUpdate();
  }, FULL_RUN);

  afterAll(() => vi.restoreAllMocks());

  it("4.1 legger alt i Byggcon i mengden planen sier", async () => {
    const employeeRows = await findTestdataEmployees(
      db,
      organizationId,
      plan.employees.map((e) => e.email),
    );
    expect(employeeRows).toHaveLength(plan.employees.length);
    expect(employeeRows.length).toBeGreaterThanOrEqual(10);
    expect(
      await findTestdataFirms(
        db,
        organizationId,
        plan.firms.map((f) => f.name),
      ),
    ).toHaveLength(plan.firms.length);
    const orderRows = await findTestdataOrders(
      db,
      organizationId,
      plan.orders.map((o) => o.externalRef),
    );
    expect(orderRows).toHaveLength(plan.orders.length);
    expect(orderRows.filter((row) => row.assignmentId !== null)).toHaveLength(
      converted(plan).length,
    );
    const statuses = new Set(orderRows.map((row) => row.assignmentStatus).filter(Boolean));
    expect([...statuses].sort()).toEqual(["completed", "in_progress", "invoiced", "ordered"]);
    expect(orderRows.some((row) => row.assignmentId === null && row.status === "received")).toBe(
      true,
    );
    const claimRows = await db
      .select()
      .from(claims)
      .where(eq(claims.organizationId, organizationId));
    expect(claimRows).toHaveLength(converted(plan).filter((c) => c.assignment.claim).length);
    expect(new Set(claimRows.map((c) => c.outcome))).toEqual(
      new Set(["open", "rejected", "upheld", "settled", "withdrawn"]),
    );
    const properties = await findTestdataProperties(
      db,
      organizationId,
      converted(plan).map((c) => c.assignment.property),
    );
    expect(properties).toHaveLength(converted(plan).length);
  });

  it("4.2 hvert oppdrag har ansvarlig, sidemann (en annen person), kontor og parter", async () => {
    const ids = [...(await assignmentIdsByRef(organizationId)).values()];
    const team = await db
      .select()
      .from(assignmentTeamMembers)
      .where(inArray(assignmentTeamMembers.assignmentId, ids));
    const parties = await db
      .select({ assignmentId: assignmentParties.assignmentId })
      .from(assignmentParties)
      .where(inArray(assignmentParties.assignmentId, ids));
    for (const id of ids) {
      const members = team.filter((row) => row.assignmentId === id);
      const responsible = members.find((row) => row.teamRole === "responsible");
      const second = members.find((row) => row.teamRole === "peer_reviewer");
      expect(responsible).toBeDefined();
      expect(second).toBeDefined();
      expect(second!.employeeId).not.toBe(responsible!.employeeId);
      expect(members.some((row) => row.teamRole === "office")).toBe(true);
      expect(parties.some((row) => row.assignmentId === id)).toBe(true);
    }
  });

  it("4.3 befarte oppdrag har bygning, etasje, rom og areal; de andre har ingen", async () => {
    const ids = await assignmentIdsByRef(organizationId);
    for (const { order, assignment } of converted(plan)) {
      const assignmentId = ids.get(order.externalRef)!;
      const buildings = await db
        .select({ id: reportBuildings.id })
        .from(reportBuildings)
        .where(eq(reportBuildings.assignmentId, assignmentId));
      expect(buildings).toHaveLength(assignment.buildings.length);
    }
    const [roomCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(rooms)
      .where(eq(rooms.organizationId, organizationId));
    const planned = converted(plan).reduce(
      (sum, c) =>
        sum + c.assignment.buildings.flatMap((b) => b.floors).flatMap((f) => f.rooms).length,
      0,
    );
    expect(roomCount!.n).toBe(planned);
    const [areaCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(floorAreas)
      .where(eq(floorAreas.organizationId, organizationId));
    expect(areaCount!.n).toBeGreaterThan(0);
  });

  it("4.4 arbeidsøktene ligger på ferdige og fakturerte oppdrag og bare på oppdiktede ansatte", async () => {
    const rows = await db
      .select({ email: users.email, status: assignments.status })
      .from(workSessions)
      .innerJoin(employees, eq(employees.id, workSessions.employeeId))
      .innerJoin(users, eq(users.id, employees.userId))
      .innerJoin(assignments, eq(assignments.id, workSessions.assignmentId))
      .where(eq(workSessions.organizationId, organizationId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.email.endsWith("@testdata.invalid")).toBe(true);
      expect(["completed", "invoiced"]).toContain(row.status);
    }
  });

  it("4.5 fakturert nås gjennom gyldige statusbytter i økende tid", async () => {
    const ids = await assignmentIdsByRef(organizationId);
    const invoiced = converted(plan).filter((c) => c.assignment.status === "invoiced");
    expect(invoiced.length).toBeGreaterThan(0);
    for (const { order } of invoiced) {
      const rows = await db
        .select({ data: events.data, occurredAt: events.occurredAt })
        .from(events)
        .where(
          and(
            eq(events.assignmentId, ids.get(order.externalRef)!),
            eq(events.type, "assignment.status_changed"),
          ),
        )
        .orderBy(asc(events.occurredAt));
      expect(rows.map((row) => `${row.data.from}>${row.data.to}`)).toEqual([
        "ordered>in_progress",
        "in_progress>completed",
        "completed>invoiced",
      ]);
    }
  });

  it("4.6 aktørene er oppdiktede ansatte med riktig rolle, aldri seed-admin", async () => {
    const adminEmployee = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, admin.id), eq(employees.organizationId, organizationId)));
    const adminId = adminEmployee[0]!.id;
    const actorRows = await db
      .select({ type: events.type, actorId: events.actorId })
      .from(events)
      .where(eq(events.organizationId, organizationId));
    expect(actorRows.some((row) => row.actorId === adminId)).toBe(false);
    const auditActors = await db
      .select({ actorId: auditLog.actorEmployeeId })
      .from(auditLog)
      .where(eq(auditLog.organizationId, organizationId));
    expect(auditActors.some((row) => row.actorId === adminId)).toBe(false);

    const roleOf = async (employeeId: string | null) => {
      const roles = await db
        .select({ role: employeeRoleAssignments.role })
        .from(employeeRoleAssignments)
        .where(eq(employeeRoleAssignments.employeeId, employeeId!));
      return roles.map((r) => r.role);
    };
    const byType = (type: string) => actorRows.find((row) => row.type === type);
    expect(await roleOf(byType("order.received")!.actorId)).toContain("office");
    expect(await roleOf(byType("assignment.created")!.actorId)).toContain("office");
    expect(await roleOf(byType("assignment.status_changed")!.actorId)).toContain("inspector");
    expect(await roleOf(byType("claim.registered")!.actorId)).toContain("manager");
  });

  it("4.7 domenetidspunktene stemmer med planen", async () => {
    const ids = await assignmentIdsByRef(organizationId);
    const orderRows = await db
      .select({
        ref: orders.externalRef,
        receivedAt: orders.receivedAt,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(eq(orders.organizationId, organizationId));
    for (const order of plan.orders) {
      const row = orderRows.find((r) => r.ref === order.externalRef)!;
      expect(row.receivedAt.toISOString()).toBe(order.receivedAt.toISOString());
      expect(row.createdAt.toISOString()).toBe(order.receivedAt.toISOString());
    }
    for (const { order, assignment } of converted(plan)) {
      const assignmentId = ids.get(order.externalRef)!;
      const [row] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
      expect(row!.createdAt.toISOString()).toBe(assignment.convertedAt.toISOString());
      expect(row!.status).toBe(assignment.status);
      expect(row!.inspectionAt?.toISOString() ?? null).toBe(
        assignment.inspectionAt?.toISOString() ?? null,
      );
      expect(row!.dueDate).toBe(assignment.dueDate);
      const statusEvents = await db
        .select({ data: events.data, occurredAt: events.occurredAt })
        .from(events)
        .where(
          and(eq(events.assignmentId, assignmentId), eq(events.type, "assignment.status_changed")),
        );
      for (const change of assignment.statusTimes) {
        const event = statusEvents.find((e) => e.data.to === change.toStatus)!;
        expect(event.occurredAt.toISOString()).toBe(change.at.toISOString());
      }
      if (assignment.claim) {
        const [claim] = await db.select().from(claims).where(eq(claims.assignmentId, assignmentId));
        expect(claim!.receivedAt).toBe(assignment.claim.receivedAt);
        expect(claim!.createdAt.toISOString()).toBe(assignment.claim.registeredAt.toISOString());
        expect(claim!.closedAt?.toISOString() ?? null).toBe(
          assignment.claim.closedAt?.toISOString() ?? null,
        );
        expect(claim!.amount).toBe(assignment.claim.amount);
      }
    }
  });

  it("4.8 revisjonsloggen er urørt: tidene er kjøretiden, og skriptet oppdaterer den aldri", async () => {
    const rows = await db
      .select({ receivedAt: auditLog.receivedAt, occurredAt: auditLog.occurredAt })
      .from(auditLog)
      .where(eq(auditLog.organizationId, organizationId));
    expect(rows.length).toBeGreaterThan(0);
    const margin = 5_000;
    for (const row of rows) {
      expect(row.receivedAt.getTime()).toBeGreaterThanOrEqual(start.getTime() - margin);
      expect(row.receivedAt.getTime()).toBeLessThanOrEqual(end.getTime() + margin);
      expect(row.occurredAt.getTime()).toBeGreaterThanOrEqual(start.getTime() - margin);
    }
    const source = readFileSync(new URL("./testdata.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/update\(\s*auditLog\s*\)/);
    expect(source).not.toMatch(/update\s+audit_log/i);
  });

  it("4.9 og 4.42 sertifiseringen avgjør report.publish, lesetilgangen står", async () => {
    const byValidTo = plan.employees
      .filter((e) => e.roles.includes("inspector") && e.certification !== null)
      .sort((a, b) => a.certification!.validTo.localeCompare(b.certification!.validTo));
    const expired = byValidTo[0]!;
    const certified = byValidTo[byValidTo.length - 1]!;
    expect(expired.certification!.validTo < "2026-11-03").toBe(true);
    const good = await requireOrganizationAccess(await actorFor(certified.email), organizationId);
    expect(good.permissions).toContain("report.publish");
    const bad = await requireOrganizationAccess(await actorFor(expired.email), organizationId);
    expect(bad.permissions).not.toContain("report.publish");
    expect(bad.permissions).toContain("organization.read");
  });

  it("4.10 radene stemmer med planen i nøkler og feltverdier", async () => {
    const orderRows = await db
      .select({
        ref: orders.externalRef,
        addressText: orders.addressText,
        gnr: orders.gnr,
        bnr: orders.bnr,
        orderedByText: orders.orderedByText,
        sellerDeclarationReceived: orders.sellerDeclarationReceived,
      })
      .from(orders)
      .where(eq(orders.organizationId, organizationId))
      .orderBy(asc(orders.externalRef));
    const expected = plan.orders
      .filter((order) => order.externalRef.startsWith("TD-"))
      .map((order) => ({
        ref: order.externalRef,
        addressText: order.fields.addressText,
        gnr: order.fields.gnr,
        bnr: order.fields.bnr,
        orderedByText: order.fields.orderedByText,
        sellerDeclarationReceived: order.fields.sellerDeclarationReceived,
      }));
    expect(orderRows.filter((row) => row.ref?.startsWith("TD-"))).toEqual(expected);

    const ids = await assignmentIdsByRef(organizationId);
    const sample = converted(plan).find((c) => c.assignment.buildings.length > 0)!;
    const roomRows = await db
      .select({ name: rooms.name, roomType: rooms.roomType, areaType: rooms.areaType })
      .from(rooms)
      .innerJoin(sql`floors`, sql`floors.id = ${rooms.floorId}`)
      .innerJoin(reportBuildings, sql`${reportBuildings.id} = floors.report_building_id`)
      .where(eq(reportBuildings.assignmentId, ids.get(sample.order.externalRef)!));
    const plannedRooms = sample.assignment.buildings
      .flatMap((b) => b.floors)
      .flatMap((f) => f.rooms)
      .map((r) => ({ name: r.name, roomType: r.roomType, areaType: r.areaType }));
    expect(roomRows.sort((a, b) => a.name!.localeCompare(b.name!))).toEqual(
      plannedRooms.sort((a, b) => a.name.localeCompare(b.name)),
    );
  });

  it("4.11 ingen innlogging og ingen oppdiktet admin", async () => {
    const people = await findTestdataEmployees(
      db,
      organizationId,
      plan.employees.map((e) => e.email),
    );
    const userIds = people.map((p) => p.userId);
    expect(await db.select().from(sessions).where(inArray(sessions.userId, userIds))).toEqual([]);
    expect(await db.select().from(accounts).where(inArray(accounts.userId, userIds))).toEqual([]);
    const adminRoles = await db
      .select()
      .from(employeeRoleAssignments)
      .where(
        and(
          inArray(
            employeeRoleAssignments.employeeId,
            people.map((p) => p.employeeId),
          ),
          eq(employeeRoleAssignments.role, "admin"),
        ),
      );
    expect(adminRoles).toEqual([]);
    for (const person of people) {
      expect(person.email.endsWith("@testdata.invalid")).toBe(true);
      expect(person.name).not.toBe(SEED_ENV.SEED_ADMIN_NAME);
    }
  });

  it("4.12 ingen KI: ai_usage_log er uendret", () => {
    expect(afterFirst.ai_usage_log).toBe(before.ai_usage_log);
  });

  it("4.21 setter aldri deleted_at, og kildeteksten skriver aldri til den", async () => {
    expect(await countDeleted()).toBe(deletedBefore);
    const source = readFileSync(new URL("./testdata.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/set\(\{[^}]*deletedAt/);
    expect(source).not.toMatch(/deleted_at\s*=/);
  });

  it("4.26 prøveorganisasjonen er urørt", async () => {
    expect(await sampleCounts()).toEqual(sampleBefore);
  });

  it("4.34 ekte ordre, kontakt og ansatt uten TD er uendret", async () => {
    expect(await realWorkRows()).toEqual(realWorkBefore);
  });

  it("4.35 seed-admin har samme roller og er aktiv, og antallet aktive admin er likt", async () => {
    expect(await adminRoles()).toEqual(adminRolesBefore);
    expect(await activeAdminCount(organizationId)).toBe(adminsBefore);
  });

  it("4.36 admin ser fortsatt reklamasjonene", async () => {
    const ids = await assignmentIdsByRef(organizationId);
    const withClaim = converted(plan).find((c) => c.assignment.claim)!;
    const list = await listClaimsForAssignment(
      admin,
      organizationId,
      ids.get(withClaim.order.externalRef)!,
    );
    expect(list).toHaveLength(1);
  });

  it("4.37 og 4.38 innstillingene og tilkoblingene er like (av som standard)", async () => {
    expect((await byggcon()).settings).toEqual(settingsBefore);
    expect(await db.select().from(integrationConnections)).toEqual(connectionsBefore);
  });

  describe("4.39–4.43 tilgang per rolle med testdata", () => {
    const roles = ["inspector", "office", "manager", "admin"] as const;

    async function actorWithRole(role: (typeof roles)[number]): Promise<Actor> {
      if (role === "admin") return admin;
      const employee = plan.employees.find((e) => e.roles.length === 1 && e.roles[0] === role)!;
      return actorFor(employee.email);
    }

    it.each(roles)("4.39 %s ser TD-oppdragene i arbeidskøen og ordrelisten", async (role) => {
      const actor = await actorWithRole(role);
      const queue = await listWorkQueue(actor, organizationId, {
        status: "in_progress",
        mineOnly: false,
        query: "",
      });
      expect(queue.total).toBe(
        converted(plan).filter((c) => c.assignment.status === "in_progress").length,
      );
      const list = await listOrders(actor, organizationId, {});
      expect(list.total).toBeGreaterThanOrEqual(plan.orders.length);
    });

    it.each(roles)("4.40 og 4.41 reklamasjonene for %s", async (role) => {
      const actor = await actorWithRole(role);
      const ids = await assignmentIdsByRef(organizationId);
      const withClaim = converted(plan).find((c) => c.assignment.claim)!;
      const assignmentId = ids.get(withClaim.order.externalRef)!;
      const [claim] = await db.select().from(claims).where(eq(claims.assignmentId, assignmentId));
      const planned = withClaim.assignment.claim!;
      const input = {
        claimType: planned.claimType,
        receivedAt: planned.receivedAt,
        claimantPartyId: claim!.claimantPartyId,
        claimantText: null,
        description: planned.description,
        buildingPartText: planned.buildingPartText,
        outcome: claim!.outcome as typeof planned.outcome,
        amount: claim!.amount,
      };
      if (role === "manager" || role === "admin") {
        expect(await listClaimsForAssignment(actor, organizationId, assignmentId)).toHaveLength(1);
        // Ingen endring i verdiene: tjenesten svarer uten å skrive
        await expect(updateClaim(actor, organizationId, claim!.id, input)).resolves.toBeDefined();
      } else {
        await expect(
          listClaimsForAssignment(actor, organizationId, assignmentId),
        ).rejects.toBeInstanceOf(AccessDeniedError);
        await expect(updateClaim(actor, organizationId, claim!.id, input)).rejects.toBeInstanceOf(
          AccessDeniedError,
        );
      }
    });

    it("4.43 admin stenges ikke ute: samme rettigheter som før kjøringen", async () => {
      const grant = await requireOrganizationAccess(admin, organizationId);
      expect(grant.permissions).toEqual(adminPermissionsBefore);
      // Alle rettigheter unntatt publisering, som krever sertifisering (A29)
      for (const permission of permissions.filter((p) => p !== "report.publish")) {
        await expect(
          requireOrganizationAccess(admin, organizationId, permission),
        ).resolves.toBeDefined();
      }
    });
  });

  describe("4.46–4.48 ytelse med full testdata (under 2 sekunder per kall, A306)", () => {
    const LIMIT_MS = 2_000;
    async function timed(work: () => Promise<unknown>): Promise<number> {
      await work();
      const started = performance.now();
      await work();
      return performance.now() - started;
    }
    const lastName = () => plan.contacts[0]!.lastName;

    it("4.46 listWorkQueue uten filter, med søketekst og med statusfilter", async () => {
      for (const input of [
        { status: "ordered" as const, mineOnly: false, query: "" },
        { status: "in_progress" as const, mineOnly: false, query: lastName() },
        { status: "invoiced" as const, mineOnly: false, query: "" },
      ]) {
        expect(await timed(() => listWorkQueue(admin, organizationId, input))).toBeLessThan(
          LIMIT_MS,
        );
      }
    });

    it("4.47 countWorkQueueByStatus uten filter og med søketekst", async () => {
      for (const query of ["", lastName()]) {
        expect(
          await timed(() =>
            countWorkQueueByStatus(admin, organizationId, { mineOnly: false, query }),
          ),
        ).toBeLessThan(LIMIT_MS);
      }
    });

    it("4.48 listOrders uten filter og med søketekst", async () => {
      for (const query of ["", lastName(), "TD-0010"]) {
        expect(await timed(() => listOrders(admin, organizationId, { query }))).toBeLessThan(
          LIMIT_MS,
        );
      }
    });
  });

  it("4.13 andre kjøring skriver ingenting", async () => {
    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    expect(await countRows()).toEqual(afterFirst);
    expect(await latestUpdate()).toBe(afterFirstLatest);
  });

  it("4.14 og 4.15 kjøring med now 30 dager fram og en tredje kjøring endrer ingenting", async () => {
    const later = new Date(TEST_NOW.getTime() + 30 * 86_400_000);
    await seedTestdata({ db, now: later, seed: TESTDATA_SEED });
    expect(await countRows()).toEqual(afterFirst);
    expect(await latestUpdate()).toBe(afterFirstLatest);
    await seedTestdata({ db, now: later, seed: TESTDATA_SEED });
    expect(await countRows()).toEqual(afterFirst);
  });

  it("4.18–4.20 mykt slettet TD-ordre, TD-kontakt og oppdiktet ansatt gjenopplives ikke og får ingen kopi", async () => {
    const deletedAt = new Date("2026-11-10T10:00:00Z");
    const [order] = await db
      .update(orders)
      .set({ deletedAt })
      .where(and(eq(orders.organizationId, organizationId), eq(orders.externalRef, "TD-0005")))
      .returning({ id: orders.id });
    const [contact] = await db
      .update(contacts)
      .set({ deletedAt })
      .where(
        and(
          eq(contacts.organizationId, organizationId),
          eq(contacts.email, plan.contacts[0]!.email),
        ),
      )
      .returning({ id: contacts.id });
    const office = plan.employees.find((e) => e.roles.includes("office"))!;
    const [person] = await findTestdataEmployees(db, organizationId, [office.email]);
    await db.update(employees).set({ deletedAt }).where(eq(employees.id, person!.employeeId));
    const counts = await countRows();

    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    expect(await countRows()).toEqual(counts);
    const [orderAfter] = await db.select().from(orders).where(eq(orders.id, order!.id));
    const [contactAfter] = await db.select().from(contacts).where(eq(contacts.id, contact!.id));
    const [employeeAfter] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, person!.employeeId));
    expect(orderAfter!.deletedAt).toEqual(deletedAt);
    expect(contactAfter!.deletedAt).toEqual(deletedAt);
    expect(employeeAfter!.deletedAt).toEqual(deletedAt);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.37 med innstillingene slått på og av (takstmenn uten «endre alt»)
// ---------------------------------------------------------------------------------------------

describe("seedTestdata: innstillingene er satt", { timeout: FULL_RUN }, () => {
  it("4.37 innstillingene er like før og etter, og kjøringen virker med inspectors_edit_all av", async () => {
    await resetDatabase();
    await runSeed(SEED_ENV);
    const organization = await byggcon();
    const settings = {
      "time_tracking.enabled": true,
      "time_tracking.baseline": { minutes: 420 },
      "ai.enabled": false,
      "access.inspectors_edit_all": false,
    };
    await db.update(organizations).set({ settings }).where(eq(organizations.id, organization.id));
    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    expect((await byggcon()).settings).toEqual(settings);
    const plan = planFor(TEST_NOW);
    const rows = await findTestdataOrders(
      db,
      organization.id,
      plan.orders.map((o) => o.externalRef),
    );
    expect(rows.filter((row) => row.assignmentStatus === "invoiced").length).toBe(
      converted(plan).filter((c) => c.assignment.status === "invoiced").length,
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 4.16–4.17 avbrutt kjøring
// ---------------------------------------------------------------------------------------------

describe("seedTestdata: avbrutt kjøring fylles ut av neste", { timeout: FULL_RUN }, () => {
  it("4.16 bare ansatte finnes: neste kjøring fyller ut resten uten kopier", async () => {
    await resetDatabase();
    await runSeed(SEED_ENV);
    failures.firm = true;
    await expect(seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED })).rejects.toMatchObject({
      key: "firma",
    });
    const partial = await countRows();
    expect(partial.firms).toBe(0);
    expect(partial.orders).toBe(0);
    failures.firm = false;
    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    const full = await countRows();
    const plan = planFor(TEST_NOW);
    expect(full.employees).toBe(partial.employees);
    expect(full.orders).toBe(plan.orders.length);

    // Samme antall som en full første kjøring
    await resetDatabase();
    await runSeed(SEED_ENV);
    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    const reference = await countRows();
    const { audit_log: _a, events: _e, ...fullRest } = full;
    const { audit_log: _ra, events: _re, ...referenceRest } = reference;
    expect(fullRest).toEqual(referenceRest);
  });

  it("4.17 avbrutt midt i ordrene: ingen dobbel ordre og ingen hull i nummerserien", async () => {
    await resetDatabase();
    await runSeed(SEED_ENV);
    failures.orderRef = "TD-0021";
    const error = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED }).catch((e) => e);
    expect(error).toBeInstanceOf(TestdataStepError);
    expect((error as TestdataStepError).key).toBe("TD-0021");
    const partial = await countRows();
    expect(partial.orders).toBe(20);
    failures.orderRef = null;
    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    const plan = planFor(TEST_NOW);
    const refs = await db
      .select({ ref: orders.externalRef })
      .from(orders)
      .where(sql`${orders.externalRef} like 'TD-%'`);
    expect(refs).toHaveLength(plan.orders.length);
    expect(new Set(refs.map((r) => r.ref)).size).toBe(plan.orders.length);
    const numbers = await db
      .select({ number: assignments.number })
      .from(assignments)
      .orderBy(asc(assignments.number));
    expect(numbers.map((n) => Number(n.number.split("-")[1]))).toEqual(
      numbers.map((_, index) => index + 1),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 4.22–4.25 oppsett og vakt
// ---------------------------------------------------------------------------------------------

describe("seedTestdata: oppsett og vakt", { timeout: FULL_RUN }, () => {
  beforeEach(resetDatabase);

  it("4.22 Byggcon mangler: norsk melding og ingen skriving", async () => {
    const before = await countRows();
    const error = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED }).catch((e) => e);
    expect(error).toBeInstanceOf(TestdataSetupError);
    expect(error.message).toBe(TESTDATA_ORGANIZATION_MISSING_MESSAGE);
    expect(await countRows()).toEqual(before);
  });

  it("4.23 TD-e-post er ansatt i en annen organisasjon: stopper før første skriving", async () => {
    await runSeed(SEED_ENV);
    const email = planFor(TEST_NOW).employees[0]!.email;
    const other = await createOrganization("Annen takst");
    const person = await createUser({ name: "Ansatt annet sted", email });
    const otherEmployee = await createEmployee(person, other.id, ["inspector"]);
    const before = await countRows();
    const error = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED }).catch((e) => e);
    expect(error).toBeInstanceOf(TestdataSetupError);
    expect(error.message).toBe(TESTDATA_USER_CONFLICT_MESSAGE);
    expect(error.message).not.toContain("@");
    expect(await countRows()).toEqual(before);
    const inByggcon = await db
      .select()
      .from(employees)
      .where(
        and(eq(employees.userId, person.id), eq(employees.organizationId, (await byggcon()).id)),
      );
    expect(inByggcon).toEqual([]);
    const [after] = await db.select().from(employees).where(eq(employees.id, otherEmployee.id));
    expect(after!.updatedAt).toEqual(otherEmployee.updatedAt);
  });

  it("4.24 TD-e-post er bruker uten ansatt: brukeren gjenbrukes og kobles til Byggcon", async () => {
    await runSeed(SEED_ENV);
    const email = planFor(TEST_NOW).employees[0]!.email;
    const person = await createUser({ name: "Uten ansatt", email });
    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });
    const usersWithEmail = await db.select().from(users).where(eq(users.email, email));
    expect(usersWithEmail.map((u) => u.id)).toEqual([person.id]);
    const [employee] = await findTestdataEmployees(db, (await byggcon()).id, [email]);
    expect(employee!.userId).toBe(person.id);
  });

  it.each([
    ["production", undefined],
    ["", undefined],
    ["test", "postgres://ezprop:ezprop@psql-ezprop-prod.postgres.database.azure.com:5432/ezprop"],
    ["test", "postgres://ezprop:ezprop@localhost,psql-ezprop-prod.example.com:5432/ezprop"],
    ["test", "postgres://ezprop:ezprop@localhost:5432/ezprop?host=psql-ezprop-prod.example.com"],
  ])(
    "4.25 vakten stopper før første skriving (APP_ENVIRONMENT=%j, vert %#)",
    async (environment, url) => {
      await runSeed(SEED_ENV);
      const before = await countRows();
      vi.stubEnv("APP_ENVIRONMENT", environment);
      if (url) vi.stubEnv("DATABASE_URL", url);
      resetEnvCache();
      const transaction = vi.spyOn(db, "transaction");
      const select = vi.spyOn(db, "select");
      try {
        const error = await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED }).catch(
          (e) => e,
        );
        expect(error).toBeInstanceOf(TestdataNotAllowedError);
        expect(error.message).not.toMatch(/psql|localhost|ezprop:/);
        expect(transaction).not.toHaveBeenCalled();
        expect(select).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
        resetEnvCache();
      }
      expect(await countRows()).toEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.27–4.31 andre organisasjoner tolkes ikke som «finnes»
// ---------------------------------------------------------------------------------------------

describe("seedTestdata: andre organisasjoner", { timeout: FULL_RUN }, () => {
  it("4.27–4.31 like TD-rader i en annen organisasjon tolkes ikke som «finnes» og endres ikke", async () => {
    await resetDatabase();
    await runSeed(SEED_ENV);
    const plan = planFor(TEST_NOW);
    const other = await createOrganization("Annen takst");
    const otherOrder = await createOrder(other.id, {
      externalRef: "TD-0001",
      createdAt: new Date(TEST_NOW.getTime() - 60 * 86_400_000),
    });
    const contactPlan = plan.contacts[0]!;
    const otherContact = await createContact(other.id, { email: contactPlan.email });
    const firmPlan = plan.firms[0]!;
    const otherFirm = await createFirm(other.id, {
      name: firmPlan.name,
      firmType: firmPlan.firmType,
      orgNumber: null,
    });
    const property = converted(plan)[0]!.assignment.property;
    const otherProperty = await createProperty(other.id, {
      municipalityNumber: property.municipalityNumber,
      gnr: property.gnr,
      bnr: property.bnr,
    });
    const snapshot = async () =>
      Promise.all([
        db.select().from(orders).where(eq(orders.id, otherOrder.id)),
        db.select().from(contacts).where(eq(contacts.id, otherContact.id)),
        db.select().from(firms).where(eq(firms.id, otherFirm.id)),
        db.execute(sql`select * from properties where id = ${otherProperty.property.id}`),
      ]);
    const before = await snapshot();

    await seedTestdata({ db, now: TEST_NOW, seed: TESTDATA_SEED });

    expect(await snapshot()).toEqual(before);
    const organizationId = (await byggcon()).id;
    const [anchor] = await db
      .select({ createdAt: orders.createdAt })
      .from(orders)
      .where(and(eq(orders.organizationId, organizationId), eq(orders.externalRef, "TD-0001")));
    // 4.31: ankeret er fra Byggcons egen kjøring, ikke den andre organisasjonens TD-0001
    expect(anchor!.createdAt.toISOString()).toBe(plan.orders[0]!.receivedAt.toISOString());
    expect(await findTestdataContacts(db, organizationId, [contactPlan.email])).toHaveLength(1);
    expect(await findTestdataFirms(db, organizationId, [firmPlan.name])).toHaveLength(1);
    const own = await findTestdataProperties(db, organizationId, [property]);
    expect(own.filter((row) => row.key === property.key)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.32 tenant-isolasjon per oppslag, og ankeret
// ---------------------------------------------------------------------------------------------

describe("4.32 tenant-isolasjon i oppslagene", () => {
  beforeEach(resetDatabase);

  const EMAIL = "kari.prøvdal@testdata.invalid";

  it("findTestdataOrders", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createOrder(grantA.organizationId, { externalRef: "TD-0001" });
        const b = await createOrder(grantB.organizationId, { externalRef: "TD-0001" });
        await createOrder(grantA.organizationId, { externalRef: "MEGLER-1" });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        return findTestdataOrders(db, grant.organizationId, ["TD-0001"]);
      },
      idOf: (row) => row.id,
    });
  });

  it("findTestdataContacts", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createContact(grantA.organizationId, { email: EMAIL });
        const b = await createContact(grantB.organizationId, { email: EMAIL });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        return findTestdataContacts(db, grant.organizationId, [EMAIL]);
      },
      idOf: (row) => row.id,
    });
  });

  it("findTestdataFirms", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createFirm(grantA.organizationId, { name: "Prøvemegling AS" });
        const b = await createFirm(grantB.organizationId, { name: "Prøvemegling AS" });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        return findTestdataFirms(db, grant.organizationId, ["Prøvemegling AS"]);
      },
      idOf: (row) => row.id,
    });
  });

  it("findTestdataProperties", async () => {
    const key = { municipalityNumber: "1804", gnr: "9001" };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createProperty(grantA.organizationId, { ...key, bnr: "1" });
        const b = await createProperty(grantB.organizationId, { ...key, bnr: "1" });
        return { a: [a.property.id], b: [b.property.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        return findTestdataProperties(db, grant.organizationId, [key]);
      },
      idOf: (row) => row.propertyId,
    });
  });

  it("findTestdataEmployees", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const userA = await createUser({ email: EMAIL });
        const userB = await createUser({ email: "ola.prøvdal@testdata.invalid" });
        const a = await createEmployee(userA, grantA.organizationId, ["office"]);
        const b = await createEmployee(userB, grantB.organizationId, ["office"]);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        return findTestdataEmployees(db, grant.organizationId, [
          EMAIL,
          "ola.prøvdal@testdata.invalid",
        ]);
      },
      idOf: (row) => row.employeeId,
    });
  });

  it("findAnchorOrder", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createOrder(grantA.organizationId, { externalRef: "TD-0001" });
        const b = await createOrder(grantB.organizationId, { externalRef: "TD-0001" });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const row = await findAnchorOrder(db, grant.organizationId);
        return row ? [row] : [];
      },
      idOf: (row) => row.id,
    });
  });
});

describe("anchorFromCreatedAt", () => {
  it("gir ankerdagen tilbake fra mottatt-tiden til TD-0001, uansett klokkeslett", () => {
    const anchor = new Date("2026-11-03T00:00:00Z");
    const plan = buildTestdataPlan({
      seed: TESTDATA_SEED,
      anchor: new Date("2026-11-03T15:42:00Z"),
    });
    expect(anchorFromCreatedAt(plan.orders[0]!.receivedAt, TESTDATA_SEED)).toEqual(anchor);
  });

  it("bruker created_at som den er når tiden ikke er flyttet (avbrutt kjøring)", () => {
    const createdAt = new Date("2026-11-03T15:42:17.123Z");
    expect(anchorFromCreatedAt(createdAt, TESTDATA_SEED)).toEqual(createdAt);
  });
});
