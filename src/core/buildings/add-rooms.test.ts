import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  ROOM_PRESETS,
  ROOM_TYPE_KEYS,
  addRooms,
  addRoomsInputSchema,
  getAssignmentBuildings,
  numberRoomDrafts,
  suggestRoomPreset,
} from "@/core/buildings";
import { db } from "@/db/client";
import {
  createAssignment,
  createBuilding,
  createEmployee,
  createFloor,
  createOrganization,
  createProperty,
  createRoom,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Utviklerens egne tester for flere rom på én gang (T4). Testplanens F1–F10 skrives av
 * testskriveren i room-presets.test.ts, schemas.test.ts, buildings.test.ts og
 * buildings-transaction.test.ts. Testdata er oppdiktet. Støtter hovedmål: de ansatte (alle rom i
 * én operasjon), færre reklamasjoner (unike navn, riktig arealtype og under terreng).
 */

beforeEach(async () => {
  await resetDatabase();
});

type DbRow = Record<string, unknown>;

async function rawRows(table: string, where = sql`true`): Promise<DbRow[]> {
  return (await db.execute(
    sql`select * from ${sql.identifier(table)} where ${where} order by created_at, id`,
  )) as unknown as DbRow[];
}

async function setup(options: { belowGround?: boolean; housingType?: string } = {}) {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  await createEmployee(admin, org.id, ["admin"]);
  const assignment = await createAssignment(org.id);
  await createProperty(org.id, {
    assignmentId: assignment.id,
    housingType: options.housingType ?? "apartment",
  });
  const building = await createBuilding(org.id, { assignmentId: assignment.id });
  const floor = await createFloor(org.id, {
    buildingId: building.id,
    level: options.belowGround ? -1 : 1,
    belowGround: options.belowGround ?? false,
  });
  return { org, admin, assignment, building, floor };
}

describe("ferdige sett og nummerering (rene funksjoner)", () => {
  it("hvert sett bruker aktive romtyper og går gjennom skjemaet", () => {
    for (const preset of ROOM_PRESETS) {
      expect(preset.draft).toBe(true);
      for (const draft of preset.drafts) expect(ROOM_TYPE_KEYS).toContain(draft.roomType);
      const parsed = addRoomsInputSchema.safeParse({
        drafts: preset.drafts,
        source: "preset",
        presetKey: preset.key,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("forslaget: under terreng, leilighet, inngangsetasje, etasje over", () => {
    const base = { housingType: "detached" as const, floorLevel: 1, floorBelowGround: false };
    expect(suggestRoomPreset({ ...base, floorBelowGround: true })).toBe("basement");
    expect(suggestRoomPreset({ ...base, housingType: "apartment_in_house" })).toBe("apartment");
    expect(suggestRoomPreset({ ...base, housingType: null })).toBe("house_main_floor");
    expect(suggestRoomPreset({ ...base, floorLevel: 2 })).toBe("house_upper_floor");
  });

  it("nummerering: «soverom 7» teller (store og små bokstaver likt), «Soverom 3b» teller ikke", () => {
    expect(
      numberRoomDrafts(
        [{ roomType: "bedroom", count: 1 }],
        [
          { roomType: "bedroom", name: "soverom 7" },
          { roomType: "bedroom", name: "Soverom 3b" },
        ],
      ),
    ).toEqual([{ roomType: "bedroom", name: "Soverom 8" }]);
    expect(numberRoomDrafts([{ roomType: "bedroom", count: 1 }], [])).toEqual([
      { roomType: "bedroom", name: "" },
    ]);
  });

  it("skjemaet avviser samme romtype to ganger, navn og ai_floor_plan", () => {
    const bad = [
      {
        drafts: [
          { roomType: "bedroom", count: 1 },
          { roomType: "bedroom", count: 1 },
        ],
        source: "manual",
      },
      { drafts: [{ roomType: "bedroom", count: 1, name: "Soverom 9" }], source: "manual" },
      { drafts: [{ roomType: "bedroom", count: 1 }], source: "ai_floor_plan" },
      { drafts: [{ roomType: "bedroom", count: 1 }], source: "manual", presetKey: "apartment" },
      { drafts: [{ roomType: "bedroom", count: 1 }], source: "preset" },
    ];
    for (const input of bad) expect(addRoomsInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("addRooms", () => {
  it("lagrer settet med nummer, arealtype, under terreng, logg uten navn og hendelser", async () => {
    const { org, admin, floor } = await setup({ belowGround: true });
    await createRoom(org.id, { floorId: floor.id, roomType: "storage", name: "Bod, inne 2" });

    const result = await addRooms(admin, org.id, floor.id, {
      drafts: [
        { roomType: "hallway", count: 1 },
        { roomType: "storage", count: 2 },
      ],
      source: "preset",
      presetKey: "basement",
    });

    expect(result.names).toEqual(["", "Bod, inne 3", "Bod, inne 4"]);
    const saved = await rawRows("rooms", sql`id in ${result.ids}`);
    expect(saved).toHaveLength(3);
    for (const row of saved) {
      expect(row.organization_id).toBe(org.id);
      expect(row.below_ground).toBe(true);
      expect(row.area_type).toBe("bra_i");
    }
    expect(saved.find((row) => row.room_type === "hallway")!.name).toBeNull();

    const audit = await rawRows("audit_log", sql`entity_type = 'room'`);
    expect(audit).toHaveLength(3);
    for (const row of audit) {
      expect(row.changes).toMatchObject({ source: "preset", presetKey: "basement" });
      expect(JSON.stringify(row)).not.toContain("Bod, inne");
    }
    const events = await rawRows("events", sql`type = 'assignment.room_saved'`);
    expect(events).toHaveLength(3);
    expect(await rawRows("ai_usage_log")).toHaveLength(0);
  });

  it("samtidige lagringer i samme etasje gir unike navn", async () => {
    const { org, admin, floor } = await setup();
    const input = { drafts: [{ roomType: "bedroom", count: 3 }], source: "manual" } as const;
    await Promise.all([
      addRooms(admin, org.id, floor.id, input),
      addRooms(admin, org.id, floor.id, input),
    ]);
    const names = (await rawRows("rooms", sql`floor_id = ${floor.id}`)).map((row) => row.name);
    expect(new Set(names).size).toBe(6);
  });

  it("myk-slettet etasje, ukjent og ugyldig id gir AccessDeniedError", async () => {
    const { org, admin, building } = await setup();
    const deleted = await createFloor(org.id, {
      buildingId: building.id,
      deletedAt: new Date(),
    });
    const input = { drafts: [{ roomType: "bedroom", count: 1 }], source: "manual" } as const;
    for (const id of [deleted.id, randomUUID(), "abc"]) {
      await expect(addRooms(admin, org.id, id, input)).rejects.toBeInstanceOf(AccessDeniedError);
    }
    expect(await rawRows("rooms")).toHaveLength(0);
  });

  it("tenant-isolasjon: rommene havner alltid i egen organisasjon", async () => {
    const floorFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const floor = await createFloor(grant.organizationId);
          floorFor.set(grant.organizationId, floor.id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const floorId = floorFor.get(organizationId) ?? randomUUID();
        await addRooms(actor, organizationId, floorId, {
          drafts: [{ roomType: "bedroom", count: 2 }],
          source: "manual",
        });
        return rawRows("rooms", sql`floor_id = ${floorId}`);
      },
      idOf: (row) => row.organization_id as string,
    });
  });

  it("etasje-id fra en annen organisasjon gir AccessDeniedError og ingen rom", async () => {
    const a = await setup();
    const b = await setup();
    await expect(
      addRooms(a.admin, a.org.id, b.floor.id, {
        drafts: [{ roomType: "bedroom", count: 1 }],
        source: "manual",
      }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await rawRows("rooms")).toHaveLength(0);
  });
});

describe("getAssignmentBuildings: boligtypen", () => {
  it("gir boligtypen fra egen eiendom, og null uten eiendom", async () => {
    const a = await setup({ housingType: "terraced" });
    await setup({ housingType: "apartment" });
    const result = await getAssignmentBuildings(a.admin, a.org.id, a.assignment.id);
    expect(result.housingType).toBe("terraced");
    expect(result.hasProperty).toBe(true);

    const bare = await createAssignment(a.org.id);
    const empty = await getAssignmentBuildings(a.admin, a.org.id, bare.id);
    expect(empty.housingType).toBeNull();
    expect(empty.hasProperty).toBe(false);
  });
});
