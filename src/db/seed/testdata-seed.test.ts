import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  like,
  max,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import {
  aiUsageLog,
  assignments,
  auditLog,
  cadastralUnits,
  claims,
  contacts,
  employees,
  events,
  firms,
  numberSequences,
  orders,
  organizations,
  properties,
  users,
} from "@/db/schema";
import { resetDatabase } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { runSeed } from "./run";
import {
  findTestdataContacts,
  findTestdataEmployees,
  findTestdataFirms,
  findTestdataOrders,
  findTestdataProperties,
  runTestdataSeed,
} from "./testdata";
import { TESTDATA_EMPLOYEES, TESTDATA_FIRMS, TESTDATA_ORDERS } from "./testdata.data";
import { TestdataGuardError } from "./testdata-guard";

/*
 * Utviklerens tester for seed-steget (docs/funksjoner/fase2a-testdata-arbeidshverdag.md). Testplanen
 * avsnitt 4 og 6 skrives i tillegg av testskriveren. Støtter hovedmålene: de ansatte (alt ligger i
 * organisasjonen de logger inn i), færre reklamasjoner (driftslik mengde) og KI i bunnen (ingen
 * KI-kall).
 */

const TEST_NOW = new Date("2026-11-13T09:00:00Z");
const SEED_ENV = { SEED_ADMIN_EMAIL: "admin@example.com", SEED_ADMIN_NAME: "Test Admin" };

function testdataEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    ...SEED_ENV,
    APP_ENVIRONMENT: "test",
    DATABASE_URL: process.env.DATABASE_URL,
    ...overrides,
  };
}

async function byggconId(): Promise<string> {
  const [row] = await db.select({ id: organizations.id }).from(organizations);
  if (!row) throw new Error("fant ikke organisasjonen");
  return row.id;
}

/** Antall rader i tabellene seed-steget skriver i, og verdien i nummerserien. */
async function countRows() {
  const tables = { users, employees, orders, assignments, claims, events, auditLog, aiUsageLog };
  const result: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ value: count() }).from(table);
    result[name] = Number(row?.value ?? 0);
  }
  const [sequence] = await db
    .select({ value: sql<number>`coalesce(sum(${numberSequences.nextValue}), 0)::int` })
    .from(numberSequences);
  result.numberSequences = Number(sequence?.value ?? 0);
  const [updated] = await db
    .select({ value: max(orders.updatedAt) })
    .from(orders)
    .where(like(orders.externalRef, "TD-%"));
  result.lastOrderUpdate = updated?.value ? new Date(updated.value).getTime() : 0;
  return result;
}

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
  await runSeed(SEED_ENV);
});
afterEach(() => vi.restoreAllMocks());

describe("runTestdataSeed", () => {
  it("lager ansatte, firma, ordre, oppdrag i alle statuser og reklamasjoner i Byggcon, uten admin som aktør", async () => {
    const summary = await runTestdataSeed(testdataEnv(), TEST_NOW);
    const organizationId = await byggconId();

    expect(summary.keys).toEqual(TESTDATA_ORDERS.map((order) => order.externalRef));
    expect(summary.orders.every((item) => item.result === "created")).toBe(true);
    expect(summary.created.employees).toBe(TESTDATA_EMPLOYEES.length);
    expect(summary.created.firms).toBe(TESTDATA_FIRMS.length);

    const tdOrders = await db
      .select({ status: assignments.status, createdBy: orders.createdBy, ref: orders.externalRef })
      .from(orders)
      .leftJoin(assignments, eq(assignments.id, orders.assignmentId))
      .where(and(eq(orders.organizationId, organizationId), like(orders.externalRef, "TD-%")));
    expect(tdOrders).toHaveLength(TESTDATA_ORDERS.length);
    const statuses = new Set(tdOrders.map((row) => row.status));
    for (const status of ["ordered", "in_progress", "completed", "invoiced", null]) {
      expect(statuses.has(status)).toBe(true);
    }
    const outcomes = await db.select({ outcome: claims.outcome }).from(claims);
    expect(new Set(outcomes.map((row) => row.outcome))).toEqual(
      new Set(["open", "rejected", "upheld", "settled", "withdrawn"]),
    );

    // Admin er aldri aktør i hendelser og revisjonslogg
    const [admin] = await db
      .select({ id: employees.id })
      .from(employees)
      .innerJoin(users, eq(users.id, employees.userId))
      .where(eq(users.email, SEED_ENV.SEED_ADMIN_EMAIL));
    const [adminEvents] = await db
      .select({ value: count() })
      .from(events)
      .where(eq(events.actorId, admin!.id));
    const [adminAudit] = await db
      .select({ value: count() })
      .from(auditLog)
      .where(eq(auditLog.actorEmployeeId, admin!.id));
    expect(adminEvents?.value).toBe(0);
    expect(adminAudit?.value).toBe(0);

    // Datoankeret: TD-0001 ligger på dagen for `now`, og alle hendelser er flyttet til før `now`
    const [first] = await db
      .select({ createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.externalRef, "TD-0001"));
    expect(first!.createdAt.toISOString().slice(0, 10)).toBe("2026-11-13");
    const [late] = await db
      .select({ value: count() })
      .from(events)
      .where(gt(events.occurredAt, TEST_NOW));
    expect(late?.value).toBe(0);
    const [lateAudit] = await db
      .select({ value: count() })
      .from(auditLog)
      .where(
        and(
          gt(auditLog.occurredAt, TEST_NOW),
          notInArray(auditLog.entityType, ["firm", "contact"]),
        ),
      );
    expect(lateAudit?.value).toBe(0);
    const [lateOrders] = await db
      .select({ value: count() })
      .from(orders)
      .where(or(gt(orders.createdAt, TEST_NOW), gt(orders.updatedAt, TEST_NOW)));
    expect(lateOrders?.value).toBe(0);

    // Ingen KI-kall
    const [aiRows] = await db.select({ value: count() }).from(aiUsageLog);
    expect(aiRows?.value).toBe(0);
  }, 300_000);

  it("andre kjøring og kjøring med klokka 30 dager fram skriver ingenting", async () => {
    await runTestdataSeed(testdataEnv(), TEST_NOW);
    const before = await countRows();

    const second = await runTestdataSeed(testdataEnv(), TEST_NOW);
    expect(await countRows()).toEqual(before);
    expect(second.orders.every((item) => item.result === "existing")).toBe(true);
    expect(Object.values(second.created).every((value) => value === 0)).toBe(true);

    await runTestdataSeed(testdataEnv(), new Date(TEST_NOW.getTime() + 30 * 86_400_000));
    expect(await countRows()).toEqual(before);
  }, 300_000);

  it("gjenoppliver ikke en mykt slettet ordre og lager ingen kopi", async () => {
    await runTestdataSeed(testdataEnv(), TEST_NOW);
    const deletedAt = new Date("2026-11-13T10:00:00Z");
    await db.update(orders).set({ deletedAt }).where(eq(orders.externalRef, "TD-0005"));

    const summary = await runTestdataSeed(testdataEnv(), TEST_NOW);
    const rows = await db
      .select({ deletedAt: orders.deletedAt })
      .from(orders)
      .where(eq(orders.externalRef, "TD-0005"));
    expect(rows).toEqual([{ deletedAt }]);
    expect(summary.orders.find((item) => item.externalRef === "TD-0005")?.result).toBe("skipped");
  }, 300_000);

  it.each([
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: undefined },
    { APP_ENVIRONMENT: "test", DATABASE_URL: "postgres://u:p@psql-ezprop-prod.example/db" },
  ])("vakten stopper før noen transaksjon: %o", async (overrides) => {
    const before = await countRows();
    const spy = vi.spyOn(db, "transaction");
    await expect(runTestdataSeed(testdataEnv(overrides), TEST_NOW)).rejects.toBeInstanceOf(
      TestdataGuardError,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(await countRows()).toEqual(before);
  });

  it("logger bare antall og TD-nøkler", async () => {
    const log = vi.mocked(console.log);
    await runTestdataSeed(testdataEnv(), TEST_NOW);
    const output = log.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(output).not.toContain("@");
    for (const employee of TESTDATA_EMPLOYEES) expect(output).not.toContain(employee.name);
    for (const firm of TESTDATA_FIRMS) expect(output).not.toContain(firm.name);
  }, 300_000);
});

describe("oppslagene filtrerer på organisasjonen (regel 2)", () => {
  async function grantFor(actor: Parameters<typeof requireOrganizationAccess>[0], id: string) {
    return requireOrganizationAccess(actor, id, "organization.read");
  }

  it("findTestdataOrders", async () => {
    await expectTenantIsolation({
      seed: async (a, b) => {
        const insert = async (grant: EmployeeGrant) => {
          const [row] = await db
            .insert(orders)
            .values({
              organizationId: grant.organizationId,
              addressText: "Testveien 1",
              externalRef: "TD-0001",
            })
            .returning({ id: orders.id });
          return [row!.id];
        };
        return { a: await insert(a), b: await insert(b) };
      },
      query: async (actor, id) => findTestdataOrders(await grantFor(actor, id)),
      idOf: (row) => row.id,
    });
  });

  it("findTestdataEmployees", async () => {
    await expectTenantIsolation({
      seed: async (a, b) => {
        const [user] = await db
          .insert(users)
          .values({ id: "td-felles-bruker", email: "felles@testdata.invalid", name: "Test Felles" })
          .returning({ id: users.id });
        const insert = async (grant: EmployeeGrant) => {
          const [row] = await db
            .insert(employees)
            .values({ organizationId: grant.organizationId, userId: user!.id, name: "Test" })
            .returning({ id: employees.id });
          return [row!.id];
        };
        return { a: await insert(a), b: await insert(b) };
      },
      query: async (actor, id) => findTestdataEmployees(await grantFor(actor, id)),
      idOf: (row) => row.id,
    });
  });

  it("findTestdataFirms", async () => {
    const name = TESTDATA_FIRMS[0]!.name;
    await expectTenantIsolation({
      seed: async (a, b) => {
        const insert = async (grant: EmployeeGrant) => {
          const [row] = await db
            .insert(firms)
            .values({ organizationId: grant.organizationId, name })
            .returning({ id: firms.id });
          return [row!.id];
        };
        return { a: await insert(a), b: await insert(b) };
      },
      query: async (actor, id) => findTestdataFirms(await grantFor(actor, id)),
      idOf: (row) => row.id,
    });
  });

  it("findTestdataContacts", async () => {
    await expectTenantIsolation({
      seed: async (a, b) => {
        const insert = async (grant: EmployeeGrant) => {
          const [row] = await db
            .insert(contacts)
            .values({
              organizationId: grant.organizationId,
              firstName: "Test",
              email: "megler1@testdata.invalid",
            })
            .returning({ id: contacts.id });
          return [row!.id];
        };
        return { a: await insert(a), b: await insert(b) };
      },
      query: async (actor, id) => findTestdataContacts(await grantFor(actor, id)),
      idOf: (row) => row.id,
    });
  });

  it("findTestdataProperties", async () => {
    await expectTenantIsolation({
      seed: async (a, b) => {
        const insert = async (grant: EmployeeGrant) => {
          const [row] = await db
            .insert(properties)
            .values({
              organizationId: grant.organizationId,
              address: "Testveien 1",
              municipalityNumber: "1804",
              housingType: "detached",
              ownershipForm: "freehold",
            })
            .returning({ id: properties.id });
          await db.insert(cadastralUnits).values({
            organizationId: grant.organizationId,
            propertyId: row!.id,
            gnr: "9001",
            bnr: "1",
          });
          return [row!.id];
        };
        return { a: await insert(a), b: await insert(b) };
      },
      query: async (actor, id) => findTestdataProperties(await grantFor(actor, id)),
      idOf: (row) => row.id,
    });
  });

  it("en annen organisasjon med TD-0001 påvirker verken ankeret eller sine egne rader", async () => {
    const [other] = await db
      .insert(organizations)
      .values({ name: "Annen organisasjon", brandName: "Annen" })
      .returning({ id: organizations.id });
    const [foreign] = await db
      .insert(orders)
      .values({
        organizationId: other!.id,
        addressText: "Testveien 1",
        externalRef: "TD-0001",
        createdAt: new Date("2026-01-02T09:00:00Z"),
      })
      .returning();

    await runTestdataSeed(testdataEnv(), TEST_NOW);
    const [after] = await db.select().from(orders).where(eq(orders.id, foreign!.id));
    expect(after).toEqual(foreign);
    const byggcon = await byggconId();
    const [anchor] = await db
      .select({ createdAt: orders.createdAt })
      .from(orders)
      .where(and(eq(orders.organizationId, byggcon), eq(orders.externalRef, "TD-0001")));
    expect(anchor!.createdAt.toISOString().slice(0, 10)).toBe("2026-11-13");
    const foreignAssignments = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(and(eq(assignments.organizationId, other!.id), isNotNull(assignments.id)));
    expect(foreignAssignments).toEqual([]);
    const tdInOther = await db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.organizationId, other!.id), inArray(orders.externalRef, ["TD-0002"])));
    expect(tdInOther).toEqual([]);
  }, 300_000);
});
