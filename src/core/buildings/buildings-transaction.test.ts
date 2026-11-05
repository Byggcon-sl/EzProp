import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAuditEvent } from "@/core/audit";
import { saveBuilding, saveFloorArea, removeFloor } from "@/core/buildings";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import {
  createAssignment,
  createBuilding,
  createEmployee,
  createFloor,
  createFloorArea,
  createOrganization,
  createProperty,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Hendelser og revisjonslogg skrives i samme transaksjon som bygningen, arealet og fjerningen
 * (docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md 4.6.5).
 *
 * `recordEvent` og `recordAuditEvent` er pakket inn: de kaller den ekte funksjonen, og kaster
 * bare der testen ber om det. Kaster en av dem, skal endringen ikke finnes.
 *
 * Ingen ny spørring her, så filen trenger ikke expectTenantIsolation (den står i
 * buildings.test.ts). Testdata er oppdiktet. Støtter hovedmål: reklamasjoner (aldri en bygning,
 * et areal eller en fjerning uten spor).
 */

vi.mock("@/core/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/events")>();
  return { ...actual, recordEvent: vi.fn(actual.recordEvent) };
});

vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return { ...actual, recordAuditEvent: vi.fn(actual.recordAuditEvent) };
});

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(recordEvent).mockClear();
  vi.mocked(recordAuditEvent).mockClear();
});

function failEventOnce() {
  vi.mocked(recordEvent).mockImplementationOnce(async () => {
    throw new Error("hendelsen feilet (test)");
  });
}

function failAuditOnce() {
  vi.mocked(recordAuditEvent).mockImplementationOnce(async () => {
    throw new Error("revisjonsloggen feilet (test)");
  });
}

const FAILURES = [
  ["recordEvent", failEventOnce],
  ["recordAuditEvent", failAuditOnce],
] as const;

type DbRow = Record<string, unknown>;

async function rows(table: string): Promise<DbRow[]> {
  return (await db.execute(
    sql`select * from ${sql.identifier(table)} order by id`,
  )) as unknown as DbRow[];
}

async function counts() {
  const result: Record<string, number> = {};
  for (const table of [
    "report_buildings",
    "floors",
    "floor_areas",
    "rooms",
    "events",
    "audit_log",
  ]) {
    result[table] = (await rows(table)).length;
  }
  return result;
}

async function setup() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  await createProperty(org.id, { assignmentId: assignment.id });
  return { org, admin, assignment };
}

const AREA = {
  braI: "123.4",
  braE: "56.7",
  braB: "8.9",
  alh: "210.3",
  measuredBy: "",
  method: "laser",
  comment: "Målt langs innvendig vegg test",
} as unknown as Parameters<typeof saveFloorArea>[3];

describe("4.6.5 feiler hendelsen eller loggen, finnes ingen endring", () => {
  it("modulene er pakket inn (ellers tester filen ingenting)", async () => {
    const { org, admin, assignment } = await setup();
    await saveBuilding(admin, org.id, assignment.id, null, { name: "Bolighus" } as never);
    expect(vi.mocked(recordEvent)).toHaveBeenCalled();
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalled();
  });

  it.each(FAILURES)("saveBuilding: %s kaster → ingen ny bygning", async (_name, fail) => {
    const { org, admin, assignment } = await setup();
    const before = await counts();
    fail();

    await expect(
      saveBuilding(admin, org.id, assignment.id, null, { name: "Bolighus" } as never),
    ).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });

  it.each(FAILURES)(
    "saveBuilding (endring): %s kaster → navnet er uendret",
    async (_name, fail) => {
      const { org, admin, assignment } = await setup();
      const building = await createBuilding(org.id, { assignmentId: assignment.id });
      const before = await rows("report_buildings");
      fail();

      await expect(
        saveBuilding(admin, org.id, assignment.id, building.id, { name: "Garasje test" } as never),
      ).rejects.toThrow();
      expect(await rows("report_buildings")).toEqual(before);
    },
  );

  it.each(FAILURES)("saveFloorArea: %s kaster → ingen arealrad", async (_name, fail) => {
    const { org, admin, assignment } = await setup();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    const before = await counts();
    fail();

    await expect(saveFloorArea(admin, org.id, floor.id, AREA)).rejects.toThrow();
    expect(await counts()).toEqual(before);
  });

  it.each(FAILURES)(
    "removeFloor: %s kaster → etasjen og arealet er ikke myk-slettet",
    async (_name, fail) => {
      const { org, admin, assignment } = await setup();
      const building = await createBuilding(org.id, { assignmentId: assignment.id });
      const floor = await createFloor(org.id, { buildingId: building.id });
      await createFloorArea(org.id, { floorId: floor.id, braI: 123.4 });
      const beforeFloors = await rows("floors");
      const beforeAreas = await rows("floor_areas");
      const before = await counts();
      fail();

      await expect(removeFloor(admin, org.id, floor.id)).rejects.toThrow();
      expect(await rows("floors")).toEqual(beforeFloors);
      expect(await rows("floor_areas")).toEqual(beforeAreas);
      expect(await counts()).toEqual(before);
      for (const row of [...beforeFloors, ...beforeAreas]) expect(row.deleted_at).toBeNull();
    },
  );
});
