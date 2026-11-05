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
  createProperty,
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
 * alh, measured_by, method, comment) og rooms (floor_id, room_type, name, area_type,
 * below_ground).
 *
 * Støtter hovedmål: reklamasjoner (bare faste koder for romtype, arealtype og metode, aldri
 * negativt areal, aldri en rad som peker inn i en annen organisasjon, aldri to aktive arealrader
 * på samme etasje) og KI først (strukturen er låst, så et senere forslag fyller de samme feltene).
 * Testdata er oppdiktet.
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

const MISSING = Symbol("mangler");
type Value = string | number | boolean | null | typeof MISSING;

/**
 * `insert into <table> (...) values (...) returning *` med bare kolonnene som ikke er `MISSING`,
 * slik at standardverdier og NOT NULL kan prøves.
 */
function insertSql(table: string, values: Record<string, Value>) {
  const entries = Object.entries(values).filter(([, value]) => value !== MISSING);
  const columns = sql.raw(entries.map(([name]) => name).join(", "));
  const params = sql.join(
    entries.map(([, value]) => sql`${value}`),
    sql`, `,
  );
  return db.execute(sql`insert into ${sql.raw(table)} (${columns}) values (${params}) returning *`);
}

async function insertedId(run: Promise<unknown>): Promise<string> {
  const [row] = rowsOf(await run);
  return row!.id as string;
}

function insertBuilding(organizationId: string, values: Record<string, Value> = {}) {
  return insertSql("report_buildings", {
    organization_id: organizationId,
    name: "Bolighus",
    ...values,
  });
}

function insertFloor(
  organizationId: string,
  buildingId: Value,
  values: Record<string, Value> = {},
) {
  return insertSql("floors", {
    organization_id: organizationId,
    report_building_id: buildingId,
    name: "1. etasje",
    level: 1,
    ...values,
  });
}

function insertArea(organizationId: string, floorId: Value, values: Record<string, Value> = {}) {
  return insertSql("floor_areas", {
    organization_id: organizationId,
    floor_id: floorId,
    ...values,
  });
}

function insertRoom(organizationId: string, floorId: Value, values: Record<string, Value> = {}) {
  return insertSql("rooms", {
    organization_id: organizationId,
    floor_id: floorId,
    room_type: "bathroom",
    area_type: "bra_i",
    below_ground: false,
    ...values,
  });
}

/** Oppdrag med eiendom i organisasjonen. */
async function assignmentWithProperty(organizationId: string) {
  const assignment = await createAssignment(organizationId);
  await createProperty(organizationId, { assignmentId: assignment.id });
  return assignment;
}

/** En organisasjon med oppdrag, bygning og etasje, satt inn med SQL. */
async function orgWithFloor(name: string) {
  const org = await createOrganization(name);
  const assignment = await assignmentWithProperty(org.id);
  const buildingId = await insertedId(insertBuilding(org.id, { assignment_id: assignment.id }));
  const floorId = await insertedId(insertFloor(org.id, buildingId));
  return { org, assignment, buildingId, floorId };
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
  it("de 33 romtypene i kortet godtas", async () => {
    expect(ROOM_TYPE_KEYS).toHaveLength(33);
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    for (const roomType of ROOM_TYPE_KEYS) {
      await insertRoom(org.id, floorId, { room_type: roomType });
    }
    const [row] = rowsOf(await db.execute(sql`select count(*)::int as n from rooms`));
    expect(row!.n).toBe(33);
  });

  it.each(["villa", "", "Bathroom", "bad"])("ukjent room_type «%s» avvises", async (roomType) => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    await expectPgError(insertRoom(org.id, floorId, { room_type: roomType }), CHECK);
  });

  it.each(["bra_i", "bra_e", "bra_b"])("area_type %s godtas", async (areaType) => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    const [row] = rowsOf(await insertRoom(org.id, floorId, { area_type: areaType }));
    expect(row!.area_type).toBe(areaType);
  });

  it.each(["alh", "tba", "BRA-i", ""])("ukjent area_type «%s» avvises", async (areaType) => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    await expectPgError(insertRoom(org.id, floorId, { area_type: areaType }), CHECK);
  });

  it.each(["laser", "drawing", "other"])("method %s godtas", async (method) => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    const [row] = rowsOf(await insertArea(org.id, floorId, { method }));
    expect(row!.method).toBe(method);
  });

  it.each(["lidar", "Laser", ""])("ukjent method «%s» avvises", async (method) => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    await expectPgError(insertArea(org.id, floorId, { method }), CHECK);
  });

  it("method kan være tom (null)", async () => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    const [row] = rowsOf(await insertArea(org.id, floorId, { method: null }));
    expect(row!.method).toBeNull();
  });
});

const AREA_COLUMNS = ["bra_i", "bra_e", "bra_b", "alh"] as const;

describe("3.2 areal", () => {
  it.each(AREA_COLUMNS)("negativt %s (-0,1) avvises", async (column) => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    await expectPgError(insertArea(org.id, floorId, { [column]: "-0.1" }), CHECK);
  });

  it("0 og 9999,9 godtas i alle fire kolonnene, og tallene lagres med én desimal", async () => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    const [row] = rowsOf(
      await insertArea(org.id, floorId, {
        bra_i: "9999.9",
        bra_e: "0",
        bra_b: "8.9",
        alh: "210.3",
      }),
    );
    expect([row!.bra_i, row!.bra_e, row!.bra_b, row!.alh].map(String)).toEqual([
      "9999.9",
      "0.0",
      "8.9",
      "210.3",
    ]);
  });

  it("alle fire kolonnene kan være tomme", async () => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    const [row] = rowsOf(await insertArea(org.id, floorId));
    expect([row!.bra_i, row!.bra_e, row!.bra_b, row!.alh]).toEqual([null, null, null, null]);
  });
});

describe("3.3 etasjenummer", () => {
  it.for([-4, 21])("level %d avvises når databasen har CHECK på level", async (level, ctx) => {
    const [found] = rowsOf(
      await db.execute(sql`
        select count(*)::int as n from pg_constraint
        where conrelid = 'floors'::regclass and contype = 'c'
          and pg_get_constraintdef(oid) like '%level%'`),
    );
    // Uten CHECK i databasen er grensen dekket av skjemaet (schemas.test.ts 2.3).
    if (found!.n === 0) ctx.skip();
    const org = await createOrganization("Oppdiktet takst A");
    const building = await createBuilding(org.id);
    await expectPgError(insertFloor(org.id, building.id, { level }), CHECK);
  });

  it.each([-3, 0, 20])("level %d godtas", async (level) => {
    const org = await createOrganization("Oppdiktet takst A");
    const building = await createBuilding(org.id);
    const [row] = rowsOf(await insertFloor(org.id, building.id, { level }));
    expect(row!.level).toBe(level);
  });
});

describe("3.4 sammensatte fremmednøkler: rad i A som peker inn i B avvises", () => {
  it("bygning i A → oppdrag i B", async () => {
    const a = await createOrganization("Oppdiktet takst A");
    const b = await createOrganization("Oppdiktet takst B");
    const assignmentB = await assignmentWithProperty(b.id);
    await expectPgError(insertBuilding(a.id, { assignment_id: assignmentB.id }), FOREIGN_KEY);
  });

  it("etasje i A → bygning i B", async () => {
    const a = await createOrganization("Oppdiktet takst A");
    const b = await orgWithFloor("Oppdiktet takst B");
    await expectPgError(insertFloor(a.id, b.buildingId), FOREIGN_KEY);
  });

  it("areal i A → etasje i B", async () => {
    const a = await createOrganization("Oppdiktet takst A");
    const b = await orgWithFloor("Oppdiktet takst B");
    await expectPgError(insertArea(a.id, b.floorId), FOREIGN_KEY);
  });

  it("rom i A → etasje i B", async () => {
    const a = await createOrganization("Oppdiktet takst A");
    const b = await orgWithFloor("Oppdiktet takst B");
    await expectPgError(insertRoom(a.id, b.floorId), FOREIGN_KEY);
  });

  it("areal i A med measured_by = ansatt i B", async () => {
    const a = await orgWithFloor("Oppdiktet takst A");
    const b = await createOrganization("Oppdiktet takst B");
    const employeeB = await createEmployee(await createUser({ name: "Test Måler B" }), b.id, [
      "inspector",
    ]);
    await expectPgError(
      insertArea(a.org.id, a.floorId, { measured_by: employeeB.id }),
      FOREIGN_KEY,
    );
  });

  it("measured_by = ansatt i samme organisasjon godtas", async () => {
    const a = await orgWithFloor("Oppdiktet takst A");
    const employee = await createEmployee(await createUser({ name: "Test Måler A" }), a.org.id, [
      "inspector",
    ]);
    const [row] = rowsOf(await insertArea(a.org.id, a.floorId, { measured_by: employee.id }));
    expect(row!.measured_by).toBe(employee.id);
  });

  it.each([
    ["bygning → ukjent oppdrag", "report_buildings"],
    ["etasje → ukjent bygning", "floors"],
    ["areal → ukjent etasje", "floor_areas"],
    ["rom → ukjent etasje", "rooms"],
  ])("%s avvises", async (_name, table) => {
    const org = await createOrganization("Oppdiktet takst A");
    const unknown = "0190a000-0000-7000-8000-0000000000ff";
    const run =
      table === "report_buildings"
        ? insertBuilding(org.id, { assignment_id: unknown })
        : table === "floors"
          ? insertFloor(org.id, unknown)
          : table === "floor_areas"
            ? insertArea(org.id, unknown)
            : insertRoom(org.id, unknown);
    await expectPgError(run, FOREIGN_KEY);
  });
});

describe("3.5 én aktiv arealrad per etasje (A96)", () => {
  it("to aktive arealrader på samme etasje avvises", async () => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    await insertArea(org.id, floorId, { bra_i: "123.4" });
    await expectPgError(insertArea(org.id, floorId, { bra_i: "56.7" }), UNIQUE);
  });

  it("en myk-slettet arealrad sperrer ikke for en ny aktiv", async () => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    await insertArea(org.id, floorId, { bra_i: "123.4", deleted_at: DELETED_AT });
    const [row] = rowsOf(await insertArea(org.id, floorId, { bra_i: "56.7" }));
    expect(row!.deleted_at).toBeNull();
    const [count] = rowsOf(
      await db.execute(sql`select count(*)::int as n from floor_areas where floor_id = ${floorId}`),
    );
    expect(count!.n).toBe(2);
  });

  it("to myk-slettede arealrader på samme etasje godtas", async () => {
    const { org, floorId } = await orgWithFloor("Oppdiktet takst A");
    await insertArea(org.id, floorId, { deleted_at: DELETED_AT });
    await insertArea(org.id, floorId, { deleted_at: DELETED_AT });
  });

  it("aktive arealrader på hver sin etasje godtas", async () => {
    const { org, buildingId, floorId } = await orgWithFloor("Oppdiktet takst A");
    const second = await insertedId(
      insertFloor(org.id, buildingId, { name: "Kjeller", level: -1 }),
    );
    await insertArea(org.id, floorId);
    await insertArea(org.id, second);
  });
});

describe("3.6 påkrevde felt og standardverdier", () => {
  it("bygning uten assignment_id avvises", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    await expectPgError(insertBuilding(org.id, { assignment_id: MISSING }), NOT_NULL);
  });

  it("bygning uten navn avvises", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const assignment = await assignmentWithProperty(org.id);
    await expectPgError(
      insertBuilding(org.id, { assignment_id: assignment.id, name: null }),
      NOT_NULL,
    );
  });

  it.each([
    ["report_building_id", { report_building_id: null }],
    ["name", { name: null }],
    ["level", { level: null }],
    ["below_ground", { below_ground: null }],
  ] as const)("etasje med %s = null avvises", async (_column, values) => {
    const org = await createOrganization("Oppdiktet takst A");
    const building = await createBuilding(org.id);
    await expectPgError(insertFloor(org.id, building.id, values), NOT_NULL);
  });

  it("etasje uten below_ground får standard false", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    const building = await createBuilding(org.id);
    const [row] = rowsOf(await insertFloor(org.id, building.id));
    expect(row!.below_ground).toBe(false);
  });

  it("areal uten floor_id avvises", async () => {
    const org = await createOrganization("Oppdiktet takst A");
    await expectPgError(insertArea(org.id, null), NOT_NULL);
  });

  it.each([
    ["floor_id", "floor_id"],
    ["room_type", "room_type"],
    ["area_type", "area_type"],
    ["below_ground", "below_ground"],
  ])("rom med %s = null avvises", async (_name, column) => {
    const floor = await createFloor((await createOrganization("Oppdiktet takst A")).id);
    await expectPgError(insertRoom(floor.organizationId, floor.id, { [column]: null }), NOT_NULL);
  });

  it("rom uten navn godtas (romtypens navn vises)", async () => {
    const floor = await createFloor((await createOrganization("Oppdiktet takst A")).id);
    const [row] = rowsOf(await insertRoom(floor.organizationId, floor.id, { name: null }));
    expect(row!.name).toBeNull();
  });

  it.each(["report_buildings", "floors", "floor_areas", "rooms"])(
    "%s får deleted_at = null og row_version = 1 som standard",
    async (table) => {
      const { org, assignment, buildingId, floorId } = await orgWithFloor("Oppdiktet takst A");
      const run =
        table === "report_buildings"
          ? insertBuilding(org.id, { assignment_id: assignment.id })
          : table === "floors"
            ? insertFloor(org.id, buildingId, { level: 2 })
            : table === "floor_areas"
              ? insertArea(org.id, floorId)
              : insertRoom(org.id, floorId);
      const [row] = rowsOf(await run);
      expect(row!.deleted_at).toBeNull();
      expect(row!.row_version).toBe(1);
      expect(row!.organization_id).toBe(org.id);
    },
  );
});

describe("3.7 tenant-tabellene", () => {
  const schemaValues: unknown[] = Object.values(schema);
  const tables = schemaValues.filter((value): value is PgTable => is(value, PgTable));
  const NAMES = ["report_buildings", "floors", "floor_areas", "rooms"] as const;

  it.each(NAMES)("%s finnes i skjemaet med organization_id og deleted_at", (name) => {
    const table = tables.find((candidate) => getTableName(candidate) === name);
    expect(table, `tabellen ${name} i skjemaet`).toBeDefined();
    const columns = Object.values(getTableColumns(table!)).map((column) => column.name);
    expect(columns).toEqual(
      expect.arrayContaining(["id", "organization_id", "deleted_at", "deleted_by", "row_version"]),
    );
  });

  it("report_buildings har ikke property_id (eiendommen finnes via oppdraget, A94)", () => {
    const table = tables.find((candidate) => getTableName(candidate) === "report_buildings");
    const columns = Object.values(getTableColumns(table!)).map((column) => column.name);
    expect(columns).toContain("assignment_id");
    expect(columns).not.toContain("property_id");
  });

  it.each(NAMES)(
    "%s står i tests/tenant-tables.ts med buildings.test.ts, og radbyggeren virker",
    async (name) => {
      const entry = tenantTables.find((candidate) => candidate.table === name);
      expect(entry, `${name} i tests/tenant-tables.ts`).toBeDefined();
      expect(entry!.testFile).toBe("src/core/buildings/buildings.test.ts");
      const org = await createOrganization("Oppdiktet takst A");
      const id = await entry!.insertRow(org.id);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      const [row] = rowsOf(
        await db.execute(sql`select organization_id from ${sql.raw(name)} where id = ${id}`),
      );
      expect(row!.organization_id).toBe(org.id);
    },
  );
});

describe("3.8 migreringen", () => {
  const dir = path.join(process.cwd(), "src/db/migrations");

  it("0018 finnes, er den eneste med nummeret, og lager de fire tabellene", () => {
    const files = readdirSync(dir).filter((name) => name.startsWith("0018_"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.sql$/);
    const text = readFileSync(path.join(dir, files[0]!), "utf8");
    for (const table of ["report_buildings", "floors", "floor_areas", "rooms"]) {
      expect(text, `0018 lager ${table}`).toMatch(new RegExp(`create table "?${table}"?`, "i"));
    }
  });

  it("ingen annen migrering lager de fire tabellene", () => {
    const others = readdirSync(dir).filter(
      (name) => name.endsWith(".sql") && !name.startsWith("0018_"),
    );
    for (const name of others) {
      const text = readFileSync(path.join(dir, name), "utf8");
      expect(text, name).not.toMatch(/create table "?(report_buildings|floor_areas|rooms)"?/i);
    }
  });
});
