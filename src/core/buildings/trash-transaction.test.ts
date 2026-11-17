import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import {
  removeBuilding,
  removeFloor,
  restoreBuilding,
  restoreFloor,
  restoreRoom,
  saveFloorArea,
} from "@/core/buildings";
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
  createRoom,
  createUser,
  resetDatabase,
} from "../../../tests/factories";

/*
 * Papirkurv: transaksjon og samtidighet (docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 3).
 *
 * `recordEvent` og `recordAuditEvent` er pakket inn: de kaller den ekte funksjonen, og kaster bare
 * der testen ber om det. Kaster en av dem, skal verken rad, logg eller hendelse finnes.
 * Samtidige kall skal aldri gi en ubehandlet databasefeil (500), heller ikke fra den unike
 * indeksen `floor_areas_active_floor_idx`.
 *
 * Ingen ny spørring her, så filen har ikke `expectTenantIsolation` (den står i trash.test.ts).
 * Testdata er oppdiktet. Støtter hovedmål: reklamasjoner (aldri en halv gjenoppretting).
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

const FAILURES = [
  [
    "recordEvent",
    () =>
      vi.mocked(recordEvent).mockImplementationOnce(async () => {
        throw new Error("hendelsen feilet (test)");
      }),
  ],
  [
    "recordAuditEvent (siste)",
    () => {
      // Kaster på det tredje kallet: noen rader er alt skrevet i transaksjonen.
      const actual = vi.mocked(recordAuditEvent).getMockImplementation()!;
      vi.mocked(recordAuditEvent).mockImplementationOnce(actual);
      vi.mocked(recordAuditEvent).mockImplementationOnce(actual);
      vi.mocked(recordAuditEvent).mockImplementationOnce(async () => {
        throw new Error("revisjonsloggen feilet (test)");
      });
    },
  ],
] as const;

type DbRow = Record<string, unknown>;

async function rows(table: string): Promise<DbRow[]> {
  return (await db.execute(
    sql`select * from ${sql.identifier(table)} order by id`,
  )) as unknown as DbRow[];
}

async function snapshot() {
  const result: Record<string, DbRow[]> = {};
  for (const table of [
    "report_buildings",
    "floors",
    "floor_areas",
    "rooms",
    "events",
    "audit_log",
  ]) {
    result[table] = await rows(table);
  }
  return JSON.stringify(result);
}

/** Organisasjon med admin og en etasje med areal og to rom. */
async function setup() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  await createProperty(org.id, { assignmentId: assignment.id });
  const building = await createBuilding(org.id, { assignmentId: assignment.id });
  const floor = await createFloor(org.id, { buildingId: building.id });
  const area = await createFloorArea(org.id, { floorId: floor.id, braI: 64 });
  const room1 = await createRoom(org.id, { floorId: floor.id });
  const room2 = await createRoom(org.id, { floorId: floor.id });
  return { org, admin, building, floor, area, rooms: [room1, room2] };
}

describe("3.1 tilbakerulling", () => {
  it("modulene er pakket inn (ellers tester filen ingenting)", async () => {
    const { org, admin, floor } = await setup();
    await removeFloor(admin, org.id, floor.id);
    expect(vi.mocked(recordEvent)).toHaveBeenCalled();
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalled();
  });

  it.each(FAILURES)(
    "restoreFloor: %s kaster → etasjen, rommene og arealet er fortsatt fjernet",
    async (_name, fail) => {
      const { org, admin, floor } = await setup();
      await removeFloor(admin, org.id, floor.id);
      const before = await snapshot();
      fail();

      await expect(restoreFloor(admin, org.id, floor.id, "undo")).rejects.toThrow();
      expect(await snapshot()).toBe(before);
    },
  );

  it.each(FAILURES)(
    "restoreBuilding: %s kaster → ingenting er hentet tilbake",
    async (_name, fail) => {
      const { org, admin, building } = await setup();
      await removeBuilding(admin, org.id, building.id);
      const before = await snapshot();
      fail();

      await expect(restoreBuilding(admin, org.id, building.id, "trash")).rejects.toThrow();
      expect(await snapshot()).toBe(before);
    },
  );

  it.each(FAILURES)(
    "restoreRoom med overordnet ledd: %s kaster → ingenting er hentet tilbake",
    async (_name, fail) => {
      const { org, admin, floor, rooms } = await setup();
      await removeFloor(admin, org.id, floor.id);
      const before = await snapshot();
      fail();

      await expect(restoreRoom(admin, org.id, rooms[0]!.id, "trash")).rejects.toThrow();
      expect(await snapshot()).toBe(before);
    },
  );

  it.each(FAILURES)(
    "removeFloor med innhold: %s kaster → ingenting er fjernet",
    async (_name, fail) => {
      const { org, admin, floor } = await setup();
      const before = await snapshot();
      fail();

      await expect(removeFloor(admin, org.id, floor.id)).rejects.toThrow();
      expect(await snapshot()).toBe(before);
    },
  );

  it.each(FAILURES)(
    "removeBuilding med innhold: %s kaster → ingenting er fjernet",
    async (_name, fail) => {
      const { org, admin, building } = await setup();
      const before = await snapshot();
      fail();

      await expect(removeBuilding(admin, org.id, building.id)).rejects.toThrow();
      expect(await snapshot()).toBe(before);
    },
  );
});

describe("3.2–3.3 samtidighet", () => {
  it("3.2 to gjenopprettinger av samme etasje samtidig: én endrer, ingen feil, én hendelse", async () => {
    const { org, admin, floor } = await setup();
    await removeFloor(admin, org.id, floor.id);

    const results = await Promise.all([
      restoreFloor(admin, org.id, floor.id, "undo"),
      restoreFloor(admin, org.id, floor.id, "trash"),
    ]);
    expect(results.map((result) => result.changed).sort()).toEqual([false, true]);
    const restored = (await rows("events")).filter(
      (row) => row.type === "assignment.floor_restored",
    );
    expect(restored).toHaveLength(1);
  });

  it("3.2 rom og etasje i samme gruppe samtidig: ingen feil, etasjen hentes én gang", async () => {
    const { org, admin, floor, rooms } = await setup();
    await removeFloor(admin, org.id, floor.id);

    const settled = await Promise.allSettled([
      restoreRoom(admin, org.id, rooms[0]!.id, "trash"),
      restoreFloor(admin, org.id, floor.id, "trash"),
    ]);
    expect(settled.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const floorEvents = (await rows("events")).filter(
      (row) => row.type === "assignment.floor_restored",
    );
    expect(floorEvents).toHaveLength(1);
    const active = (await rows("floor_areas")).filter((row) => row.deleted_at === null);
    expect(active).toHaveLength(1);
  });

  it("3.3 gjenoppretting samtidig med ny arealrad: ingen feil fra indeksen, nøyaktig én aktiv arealrad", async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetDatabase();
      const { org, admin, floor } = await setup();
      await removeFloor(admin, org.id, floor.id);

      const settled = await Promise.allSettled([
        saveFloorArea(admin, org.id, floor.id, {
          braI: "70",
          braE: "",
          braB: "",
          alh: "",
          measuredBy: "",
          method: "laser",
          comment: "",
        } as unknown as Parameters<typeof saveFloorArea>[3]),
        restoreFloor(admin, org.id, floor.id, "trash"),
      ]);
      expect(settled[1]!.status).toBe("fulfilled");
      if (settled[0]!.status === "rejected") {
        // Kom lagringen først, var etasjen fortsatt fjernet: vanlig avslag, ingen databasefeil.
        expect(settled[0]!.reason).toBeInstanceOf(AccessDeniedError);
      }
      const active = (await rows("floor_areas")).filter((row) => row.deleted_at === null);
      expect(active).toHaveLength(1);
    }
  });

  it("3.3 ny aktiv arealrad lagt inn før gjenopprettingen (også uten lås): den nye står, ingen feil", async () => {
    const { org, admin, floor, area } = await setup();
    await removeFloor(admin, org.id, floor.id);
    // Rad lagt inn direkte, slik en annen vei inn kunne gjort det.
    const fresh = await createFloorArea(org.id, { floorId: floor.id, braI: 71 });

    const result = await restoreFloor(admin, org.id, floor.id, "undo");
    expect(result.changed).toBe(true);
    expect(result.notices).toHaveLength(1);
    const active = (await rows("floor_areas")).filter((row) => row.deleted_at === null);
    expect(active.map((row) => row.id)).toEqual([fresh.id]);
    expect(active.map((row) => row.id)).not.toContain(area.id);
  });
});
