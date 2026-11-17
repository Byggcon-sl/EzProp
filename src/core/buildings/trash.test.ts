import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import {
  getAssignmentBuildings,
  listTrash,
  removeBuilding,
  removeFloor,
  removeRoom,
  restoreBuilding,
  restoreFloor,
  restoreRoom,
  type PartyTrashLine,
  type RestoreResult,
  type StructureTrashLine,
  type TrashLine,
} from "@/core/buildings";
import { db } from "@/db/client";
import { auditLog, employees, events, organizations, type EmployeeRole } from "@/db/schema";
import {
  createAiUsageLog,
  createAssignment,
  createAssignmentParty,
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
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Papirkurv og gjenoppretting av bygning, etasje og rom (kjernen).
 * Testplan: docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 1, 2, 4 og 5.1–5.4.
 * Avsnitt 3 (transaksjon og samtidighet) står i trash-transaction.test.ts, 6 (kansellert oppdrag)
 * i buildings-cancel.test.ts. Parter (restoreParty, 4/5.5 og 7) er en egen bit.
 *
 * Fasiten står i testene (tabeller), ikke importert fra koden. Testdata er oppdiktet: «Bolighus
 * test», «Garasje test», «1. etasje», «2. etasje», «Bad test», «Ola Testmann».
 *
 * Støtter hovedmål: de ansatte (ett trykk fjerner etasjen med rom, «Angre» henter alt tilbake på
 * samme plass), KI i bunnen (strukturerte hendelser uten persondata, KI-forslag overlever) og færre
 * reklamasjoner (ingenting slettes permanent, alt står i revisjonsloggen).
 */

beforeEach(resetDatabase);
afterEach(() => {
  vi.useRealTimers();
});

const BUILDING_NAME = "Bolighus test";
const GARAGE_NAME = "Garasje test";
const FIRST_FLOOR = "1. etasje";
const SECOND_FLOOR = "2. etasje";
const ROOM_NAME = "Bad test";
const COMMENT = "Målt langs innvendig vegg test";
const PARTY_NAME = "Ola Testmann";
const PARTY_EMAIL = "ola.testmann@example.invalid";
const PARTY_PHONE = "90000000";
const T0 = new Date("2026-11-16T10:00:00.000Z");

const TABLES = [
  "report_buildings",
  "floors",
  "floor_areas",
  "rooms",
  "assignment_parties",
] as const;
type TableName = (typeof TABLES)[number];
type DbRow = Record<string, unknown>;

function at(base: Date, ms: number): Date {
  return new Date(base.getTime() + ms);
}

function useClock(time: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(time);
}

async function rowById(table: TableName, id: string): Promise<DbRow> {
  const [row] = (await db.execute(
    sql`select * from ${sql.identifier(table)} where id = ${id}`,
  )) as unknown as DbRow[];
  if (!row) throw new Error(`fant ikke raden i ${table}`);
  return row;
}

async function isActive(table: TableName, id: string): Promise<boolean> {
  return (await rowById(table, id)).deleted_at === null;
}

function timeOf(value: unknown): number {
  return new Date(value as string | Date).getTime();
}

async function countRows(table: TableName | "events" | "audit_log"): Promise<number> {
  if (table === "events") return (await db.select({ n: count() }).from(events))[0]?.n ?? 0;
  if (table === "audit_log") return (await db.select({ n: count() }).from(auditLog))[0]?.n ?? 0;
  const [row] = (await db.execute(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  )) as unknown as { n: number }[];
  return row?.n ?? 0;
}

async function allCounts() {
  const counts: Record<string, number> = {};
  for (const table of [...TABLES, "events", "audit_log"] as const) {
    counts[table] = await countRows(table);
  }
  return counts;
}

async function eventsFor(organizationId: string, type?: string) {
  const rows = await db.select().from(events).where(eq(events.organizationId, organizationId));
  return rows.filter((row) => type === undefined || row.type === type);
}

async function auditFor(organizationId: string, action?: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
  return rows.filter((row) => action === undefined || row.action === action);
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin og ett oppdrag med eiendom. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Kari Testesen" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id });
  await createProperty(org.id, { assignmentId: assignment.id });
  return { org, admin, adminEmployee, assignment };
}

/** Bygning med «1. etasje», areal og `roomCount` rom. */
async function floorWithRooms(organizationId: string, assignmentId: string, roomCount: number) {
  const building = await createBuilding(organizationId, { assignmentId, name: BUILDING_NAME });
  const floor = await createFloor(organizationId, { buildingId: building.id, name: FIRST_FLOOR });
  const area = await createFloorArea(organizationId, {
    floorId: floor.id,
    braI: 50,
    braE: 10,
    braB: 4,
    alh: 70,
    method: "laser",
    comment: COMMENT,
  });
  const roomList = [];
  for (let i = 0; i < roomCount; i += 1) {
    roomList.push(
      await createRoom(organizationId, {
        floorId: floor.id,
        name: i === 0 ? ROOM_NAME : null,
        roomType: i === 0 ? "bathroom" : "bedroom",
        createdAt: at(T0, -60_000 + i * 1000),
      }),
    );
  }
  return { building, floor, area, rooms: roomList };
}

function ids(result: RestoreResult) {
  return result.restored.map((row) => `${row.type}:${row.id}`).sort();
}

function structureLines(lines: TrashLine[]): StructureTrashLine[] {
  return lines.filter((line): line is StructureTrashLine => line.type !== "party");
}

// ---------------------------------------------------------------------------------------------
// 1. Regler for sletting og gjenoppretting
// ---------------------------------------------------------------------------------------------

describe("1. regler for sletting og gjenoppretting", () => {
  it("1.1 A414 «Fjern» etasje tar med 4 rom og arealraden, med nøyaktig samme tid og samme ansatt", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    const { floor, area, rooms } = await floorWithRooms(org.id, assignment.id, 4);

    const result = await removeFloor(admin, org.id, floor.id);
    expect(result.removed.filter((row) => row.type === "floor")).toEqual([
      { type: "floor", id: floor.id },
    ]);
    expect(
      result.removed
        .filter((row) => row.type === "room")
        .map((row) => row.id)
        .sort(),
    ).toEqual(rooms.map((room) => room.id).sort());

    const floorRow = await rowById("floors", floor.id);
    const expected = timeOf(floorRow.deleted_at);
    expect(floorRow.deleted_by).toBe(adminEmployee.id);
    for (const [table, id] of [
      ["floor_areas", area.id] as const,
      ...rooms.map((room) => ["rooms", room.id] as const),
    ]) {
      const row = await rowById(table, id);
      expect(timeOf(row.deleted_at), `${table} ${id}`).toBe(expected);
      expect(row.deleted_by).toBe(adminEmployee.id);
    }
  });

  it("1.2 A414 «Fjern» bygning tar med 2 etasjer, 3 rom og 2 arealrader med samme tid", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const f1 = await createFloor(org.id, { buildingId: building.id, name: FIRST_FLOOR });
    const f2 = await createFloor(org.id, { buildingId: building.id, name: SECOND_FLOOR, level: 2 });
    const a1 = await createFloorArea(org.id, { floorId: f1.id, braI: 10 });
    const a2 = await createFloorArea(org.id, { floorId: f2.id, braI: 20 });
    const r1 = await createRoom(org.id, { floorId: f1.id });
    const r2 = await createRoom(org.id, { floorId: f1.id });
    const r3 = await createRoom(org.id, { floorId: f2.id });

    const result = await removeBuilding(admin, org.id, building.id);
    expect(result.removed).toHaveLength(6);
    expect(result.removed[0]).toEqual({ type: "building", id: building.id });

    const expected = timeOf((await rowById("report_buildings", building.id)).deleted_at);
    for (const [table, id] of [
      ["floors", f1.id],
      ["floors", f2.id],
      ["floor_areas", a1.id],
      ["floor_areas", a2.id],
      ["rooms", r1.id],
      ["rooms", r2.id],
      ["rooms", r3.id],
    ] as const) {
      expect(timeOf((await rowById(table, id)).deleted_at), `${table} ${id}`).toBe(expected);
    }
  });

  it("1.3 A414 et rom fjernet før etasjen blir liggende når etasjen hentes tilbake", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { floor, rooms } = await floorWithRooms(org.id, assignment.id, 3);
    const [early, ...rest] = rooms;

    useClock(T0);
    await removeRoom(admin, org.id, early!.id);
    vi.setSystemTime(at(T0, 5 * 60_000));
    await removeFloor(admin, org.id, floor.id);

    const result = await restoreFloor(admin, org.id, floor.id, "trash");
    expect(result.changed).toBe(true);
    expect(await isActive("floors", floor.id)).toBe(true);
    for (const room of rest) expect(await isActive("rooms", room.id)).toBe(true);
    expect(await isActive("rooms", early!.id)).toBe(false);
    expect(ids(result)).toEqual(
      [`floor:${floor.id}`, ...rest.map((room) => `room:${room.id}`)].sort(),
    );
  });

  it("1.4 A411 removeFloor bruker ett tidspunkt, også når klokka går mellom kallene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    const area = await createFloorArea(org.id, { floorId: floor.id, braI: 12 });

    // Klokke som går ett sekund frem for hver `new Date()`: to kall ville gitt ulik tid.
    const RealDate = Date;
    let tick = 0;
    class CountingDate extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          tick += 1;
          super(T0.getTime() + tick * 1000);
        } else {
          super(...(args as [number]));
        }
      }
    }
    vi.stubGlobal("Date", CountingDate);
    try {
      await removeFloor(admin, org.id, floor.id);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(tick).toBeGreaterThan(0);
    expect(timeOf((await rowById("floor_areas", area.id)).deleted_at)).toBe(
      timeOf((await rowById("floors", floor.id)).deleted_at),
    );
  });

  it("1.5 A411 arealraden med samme tid kommer tilbake med etasjen, med samme verdier", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { floor, area } = await floorWithRooms(org.id, assignment.id, 0);
    await removeFloor(admin, org.id, floor.id);
    await restoreFloor(admin, org.id, floor.id, "undo");

    const row = await rowById("floor_areas", area.id);
    expect(row.deleted_at).toBeNull();
    expect(row.comment).toBe(COMMENT);
    expect(row.method).toBe("laser");
  });

  describe("1.6 A411 eldre rader", () => {
    const CASES = [
      { offset: -900, sameBy: true, back: true },
      { offset: 900, sameBy: true, back: true },
      { offset: -1100, sameBy: true, back: false },
      { offset: 1100, sameBy: true, back: false },
      { offset: 0, sameBy: false, back: false },
    ];

    it.each(CASES)(
      "arealraden $offset ms fra etasjen, samme ansatt: $sameBy → tilbake: $back",
      async ({ offset, sameBy, back }) => {
        const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
        const other = await createEmployee(await createUser({ name: "Per Prøvesen" }), org.id, [
          "inspector",
        ]);
        const building = await createBuilding(org.id, { assignmentId: assignment.id });
        const floor = await createFloor(org.id, {
          buildingId: building.id,
          deletedAt: T0,
          deletedBy: adminEmployee.id,
        });
        const area = await createFloorArea(org.id, {
          floorId: floor.id,
          braI: 33,
          deletedAt: at(T0, offset),
          deletedBy: sameBy ? adminEmployee.id : other.id,
        });

        const result = await restoreFloor(admin, org.id, floor.id, "trash");
        expect(result.changed).toBe(true);
        expect(await isActive("floors", floor.id)).toBe(true);
        expect(await isActive("floor_areas", area.id)).toBe(back);
        expect(result.notices).toEqual([]);
      },
    );
  });

  it("1.7 A411 ny aktiv arealrad står; den gamle blir liggende, med beskjed og uten feil", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: FIRST_FLOOR,
      deletedAt: T0,
      deletedBy: adminEmployee.id,
    });
    const old = await createFloorArea(org.id, {
      floorId: floor.id,
      braI: 40,
      deletedAt: T0,
      deletedBy: adminEmployee.id,
    });
    const fresh = await createFloorArea(org.id, { floorId: floor.id, braI: 41 });

    const result = await restoreFloor(admin, org.id, floor.id, "trash");
    expect(result.changed).toBe(true);
    expect(result.notices).toEqual([
      "Etasjen kom tilbake med arealet som er ført nå. Det gamle arealet er tatt vare på, men ikke hentet tilbake.",
    ]);
    expect(await isActive("floors", floor.id)).toBe(true);
    expect(await isActive("floor_areas", fresh.id)).toBe(true);
    expect(await isActive("floor_areas", old.id)).toBe(false);
  });

  it("1.8 A410 rom i fjernet etasje i fjernet bygning: alle tre kommer tilbake, søsken blir liggende", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    const by = adminEmployee.id;
    const building = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: BUILDING_NAME,
      deletedAt: at(T0, 3000),
      deletedBy: by,
    });
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: FIRST_FLOOR,
      deletedAt: at(T0, 2000),
      deletedBy: by,
    });
    const otherFloor = await createFloor(org.id, {
      buildingId: building.id,
      name: SECOND_FLOOR,
      level: 2,
      deletedAt: at(T0, 3000),
      deletedBy: by,
    });
    const room = await createRoom(org.id, { floorId: floor.id, deletedAt: T0, deletedBy: by });
    const sibling = await createRoom(org.id, {
      floorId: floor.id,
      deletedAt: at(T0, 2000),
      deletedBy: by,
    });

    const result = await restoreRoom(admin, org.id, room.id, "trash");
    expect(ids(result)).toEqual(
      [`building:${building.id}`, `floor:${floor.id}`, `room:${room.id}`].sort(),
    );
    expect(result.notices).toEqual([
      `Rommet kom tilbake, sammen med etasjen «${FIRST_FLOOR}» og bygningen «${BUILDING_NAME}».`,
    ]);
    expect(await isActive("report_buildings", building.id)).toBe(true);
    expect(await isActive("floors", floor.id)).toBe(true);
    expect(await isActive("rooms", room.id)).toBe(true);
    expect(await isActive("rooms", sibling.id)).toBe(false);
    expect(await isActive("floors", otherFloor.id)).toBe(false);
  });

  it("1.9 A410 gjennom slettegruppe: ett rom henter etasjen, ikke de andre rommene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { floor, area, rooms } = await floorWithRooms(org.id, assignment.id, 3);
    await removeFloor(admin, org.id, floor.id);

    const result = await restoreRoom(admin, org.id, rooms[0]!.id, "trash");
    expect(ids(result)).toEqual([`floor:${floor.id}`, `room:${rooms[0]!.id}`].sort());
    expect(result.notices).toEqual([`Rommet kom tilbake, sammen med etasjen «${FIRST_FLOOR}».`]);
    expect(await isActive("floor_areas", area.id)).toBe(true);
    expect(await isActive("rooms", rooms[1]!.id)).toBe(false);
    expect(await isActive("rooms", rooms[2]!.id)).toBe(false);
  });

  it("1.10 samme id, plass og verdier; deleted_at og deleted_by er null, updated_by er den som hentet tilbake", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const measurer = await createEmployee(await createUser({ name: "Per Prøvesen" }), org.id, [
      "inspector",
    ]);
    const restorer = await createUser({ name: "Leder Test" });
    const restorerEmployee = await createEmployee(restorer, org.id, ["manager"]);
    const building = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: BUILDING_NAME,
    });
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      name: "Kjeller test",
      level: -1,
      belowGround: true,
    });
    const area = await createFloorArea(org.id, {
      floorId: floor.id,
      braI: 61.5,
      braB: 3.2,
      measuredBy: measurer.id,
      method: "drawing",
      comment: COMMENT,
    });
    for (const [i, roomType] of ["laundry", "storage", "bathroom"].entries()) {
      await createRoom(org.id, {
        floorId: floor.id,
        roomType,
        name: i === 2 ? ROOM_NAME : null,
        areaType: i === 1 ? "bra_b" : "bra_i",
        belowGround: true,
        createdAt: at(T0, i * 1000),
      });
    }
    const keep = (row: DbRow) => {
      const copy = { ...row };
      for (const key of ["deleted_at", "deleted_by", "updated_at", "updated_by", "row_version"]) {
        delete copy[key];
      }
      return copy;
    };
    const before = await getAssignmentBuildings(admin, org.id, assignment.id);
    const raw = async () =>
      JSON.stringify({
        building: keep(await rowById("report_buildings", building.id)),
        floor: keep(await rowById("floors", floor.id)),
        area: keep(await rowById("floor_areas", area.id)),
      });
    const rawBefore = await raw();

    await removeBuilding(admin, org.id, building.id);
    await restoreBuilding(restorer, org.id, building.id, "undo");

    expect(await getAssignmentBuildings(admin, org.id, assignment.id)).toEqual(before);
    expect(await raw()).toBe(rawBefore);
    for (const [table, id] of [
      ["report_buildings", building.id],
      ["floors", floor.id],
      ["floor_areas", area.id],
    ] as const) {
      const row = await rowById(table, id);
      expect(row.deleted_at).toBeNull();
      expect(row.deleted_by).toBeNull();
      expect(row.updated_by).toBe(restorerEmployee.id);
    }
  });

  it("1.11 rader gjenopprettes uendret uten å valideres mot dagens kodelister (arkiverte koder)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id, level: -3 });
    const room = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "other_wet_room",
      areaType: "not_bra",
    });
    await removeFloor(admin, org.id, floor.id);
    await restoreRoom(admin, org.id, room.id, "trash");
    const row = await rowById("rooms", room.id);
    expect(row.room_type).toBe("other_wet_room");
    expect(row.area_type).toBe("not_bra");
    expect(Number((await rowById("floors", floor.id)).level)).toBe(-3);

    // Gjenopprettingen leser aldri skjemaene eller kodelistene for romtype og etasje (regel 6):
    // en kode som er arkivert i malen i mellomtiden, skal komme tilbake uendret.
    const source = readFileSync(
      join(fileURLToPath(new URL(".", import.meta.url)), "trash.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from "\.\/schemas"/);
    expect(source).not.toMatch(/ROOM_TYPE_KEYS|suggestAreaType|suggestBelowGround/);
  });

  describe("1.12 gjentatte kall gir ingen endring og ingen ny hendelse", () => {
    const KINDS = ["building", "floor", "room"] as const;
    it.each(KINDS)("%s", async (kind) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const { building, floor, rooms } = await floorWithRooms(org.id, assignment.id, 1);
      const restore = { building: restoreBuilding, floor: restoreFloor, room: restoreRoom }[kind];
      const id = { building: building.id, floor: floor.id, room: rooms[0]!.id }[kind];
      if (kind === "building") await removeBuilding(admin, org.id, id);
      if (kind === "floor") await removeFloor(admin, org.id, id);
      if (kind === "room") await removeRoom(admin, org.id, id);

      expect((await restore(admin, org.id, id, "undo")).changed).toBe(true);
      const table = { building: "report_buildings", floor: "floors", room: "rooms" } as const;
      const row = JSON.stringify(await rowById(table[kind], id));
      const counts = await allCounts();

      const second = await restore(admin, org.id, id, "undo");
      expect(second.changed).toBe(false);
      expect(second.notices).toEqual([]);
      expect(second.restored).toEqual([{ type: kind, id, organizationId: org.id }]);
      expect(JSON.stringify(await rowById(table[kind], id))).toBe(row);
      expect(await allCounts()).toEqual(counts);
    });
  });

  it("1.13 et aktivt rom i en annen organisasjon gir avslag, ikke changed: false", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const { rooms } = await floorWithRooms(b.org.id, b.assignment.id, 1);
    expect(await caught(restoreRoom(a.admin, a.org.id, rooms[0]!.id, "trash"))).toBeInstanceOf(
      AccessDeniedError,
    );
  });

  describe("1.14 listTrash", () => {
    it("nyeste først, slettegruppe som én linje med rommene under, sti og areal", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const { building, floor, rooms } = await floorWithRooms(org.id, assignment.id, 4);
      const lone = await createRoom(org.id, { floorId: floor.id, roomType: "toilet" });

      useClock(T0);
      await removeRoom(admin, org.id, lone.id);
      vi.setSystemTime(at(T0, 60_000));
      await removeFloor(admin, org.id, floor.id);

      const lines = structureLines(await listTrash(admin, org.id, assignment.id));
      expect(lines.map((line) => `${line.type}:${line.id}`)).toEqual([
        `floor:${floor.id}`,
        `room:${lone.id}`,
      ]);
      const [group, single] = lines as [StructureTrashLine, StructureTrashLine];
      expect(group.label).toBe(FIRST_FLOOR);
      expect(group.groupCount).toBe(5);
      expect(group.contents).toEqual({ floors: 0, rooms: 4 });
      expect(group.children.map((child) => child.id).sort()).toEqual(
        rooms.map((room) => room.id).sort(),
      );
      expect(group.children.find((child) => child.id === rooms[0]!.id)?.label).toBe(ROOM_NAME);
      expect(group.path).toEqual([
        { type: "building", id: building.id, label: BUILDING_NAME, removed: false },
      ]);
      expect(group.area).toEqual({ braI: 50, braE: 10, braB: 4, bra: 64 });
      expect(group.removedAt.getTime()).toBe(at(T0, 60_000).getTime());
      expect(group.removedByName).toBe("Kari Testesen");

      // Rommet som ble fjernet alene, står for seg, med fjernet etasje i stien.
      expect(single.label).toBe("Toalettrom");
      expect(single.groupCount).toBe(1);
      expect(single.children).toEqual([]);
      expect(single.area).toBeNull();
      expect(single.path).toEqual([
        { type: "building", id: building.id, label: BUILDING_NAME, removed: false },
        { type: "floor", id: floor.id, label: FIRST_FLOOR, removed: true },
      ]);

      // Rommene i gruppen kan også hentes tilbake for seg (A410).
      await restoreRoom(admin, org.id, rooms[1]!.id, "trash");
      const after = structureLines(await listTrash(admin, org.id, assignment.id));
      expect(after.map((line) => line.id).sort()).toEqual(
        [lone.id, rooms[0]!.id, rooms[2]!.id, rooms[3]!.id].sort(),
      );
    });

    it("bygning fjernet med innhold er én linje med etasjer og rom under", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const { building, floor, rooms } = await floorWithRooms(org.id, assignment.id, 2);
      await removeBuilding(admin, org.id, building.id);

      const [line, ...rest] = structureLines(await listTrash(admin, org.id, assignment.id));
      expect(rest).toEqual([]);
      expect(line).toMatchObject({
        type: "building",
        id: building.id,
        label: BUILDING_NAME,
        path: [],
        groupCount: 4,
        contents: { floors: 1, rooms: 2 },
        area: null,
      });
      expect(line!.children.map((child) => `${child.type}:${child.id}`).sort()).toEqual(
        [`floor:${floor.id}`, ...rooms.map((room) => `room:${room.id}`)].sort(),
      );
      const child = line!.children.find((item) => item.id === rooms[0]!.id)!;
      expect(child.path).toEqual([
        { type: "building", id: building.id, label: BUILDING_NAME, removed: true },
        { type: "floor", id: floor.id, label: FIRST_FLOOR, removed: true },
      ]);
    });

    it("navnet til en ansatt som har sluttet, vises; aldri e-post", async () => {
      const { org, assignment } = await orgWithAdmin();
      const gone = await createUser({ name: "Sluttet Testesen" });
      const goneEmployee = await createEmployee(gone, org.id, ["inspector"]);
      await db
        .update(employees)
        .set({ deletedAt: T0, deactivatedAt: T0 })
        .where(eq(employees.id, goneEmployee.id));
      const building = await createBuilding(org.id, {
        assignmentId: assignment.id,
        deletedAt: T0,
        deletedBy: goneEmployee.id,
      });

      const lines = await listTrash((await orgAdmin(org.id))!, org.id, assignment.id);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ id: building.id, removedByName: "Sluttet Testesen" });
      expect(JSON.stringify(lines)).not.toContain("@");
    });

    it("ingen rader fra et annet oppdrag i samme organisasjon", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const other = await createAssignment(org.id);
      await createProperty(org.id, { assignmentId: other.id });
      await createBuilding(org.id, { assignmentId: other.id, deletedAt: T0 });
      const own = await createBuilding(org.id, { assignmentId: assignment.id, deletedAt: T0 });
      await createAssignmentParty(org.id, { assignmentId: other.id, deletedAt: T0 });

      const lines = await listTrash(admin, org.id, assignment.id);
      expect(lines.map((line) => line.id)).toEqual([own.id]);
    });

    it("høyst 200 linjer, de nyeste", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const building = await createBuilding(org.id, { assignmentId: assignment.id });
      const floor = await createFloor(org.id, { buildingId: building.id });
      const values = Array.from(
        { length: 205 },
        (_, i) =>
          sql`(${org.id}::uuid, ${floor.id}::uuid, 'bedroom', 'bra_i', false, ${at(T0, i * 1000).toISOString()}::timestamptz)`,
      );
      await db.execute(
        sql`insert into rooms (organization_id, floor_id, room_type, area_type, below_ground, deleted_at) values ${sql.join(values, sql`, `)}`,
      );

      const lines = await listTrash(admin, org.id, assignment.id);
      expect(lines).toHaveLength(200);
      expect(lines[0]!.removedAt.getTime()).toBe(at(T0, 204_000).getTime());
      expect(lines[199]!.removedAt.getTime()).toBe(at(T0, 5000).getTime());
    });

    it("parter gir bare id, rolle, navn og firmanavn", async () => {
      const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
      const party = await createAssignmentParty(org.id, {
        assignmentId: assignment.id,
        role: "buyer",
        name: PARTY_NAME,
        firmName: "Testfirma AS",
        email: PARTY_EMAIL,
        phone: PARTY_PHONE,
        deletedAt: T0,
        deletedBy: adminEmployee.id,
      });
      const [line] = (await listTrash(admin, org.id, assignment.id)) as PartyTrashLine[];
      expect(line).toEqual({
        type: "party",
        id: party.id,
        role: "buyer",
        name: PARTY_NAME,
        firmName: "Testfirma AS",
        removedAt: T0,
        removedByName: "Kari Testesen",
      });
      for (const key of ["email", "phone", "contactId", "firmId"])
        expect(line).not.toHaveProperty(key);
    });
  });

  it("1.15 tom papirkurv gir tom liste", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await floorWithRooms(org.id, assignment.id, 2);
    expect(await listTrash(admin, org.id, assignment.id)).toEqual([]);
  });
});

/** Aktøren til den første admin i organisasjonen. */
async function orgAdmin(organizationId: string): Promise<Actor | undefined> {
  const [row] = await db
    .select({ userId: employees.userId, name: employees.name })
    .from(employees)
    .where(eq(employees.organizationId, organizationId))
    .orderBy(employees.createdAt);
  return row ? { id: row.userId!, email: `${row.userId}@example.com`, name: row.name } : undefined;
}

// ---------------------------------------------------------------------------------------------
// 2. Hendelser, revisjonslogg og varige data
// ---------------------------------------------------------------------------------------------

describe("2. hendelser, revisjonslogg og varige data", () => {
  it("2.1 én revisjonslinje per rad ved fjerning og gjenoppretting; slettelinjene står uendret", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { building, floor, area, rooms } = await floorWithRooms(org.id, assignment.id, 2);

    await removeBuilding(admin, org.id, building.id);
    const deletes = await auditFor(org.id, "delete");
    const expected = [
      `report_building:${building.id}`,
      `floor:${floor.id}`,
      `floor_area:${area.id}`,
      ...rooms.map((room) => `room:${room.id}`),
    ].sort();
    expect(deletes.map((row) => `${row.entityType}:${row.entityId}`).sort()).toEqual(expected);
    const deletesBefore = JSON.stringify(deletes);

    await restoreBuilding(admin, org.id, building.id, "trash");
    const restores = await auditFor(org.id, "restore");
    expect(restores.map((row) => `${row.entityType}:${row.entityId}`).sort()).toEqual(expected);
    for (const row of restores) expect(row.changes).toMatchObject({ how: "trash" });
    expect(JSON.stringify(await auditFor(org.id, "delete"))).toBe(deletesBefore);
  });

  it("2.2 hendelsene har groupCount, how, secondsSinceRemoval og faste koder; én per overordnet ledd", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { building, floor, rooms } = await floorWithRooms(org.id, assignment.id, 2);
    const bedroom = rooms[1]!;

    useClock(T0);
    await removeRoom(admin, org.id, bedroom.id);
    vi.setSystemTime(at(T0, 1000));
    await removeFloor(admin, org.id, floor.id);
    vi.setSystemTime(at(T0, 2000));
    await removeBuilding(admin, org.id, building.id);

    const [roomRemoved] = await eventsFor(org.id, "assignment.room_removed");
    expect(roomRemoved!.data).toEqual({
      roomId: bedroom.id,
      created: false,
      roomTypeKey: "bedroom",
      groupCount: 1,
    });
    const [floorRemoved] = await eventsFor(org.id, "assignment.floor_removed");
    expect(floorRemoved!.data).toEqual({
      floorId: floor.id,
      created: false,
      floorKey: 1,
      groupCount: 2,
    });
    const [buildingRemoved] = await eventsFor(org.id, "assignment.building_removed");
    expect(buildingRemoved!.data).toEqual({
      buildingId: building.id,
      created: false,
      groupCount: 1,
    });

    vi.setSystemTime(at(T0, 42_000));
    await restoreRoom(admin, org.id, bedroom.id, "trash");

    const [roomRestored, ...moreRooms] = await eventsFor(org.id, "assignment.room_restored");
    expect(moreRooms).toEqual([]);
    expect(roomRestored!.assignmentId).toBe(assignment.id);
    expect(roomRestored!.data).toEqual({
      roomId: bedroom.id,
      roomTypeKey: "bedroom",
      groupCount: 1,
      how: "trash",
      secondsSinceRemoval: 42,
    });
    const [floorRestored, ...moreFloors] = await eventsFor(org.id, "assignment.floor_restored");
    expect(moreFloors).toEqual([]);
    expect(floorRestored!.data).toEqual({
      floorId: floor.id,
      floorKey: 1,
      groupCount: 1,
      how: "trash",
      secondsSinceRemoval: 41,
    });
    const [buildingRestored, ...moreBuildings] = await eventsFor(
      org.id,
      "assignment.building_restored",
    );
    expect(moreBuildings).toEqual([]);
    expect(buildingRestored!.data).toEqual({
      buildingId: building.id,
      groupCount: 1,
      how: "trash",
      secondsSinceRemoval: 40,
    });
  });

  it("2.2 «Angre» på en gruppe gir én hendelse for den øverste delen, med antallet", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { floor } = await floorWithRooms(org.id, assignment.id, 4);
    useClock(T0);
    await removeFloor(admin, org.id, floor.id);
    vi.setSystemTime(at(T0, 3000));
    await restoreFloor(admin, org.id, floor.id, "undo");

    const restored = (await eventsFor(org.id)).filter((row) => row.type.endsWith("_restored"));
    expect(restored.map((row) => [row.type, row.data])).toEqual([
      [
        "assignment.floor_restored",
        { floorId: floor.id, floorKey: 1, groupCount: 5, how: "undo", secondsSinceRemoval: 3 },
      ],
    ]);
  });

  it("2.4 ingen navn, kommentar, e-post eller telefon i events.data eller audit_log.changes", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { building, floor, rooms } = await floorWithRooms(org.id, assignment.id, 2);
    await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      name: PARTY_NAME,
      email: PARTY_EMAIL,
      phone: PARTY_PHONE,
    });
    await removeRoom(admin, org.id, rooms[0]!.id);
    await restoreRoom(admin, org.id, rooms[0]!.id, "undo");
    await removeFloor(admin, org.id, floor.id);
    await restoreFloor(admin, org.id, floor.id, "trash");
    await removeBuilding(admin, org.id, building.id);
    await restoreRoom(admin, org.id, rooms[1]!.id, "trash");

    const text = JSON.stringify([
      (await eventsFor(org.id)).map((row) => row.data),
      (await auditFor(org.id)).map((row) => row.changes),
    ]);
    for (const value of [
      BUILDING_NAME,
      FIRST_FLOOR,
      ROOM_NAME,
      COMMENT,
      PARTY_NAME,
      PARTY_EMAIL,
      PARTY_PHONE,
    ]) {
      expect(text, value).not.toContain(value);
    }
  });

  it("2.5 ingenting slettes permanent: like mange rader etter en hel runde; logg og hendelser bare vokser", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { building, floor, rooms } = await floorWithRooms(org.id, assignment.id, 3);
    await createAssignmentParty(org.id, { assignmentId: assignment.id });
    const before = await allCounts();

    await removeFloor(admin, org.id, floor.id);
    await restoreFloor(admin, org.id, floor.id, "undo");
    await removeBuilding(admin, org.id, building.id);
    await restoreRoom(admin, org.id, rooms[0]!.id, "trash");
    await removeRoom(admin, org.id, rooms[0]!.id);
    await restoreBuilding(admin, org.id, building.id, "trash");

    const after = await allCounts();
    for (const table of TABLES) expect(after[table], table).toBe(before[table]);
    expect(after.events).toBeGreaterThan(before.events!);
    expect(after.audit_log).toBeGreaterThan(before.audit_log!);
  });

  it("2.6 KI-forslag som peker på rommet og etasjen, er helt uendret etter fjerning og gjenoppretting", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    const { building, floor, rooms } = await floorWithRooms(org.id, assignment.id, 1);
    const forRoom = await createAiUsageLog(org.id, {
      employeeId: adminEmployee.id,
      assignmentId: assignment.id,
      targetRef: { type: "room", id: rooms[0]!.id, fieldKey: "name" },
    });
    const forFloor = await createAiUsageLog(org.id, {
      employeeId: adminEmployee.id,
      assignmentId: assignment.id,
      targetRef: { type: "floor", id: floor.id, fieldKey: "name" },
    });
    const snapshot = async () =>
      JSON.stringify(
        await db.execute(
          sql`select * from ai_usage_log where id in (${forRoom.id}, ${forFloor.id}) order by id`,
        ),
      );
    const before = await snapshot();

    await removeBuilding(admin, org.id, building.id);
    await restoreRoom(admin, org.id, rooms[0]!.id, "trash");
    expect(await snapshot()).toBe(before);
    expect(await isActive("rooms", rooms[0]!.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Tilgang per rolle og avslag
// ---------------------------------------------------------------------------------------------

type Fn = "listTrash" | "restoreBuilding" | "restoreFloor" | "restoreRoom";
const FUNCTIONS: Fn[] = ["listTrash", "restoreBuilding", "restoreFloor", "restoreRoom"];

/** Oppsett der hver funksjon har noe å gjøre: en fjernet bygning, etasje og rom. */
async function accessSetup() {
  const base = await orgWithAdmin();
  const { org, admin, assignment } = base;
  const removedBuilding = await createBuilding(org.id, {
    assignmentId: assignment.id,
    name: GARAGE_NAME,
  });
  await removeBuilding(admin, org.id, removedBuilding.id);
  const { floor: removedFloor } = await floorWithRooms(org.id, assignment.id, 0);
  await removeFloor(admin, org.id, removedFloor.id);
  const { rooms } = await floorWithRooms(org.id, assignment.id, 1);
  await removeRoom(admin, org.id, rooms[0]!.id);
  return {
    ...base,
    ids: { building: removedBuilding.id, floor: removedFloor.id, room: rooms[0]!.id },
  };
}

function run(
  fn: Fn,
  actor: Actor,
  organizationId: string,
  s: { assignment: { id: string }; ids: { building: string; floor: string; room: string } },
) {
  switch (fn) {
    case "listTrash":
      return listTrash(actor, organizationId, s.assignment.id);
    case "restoreBuilding":
      return restoreBuilding(actor, organizationId, s.ids.building, "trash");
    case "restoreFloor":
      return restoreFloor(actor, organizationId, s.ids.floor, "trash");
    case "restoreRoom":
      return restoreRoom(actor, organizationId, s.ids.room, "trash");
  }
}

type RoleCase = {
  name: string;
  roles: EmployeeRole[];
  editAll: boolean;
  read: boolean;
  write: boolean;
};
const ROLE_CASES: RoleCase[] = [
  {
    name: "takstmann, innstillingen på",
    roles: ["inspector"],
    editAll: true,
    read: true,
    write: true,
  },
  {
    name: "takstmann, innstillingen av",
    roles: ["inspector"],
    editAll: false,
    read: true,
    write: false,
  },
  { name: "kontor", roles: ["office"], editAll: false, read: true, write: true },
  { name: "leder", roles: ["manager"], editAll: false, read: true, write: true },
  { name: "admin (eneste rolle)", roles: ["admin"], editAll: false, read: true, write: true },
];

describe("4. tilgang per rolle", () => {
  const MATRIX = ROLE_CASES.flatMap((role) => FUNCTIONS.map((fn) => ({ ...role, fn })));

  it.each(MATRIX)("$name: $fn", async ({ roles, editAll, read, write, fn }) => {
    const s = await accessSetup();
    await setInspectorsEditAll(s.org.id, editAll);
    const actor = await createUser({ name: "Rolle Test" });
    await createEmployee(actor, s.org.id, roles);
    const allowed = fn === "listTrash" ? read : write;
    const counts = await allCounts();

    const error = await caught(run(fn, actor, s.org.id, s));
    if (allowed) {
      expect(error).toBeNull();
    } else {
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(await allCounts()).toEqual(counts);
    }
  });

  it.each(FUNCTIONS)("ansatt med deleted_at får avslag: %s", async (fn) => {
    const s = await accessSetup();
    const actor = await createUser({ name: "Slettet Test" });
    const employee = await createEmployee(actor, s.org.id, ["admin"]);
    await db.update(employees).set({ deletedAt: T0 }).where(eq(employees.id, employee.id));
    const counts = await allCounts();
    expect(await caught(run(fn, actor, s.org.id, s))).toBeInstanceOf(AccessDeniedError);
    expect(await allCounts()).toEqual(counts);
  });

  it("4.1 ukjent id, id fra annen organisasjon, ugyldig UUID og kansellert oppdrag gir samme avslag", async () => {
    const s = await accessSetup();
    const other = await accessSetup();
    const { cancelAssignment } = await import("@/core/assignments");
    const cancelled = await createAssignment(s.org.id);
    await createProperty(s.org.id, { assignmentId: cancelled.id });
    const { building, floor, rooms } = await floorWithRooms(s.org.id, cancelled.id, 1);
    await removeBuilding(s.admin, s.org.id, building.id);
    await cancelAssignment(s.admin, s.org.id, cancelled.id, {
      expectedStatus: "ordered",
      reason: "Kunden trakk bestillingen test",
    });

    const idsFor: Record<
      string,
      { building: string; floor: string; room: string; assignment: string }
    > = {
      unknown: {
        building: randomUUID(),
        floor: randomUUID(),
        room: randomUUID(),
        assignment: randomUUID(),
      },
      foreign: { ...other.ids, assignment: other.assignment.id },
      invalid: {
        building: "ikke-en-id",
        floor: "ikke-en-id",
        room: "ikke-en-id",
        assignment: "ikke-en-id",
      },
      cancelled: {
        building: building.id,
        floor: floor.id,
        room: rooms[0]!.id,
        assignment: cancelled.id,
      },
    };
    const messages = new Set<string>();
    for (const [name, ids] of Object.entries(idsFor)) {
      for (const fn of FUNCTIONS) {
        const error = await caught(
          run(fn, s.admin, s.org.id, { assignment: { id: ids.assignment }, ids }),
        );
        expect(error, `${name} ${fn}`).toBeInstanceOf(AccessDeniedError);
        messages.add((error as Error).message);
      }
    }
    expect(messages.size).toBe(1);
  });

  it("4.2 rom-id fra B med organisasjon A gir avslag, og B-raden er uendret", async () => {
    const a = await accessSetup();
    const b = await accessSetup();
    const before = JSON.stringify(await rowById("rooms", b.ids.room));
    expect(await caught(restoreRoom(a.admin, a.org.id, b.ids.room, "trash"))).toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await caught(restoreRoom(a.admin, b.org.id, b.ids.room, "trash"))).toBeInstanceOf(
      AccessDeniedError,
    );
    expect(JSON.stringify(await rowById("rooms", b.ids.room))).toBe(before);
  });

  it("ugyldig «how» gir feil uten endring", async () => {
    const s = await accessSetup();
    const counts = await allCounts();
    await expect(
      restoreRoom(s.admin, s.org.id, s.ids.room, "auto" as unknown as "undo"),
    ).rejects.toThrow();
    expect(await allCounts()).toEqual(counts);
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Tenant-isolasjon
// ---------------------------------------------------------------------------------------------

describe("5. tenant-isolasjon", () => {
  /** Oppdrag med eiendom og en fjernet bygning med etasje og rom i organisasjonen. */
  async function seedOrg(organizationId: string) {
    const assignment = await createAssignment(organizationId);
    await createProperty(organizationId, { assignmentId: assignment.id });
    const building = await createBuilding(organizationId, {
      assignmentId: assignment.id,
      deletedAt: T0,
    });
    const floor = await createFloor(organizationId, { buildingId: building.id, deletedAt: T0 });
    const room = await createRoom(organizationId, { floorId: floor.id, deletedAt: T0 });
    return { assignment, building, floor, room };
  }

  it("5.1 listTrash", async () => {
    const seeded = new Map<string, Awaited<ReturnType<typeof seedOrg>>>();
    await expectTenantIsolation<TrashLine>({
      seed: async (grantA, grantB) => {
        const a = await seedOrg(grantA.organizationId);
        const b = await seedOrg(grantB.organizationId);
        seeded.set(grantA.organizationId, a);
        seeded.set(grantB.organizationId, b);
        return { a: [a.building.id], b: [b.building.id] };
      },
      query: (actor, organizationId) => {
        const own = seeded.get(organizationId)!;
        return listTrash(actor, organizationId, own.assignment.id);
      },
      idOf: (line) => line.id,
    });
  });

  const RESTORES = [
    [
      "5.2 restoreBuilding",
      (s: Awaited<ReturnType<typeof seedOrg>>) => s.building.id,
      restoreBuilding,
    ],
    ["5.3 restoreFloor", (s: Awaited<ReturnType<typeof seedOrg>>) => s.floor.id, restoreFloor],
    ["5.4 restoreRoom", (s: Awaited<ReturnType<typeof seedOrg>>) => s.room.id, restoreRoom],
  ] as const;

  it.each(RESTORES)("%s", async (_name, idOf, restore) => {
    const seeded = new Map<string, Awaited<ReturnType<typeof seedOrg>>>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedOrg(grantA.organizationId);
        const b = await seedOrg(grantB.organizationId);
        seeded.set(grantA.organizationId, a);
        seeded.set(grantB.organizationId, b);
        return { a: [idOf(a)], b: [idOf(b)] };
      },
      query: async (actor, organizationId) => {
        const own = seeded.get(organizationId)!;
        const result = await restore(actor, organizationId, idOf(own), "trash");
        for (const row of result.restored) expect(row.organizationId).toBe(organizationId);
        return result.restored;
      },
      idOf: (row) => row.id,
    });
  });
});
