import { readFileSync } from "node:fs";
import { and, count, eq, isNotNull, max } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { cancelAssignment } from "@/core/assignments";
import { db } from "@/db/client";
import {
  assignmentParties,
  assignments,
  auditLog,
  companies,
  events,
  floorAreas,
  numberSequences,
  orders,
  organizations,
  reportBuildings,
  rooms,
  users,
} from "@/db/schema";
import { createOrder, resetDatabase, TEST_NOW } from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { runSeed } from "./run";
import {
  ensureSampleOrder,
  findSampleOrders,
  prepareSampleSeed,
  runSampleSeed,
  SampleOrganizationError,
} from "./sample-assignments";
import {
  SAMPLE_ASSIGNMENTS,
  SAMPLE_COMPANY_NAME,
  SAMPLE_ORGANIZATION_NAME,
} from "./sample-assignments.data";

/*
 * Utviklerens egne tester for seed-steget (testplanen dekkes i tillegg av testskriveren i
 * `sample-assignments.test.ts`). Alt er oppdiktet.
 */

const env = { SEED_ADMIN_EMAIL: "admin@example.invalid", SEED_ADMIN_NAME: "Test Admin" };

beforeEach(async () => {
  await resetDatabase();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function sampleOrganizationId() {
  const [row] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.name, SAMPLE_ORGANIZATION_NAME));
  return row!.id;
}

async function adminActor() {
  const [user] = await db.select().from(users).where(eq(users.email, env.SEED_ADMIN_EMAIL));
  return { id: user!.id, email: user!.email, name: user!.name };
}

async function totals(organizationId: string) {
  const counted = async (table: typeof events | typeof auditLog | typeof orders | typeof rooms) => {
    const [row] = await db
      .select({ n: count() })
      .from(table)
      .where(eq(table.organizationId, organizationId));
    return row!.n;
  };
  const [sequence] = await db
    .select({ value: max(numberSequences.nextValue) })
    .from(numberSequences)
    .where(eq(numberSequences.organizationId, organizationId));
  return {
    events: await counted(events),
    audit: await counted(auditLog),
    orders: await counted(orders),
    rooms: await counted(rooms),
    sequence: sequence?.value ?? null,
  };
}

describe("runSampleSeed", () => {
  beforeEach(async () => {
    await runSeed(env);
  });

  it("lager fire testoppdrag gjennom tjenestene, med selskap, status og bygninger", async () => {
    const summary = await runSampleSeed(env, TEST_NOW);
    expect(summary.organization).toBe("created");
    expect(summary.assignments.map((entry) => entry.result)).toEqual([
      "created",
      "created",
      "created",
      "created",
    ]);

    const organizationId = await sampleOrganizationId();
    const [organization] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    expect(organization!.settings.sampleData).toBe(true);

    const [company] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.organizationId, organizationId));
    const rows = await db
      .select({
        status: assignments.status,
        companyId: assignments.companyId,
        number: assignments.number,
        externalRef: orders.externalRef,
      })
      .from(assignments)
      .innerJoin(orders, eq(orders.id, assignments.orderId))
      .where(eq(assignments.organizationId, organizationId));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.number)).size).toBe(4);
    for (const sample of SAMPLE_ASSIGNMENTS) {
      const row = rows.find((candidate) => candidate.externalRef === sample.externalRef)!;
      expect(row.status).toBe(sample.status);
      expect(row.companyId).toBe(company!.id);
    }

    const buildingCount = SAMPLE_ASSIGNMENTS.reduce((sum, s) => sum + s.buildings.length, 0);
    const [buildingRow] = await db
      .select({ n: count() })
      .from(reportBuildings)
      .where(eq(reportBuildings.organizationId, organizationId));
    expect(buildingRow!.n).toBe(buildingCount);
    const [garage] = await db
      .select({ n: count() })
      .from(rooms)
      .where(and(eq(rooms.organizationId, organizationId), eq(rooms.roomType, "garage")));
    expect(garage!.n).toBe(1);
    const [measured] = await db
      .select({ n: count() })
      .from(floorAreas)
      .where(and(eq(floorAreas.organizationId, organizationId), isNotNull(floorAreas.measuredBy)));
    expect(measured!.n).toBe(
      SAMPLE_ASSIGNMENTS.reduce(
        (sum, s) => sum + s.buildings.reduce((n, b) => n + b.floors.length, 0),
        0,
      ),
    );
    const [partyRow] = await db
      .select({ n: count() })
      .from(assignmentParties)
      .where(eq(assignmentParties.organizationId, organizationId));
    expect(partyRow!.n).toBe(SAMPLE_ASSIGNMENTS.reduce((sum, s) => sum + s.parties.length, 0));
    expect(SAMPLE_COMPANY_NAME).toBe("Prøveselskap AS");
  });

  it("andre kjøring skriver ingenting, og et kansellert testoppdrag lages ikke på nytt", async () => {
    await runSampleSeed(env, TEST_NOW);
    const organizationId = await sampleOrganizationId();
    const [cooperative] = (await findSampleOrders(organizationId)).filter(
      (order) => order.externalRef === "sample:apartment-cooperative",
    );
    await cancelAssignment(await adminActor(), organizationId, cooperative!.assignmentId!, {
      expectedStatus: "in_progress",
      reason: "Prøve",
    });
    const before = await totals(organizationId);

    const summary = await runSampleSeed(env, TEST_NOW);
    expect(summary.organization).toBe("existing");
    expect(summary.assignments.map((entry) => entry.result)).toEqual([
      "existing",
      "existing",
      "skipped",
      "existing",
    ]);
    expect(await totals(organizationId)).toEqual(before);
  });

  it("fullfører en kjøring der bare ordren finnes", async () => {
    await runSampleSeed(env, TEST_NOW);
    const full = await totals(await sampleOrganizationId());
    await resetDatabase();
    await runSeed(env);

    // Første kjøring stoppet etter ordren til eneboligen
    const { context } = await prepareSampleSeed(env, TEST_NOW);
    const { result } = await ensureSampleOrder(context, SAMPLE_ASSIGNMENTS[0]!);
    expect(result).toBe("created");

    await runSampleSeed(env, TEST_NOW);
    const organizationId = await sampleOrganizationId();
    const after = await totals(organizationId);
    expect(after.orders).toBe(full.orders);
    expect(after.rooms).toBe(full.rooms);
    expect(after.sequence).toBe(full.sequence);
  });

  it("nekter å skrive i en organisasjon med navnet uten merket", async () => {
    await db
      .insert(organizations)
      .values({ name: SAMPLE_ORGANIZATION_NAME, brandName: SAMPLE_ORGANIZATION_NAME });
    const organizationId = await sampleOrganizationId();
    await expect(runSampleSeed(env, TEST_NOW)).rejects.toBeInstanceOf(SampleOrganizationError);
    const [companyRow] = await db
      .select({ n: count() })
      .from(companies)
      .where(eq(companies.organizationId, organizationId));
    expect(companyRow!.n).toBe(0);
  });

  it("stopper uten admin, før noe skrives", async () => {
    await expect(
      runSampleSeed({ SEED_ADMIN_EMAIL: "ingen@example.invalid" }, TEST_NOW),
    ).rejects.toThrow("Kjør pnpm db:seed først");
    await expect(runSampleSeed({}, TEST_NOW)).rejects.toThrow("SEED_ADMIN_EMAIL mangler");
    const found = await db
      .select()
      .from(organizations)
      .where(eq(organizations.name, SAMPLE_ORGANIZATION_NAME));
    expect(found).toHaveLength(0);
  });

  it("admin er admin i prøveorganisasjonen og fortsatt i Byggcon, og loggen har ingen e-post", async () => {
    await runSampleSeed(env, TEST_NOW);
    await runSampleSeed(env, TEST_NOW);
    const actor = await adminActor();
    const grant = await requireOrganizationAccess(
      actor,
      await sampleOrganizationId(),
      "organization.manage",
    );
    expect(grant.roles).toEqual(["admin"]);
    const [byggcon] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.name, "Byggcon"));
    await requireOrganizationAccess(actor, byggcon!.id, "organization.manage");
    const lines = vi.mocked(console.log).mock.calls.map((args) => args.map(String).join(" "));
    for (const line of lines) expect(line).not.toContain("@");
  });
});

describe("findSampleOrders", () => {
  it("gir bare ordrer i egen organisasjon (tenant-isolasjon)", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createOrder(grantA.organizationId, {
          externalRef: "sample:detached-garage",
        });
        const b = await createOrder(grantB.organizationId, {
          externalRef: "sample:detached-garage",
        });
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
        return findSampleOrders(grant.organizationId);
      },
      idOf: (row) => row.id,
    });
  });
});

describe("kildeteksten", () => {
  it("sletter aldri noe", () => {
    for (const file of ["sample-assignments.ts", "sample-index.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      for (const forbidden of [
        "db.delete",
        "tx.delete",
        "DELETE FROM",
        "deletedAt:",
        "cancelAssignment",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });
});
