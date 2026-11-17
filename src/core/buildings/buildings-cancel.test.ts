import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import { cancelAssignment, restoreParty } from "@/core/assignments";
import {
  getAssignmentBuildings,
  listTrash,
  removeBuilding,
  removeFloor,
  removeRoom,
  restoreBuilding,
  restoreFloor,
  restoreRoom,
  saveBuilding,
  saveFloor,
  saveFloorArea,
  saveRoom,
} from "@/core/buildings";
import { db } from "@/db/client";
import { assignments, auditLog, events, type EmployeeRole } from "@/db/schema";
import {
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

/*
 * 4.4.1b: bygninger, etasjer, areal og rom på et kansellert oppdrag kan verken leses eller endres.
 * Testplan: docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md punkt 4.4.1b. Oppgavekort:
 * docs/funksjoner/fase2a-bygninger-areal-rom.md punkt 9.
 *
 * Oppdraget kanselleres gjennom statustjenesten (`cancelAssignment`, A76), aldri ved å sette
 * `deleted_at` for hånd. Etterpå skal lesingen og alle sju skrivetjenestene gi
 * `AccessDeniedError` for admin, leder, kontor og takstmann (innstillingen på), radene i de fire
 * tabellene skal være helt uendret, og det skal ikke komme nye hendelser eller loggrader.
 *
 * Papirkurven (docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 6, A416): `listTrash` og
 * `restore*` gir også `AccessDeniedError` på et kansellert oppdrag, for alle roller, uten spor.
 *
 * Ingen ny spørring testes her (bare tjenester som er testet andre steder), så filen har ikke
 * `expectTenantIsolation`; den står i buildings.test.ts og trash.test.ts.
 *
 * Testdata er oppdiktet. Støtter hovedmål: reklamasjoner (et kansellert oppdrag kan ikke få
 * endret areal eller rom i ettertid).
 */

beforeEach(resetDatabase);

const TABLES = ["report_buildings", "floors", "floor_areas", "rooms"] as const;
type TableName = (typeof TABLES)[number];
type DbRow = Record<string, unknown>;

const ROLES: EmployeeRole[] = ["admin", "manager", "office", "inspector"];

type BuildingInput = Parameters<typeof saveBuilding>[4];
type FloorInput = Parameters<typeof saveFloor>[4];
type AreaInput = Parameters<typeof saveFloorArea>[3];
type RoomInput = Parameters<typeof saveRoom>[4];

const BUILDING_INPUT = { name: "Anneks test" } as unknown as BuildingInput;
const FLOOR_INPUT = { name: "Loft test", level: "2", belowGround: false } as unknown as FloorInput;
const AREA_INPUT = {
  braI: "99.9",
  braE: "11.1",
  braB: "2.2",
  alh: "120.5",
  measuredBy: "",
  method: "laser",
  comment: "Endret etter kansellering test",
} as unknown as AreaInput;
const ROOM_INPUT = {
  roomType: "bedroom",
  name: "Soverom test",
  areaType: "bra_i",
  belowGround: false,
} as unknown as RoomInput;

async function rawRows(table: TableName, organizationId: string): Promise<DbRow[]> {
  return (await db.execute(
    sql`select * from ${sql.identifier(table)} where organization_id = ${organizationId} order by id`,
  )) as unknown as DbRow[];
}

/** Alle radene i de fire tabellene, med alle kolonnene (også updated_at og deleted_at). */
async function snapshot(organizationId: string): Promise<string> {
  const all: Record<string, DbRow[]> = {};
  for (const table of TABLES) all[table] = await rawRows(table, organizationId);
  return JSON.stringify(all);
}

async function eventAndAuditCounts(organizationId: string) {
  const [eventRow] = await db
    .select({ n: count() })
    .from(events)
    .where(eq(events.organizationId, organizationId));
  const [auditRow] = await db
    .select({ n: count() })
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId));
  return { events: eventRow?.n ?? 0, audit: auditRow?.n ?? 0 };
}

async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

/**
 * Oppdrag med eiendom i en organisasjon med én person per rolle. Bygningen har en etasje med
 * areal og rom, og det finnes også en tom bygning og en tom etasje, slik at «Fjern» ville
 * lyktes om oppdraget ikke var kansellert.
 */
async function setup() {
  const org = await createOrganization("Testfirma takst");
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const people = {} as Record<EmployeeRole, Actor>;
  for (const role of ROLES) {
    const actor = await createUser({ name: `Test ${role}` });
    await createEmployee(actor, org.id, [role]);
    people[role] = actor;
  }
  const assignment = await createAssignment(org.id, { officeId: office.id });
  await createProperty(org.id, { assignmentId: assignment.id });

  const building = await createBuilding(org.id, {
    assignmentId: assignment.id,
    name: "Bolighus",
  });
  const floor = await createFloor(org.id, { buildingId: building.id, name: "1. etasje" });
  await createFloorArea(org.id, {
    floorId: floor.id,
    braI: 123.4,
    braE: 56.7,
    braB: 8.9,
    alh: 210.3,
    method: "laser",
    comment: "Målt langs innvendig vegg test",
  });
  const room = await createRoom(org.id, { floorId: floor.id, name: "Rom test" });
  const emptyBuilding = await createBuilding(org.id, {
    assignmentId: assignment.id,
    name: "Garasje test",
  });
  const emptyFloor = await createFloor(org.id, { buildingId: building.id, name: "Kjeller" });

  return { org, people, assignment, building, floor, room, emptyBuilding, emptyFloor };
}

describe("4.4.1b kansellert oppdrag: bygninger, etasjer, areal og rom er låst", () => {
  it("lesing og alle sju skrivetjenestene gir AccessDeniedError, og ingenting endres", async () => {
    const { org, people, assignment, building, floor, room, emptyBuilding, emptyFloor } =
      await setup();

    // Kontroll: før kansellering kan alle fire rollene lese bygningene.
    for (const role of ROLES) {
      const result = await getAssignmentBuildings(people[role], org.id, assignment.id);
      expect(result.buildings.length, role).toBe(2);
    }

    await cancelAssignment(people.admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "Kunden trakk bestillingen test",
    });
    const [cancelled] = await db
      .select({ deletedAt: assignments.deletedAt })
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    expect(cancelled?.deletedAt).toBeInstanceOf(Date);

    const before = await snapshot(org.id);
    const countsBefore = await eventAndAuditCounts(org.id);

    for (const role of ROLES) {
      const actor = people[role];
      const calls: [string, () => Promise<unknown>][] = [
        ["getAssignmentBuildings", () => getAssignmentBuildings(actor, org.id, assignment.id)],
        [
          "saveBuilding (ny)",
          () => saveBuilding(actor, org.id, assignment.id, null, BUILDING_INPUT),
        ],
        [
          "saveBuilding (eksisterende)",
          () => saveBuilding(actor, org.id, assignment.id, building.id, BUILDING_INPUT),
        ],
        ["removeBuilding", () => removeBuilding(actor, org.id, emptyBuilding.id)],
        ["saveFloor (ny)", () => saveFloor(actor, org.id, building.id, null, FLOOR_INPUT)],
        [
          "saveFloor (eksisterende)",
          () => saveFloor(actor, org.id, building.id, floor.id, FLOOR_INPUT),
        ],
        ["removeFloor", () => removeFloor(actor, org.id, emptyFloor.id)],
        ["saveFloorArea", () => saveFloorArea(actor, org.id, floor.id, AREA_INPUT)],
        ["saveRoom (ny)", () => saveRoom(actor, org.id, floor.id, null, ROOM_INPUT)],
        ["saveRoom (eksisterende)", () => saveRoom(actor, org.id, floor.id, room.id, ROOM_INPUT)],
        ["removeRoom", () => removeRoom(actor, org.id, room.id)],
      ];
      for (const [name, run] of calls) {
        expect(await caught(run()), `${role}: ${name}`).toBeInstanceOf(AccessDeniedError);
      }
    }

    expect(await snapshot(org.id)).toBe(before);
    expect(await eventAndAuditCounts(org.id)).toEqual(countsBefore);
  });

  it("kansellering fra «under arbeid» låser også", async () => {
    const { org, people, assignment, floor, room } = await setup();
    await db
      .update(assignments)
      .set({ status: "in_progress" })
      .where(eq(assignments.id, assignment.id));

    await cancelAssignment(people.manager, org.id, assignment.id, {
      expectedStatus: "in_progress",
      reason: "Avlyst befaring test",
    });

    const before = await snapshot(org.id);
    const countsBefore = await eventAndAuditCounts(org.id);
    expect(
      await caught(saveFloorArea(people.inspector, org.id, floor.id, AREA_INPUT)),
    ).toBeInstanceOf(AccessDeniedError);
    expect(
      await caught(saveRoom(people.office, org.id, floor.id, room.id, ROOM_INPUT)),
    ).toBeInstanceOf(AccessDeniedError);
    expect(await snapshot(org.id)).toBe(before);
    expect(await eventAndAuditCounts(org.id)).toEqual(countsBefore);
  });
});

describe("6. papirkurven på kansellert oppdrag (A416)", () => {
  /** Oppsettet over, med en fjernet bygning, etasje og rom før kanselleringen. */
  async function removedSetup() {
    const base = await setup();
    const { org, people, assignment, building, room, emptyBuilding, emptyFloor } = base;
    const removedRoom = await createRoom(org.id, { floorId: base.floor.id, name: "Bad test" });
    await removeRoom(people.admin, org.id, removedRoom.id);
    await removeFloor(people.admin, org.id, emptyFloor.id);
    await removeBuilding(people.admin, org.id, emptyBuilding.id);
    // Kontroll: før kansellering ser admin papirkurven.
    expect((await listTrash(people.admin, org.id, assignment.id)).length).toBe(3);
    return { ...base, building, room, removedRoom };
  }

  it("6.1–6.2 listTrash og restore* gir avslag for alle roller, også admin, uten endring", async () => {
    const { org, people, assignment, emptyBuilding, emptyFloor, removedRoom } =
      await removedSetup();
    await cancelAssignment(people.admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "Kunden trakk bestillingen test",
    });
    const before = await snapshot(org.id);
    const countsBefore = await eventAndAuditCounts(org.id);

    for (const role of ROLES) {
      const actor = people[role];
      const calls: [string, () => Promise<unknown>][] = [
        ["listTrash", () => listTrash(actor, org.id, assignment.id)],
        ["restoreBuilding", () => restoreBuilding(actor, org.id, emptyBuilding.id, "trash")],
        ["restoreFloor", () => restoreFloor(actor, org.id, emptyFloor.id, "trash")],
        ["restoreRoom", () => restoreRoom(actor, org.id, removedRoom.id, "undo")],
      ];
      for (const [name, run] of calls) {
        expect(await caught(run()), `${role}: ${name}`).toBeInstanceOf(AccessDeniedError);
      }
    }
    expect(await snapshot(org.id)).toBe(before);
    expect(await eventAndAuditCounts(org.id)).toEqual(countsBefore);
  });

  it("6.3 det kansellerte oppdraget og radene på det står aldri i papirkurven til et annet oppdrag", async () => {
    const { org, people, assignment, building } = await removedSetup();
    await cancelAssignment(people.admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "Kunden trakk bestillingen test",
    });
    const other = await createAssignment(org.id);
    await createProperty(org.id, { assignmentId: other.id });
    const otherBuilding = await createBuilding(org.id, { assignmentId: other.id });
    await removeBuilding(people.admin, org.id, otherBuilding.id);

    const lines = await listTrash(people.admin, org.id, other.id);
    expect(lines.map((line) => line.id)).toEqual([otherBuilding.id]);
    const text = JSON.stringify(lines);
    expect(text).not.toContain(assignment.id);
    expect(text).not.toContain(building.id);
  });
});

/*
 * Papirkurven på kansellert oppdrag (A416). Testplan: docs/funksjoner/fase2a-papirkurv-testplan.md
 * avsnitt 6. Oppgavekort: docs/funksjoner/fase2a-papirkurv.md («Kansellert oppdrag»).
 * `listTrash` og alle fire `restore*` gir `AccessDeniedError` for alle roller, også admin, uten
 * endring i radene og uten nye hendelser eller loggrader. Det kansellerte oppdraget står aldri i
 * papirkurven for et annet oppdrag. Tenant-isolasjonen for funksjonene står i trash.test.ts og
 * party-restore.test.ts.
 */
describe("6b. papirkurven på kansellert oppdrag med part (A416, testplan)", () => {
  /** Oppsettet over, med en fjernet bygning, etasje, rom og part før kanselleringen. */
  async function cancelledWithTrash() {
    const base = await setup();
    const { org, people, assignment, building, floor, room } = base;
    const removedBuilding = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: "Anneks test",
    });
    await removeBuilding(people.admin, org.id, removedBuilding.id);
    await removeRoom(people.admin, org.id, room.id);
    const removedFloor = await createFloor(org.id, { buildingId: building.id, name: "Loft test" });
    await removeFloor(people.admin, org.id, removedFloor.id);
    const party = await createAssignmentParty(org.id, {
      assignmentId: assignment.id,
      role: "buyer",
      name: "Ola Testmann",
      deletedAt: new Date("2026-11-03T10:00:00Z"),
    });

    // Kontroll: før kansellering ser admin papirkurven.
    const before = (await listTrash(people.admin, org.id, assignment.id)) as unknown as unknown[];
    expect(before.length).toBeGreaterThan(0);

    await cancelAssignment(people.admin, org.id, assignment.id, {
      expectedStatus: "ordered",
      reason: "Kunden trakk bestillingen test",
    });
    return { ...base, removedBuilding, removedFloor, floor, party };
  }

  it("6.1–6.2 listTrash og alle fire restore* gir AccessDeniedError for alle roller, uten endring og uten nye rader", async () => {
    const { org, people, assignment, removedBuilding, removedFloor, room, party } =
      await cancelledWithTrash();
    const rows = await snapshot(org.id);
    const parties = JSON.stringify(
      await db.execute(
        sql`select * from assignment_parties where organization_id = ${org.id} order by id`,
      ),
    );
    const counts = await eventAndAuditCounts(org.id);

    for (const role of ROLES) {
      const actor = people[role];
      const calls: [string, () => Promise<unknown>][] = [
        ["listTrash", () => listTrash(actor, org.id, assignment.id)],
        ["restoreBuilding", () => restoreBuilding(actor, org.id, removedBuilding.id, "trash")],
        ["restoreFloor", () => restoreFloor(actor, org.id, removedFloor.id, "trash")],
        ["restoreRoom", () => restoreRoom(actor, org.id, room.id, "undo")],
        ["restoreParty", () => restoreParty(actor, org.id, party.id, "trash")],
      ];
      for (const [name, run] of calls) {
        expect(await caught(run()), `${role}: ${name}`).toBeInstanceOf(AccessDeniedError);
      }
    }

    expect(await snapshot(org.id)).toBe(rows);
    expect(
      JSON.stringify(
        await db.execute(
          sql`select * from assignment_parties where organization_id = ${org.id} order by id`,
        ),
      ),
    ).toBe(parties);
    expect(await eventAndAuditCounts(org.id)).toEqual(counts);
  });

  it("6.3 det kansellerte oppdraget og radene på det står aldri i papirkurven for et annet oppdrag", async () => {
    const { org, people, assignment, removedBuilding, removedFloor, room, party } =
      await cancelledWithTrash();
    const other = await createAssignment(org.id);
    const otherBuilding = await createBuilding(org.id, { assignmentId: other.id, name: "Garasje" });
    await removeBuilding(people.admin, org.id, otherBuilding.id);

    for (const role of ROLES) {
      const result = (await listTrash(people[role], org.id, other.id)) as unknown as {
        id: string;
      }[];
      const text = JSON.stringify(result);
      expect(
        result.map((line) => line.id),
        role,
      ).toEqual([otherBuilding.id]);
      for (const id of [assignment.id, removedBuilding.id, removedFloor.id, room.id, party.id]) {
        expect(text, `${role}: ${id}`).not.toContain(id);
      }
    }
  });
});
