import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { removeFloor, restoreFloor, saveFloorArea } from "@/core/buildings";
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
 * Oppgavekort: docs/funksjoner/fase2a-papirkurv.md («Alt i én transaksjon», A411 om den unike
 * indeksen `floor_areas_active_floor_idx`).
 *
 * `recordEvent` og `recordAuditEvent` er pakket inn som i buildings-transaction.test.ts: de kaller
 * den ekte funksjonen, og kaster bare der testen ber om det.
 *
 * Ingen ny spørring testes her (tenant-isolasjonen for restoreFloor står i trash.test.ts).
 * Testdata er oppdiktet: «Bolighus test», «2. etasje», arealene 50 og 77.
 *
 * Støtter hovedmål: færre reklamasjoner (aldri en halv gjenoppretting eller en fjerning uten
 * spor) og de ansatte (dobbelttrykk på «Angre» eller «Gjenopprett» gir aldri en feilside).
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

type DbRow = Record<string, unknown>;
type Restored = { restored: { type: string; id: string }[]; changed: boolean; notices: string[] };

async function rows(table: string, where = sql`true`): Promise<DbRow[]> {
  return (await db.execute(
    sql`select * from ${sql.identifier(table)} where ${where} order by id`,
  )) as unknown as DbRow[];
}

async function snapshot(): Promise<string> {
  const all: Record<string, DbRow[]> = {};
  for (const table of ["report_buildings", "floors", "floor_areas", "rooms"]) {
    all[table] = await rows(table);
  }
  return JSON.stringify(all);
}

async function counts() {
  return { events: (await rows("events")).length, audit: (await rows("audit_log")).length };
}

function failEventOnce() {
  vi.mocked(recordEvent).mockImplementationOnce(async () => {
    throw new Error("hendelsen feilet (test)");
  });
}

/** Lar de første `callNumber - 1` kallene gå, og kaster på kall nr. `callNumber`. */
function failAuditOnCall(callNumber: number) {
  const actual = vi.mocked(recordAuditEvent).getMockImplementation()!;
  for (let i = 1; i < callNumber; i += 1)
    vi.mocked(recordAuditEvent).mockImplementationOnce(actual);
  vi.mocked(recordAuditEvent).mockImplementationOnce(async () => {
    throw new Error(`revisjonsloggen feilet på kall ${callNumber} (test)`);
  });
}

/** Admin, oppdrag med eiendom, bygning og etasje med areal og tre rom. */
async function setup() {
  const org = await createOrganization("Testfirma takst");
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  await createProperty(org.id, { assignmentId: assignment.id });
  const building = await createBuilding(org.id, {
    assignmentId: assignment.id,
    name: "Bolighus test",
  });
  const floor = await createFloor(org.id, { buildingId: building.id, name: "2. etasje", level: 2 });
  const area = await createFloorArea(org.id, { floorId: floor.id, braI: 50, method: "laser" });
  const rooms = [];
  for (const roomType of ["bathroom", "bedroom", "storage"]) {
    rooms.push(await createRoom(org.id, { floorId: floor.id, roomType }));
  }
  return { org, admin, assignment, building, floor, area, rooms };
}

describe("3.1 tilbakerulling", () => {
  it("feil i hendelsen midt i restoreFloor: etasjen, rommene og arealraden er fortsatt fjernet, ingen nye logg- eller hendelsesrader", async () => {
    const { org, admin, floor } = await setup();
    await removeFloor(admin, org.id, floor.id);
    const before = await snapshot();
    const countsBefore = await counts();

    failEventOnce();
    await expect(restoreFloor(admin, org.id, floor.id, "undo")).rejects.toThrow(
      "hendelsen feilet (test)",
    );

    expect(await snapshot()).toBe(before);
    expect(await counts()).toEqual(countsBefore);
  });

  it("feil i revisjonsloggen på tredje rad i restoreFloor ruller tilbake alt", async () => {
    const { org, admin, floor } = await setup();
    await removeFloor(admin, org.id, floor.id);
    const before = await snapshot();
    const countsBefore = await counts();

    failAuditOnCall(3);
    await expect(restoreFloor(admin, org.id, floor.id, "trash")).rejects.toThrow(
      "revisjonsloggen feilet på kall 3 (test)",
    );

    expect(await snapshot()).toBe(before);
    expect(await counts()).toEqual(countsBefore);
  });

  it("feil i hendelsen i removeFloor med innhold: ingenting er fjernet", async () => {
    const { org, admin, floor } = await setup();
    const before = await snapshot();
    const countsBefore = await counts();

    failEventOnce();
    await expect(removeFloor(admin, org.id, floor.id)).rejects.toThrow("hendelsen feilet (test)");

    expect(await snapshot()).toBe(before);
    expect(await counts()).toEqual(countsBefore);
  });

  it("feil i revisjonsloggen på tredje rad i removeFloor med innhold: ingenting er fjernet", async () => {
    const { org, admin, floor } = await setup();
    const before = await snapshot();
    const countsBefore = await counts();

    failAuditOnCall(3);
    await expect(removeFloor(admin, org.id, floor.id)).rejects.toThrow(
      "revisjonsloggen feilet på kall 3 (test)",
    );

    expect(await snapshot()).toBe(before);
    expect(await counts()).toEqual(countsBefore);
  });
});

describe("3.2 to gjenopprettinger samtidig", () => {
  it.each([1, 2, 3])(
    "runde %i: begge lykkes, nøyaktig én endrer, nøyaktig én floor_restored-hendelse",
    async () => {
      const { org, admin, floor, area, rooms } = await setup();
      await removeFloor(admin, org.id, floor.id);

      const results = await Promise.allSettled([
        restoreFloor(admin, org.id, floor.id, "undo"),
        restoreFloor(admin, org.id, floor.id, "trash"),
      ]);

      for (const result of results) {
        expect(result.status, result.status === "rejected" ? String(result.reason) : "lyktes").toBe(
          "fulfilled",
        );
      }
      const changed = results.map((r) => (r as PromiseFulfilledResult<unknown>).value as Restored);
      expect(changed.filter((r) => r.changed)).toHaveLength(1);
      const restoredEvents = (await rows("events")).filter(
        (e) => e.type === "assignment.floor_restored",
      );
      expect(restoredEvents).toHaveLength(1);
      expect((await rows("floors", sql`id = ${floor.id}`))[0]!.deleted_at).toBeNull();
      expect((await rows("floor_areas", sql`id = ${area.id}`))[0]!.deleted_at).toBeNull();
      for (const room of rooms) {
        expect((await rows("rooms", sql`id = ${room.id}`))[0]!.deleted_at).toBeNull();
      }
    },
  );
});

describe("3.3 gjenoppretting samtidig med ny arealrad", () => {
  it.each([1, 2, 3])(
    "runde %i: ingen ubehandlet feil fra den unike indeksen, og nøyaktig én aktiv arealrad etterpå",
    async () => {
      const { org, admin, floor } = await setup();
      await removeFloor(admin, org.id, floor.id);

      const results = await Promise.allSettled([
        restoreFloor(admin, org.id, floor.id, "undo"),
        saveFloorArea(admin, org.id, floor.id, {
          braI: "77",
          braE: "",
          braB: "",
          alh: "",
          measuredBy: "",
          method: "laser",
          comment: "",
        } as unknown as Parameters<typeof saveFloorArea>[3]),
      ]);

      // Gjenopprettingen skal alltid lykkes. Lagringen kan få avslag om den kom før etasjen var
      // tilbake (fjernet etasje), men aldri en databasefeil.
      expect(results[0]!.status, String((results[0] as PromiseRejectedResult).reason)).toBe(
        "fulfilled",
      );
      if (results[1]!.status === "rejected") {
        expect(results[1]!.reason).toBeInstanceOf(AccessDeniedError);
      }
      const active = await rows("floor_areas", sql`floor_id = ${floor.id} and deleted_at is null`);
      expect(active).toHaveLength(1);
    },
  );
});
