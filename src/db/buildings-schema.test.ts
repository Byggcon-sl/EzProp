import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import * as schema from "@/db/schema";
import {
  createAssignment,
  createBuilding,
  createEmployee,
  createFloor,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../tests/factories";
import { tenantTables } from "../../tests/tenant-tables";

/*
 * Databasen selv holder reglene for bygninger, etasjer, areal og rom
 * (docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 3). Direkte innsetting med SQL,
 * utenom kjernen, så det er skrankene i databasen som prøves. Feilkoden sjekkes, så en
 * skrivefeil i et kolonnenavn ikke gir en falsk grønn test.
 *
 * Kolonnenavnene er fra kortet punkt 1–4: report_buildings (assignment_id, name), floors
 * (report_building_id, name, level, below_ground), floor_areas (floor_id, bra_i, bra_e, bra_b,
 * alh, measured_by, method, comment) og rooms (floor_id, room_type, name, area_type, below_ground).
 *
 * Støtter hovedmål: reklamasjoner (bare faste koder, aldri negativt areal, aldri en rad som peker
 * inn i en annen organisasjon, aldri to aktive arealrader på samme etasje). Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const CHECK = "23514";
const FOREIGN_KEY = "23503";
const UNIQUE = "23505";
const NOT_NULL = "23502";
const DELETED_AT = "2026-11-03T09:00:00Z";

/** Postgres-feilkoden, også når Drizzle har pakket feilen inn. */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function expectPgError(run: Promise<unknown>, code: string) {
  const error = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "databasen skulle avvist raden").not.toBeNull();
  expect(pgCode(error), `feilkode (fikk ${String(error)})`).toBe(code);
}

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  return result as Row[];
}

/** Oppdrag i organisasjonen (uten eiendom; databasen krever ikke eiendom). */
async function assignmentIn(organizationId: string) {
  return (await createAssignment(organizationId)).id;
}

function insertBuildingSql(values: {
  organizationId: string;
  assignmentId: string | null;
  name?: string | null;
}) {
  return db.execute(sql`
    insert into report_buildings (organization_id, assignment_id, name)
    values (${values.organizationId}, ${values.assignmentId},
      ${values.name === undefined ? "Bolighus" : values.name})
    returning id`);
}

function insertFloorSql(values: {
  organizationId: string;
  buildingId: string | null;
  name?: string | null;
  level?: number | null;
  belowGround?: boolean | null;
}) {
  if (values.belowGround === undefined) {
    return db.execute(sql`
      insert into floors (organization_id, report_building_id, name, level)
      values (${values.organizationId}, ${values.buildingId},
        ${values.name === undefined ? "1. etasje" : values.name},
        ${values.level === undefined ? 1 : values.level})
      returning id, below_ground`);
  }
  return db.execute(sql`
    insert into floors (organization_id, report_building_id, name, level, below_ground)
    values (${values.organizationId}, ${values.buildingId},
      ${values.name === undefined ? "1. etasje" : values.name},
      ${values.level === undefined ? 1 : values.level}, ${values.belowGround})
    returning id, below_ground`);
}

function insertAreaSql(values: {
  organizationId: string;
  floorId: string | null;
  braI?: string | null;
  braE?: string | null;
  braB?: string | null;
  alh?: string | null;
  measuredBy?: string | null;
  method?: string | null;
  deletedAt?: string | null;
}) {
  return db.execute(sql`
    insert into floor_areas (organization_id, floor_id, bra_i, bra_e, bra_b, alh, measured_by, method, deleted_at)
    values (${values.organizationId}, ${values.floorId}, ${values.braI ?? null}::numeric,
      ${values.braE ?? null}::numeric, ${values.braB ?? null}::numeric, ${values.alh ?? null}::numeric,
      ${values.measuredBy ?? null}, ${values.method ?? null}, ${values.deletedAt ?? null})
    returning id`);
}

function insertRoomSql(values: {
  organizationId: string;
  floorId: string | null;
  roomType?: string | null;
  areaType?: string | null;
  belowGround?: boolean | null;
}) {
  return db.execute(sql`
    insert into rooms (organization_id, floor_id, room_type, area_type, below_ground)
    values (${values.organizationId}, ${values.floorId},
      ${values.roomType === undefined ? "bathroom" : values.roomType},
      ${values.areaType === undefined ? "bra_i" : values.areaType},
      ${values.belowGround === undefined ? false : values.belowGround})
    returning id`);
}

async function ownFloor(organizationId: string) {
  return (await createFloor(organizationId)).id;
}

async function twoOrgs() {
  const a = await createOrganization("Oppdiktet takst A");
  const b = await createOrganization("Oppdiktet takst B");
  return { a, b };
}

const ROOM_TYPE_KEYS = [
  "bathroom",
  "laundry",
  "bathroom_laundry",
  "room_with_drain",
  "other_wet_room",
  "kitchen",
  "living_kitchen",
  "toilet",
  "sauna",
  "boiler_room",
  "technical_room",
  "cold_room",
  "swimming_pool",
  "living_room",
  "bedroom",
  "office",
  "family_room",
  "dining_room",
  "entrance",
  "hallway",
  "stairwell",
  "wardrobe",
  "storage",
  "external_storage",
  "basement_living_room",
  "basement_room",
  "crawl_space",
  "attic_living_room",
  "unfinished_attic",
  "garage",
  "glazed_balcony",
  "workshop",
  "other",
];

describe("3.1 CHECK på faste koder", () => {
  it.each(["villa", "", "Bathroom", "wet_room"])("ukjent room_type «%s» avvises", async (code) => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await expectPgError(insertRoomSql({ organizationId: org.id, floorId, roomType: code }), CHECK);
  });

  it.each(ROOM_TYPE_KEYS)("room_type %s godtas", async (code) => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await insertRoomSql({ organizationId: org.id, floorId, roomType: code });
  });

  it.each(["alh", "", "bra", "BRA-i"])("ukjent area_type «%s» avvises", async (code) => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await expectPgError(insertRoomSql({ organizationId: org.id, floorId, areaType: code }), CHECK);
  });

  it.each(["bra_i", "bra_e", "bra_b"])("area_type %s godtas", async (code) => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await insertRoomSql({ organizationId: org.id, floorId, areaType: code });
  });

  it.each(["lidar", "", "Laser", "tape"])("ukjent method «%s» avvises", async (code) => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await expectPgError(insertAreaSql({ organizationId: org.id, floorId, method: code }), CHECK);
  });

  it.each(["laser", "drawing", "other"])("method %s godtas (og tom method)", async (code) => {
    const org = await createOrganization();
    await insertAreaSql({ organizationId: org.id, floorId: await ownFloor(org.id), method: code });
    await insertAreaSql({ organizationId: org.id, floorId: await ownFloor(org.id), method: null });
  });
});

describe("3.2 negativt areal", () => {
  it.each(["braI", "braE", "braB", "alh"] as const)("%s = -0.1 avvises", async (field) => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await expectPgError(insertAreaSql({ organizationId: org.id, floorId, [field]: "-0.1" }), CHECK);
  });

  it("0 og 9999.9 godtas i alle fire kolonnene, og tallet står med én desimal", async () => {
    const org = await createOrganization();
    await insertAreaSql({
      organizationId: org.id,
      floorId: await ownFloor(org.id),
      braI: "0",
      braE: "0",
      braB: "0",
      alh: "0",
    });
    const [row] = rowsOf(
      await insertAreaSql({
        organizationId: org.id,
        floorId: await ownFloor(org.id),
        braI: "9999.9",
        braE: "123.4",
        braB: "8.9",
        alh: "210.3",
      }),
    );
    const [stored] = rowsOf(
      await db.execute(sql`select bra_i, bra_e, bra_b, alh from floor_areas where id = ${row!.id}`),
    );
    expect(stored).toEqual({ bra_i: "9999.9", bra_e: "123.4", bra_b: "8.9", alh: "210.3" });
  });

  it("kolonnene er numeric(7,1)", async () => {
    const rows = rowsOf(
      await db.execute(sql`
        select column_name, data_type, numeric_precision, numeric_scale
        from information_schema.columns
        where table_name = 'floor_areas' and column_name in ('bra_i', 'bra_e', 'bra_b', 'alh')
        order by column_name`),
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row, String(row.column_name)).toMatchObject({
        data_type: "numeric",
        numeric_precision: 7,
        numeric_scale: 1,
      });
    }
  });
});

describe("3.3 etasjenummer", () => {
  async function levelCheckExists(): Promise<boolean> {
    const rows = rowsOf(
      await db.execute(sql`
        select pg_get_constraintdef(c.oid) as def from pg_constraint c
        join pg_class t on t.oid = c.conrelid
        where t.relname = 'floors' and c.contype = 'c'`),
    );
    return rows.some((row) => String(row.def).includes("level"));
  }

  it.for([-4, 21])(
    "level = %s avvises (hvis CHECK finnes; ellers dekket av skjematesten 2.3)",
    async (level, context) => {
      if (!(await levelCheckExists())) {
        context.skip("ingen CHECK på floors.level i databasen; grensen holdes av skjemaet (2.3)");
      }
      const org = await createOrganization();
      const buildingId = (await createBuilding(org.id)).id;
      await expectPgError(insertFloorSql({ organizationId: org.id, buildingId, level }), CHECK);
    },
  );

  it.each([-3, 0, 20])("level = %s godtas", async (level) => {
    const org = await createOrganization();
    const buildingId = (await createBuilding(org.id)).id;
    await insertFloorSql({ organizationId: org.id, buildingId, level });
  });
});

describe("3.4 sammensatte fremmednøkler på tvers av organisasjoner", () => {
  it("bygning i A som peker på oppdrag i B avvises", async () => {
    const { a, b } = await twoOrgs();
    await expectPgError(
      insertBuildingSql({ organizationId: a.id, assignmentId: await assignmentIn(b.id) }),
      FOREIGN_KEY,
    );
  });

  it("bygning mot eget oppdrag godtas", async () => {
    const { a } = await twoOrgs();
    await insertBuildingSql({ organizationId: a.id, assignmentId: await assignmentIn(a.id) });
  });

  it("etasje i A som peker på bygning i B avvises", async () => {
    const { a, b } = await twoOrgs();
    const buildingB = await createBuilding(b.id);
    await expectPgError(
      insertFloorSql({ organizationId: a.id, buildingId: buildingB.id }),
      FOREIGN_KEY,
    );
  });

  it("areal i A som peker på etasje i B avvises", async () => {
    const { a, b } = await twoOrgs();
    await expectPgError(
      insertAreaSql({ organizationId: a.id, floorId: await ownFloor(b.id) }),
      FOREIGN_KEY,
    );
  });

  it("rom i A som peker på etasje i B avvises", async () => {
    const { a, b } = await twoOrgs();
    await expectPgError(
      insertRoomSql({ organizationId: a.id, floorId: await ownFloor(b.id) }),
      FOREIGN_KEY,
    );
  });

  it("measured_by i A som peker på ansatt i B avvises", async () => {
    const { a, b } = await twoOrgs();
    const employeeB = await createEmployee(await createUser({ name: "Test Måler B" }), b.id, [
      "inspector",
    ]);
    await expectPgError(
      insertAreaSql({
        organizationId: a.id,
        floorId: await ownFloor(a.id),
        measuredBy: employeeB.id,
      }),
      FOREIGN_KEY,
    );
  });

  it("measured_by mot egen ansatt godtas", async () => {
    const { a } = await twoOrgs();
    const employeeA = await createEmployee(await createUser({ name: "Test Måler A" }), a.id, [
      "inspector",
    ]);
    await insertAreaSql({
      organizationId: a.id,
      floorId: await ownFloor(a.id),
      measuredBy: employeeA.id,
    });
  });

  it.each([
    ["bygning → oppdrag", "building"],
    ["etasje → bygning", "floor"],
    ["areal → etasje", "area"],
    ["rom → etasje", "room"],
    ["measured_by → ansatt", "measurer"],
  ] as const)("%s som ikke finnes avvises", async (_name, kind) => {
    const org = await createOrganization();
    const missing = "0190a000-0000-7000-8000-00000000dead";
    const run =
      kind === "building"
        ? insertBuildingSql({ organizationId: org.id, assignmentId: missing })
        : kind === "floor"
          ? insertFloorSql({ organizationId: org.id, buildingId: missing })
          : kind === "area"
            ? insertAreaSql({ organizationId: org.id, floorId: missing })
            : kind === "room"
              ? insertRoomSql({ organizationId: org.id, floorId: missing })
              : insertAreaSql({
                  organizationId: org.id,
                  floorId: await ownFloor(org.id),
                  measuredBy: missing,
                });
    await expectPgError(run, FOREIGN_KEY);
  });
});

describe("3.5 én aktiv arealrad per etasje", () => {
  it("to aktive rader på samme etasje avvises (unik delvis indeks)", async () => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await insertAreaSql({ organizationId: org.id, floorId, braI: "123.4" });
    await expectPgError(insertAreaSql({ organizationId: org.id, floorId, braI: "56.7" }), UNIQUE);
  });

  it("én myk-slettet og én aktiv godtas", async () => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await insertAreaSql({ organizationId: org.id, floorId, deletedAt: DELETED_AT });
    await insertAreaSql({ organizationId: org.id, floorId });
  });

  it("to myk-slettede og én aktiv godtas", async () => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await insertAreaSql({ organizationId: org.id, floorId, deletedAt: DELETED_AT });
    await insertAreaSql({ organizationId: org.id, floorId, deletedAt: DELETED_AT });
    await insertAreaSql({ organizationId: org.id, floorId });
  });

  it("aktive rader på to ulike etasjer godtas", async () => {
    const org = await createOrganization();
    await insertAreaSql({ organizationId: org.id, floorId: await ownFloor(org.id) });
    await insertAreaSql({ organizationId: org.id, floorId: await ownFloor(org.id) });
  });

  it("flere rom på samme etasje godtas", async () => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await insertRoomSql({ organizationId: org.id, floorId });
    await insertRoomSql({ organizationId: org.id, floorId });
  });
});

describe("3.6 påkrevde felt", () => {
  it("report_buildings.assignment_id er NOT NULL", async () => {
    const org = await createOrganization();
    await expectPgError(
      insertBuildingSql({ organizationId: org.id, assignmentId: null }),
      NOT_NULL,
    );
  });

  it("report_buildings.name er NOT NULL", async () => {
    const org = await createOrganization();
    await expectPgError(
      insertBuildingSql({
        organizationId: org.id,
        assignmentId: await assignmentIn(org.id),
        name: null,
      }),
      NOT_NULL,
    );
  });

  it.each([
    ["report_building_id", { buildingId: null }],
    ["name", { name: null }],
    ["level", { level: null }],
    ["below_ground", { belowGround: null }],
  ] as const)("floors.%s er NOT NULL", async (_name, values) => {
    const org = await createOrganization();
    const buildingId = (await createBuilding(org.id)).id;
    await expectPgError(
      insertFloorSql({ organizationId: org.id, buildingId, ...values }),
      NOT_NULL,
    );
  });

  it("floors.below_ground får standard false", async () => {
    const org = await createOrganization();
    const buildingId = (await createBuilding(org.id)).id;
    const [row] = rowsOf(await insertFloorSql({ organizationId: org.id, buildingId }));
    expect(row!.below_ground).toBe(false);
  });

  it("floor_areas.floor_id er NOT NULL", async () => {
    const org = await createOrganization();
    await expectPgError(insertAreaSql({ organizationId: org.id, floorId: null }), NOT_NULL);
  });

  it("floor_areas: alle arealfelt, måler, metode og kommentar kan stå tomme", async () => {
    const org = await createOrganization();
    const [row] = rowsOf(
      await insertAreaSql({ organizationId: org.id, floorId: await ownFloor(org.id) }),
    );
    const [stored] = rowsOf(
      await db.execute(sql`
        select bra_i, bra_e, bra_b, alh, measured_by, method, comment
        from floor_areas where id = ${row!.id}`),
    );
    expect(Object.values(stored!).every((value) => value === null)).toBe(true);
  });

  it.each([
    ["floor_id", { floorId: null }],
    ["room_type", { roomType: null }],
    ["area_type", { areaType: null }],
    ["below_ground", { belowGround: null }],
  ] as const)("rooms.%s er NOT NULL", async (_name, values) => {
    const org = await createOrganization();
    const floorId = await ownFloor(org.id);
    await expectPgError(insertRoomSql({ organizationId: org.id, floorId, ...values }), NOT_NULL);
  });

  it("rooms.name kan stå tomt", async () => {
    const org = await createOrganization();
    await insertRoomSql({ organizationId: org.id, floorId: await ownFloor(org.id) });
  });
});

describe("3.7 tenant-tabellene", () => {
  const schemaValues: unknown[] = Object.values(schema);
  const tables = schemaValues.filter((value): value is PgTable => is(value, PgTable));
  const NAMES = ["report_buildings", "floors", "floor_areas", "rooms"] as const;

  it.each(NAMES)("%s finnes i skjemaet med organization_id og deleted_at", (name) => {
    const table = tables.find((candidate) => getTableName(candidate) === name);
    expect(table, `tabellen ${name} i skjemaet`).toBeDefined();
    const columns = Object.values(getTableColumns(table!)).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(["organization_id", "deleted_at"]));
  });

  it("report_buildings har ingen property_id (eiendommen finnes via oppdraget, A84)", () => {
    const table = tables.find((candidate) => getTableName(candidate) === "report_buildings");
    expect(table).toBeDefined();
    const columns = Object.values(getTableColumns(table!)).map((column) => column.name);
    expect(columns).not.toContain("property_id");
  });

  it.each(NAMES)(
    "%s står i tests/tenant-tables.ts med src/core/buildings/buildings.test.ts, og radbyggeren virker",
    async (name) => {
      const entry = tenantTables.find((candidate) => candidate.table === name);
      expect(entry, `${name} i tests/tenant-tables.ts`).toBeDefined();
      expect(entry!.testFile).toBe("src/core/buildings/buildings.test.ts");
      const org = await createOrganization("Oppdiktet takst A");
      const id = await entry!.insertRow(org.id);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const [row] = rowsOf(
        await db.execute(sql`select organization_id from ${sql.identifier(name)} where id = ${id}`),
      );
      expect(row!.organization_id).toBe(org.id);
    },
  );
});

describe("3.8 migreringen", () => {
  const dir = path.join(process.cwd(), "src/db/migrations");

  it("0018_bygninger-areal-rom.sql finnes og er den eneste med nummeret 0018", () => {
    const files = readdirSync(dir).filter((name) => name.startsWith("0018_"));
    expect(files).toEqual(["0018_bygninger-areal-rom.sql"]);
  });

  it("0017 er kontakter og firma fra main, og ingen annen fil har nummeret", () => {
    const files = readdirSync(dir).filter((name) => name.startsWith("0017_"));
    expect(files).toEqual(["0017_kontakter-og-firma.sql"]);
  });

  it("0018 lager de fire tabellene", () => {
    const text = readFileSync(path.join(dir, "0018_bygninger-areal-rom.sql"), "utf8");
    for (const name of ["report_buildings", "floors", "floor_areas", "rooms"]) {
      expect(text, name).toMatch(new RegExp(`CREATE TABLE[^;]*"${name}"`, "i"));
    }
  });

  it("journalen har 19 oppføringer i rekkefølge, med 0018 sist", () => {
    const journal = JSON.parse(readFileSync(path.join(dir, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries).toHaveLength(19);
    journal.entries.forEach((entry, index) => {
      expect(entry.idx).toBe(index);
      expect(entry.tag.startsWith(String(index).padStart(4, "0") + "_")).toBe(true);
    });
    const last = journal.entries.at(-1)!;
    expect(last.tag).toBe("0018_bygninger-areal-rom");
    expect(
      readdirSync(path.join(dir, "meta")).filter((name) => name.endsWith("_snapshot.json")),
    ).toHaveLength(19);
  });
});
