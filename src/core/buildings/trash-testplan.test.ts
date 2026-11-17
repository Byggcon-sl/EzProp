import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import {
  floorInputSchema,
  getAssignmentBuildings,
  listTrash,
  removeBuilding,
  removeFloor,
  removeRoom,
  restoreBuilding,
  restoreFloor,
  restoreRoom,
  roomInputSchema,
} from "@/core/buildings";
import { db } from "@/db/client";
import { auditLog, employees, events, organizations, type EmployeeRole } from "@/db/schema";
import {
  createAiUsageLog,
  createAssignment,
  createBuilding,
  createEmployee,
  createFloor,
  createFloorArea,
  createOffice,
  createOrganization,
  createProperty,
  createRoom,
  createUser,
  resetDatabase,
  TEST_NOW,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Papirkurv og angre for sletting: kjernen for bygninger, etasjer, arealrader og rom.
 * Testplan: docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 1, 2, 4 og 5 (parter står i
 * src/core/assignments/party-restore.test.ts, tilbakerulling og samtidighet i
 * trash-transaction.test.ts, kansellert oppdrag i buildings-cancel.test.ts).
 * Oppgavekort: docs/funksjoner/fase2a-papirkurv.md (A410, A411, A414, A416, A417).
 *
 * Signaturene er avtalen i testplanen:
 * - listTrash(actor, organizationId, assignmentId) → linjer med type, id, label, path,
 *   groupCount, area (bare etasjer), removedAt, removedByName;
 * - restoreBuilding / restoreFloor / restoreRoom(actor, organizationId, id, how), how er
 *   "undo" | "trash" → { restored: { type, id, organizationId }[], changed, notices };
 * - removeBuilding / removeFloor → { removed: { type, id }[] }.
 * Typene i svaret leses løst (`AnyRecord`), slik at testene ikke binder seg til flere navn enn
 * avtalen. Fasiten for reglene (slettegruppe, overordnet ledd, arealrad, gjentatte kall) står her,
 * ikke importert fra koden.
 *
 * Testdata er oppdiktet: «Bolighus test», «Garasje test», «1. etasje», «2. etasje», «Bad test»,
 * «Målt langs vegg test», arealene 50, 10 og 4. Ingen KI-kall og ingen nett.
 *
 * Støtter hovedmål: de ansatte (et feiltrykk rettes med ett trykk, på samme plass og med samme
 * verdier, og en etasje med rom fjernes med ett trykk), KI i bunnen (strukturerte hendelser uten
 * persondata, KI-forslag på rom og etasje står uendret) og færre reklamasjoner (ingenting slettes
 * permanent, hver sletting og gjenoppretting står i revisjonsloggen).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BUILDING = "Bolighus test";
const GARAGE = "Garasje test";
const FLOOR_1 = "1. etasje";
const FLOOR_2 = "2. etasje";
const ROOM_NAME = "Bad test";
const COMMENT = "Målt langs vegg test";
const A410_NOTICE = "Rommet kom tilbake, sammen med etasjen «1. etasje».";

type AnyRecord = Record<string, unknown>;
type DbRow = Record<string, unknown>;
type Restored = {
  restored: { type: string; id: string; organizationId?: string }[];
  changed: boolean;
  notices: string[];
};

const TABLES = ["report_buildings", "floors", "floor_areas", "rooms"] as const;
type TableName = (typeof TABLES)[number] | "assignment_parties";

// ---------------------------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------------------------

async function rawRows(table: TableName, where = sql`true`): Promise<DbRow[]> {
  return (await db.execute(
    sql`select * from ${sql.identifier(table)} where ${where} order by id`,
  )) as unknown as DbRow[];
}

async function row(table: TableName, id: string): Promise<DbRow> {
  const [found] = await rawRows(table, sql`id = ${id}`);
  if (!found) throw new Error(`fant ikke raden i ${table}`);
  return found;
}

function timeOf(value: unknown): number | null {
  return value === null || value === undefined ? null : new Date(value as string | Date).getTime();
}

async function isActive(table: TableName, id: string): Promise<boolean> {
  return (await row(table, id)).deleted_at === null;
}

async function tableCount(table: string): Promise<number> {
  const result = (await db.execute(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  )) as unknown as { n: number }[];
  return result[0]?.n ?? 0;
}

async function eventsFor(organizationId: string, type?: string) {
  const rows = await db.select().from(events).where(eq(events.organizationId, organizationId));
  return rows.filter((r) => type === undefined || r.type === type);
}

async function auditFor(organizationId: string, action?: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
  return rows.filter((r) => action === undefined || r.action === action);
}

async function eventAndAuditCounts(organizationId: string) {
  const [e] = await db
    .select({ n: count() })
    .from(events)
    .where(eq(events.organizationId, organizationId));
  const [a] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId));
  return { events: e?.n ?? 0, audit: a?.n ?? 0 };
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

function asRestored(value: unknown): Restored {
  return value as Restored;
}

function lines(value: unknown): AnyRecord[] {
  return value as AnyRecord[];
}

/** Kolonnene som skal være like før sletting og etter gjenoppretting. */
function stable(r: DbRow): DbRow {
  const copy: DbRow = { ...r };
  for (const key of ["updated_at", "updated_by", "deleted_at", "deleted_by", "row_version"]) {
    delete copy[key];
  }
  return copy;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin, ett kontor og ett oppdrag med eiendom. */
async function base(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id });
  await createProperty(org.id, { assignmentId: assignment.id });
  return { org, admin, adminEmployee, office, assignment };
}

async function person(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor = await createUser(name ? { name } : {});
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/** Etasje med areal (50, 10, 4) og `rooms` aktive rom i bygningen. */
async function floorWithRooms(
  organizationId: string,
  buildingId: string,
  name: string,
  rooms: number,
  level = 1,
) {
  const floor = await createFloor(organizationId, { buildingId, name, level });
  const area = await createFloorArea(organizationId, {
    floorId: floor.id,
    braI: 50,
    braE: 10,
    braB: 4,
    method: "laser",
    comment: COMMENT,
  });
  const roomRows = [];
  for (let i = 0; i < rooms; i += 1) {
    roomRows.push(
      await createRoom(organizationId, {
        floorId: floor.id,
        roomType: i === 0 ? "bathroom" : "bedroom",
        name: i === 0 ? ROOM_NAME : `Soverom ${i} test`,
        createdAt: new Date(TEST_NOW.getTime() + i * 1000),
      }),
    );
  }
  return { floor, area, rooms: roomRows };
}

/** Låser `new Date()` (uten argument) til et fast tidspunkt. Bare `Date` er falsk. */
function setNow(date: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(date);
}

function at(minutesAfterTestNow: number, seconds = 0): Date {
  return new Date(TEST_NOW.getTime() + minutesAfterTestNow * 60_000 + seconds * 1000);
}

// ---------------------------------------------------------------------------------------------
// 1. Regler for sletting og gjenoppretting
// ---------------------------------------------------------------------------------------------

describe("1. slettegruppe (A414)", () => {
  it("1.1 «Fjern» etasje med 4 rom og arealrad: alt får nøyaktig samme deleted_at og deleted_by; svaret lister 1 etasje og 4 rom", async () => {
    const { org, admin, adminEmployee, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, area, rooms } = await floorWithRooms(org.id, building.id, FLOOR_2, 4);

    const result = (await removeFloor(admin, org.id, floor.id)) as unknown as {
      removed: { type: string; id: string }[];
    };

    const floorRow = await row("floors", floor.id);
    const stamp = timeOf(floorRow.deleted_at);
    expect(stamp).not.toBeNull();
    expect(floorRow.deleted_by).toBe(adminEmployee.id);
    for (const r of rooms) {
      const roomRow = await row("rooms", r.id);
      expect(timeOf(roomRow.deleted_at), "rom").toBe(stamp);
      expect(roomRow.deleted_by).toBe(adminEmployee.id);
    }
    const areaRow = await row("floor_areas", area.id);
    expect(timeOf(areaRow.deleted_at), "arealrad").toBe(stamp);
    expect(areaRow.deleted_by).toBe(adminEmployee.id);

    expect(result.removed.filter((r) => r.type === "floor").map((r) => r.id)).toEqual([floor.id]);
    expect(
      result.removed
        .filter((r) => r.type === "room")
        .map((r) => r.id)
        .sort(),
    ).toEqual(rooms.map((r) => r.id).sort());
  });

  it("1.2 «Fjern» bygning med 2 etasjer, 3 rom og 2 arealrader: alt får samme tidspunkt", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const first = await floorWithRooms(org.id, building.id, FLOOR_1, 2, 1);
    const second = await floorWithRooms(org.id, building.id, FLOOR_2, 1, 2);

    const result = (await removeBuilding(admin, org.id, building.id)) as unknown as {
      removed: { type: string; id: string }[];
    };

    const stamp = timeOf((await row("report_buildings", building.id)).deleted_at);
    expect(stamp).not.toBeNull();
    for (const f of [first, second]) {
      expect(timeOf((await row("floors", f.floor.id)).deleted_at)).toBe(stamp);
      expect(timeOf((await row("floor_areas", f.area.id)).deleted_at)).toBe(stamp);
      for (const r of f.rooms) expect(timeOf((await row("rooms", r.id)).deleted_at)).toBe(stamp);
    }
    expect(result.removed.filter((r) => r.type === "building")).toHaveLength(1);
    expect(result.removed.filter((r) => r.type === "floor")).toHaveLength(2);
    expect(result.removed.filter((r) => r.type === "room")).toHaveLength(3);
  });

  it("1.3 rom fjernet kl. 10:00 blir liggende når etasjen fjernet 10:05 gjenopprettes", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 3);
    const [early, ...rest] = rooms;

    setNow(at(0));
    await removeRoom(admin, org.id, early!.id);
    setNow(at(5));
    await removeFloor(admin, org.id, floor.id);
    setNow(at(6));
    await restoreFloor(admin, org.id, floor.id, "trash");

    expect(await isActive("floors", floor.id)).toBe(true);
    for (const r of rest) expect(await isActive("rooms", r.id), "rom fra 10:05").toBe(true);
    expect(await isActive("rooms", early!.id), "rom fjernet før").toBe(false);
  });
});

describe("1. arealraden (A411)", () => {
  it("1.4 removeFloor setter ett tidspunkt for etasjen og arealraden, også om klokka går mellom kallene", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const floor = await createFloor(org.id, { buildingId: building.id, name: FLOOR_1 });
    const area = await createFloorArea(org.id, { floorId: floor.id, braI: 50 });

    // Hver `new Date()` uten argument flytter seg ett sekund frem. To `softDelete()`-kall gir
    // da ulik tid; ett felles tidspunkt gir lik tid.
    const RealDate = Date;
    let tick = 0;
    class CountingDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          tick += 1;
          super(TEST_NOW.getTime() + tick * 1000);
        } else {
          super(...(args as [number]));
        }
      }
      static now() {
        tick += 1;
        return TEST_NOW.getTime() + tick * 1000;
      }
    }
    vi.stubGlobal("Date", CountingDate);
    await removeFloor(admin, org.id, floor.id);
    vi.unstubAllGlobals();

    const floorAt = timeOf((await row("floors", floor.id)).deleted_at);
    const areaAt = timeOf((await row("floor_areas", area.id)).deleted_at);
    expect(floorAt).not.toBeNull();
    expect(areaAt).toBe(floorAt);
  });

  it("1.5 restoreFloor henter arealraden med samme deleted_at", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, area } = await floorWithRooms(org.id, building.id, FLOOR_1, 0);
    await removeFloor(admin, org.id, floor.id);
    await restoreFloor(admin, org.id, floor.id, "undo");
    expect(await isActive("floors", floor.id)).toBe(true);
    expect(await isActive("floor_areas", area.id)).toBe(true);
  });

  const OLD_ROWS: { name: string; offsetMs: number; sameBy: boolean; back: boolean }[] = [
    { name: "−0,9 s, samme ansatt", offsetMs: -900, sameBy: true, back: true },
    { name: "+0,9 s, samme ansatt", offsetMs: 900, sameBy: true, back: true },
    { name: "−1,1 s, samme ansatt", offsetMs: -1100, sameBy: true, back: false },
    { name: "+1,1 s, samme ansatt", offsetMs: 1100, sameBy: true, back: false },
    { name: "0,0 s, annen ansatt", offsetMs: 0, sameBy: false, back: false },
  ];

  it.each(OLD_ROWS)(
    "1.6 eldre rader: arealrad $name → kommer tilbake: $back",
    async ({ offsetMs, sameBy, back }) => {
      const { org, admin, adminEmployee, assignment } = await base();
      const other = await person(org.id, ["manager"], "Test Leder");
      const building = await createBuilding(org.id, {
        assignmentId: assignment.id,
        name: BUILDING,
      });
      const removedAt = at(0);
      const floor = await createFloor(org.id, {
        buildingId: building.id,
        name: FLOOR_1,
        deletedAt: removedAt,
        deletedBy: adminEmployee.id,
      });
      const area = await createFloorArea(org.id, {
        floorId: floor.id,
        braI: 50,
        deletedAt: new Date(removedAt.getTime() + offsetMs),
        deletedBy: sameBy ? adminEmployee.id : other.employee.id,
      });

      await restoreFloor(admin, org.id, floor.id, "trash");

      expect(await isActive("floors", floor.id)).toBe(true);
      expect(await isActive("floor_areas", area.id)).toBe(back);
    },
  );

  it("1.7 etasjen har fått en ny aktiv arealrad: gjenopprettingen lykkes, den nye står, den gamle blir liggende, og det kommer en beskjed", async () => {
    const { org, admin, adminEmployee, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const removedAt = at(0);
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: FLOOR_1,
      deletedAt: removedAt,
      deletedBy: adminEmployee.id,
    });
    const old = await createFloorArea(org.id, {
      floorId: floor.id,
      braI: 50,
      deletedAt: removedAt,
      deletedBy: adminEmployee.id,
    });
    const fresh = await createFloorArea(org.id, { floorId: floor.id, braI: 77 });

    const result = asRestored(await restoreFloor(admin, org.id, floor.id, "trash"));

    expect(await isActive("floors", floor.id)).toBe(true);
    expect(await isActive("floor_areas", fresh.id), "den nye står").toBe(true);
    expect(await isActive("floor_areas", old.id), "den gamle blir liggende").toBe(false);
    expect(result.changed).toBe(true);
    expect(result.notices).toHaveLength(1);
    expect(result.notices[0]).toMatch(/areal/i);
  });
});

describe("1. overordnet ledd (A410)", () => {
  it("1.8 rom i fjernet etasje i fjernet bygning: rommet, etasjen og bygningen kommer tilbake; søsken blir liggende", async () => {
    const { org, admin, adminEmployee, assignment } = await base();
    const by = adminEmployee.id;
    const building = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: BUILDING,
      deletedAt: at(10),
      deletedBy: by,
    });
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: FLOOR_1,
      level: 1,
      deletedAt: at(5),
      deletedBy: by,
    });
    const otherFloor = await createFloor(org.id, {
      buildingId: building.id,
      name: FLOOR_2,
      level: 2,
      deletedAt: at(6),
      deletedBy: by,
    });
    const room = await createRoom(org.id, {
      floorId: floor.id,
      name: ROOM_NAME,
      deletedAt: at(0),
      deletedBy: by,
    });
    const sibling = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "bedroom",
      deletedAt: at(1),
      deletedBy: by,
    });

    const result = asRestored(await restoreRoom(admin, org.id, room.id, "trash"));

    expect(await isActive("rooms", room.id)).toBe(true);
    expect(await isActive("floors", floor.id)).toBe(true);
    expect(await isActive("report_buildings", building.id)).toBe(true);
    expect(await isActive("rooms", sibling.id), "søskenrom").toBe(false);
    expect(await isActive("floors", otherFloor.id), "annen etasje").toBe(false);

    const restored = result.restored.map((r) => `${r.type}:${r.id}`).sort();
    expect(restored).toEqual(
      [`room:${room.id}`, `floor:${floor.id}`, `building:${building.id}`].sort(),
    );
    expect(result.notices.join(" ")).toContain(
      "Rommet kom tilbake, sammen med etasjen «1. etasje»",
    );
  });

  it("1.8 bare etasjen fjernet: beskjeden er nøyaktig «Rommet kom tilbake, sammen med etasjen «1. etasje».»", async () => {
    const { org, admin, adminEmployee, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: FLOOR_1,
      deletedAt: at(5),
      deletedBy: adminEmployee.id,
    });
    const room = await createRoom(org.id, {
      floorId: floor.id,
      name: ROOM_NAME,
      deletedAt: at(0),
      deletedBy: adminEmployee.id,
    });

    const result = asRestored(await restoreRoom(admin, org.id, room.id, "trash"));
    expect(result.notices).toEqual([A410_NOTICE]);
    expect(result.restored.map((r) => r.type).sort()).toEqual(["floor", "room"]);
  });

  it("1.9 rom i en etasje fjernet som gruppe: restoreRoom henter rommet og etasjen, ikke de andre rommene", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 3);
    await removeFloor(admin, org.id, floor.id);

    await restoreRoom(admin, org.id, rooms[1]!.id, "trash");

    expect(await isActive("rooms", rooms[1]!.id)).toBe(true);
    expect(await isActive("floors", floor.id)).toBe(true);
    expect(await isActive("rooms", rooms[0]!.id)).toBe(false);
    expect(await isActive("rooms", rooms[2]!.id)).toBe(false);
  });
});

describe("1.10 samme plass, samme verdier, samme id", () => {
  it.each(["room", "floor", "building"] as const)(
    "%s: alle verdier like før sletting og etter gjenoppretting; deleted_* er null og updated_by er den som gjenopprettet",
    async (kind) => {
      const { org, admin, assignment } = await base();
      const { actor: manager, employee: managerEmployee } = await person(
        org.id,
        ["manager"],
        "Test Leder",
      );
      const building = await createBuilding(org.id, {
        assignmentId: assignment.id,
        name: BUILDING,
      });
      const { floor, area, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 3);
      const target = rooms[1]!;
      const ids = {
        report_buildings: [building.id],
        floors: [floor.id],
        floor_areas: [area.id],
        rooms: rooms.map((r) => r.id),
      };
      const before: Record<string, DbRow[]> = {};
      for (const [table, list] of Object.entries(ids)) {
        before[table] = await Promise.all(list.map((id) => row(table as TableName, id)));
      }
      const orderBefore = JSON.stringify(
        (await getAssignmentBuildings(admin, org.id, assignment.id)).buildings,
      );

      if (kind === "room") {
        await removeRoom(admin, org.id, target.id);
        await restoreRoom(manager, org.id, target.id, "undo");
      } else if (kind === "floor") {
        await removeFloor(admin, org.id, floor.id);
        await restoreFloor(manager, org.id, floor.id, "undo");
      } else {
        await removeBuilding(admin, org.id, building.id);
        await restoreBuilding(manager, org.id, building.id, "undo");
      }

      for (const [table, list] of Object.entries(ids)) {
        const after = await Promise.all(list.map((id) => row(table as TableName, id)));
        expect(after.map(stable), table).toEqual(before[table]!.map(stable));
        for (const r of after) {
          expect(r.deleted_at, `${table} deleted_at`).toBeNull();
          expect(r.deleted_by, `${table} deleted_by`).toBeNull();
        }
      }
      const restoredTable =
        kind === "room" ? "rooms" : kind === "floor" ? "floors" : "report_buildings";
      const restoredId = kind === "room" ? target.id : kind === "floor" ? floor.id : building.id;
      expect((await row(restoredTable, restoredId)).updated_by).toBe(managerEmployee.id);

      // Samme plass i lista: bygningene, etasjene og rommene står i samme rekkefølge.
      expect(
        JSON.stringify((await getAssignmentBuildings(admin, org.id, assignment.id)).buildings),
      ).toBe(orderBefore);
    },
  );
});

describe("1.11 koder som ikke lenger tilbys", () => {
  it("gjenoppretting validerer ikke mot dagens koder: rom og etasje kommer tilbake uendret uten Zod-sjekk", async () => {
    const { org, admin, adminEmployee, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: "Loft test",
      level: -3,
      belowGround: true,
      deletedAt: at(1),
      deletedBy: adminEmployee.id,
    });
    const room = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "crawl_space",
      areaType: "not_bra",
      belowGround: true,
      deletedAt: at(0),
      deletedBy: adminEmployee.id,
    });
    const before = {
      floor: stable(await row("floors", floor.id)),
      room: stable(await row("rooms", room.id)),
    };
    const roomParse = vi.spyOn(roomInputSchema, "parse");
    const roomSafe = vi.spyOn(roomInputSchema, "safeParse");
    const floorParse = vi.spyOn(floorInputSchema, "parse");
    const floorSafe = vi.spyOn(floorInputSchema, "safeParse");

    const result = asRestored(await restoreRoom(admin, org.id, room.id, "trash"));

    expect(result.changed).toBe(true);
    expect(stable(await row("rooms", room.id))).toEqual(before.room);
    expect(stable(await row("floors", floor.id))).toEqual(before.floor);
    expect(roomParse).not.toHaveBeenCalled();
    expect(roomSafe).not.toHaveBeenCalled();
    expect(floorParse).not.toHaveBeenCalled();
    expect(floorSafe).not.toHaveBeenCalled();
  });
});

describe("1.12–1.13 gjentatte kall", () => {
  it.each(["room", "floor", "building"] as const)(
    "1.12 %s gjenopprettet to ganger: andre kall gir changed: false, samme rad, og ingen nye hendelser eller loggrader",
    async (kind) => {
      const { org, admin, assignment } = await base();
      const building = await createBuilding(org.id, {
        assignmentId: assignment.id,
        name: BUILDING,
      });
      const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 1);
      const [table, id, remove, restore] =
        kind === "room"
          ? (["rooms", rooms[0]!.id, removeRoom, restoreRoom] as const)
          : kind === "floor"
            ? (["floors", floor.id, removeFloor, restoreFloor] as const)
            : (["report_buildings", building.id, removeBuilding, restoreBuilding] as const);
      await remove(admin, org.id, id);
      const first = asRestored(await restore(admin, org.id, id, "undo"));
      expect(first.changed).toBe(true);
      const rowAfterFirst = await row(table, id);
      const counts = await eventAndAuditCounts(org.id);

      const second = asRestored(await restore(admin, org.id, id, "undo"));

      expect(second.changed).toBe(false);
      expect(await row(table, id)).toEqual(rowAfterFirst);
      expect(await eventAndAuditCounts(org.id)).toEqual(counts);
    },
  );

  it("1.13 et aktivt rom i organisasjon B kalt fra A gir AccessDeniedError, ikke changed: false", async () => {
    const a = await base("Organisasjon A");
    const b = await base("Organisasjon B");
    const buildingB = await createBuilding(b.org.id, { assignmentId: b.assignment.id });
    const floorB = await createFloor(b.org.id, { buildingId: buildingB.id });
    const roomB = await createRoom(b.org.id, { floorId: floorB.id });

    for (const [name, run] of [
      ["restoreRoom", () => restoreRoom(a.admin, a.org.id, roomB.id, "undo")],
      ["restoreFloor", () => restoreFloor(a.admin, a.org.id, floorB.id, "undo")],
      ["restoreBuilding", () => restoreBuilding(a.admin, a.org.id, buildingB.id, "undo")],
    ] as const) {
      expect(await caught(run()), name).toBeInstanceOf(AccessDeniedError);
    }
  });
});

describe("1.14–1.15 listTrash", () => {
  it("1.14 nyeste først", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 3);
    setNow(at(0));
    await removeRoom(admin, org.id, rooms[0]!.id);
    setNow(at(5));
    await removeRoom(admin, org.id, rooms[2]!.id);
    setNow(at(2));
    await removeRoom(admin, org.id, rooms[1]!.id);
    vi.useRealTimers();

    const result = lines(await listTrash(admin, org.id, assignment.id));
    expect(result.map((l) => l.id)).toEqual([rooms[2]!.id, rooms[1]!.id, rooms[0]!.id]);
    for (const line of result) expect(line.type).toBe("room");
  });

  it("1.14 slettegruppe er én linje med groupCount 5 (etasjen og 4 rom), og rommene i gruppen finnes i svaret", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_2, 4, 2);
    await removeFloor(admin, org.id, floor.id);

    const result = lines(await listTrash(admin, org.id, assignment.id));
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("floor");
    expect(result[0]!.id).toBe(floor.id);
    expect(result[0]!.groupCount).toBe(5);
    expect(result[0]!.contents).toEqual({ floors: 0, rooms: 4 });
    expect(String(result[0]!.label)).toContain(FLOOR_2);
    const text = JSON.stringify(result);
    for (const r of rooms) expect(text, "rommet kan hentes enkeltvis").toContain(r.id);
  });

  it("1.14 riktig path når bygning og etasje også er fjernet; areal bare på etasjer; navnet til den som fjernet", async () => {
    const { org, assignment } = await base();
    const { actor: inspector } = await person(org.id, ["inspector"], "Kari Testesen");
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 2);
    const otherFloor = await floorWithRooms(org.id, building.id, FLOOR_2, 0, 2);
    setNow(at(0));
    await removeRoom(inspector, org.id, rooms[0]!.id);
    setNow(at(1));
    await removeFloor(inspector, org.id, otherFloor.floor.id);
    setNow(at(2));
    await removeFloor(inspector, org.id, floor.id);
    setNow(at(3));
    await removeBuilding(inspector, org.id, building.id);
    vi.useRealTimers();

    const result = lines(await listTrash(inspector, org.id, assignment.id));
    const roomLine = findDeep(result, rooms[0]!.id);
    expect(roomLine, "rommet fjernet først står i papirkurven").toBeDefined();
    expect(pathText(roomLine!)).toContain(BUILDING);
    expect(pathText(roomLine!)).toContain(FLOOR_1);
    expect(
      pathParts(roomLine!).map((p) => [p.type, p.removed]),
      "bygningen og etasjen er også fjernet",
    ).toEqual([
      ["building", true],
      ["floor", true],
    ]);
    expect(roomLine!.removedByName).toBe("Kari Testesen");
    expect(roomLine!.area ?? null).toBeNull();

    const floorLine = findDeep(result, otherFloor.floor.id);
    expect(floorLine, "etasjen fjernet alene står i papirkurven").toBeDefined();
    expect(pathText(floorLine!)).toContain(BUILDING);
    expect(
      pathParts(floorLine!).map((p) => [p.type, p.removed]),
      "bygningen er også fjernet",
    ).toEqual([["building", true]]);
    expect(floorLine!.area).not.toBeNull();
    // BRA = 50 + 10 + 4
    expect(JSON.stringify(floorLine!.area)).toMatch(/\b64\b/);
    expect(timeOf(floorLine!.removedAt)).toBe(at(1).getTime());
  });

  it("1.14 removedByName også for ansatt som har sluttet, og ingen e-post i svaret", async () => {
    const { org, admin, assignment } = await base();
    const { actor: leaver, employee } = await person(org.id, ["manager"], "Per Prøvesen");
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 1);
    await removeRoom(leaver, org.id, rooms[0]!.id);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));

    const result = lines(await listTrash(admin, org.id, assignment.id));
    expect(result).toHaveLength(1);
    expect(result[0]!.removedByName).toBe("Per Prøvesen");
    expect(JSON.stringify(result)).not.toContain("@");
    expect(JSON.stringify(result)).not.toContain(leaver.email);
  });

  it("1.14 ingen rader fra et annet oppdrag i samme organisasjon", async () => {
    const { org, admin, office, assignment } = await base();
    const other = await createAssignment(org.id, { officeId: office.id });
    await createProperty(org.id, { assignmentId: other.id });
    const mine = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const theirs = await createBuilding(org.id, { assignmentId: other.id, name: GARAGE });
    await removeBuilding(admin, org.id, mine.id);
    await removeBuilding(admin, org.id, theirs.id);

    const result = lines(await listTrash(admin, org.id, assignment.id));
    expect(result.map((l) => l.id)).toEqual([mine.id]);
    expect(JSON.stringify(result)).not.toContain(theirs.id);
  });

  it("1.14 høyst 200 linjer, de nyeste (205 fjernede rom)", async () => {
    const { org, admin, adminEmployee, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const floor = await createFloor(org.id, { buildingId: building.id, name: FLOOR_1 });
    await db.execute(sql`
      insert into rooms (organization_id, floor_id, room_type, area_type, below_ground, deleted_at, deleted_by)
      select ${org.id}, ${floor.id}, 'storage', 'bra_i', false,
        ${TEST_NOW.toISOString()}::timestamptz + (n || ' minutes')::interval, ${adminEmployee.id}
      from generate_series(1, 205) as n`);
    const oldest = (await db.execute(sql`
      select id from rooms where floor_id = ${floor.id} order by deleted_at asc limit 5`)) as unknown as {
      id: string;
    }[];

    const result = lines(await listTrash(admin, org.id, assignment.id));
    expect(result).toHaveLength(200);
    const ids = new Set(result.map((l) => l.id));
    for (const r of oldest) expect(ids.has(r.id), "de eldste er ikke med").toBe(false);
  });

  it("1.15 oppdrag uten fjernede rader gir tom liste", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    await floorWithRooms(org.id, building.id, FLOOR_1, 2);
    expect(await listTrash(admin, org.id, assignment.id)).toEqual([]);
  });
});

/** Linjen med id-en, også om den ligger inne i en slettegruppe. */
type PathPart = { type: string; id: string; label: string; removed: boolean };

/** Leddene i `path` (bygning › etasje), som skjermen viser med «(fjernet)». */
function pathParts(line: AnyRecord): PathPart[] {
  return line.path as PathPart[];
}

function pathText(line: AnyRecord): string {
  return pathParts(line)
    .map((p) => p.label)
    .join(" › ");
}

function findDeep(value: unknown, id: string): AnyRecord | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeep(item, id);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    const record = value as AnyRecord;
    if (record.id === id && typeof record.type === "string") return record;
    for (const inner of Object.values(record)) {
      const found = findDeep(inner, id);
      if (found) return found;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// 2. Hendelser, revisjonslogg og varige data
// ---------------------------------------------------------------------------------------------

describe("2. hendelser og revisjonslogg", () => {
  it("2.1 én revisjonslinje per rad: «Fjern» bygning gir 5 delete, restoreBuilding gir 5 restore med samme entityType; slettelinjene er uendret", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    await floorWithRooms(org.id, building.id, FLOOR_1, 2);

    await removeBuilding(admin, org.id, building.id);
    const deletes = await auditFor(org.id, "delete");
    expect(deletes).toHaveLength(5);

    await restoreBuilding(admin, org.id, building.id, "trash");
    const restores = await auditFor(org.id, "restore");
    expect(restores).toHaveLength(5);
    const types = (list: { entityType: string }[]) => list.map((r) => r.entityType).sort();
    expect(types(restores)).toEqual(types(deletes));
    expect(types(deletes)).toEqual(
      ["floor", "floor_area", "report_building", "room", "room"].sort(),
    );
    expect(await auditFor(org.id, "delete")).toEqual(deletes);
  });

  it("2.2 «Fjern» gir én *_removed-hendelse for øverste del, med groupCount", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor } = await floorWithRooms(org.id, building.id, FLOOR_2, 4, 2);

    await removeFloor(admin, org.id, floor.id);

    const removed = (await eventsFor(org.id)).filter((e) => e.type.endsWith("_removed"));
    expect(removed.map((e) => e.type)).toEqual(["assignment.floor_removed"]);
    expect(removed[0]!.data.floorId).toBe(floor.id);
    expect(removed[0]!.data.groupCount).toBe(5);
  });

  it("2.2 gjenoppretting: én floor_restored med how, secondsSinceRemoval (42), groupCount og floorKey", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor } = await floorWithRooms(org.id, building.id, FLOOR_2, 4, 2);
    setNow(at(0));
    await removeFloor(admin, org.id, floor.id);
    setNow(at(0, 42));
    await restoreFloor(admin, org.id, floor.id, "undo");
    vi.useRealTimers();

    const restored = (await eventsFor(org.id)).filter((e) => e.type.endsWith("_restored"));
    expect(restored.map((e) => e.type)).toEqual(["assignment.floor_restored"]);
    const data = restored[0]!.data;
    expect(restored[0]!.assignmentId).toBe(assignment.id);
    expect(data.floorId).toBe(floor.id);
    expect(data.how).toBe("undo");
    expect(data.secondsSinceRemoval).toBe(42);
    expect(data.groupCount).toBe(5);
    expect(data).toHaveProperty("floorKey");
  });

  it("2.2 rom: room_restored med roomTypeKey og how «trash»; overordnet ledd (A410) gir én hendelse per ledd", async () => {
    const { org, admin, adminEmployee, assignment } = await base();
    const building = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: BUILDING,
      deletedAt: at(2),
      deletedBy: adminEmployee.id,
    });
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: FLOOR_1,
      deletedAt: at(1),
      deletedBy: adminEmployee.id,
    });
    const room = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "bathroom",
      name: ROOM_NAME,
      deletedAt: at(0),
      deletedBy: adminEmployee.id,
    });

    await restoreRoom(admin, org.id, room.id, "trash");

    const restored = (await eventsFor(org.id)).filter((e) => e.type.endsWith("_restored"));
    expect(restored.map((e) => e.type).sort()).toEqual(
      [
        "assignment.building_restored",
        "assignment.floor_restored",
        "assignment.room_restored",
      ].sort(),
    );
    const roomEvent = restored.find((e) => e.type === "assignment.room_restored")!;
    expect(roomEvent.data.roomId).toBe(room.id);
    expect(roomEvent.data.roomTypeKey).toBe("bathroom");
    expect(roomEvent.data.how).toBe("trash");
    for (const e of restored) expect(e.assignmentId).toBe(assignment.id);
  });

  it("2.4 ingen romnavn, etasjenavn, bygningsnavn, kommentar eller arealtall i events.data eller audit_log.changes", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 2);
    await removeRoom(admin, org.id, rooms[0]!.id);
    await restoreRoom(admin, org.id, rooms[0]!.id, "undo");
    await removeFloor(admin, org.id, floor.id);
    await restoreFloor(admin, org.id, floor.id, "trash");
    await removeBuilding(admin, org.id, building.id);
    await restoreBuilding(admin, org.id, building.id, "trash");

    const text = JSON.stringify([
      (await eventsFor(org.id)).map((e) => e.data),
      (await auditFor(org.id)).map((a) => a.changes),
    ]);
    for (const value of [ROOM_NAME, "Soverom", FLOOR_1, BUILDING, COMMENT, "Målt langs"]) {
      expect(text, value).not.toContain(value);
    }
  });

  it("2.5 ingenting slettes permanent: like mange rader før og etter fjern, angre, fjern, gjenopprett; logg og hendelser bare vokser", async () => {
    const { org, admin, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 3);
    const tables = [...TABLES, "assignment_parties"] as const;
    const countsBefore: Record<string, number> = {};
    for (const t of tables) countsBefore[t] = await tableCount(t);
    let audit = await tableCount("audit_log");
    let evts = await tableCount("events");

    const steps: (() => Promise<unknown>)[] = [
      () => removeRoom(admin, org.id, rooms[0]!.id),
      () => restoreRoom(admin, org.id, rooms[0]!.id, "undo"),
      () => removeFloor(admin, org.id, floor.id),
      () => restoreFloor(admin, org.id, floor.id, "trash"),
      () => removeBuilding(admin, org.id, building.id),
      () => restoreBuilding(admin, org.id, building.id, "undo"),
      () => removeBuilding(admin, org.id, building.id),
      () => restoreBuilding(admin, org.id, building.id, "trash"),
    ];
    for (const step of steps) {
      await step();
      const nextAudit = await tableCount("audit_log");
      const nextEvents = await tableCount("events");
      expect(nextAudit).toBeGreaterThan(audit);
      expect(nextEvents).toBeGreaterThan(evts);
      audit = nextAudit;
      evts = nextEvents;
    }
    for (const t of tables) expect(await tableCount(t), t).toBe(countsBefore[t]);
  });

  it("2.6 KI-forslag på rom og etasje står uendret etter fjerning og gjenoppretting", async () => {
    const { org, admin, adminEmployee, assignment } = await base();
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 1);
    const onRoom = await createAiUsageLog(org.id, {
      employeeId: adminEmployee.id,
      assignmentId: assignment.id,
      targetRef: { type: "room", id: rooms[0]!.id, fieldKey: "name" },
    });
    const onFloor = await createAiUsageLog(org.id, {
      employeeId: adminEmployee.id,
      assignmentId: assignment.id,
      targetRef: { type: "floor", id: floor.id, fieldKey: "name" },
    });
    const read = async (id: string) =>
      (
        (await db.execute(sql`select * from ai_usage_log where id = ${id}`)) as unknown as DbRow[]
      )[0];
    const before = [await read(onRoom.id), await read(onFloor.id)];

    await removeRoom(admin, org.id, rooms[0]!.id);
    await removeFloor(admin, org.id, floor.id);
    expect([await read(onRoom.id), await read(onFloor.id)]).toEqual(before);
    await restoreFloor(admin, org.id, floor.id, "trash");
    await restoreRoom(admin, org.id, rooms[0]!.id, "trash");
    expect([await read(onRoom.id), await read(onFloor.id)]).toEqual(before);

    // Rommet med samme id står igjen, så forslaget peker på et aktivt rom.
    const target = (before[0]!.target_ref as { id: string }).id;
    expect(await isActive("rooms", target)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Tilgang per rolle og avslag
// ---------------------------------------------------------------------------------------------

type RoleCase = {
  name: string;
  roles: EmployeeRole[];
  editAll: boolean;
  deleted?: boolean;
  list: boolean;
  restore: boolean;
};

const ROLE_CASES: RoleCase[] = [
  {
    name: "takstmann, innstillingen på",
    roles: ["inspector"],
    editAll: true,
    list: true,
    restore: true,
  },
  {
    name: "takstmann, innstillingen av",
    roles: ["inspector"],
    editAll: false,
    list: true,
    restore: false,
  },
  { name: "kontor", roles: ["office"], editAll: false, list: true, restore: true },
  { name: "leder", roles: ["manager"], editAll: false, list: true, restore: true },
  { name: "admin (eneste rolle)", roles: ["admin"], editAll: false, list: true, restore: true },
  {
    name: "ansatt med deleted_at",
    roles: ["manager"],
    editAll: true,
    deleted: true,
    list: false,
    restore: false,
  },
];

const RESTORES = ["restoreBuilding", "restoreFloor", "restoreRoom"] as const;

describe("4. tilgang per rolle", () => {
  it.each(ROLE_CASES)("4 listTrash: $name → tilgang: $list", async (c) => {
    const { org, admin, assignment } = await base();
    await setInspectorsEditAll(org.id, c.editAll);
    const { actor, employee } = await person(org.id, c.roles);
    if (c.deleted) {
      await db
        .update(employees)
        .set({ deletedAt: new Date() })
        .where(eq(employees.id, employee.id));
    }
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    await removeBuilding(admin, org.id, building.id);

    const result = await caught(listTrash(actor, org.id, assignment.id));
    if (c.list) {
      expect(result).toBeNull();
      expect(lines(await listTrash(actor, org.id, assignment.id)).map((l) => l.id)).toEqual([
        building.id,
      ]);
    } else {
      expect(result).toBeInstanceOf(AccessDeniedError);
    }
  });

  const MATRIX = ROLE_CASES.flatMap((c) => RESTORES.map((fn) => ({ ...c, fn })));

  it.each(MATRIX)("4 $fn: $name → tilgang: $restore", async (c) => {
    const { org, admin, assignment } = await base();
    await setInspectorsEditAll(org.id, c.editAll);
    const { actor, employee } = await person(org.id, c.roles);
    if (c.deleted) {
      await db
        .update(employees)
        .set({ deletedAt: new Date() })
        .where(eq(employees.id, employee.id));
    }
    const building = await createBuilding(org.id, { assignmentId: assignment.id, name: BUILDING });
    const { floor, rooms } = await floorWithRooms(org.id, building.id, FLOOR_1, 1);
    const [table, id] =
      c.fn === "restoreRoom"
        ? (["rooms", rooms[0]!.id] as const)
        : c.fn === "restoreFloor"
          ? (["floors", floor.id] as const)
          : (["report_buildings", building.id] as const);
    if (c.fn === "restoreRoom") await removeRoom(admin, org.id, id);
    else if (c.fn === "restoreFloor") await removeFloor(admin, org.id, id);
    else await removeBuilding(admin, org.id, id);
    const counts = await eventAndAuditCounts(org.id);
    const rowBefore = await row(table, id);

    const fn = { restoreBuilding, restoreFloor, restoreRoom }[c.fn];
    const result = await caught(fn(actor, org.id, id, "trash"));

    if (c.restore) {
      expect(result).toBeNull();
      expect(await isActive(table, id)).toBe(true);
    } else {
      expect(result).toBeInstanceOf(AccessDeniedError);
      expect(await row(table, id)).toEqual(rowBefore);
      expect(await eventAndAuditCounts(org.id)).toEqual(counts);
    }
  });

  it("4.1 samme avslag uten lekkasje: ukjent id, id fra annen organisasjon, ugyldig UUID og kansellert oppdrag", async () => {
    const a = await base("Organisasjon A");
    const b = await base("Organisasjon B");
    const removedInB = await createBuilding(b.org.id, {
      assignmentId: b.assignment.id,
      deletedAt: at(0),
    });
    const cancelled = await createAssignment(a.org.id, { officeId: a.office.id, deletedAt: at(0) });
    const cancelledBuilding = await createBuilding(a.org.id, {
      assignmentId: cancelled.id,
      deletedAt: at(1),
    });
    const unknown = "0190a000-0000-7000-8000-00000000dead";

    const messages: string[] = [];
    for (const [name, id] of [
      ["ukjent id", unknown],
      ["annen organisasjon", removedInB.id],
      ["ugyldig UUID", "ikke-en-id"],
      ["kansellert oppdrag", cancelledBuilding.id],
    ] as const) {
      const error = await caught(restoreBuilding(a.admin, a.org.id, id, "trash"));
      expect(error, name).toBeInstanceOf(AccessDeniedError);
      messages.push((error as Error).message);
    }
    expect(new Set(messages).size, "samme melding").toBe(1);

    for (const [name, id] of [
      ["ukjent", unknown],
      ["ugyldig", "ikke-en-id"],
      ["annen organisasjon", b.assignment.id],
      ["kansellert", cancelled.id],
    ] as const) {
      const error = await caught(listTrash(a.admin, a.org.id, id));
      expect(error, `listTrash ${name}`).toBeInstanceOf(AccessDeniedError);
      expect((error as Error).message).toBe(messages[0]);
    }
  });

  it("4.2 id fra skjema brukes aldri: organisasjon A med rom-id fra B gir avslag, og B-raden er uendret", async () => {
    const a = await base("Organisasjon A");
    const b = await base("Organisasjon B");
    const buildingB = await createBuilding(b.org.id, { assignmentId: b.assignment.id });
    const floorB = await createFloor(b.org.id, { buildingId: buildingB.id });
    const roomB = await createRoom(b.org.id, {
      floorId: floorB.id,
      deletedAt: at(0),
      deletedBy: b.adminEmployee.id,
    });
    const before = await row("rooms", roomB.id);

    expect(await caught(restoreRoom(a.admin, a.org.id, roomB.id, "trash"))).toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await row("rooms", roomB.id)).toEqual(before);
    expect(await eventAndAuditCounts(b.org.id)).toEqual({ events: 0, audit: 0 });
  });

  it("4.3 ingen tilgangslogikk utenfor kjernen: tjenesten bruker requireOrganizationAccess", () => {
    const dir = fileURLToPath(new URL(".", import.meta.url));
    const files = readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n");
    for (const name of ["listTrash", "restoreBuilding", "restoreFloor", "restoreRoom"]) {
      expect(files, `${name} finnes i src/core/buildings`).toMatch(
        new RegExp(`export async function ${name}\\(`),
      );
    }
    // Rettighetene fra kortet (A417): lesing med organization.read, gjenoppretting med assignment.edit.
    expect(files).toContain('"organization.read"');
    expect(files).toContain('"assignment.edit"');
    expect(files).not.toMatch(/roles\.includes\(|\.roles\.some\(/);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

/** Oppdrag med eiendom og en bygning med etasje i organisasjonen (uten tilgangssjekk). */
async function treeIn(organizationId: string) {
  const assignment = await createAssignment(organizationId);
  await createProperty(organizationId, { assignmentId: assignment.id });
  const building = await createBuilding(organizationId, { assignmentId: assignment.id });
  const floor = await createFloor(organizationId, { buildingId: building.id });
  return { assignment, building, floor };
}

const assignmentByOrg = new Map<string, string>();

describe("5. tenant-isolasjon", () => {
  it("5.1 listTrash gir aldri fjernede rader fra en annen organisasjon", async () => {
    assignmentByOrg.clear();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const out = { a: [] as string[], b: [] as string[] };
        for (const [grant, key] of [
          [grantA, "a"],
          [grantB, "b"],
        ] as const) {
          const { assignment, floor } = await treeIn(grant.organizationId);
          assignmentByOrg.set(grant.organizationId, assignment.id);
          const room = await createRoom(grant.organizationId, {
            floorId: floor.id,
            deletedAt: at(0),
            deletedBy: grant.employeeId,
          });
          out[key].push(room.id);
        }
        return out;
      },
      query: async (actor: Actor, organizationId: string) => {
        // Mot fremmed organisasjon brukes et oppdrag fra den organisasjonen (skal gi avslag).
        const assignmentId =
          assignmentByOrg.get(organizationId) ?? "0190a000-0000-7000-8000-00000000beef";
        return lines(await listTrash(actor, organizationId, assignmentId));
      },
      idOf: (line) => String(line.id),
    });
  });

  /**
   * `query` lager en fersk fjernet rad i organisasjonen og gjenoppretter den, slik at hvert kall
   * har noe å gi tilbake. Radene i svaret sammenlignes på `organizationId`.
   */
  function restoreIsolation(kind: "room" | "floor" | "building") {
    return expectTenantIsolation({
      seed: async (grantA, grantB) => ({
        a: [grantA.organizationId],
        b: [grantB.organizationId],
      }),
      query: async (actor: Actor, organizationId: string) => {
        const { assignment, building, floor } = await treeIn(organizationId);
        let result: unknown;
        if (kind === "room") {
          const room = await createRoom(organizationId, { floorId: floor.id, deletedAt: at(0) });
          result = await restoreRoom(actor, organizationId, room.id, "trash");
        } else if (kind === "floor") {
          const removed = await createFloor(organizationId, {
            buildingId: building.id,
            name: FLOOR_2,
            level: 2,
            deletedAt: at(0),
          });
          result = await restoreFloor(actor, organizationId, removed.id, "trash");
        } else {
          const removed = await createBuilding(organizationId, {
            assignmentId: assignment.id,
            name: GARAGE,
            deletedAt: at(0),
          });
          result = await restoreBuilding(actor, organizationId, removed.id, "trash");
        }
        return asRestored(result).restored;
      },
      idOf: (r) => String(r.organizationId),
    });
  }

  it("5.2 restoreBuilding gjenoppretter bare i egen organisasjon", async () => {
    await restoreIsolation("building");
  });

  it("5.3 restoreFloor gjenoppretter bare i egen organisasjon", async () => {
    await restoreIsolation("floor");
  });

  it("5.4 restoreRoom gjenoppretter bare i egen organisasjon", async () => {
    await restoreIsolation("room");
  });
});
