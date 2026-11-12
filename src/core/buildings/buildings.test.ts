import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import {
  BuildingNotEmptyError,
  FloorNotEmptyError,
  getAssignmentBuildings,
  PropertyMissingError,
  removeBuilding,
  removeFloor,
  removeRoom,
  saveBuilding,
  saveFloor,
  saveFloorArea,
  saveRoom,
  suggestFloor,
  sumAssignmentArea,
} from "@/core/buildings";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  employees,
  events,
  organizations,
  properties,
  type EmployeeRole,
} from "@/db/schema";
import {
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
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";

/*
 * Bygninger, etasjer, areal per etasje og rom: kjernen i src/core/buildings.
 * Testplan: docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 4. 4.6.5 (feil i
 * hendelsen eller loggen ruller tilbake) står i buildings-transaction.test.ts.
 *
 * Signaturene er fra kortet punkt 7:
 * - getAssignmentBuildings(actor, organizationId, assignmentId) → { hasProperty, employees,
 *   buildings: [{ id, name, floors: [{ id, name, level, belowGround, area | null, rooms }] }] }
 *   og summene. Kortet sier ikke hva summene heter; `sumOf` finner objektet med braI, braE, braB
 *   og bra.
 * - saveBuilding(actor, organizationId, assignmentId, buildingId | null, input)
 * - saveFloor(actor, organizationId, buildingId, floorId | null, input)
 * - saveFloorArea(actor, organizationId, floorId, input)
 * - saveRoom(actor, organizationId, floorId, roomId | null, input)
 * - removeBuilding / removeFloor / removeRoom: kortet skriver «(...)». Testene bruker
 *   (actor, organizationId, id). Avviker utvikleren, rettes kallene ved sammenslåingen
 *   (typekontrollen viser hvor).
 * Returverdien fra lagringen brukes ikke; testene leser databasen.
 *
 * Input sendes som tekst der skjemaet på siden sender tekst (areal «123.4», etasjenummer «1»).
 *
 * Testdata er oppdiktet: «Bolighus», «Garasje test», «Kjeller», «1. etasje», «Rom test»,
 * «Målt langs innvendig vegg test», arealene 123.4, 56.7, 8.9 og 210.3.
 *
 * Støtter hovedmål: reklamasjoner (måler, metode og kommentar er sporbare, aldri data fra en
 * annen organisasjon, ingenting slettes, aldri navn eller arealtall i hendelser og logg), tid
 * (forslag til arealtype og «under terreng», «Målt av» settes selv, summene regnes ut) og KI
 * først (samme struktur som et senere forslag fra plantegning eller LiDAR kan fylle ut).
 */

beforeEach(resetDatabase);

const BUILDING_NAME = "Bolighus";
const GARAGE_NAME = "Garasje test";
const BASEMENT = "Kjeller";
const FIRST_FLOOR = "1. etasje";
const ROOM_NAME = "Rom test";
const COMMENT = "Målt langs innvendig vegg test";
const DELETED_AT = new Date("2026-11-03T09:00:00Z");
const SENSITIVE = [
  BUILDING_NAME,
  GARAGE_NAME,
  BASEMENT,
  FIRST_FLOOR,
  ROOM_NAME,
  "Målt langs innvendig vegg",
  "123.4",
  "56.7",
  "8.9",
  "210.3",
];

type BuildingInput = Parameters<typeof saveBuilding>[4];
type FloorInput = Parameters<typeof saveFloor>[4];
type AreaInput = Parameters<typeof saveFloorArea>[3];
type RoomInput = Parameters<typeof saveRoom>[4];

function buildingInput(overrides: Record<string, unknown> = {}): BuildingInput {
  return { name: BUILDING_NAME, ...overrides } as unknown as BuildingInput;
}

function floorInput(overrides: Record<string, unknown> = {}): FloorInput {
  return {
    name: FIRST_FLOOR,
    level: "1",
    belowGround: false,
    ...overrides,
  } as unknown as FloorInput;
}

function areaInput(overrides: Record<string, unknown> = {}): AreaInput {
  return {
    braI: "123.4",
    braE: "56.7",
    braB: "8.9",
    alh: "210.3",
    measuredBy: "",
    method: "laser",
    comment: COMMENT,
    ...overrides,
  } as unknown as AreaInput;
}

const EMPTY_AREA = {
  braI: "",
  braE: "",
  braB: "",
  alh: "",
  measuredBy: "",
  method: "",
  comment: "",
};

function roomInput(overrides: Record<string, unknown> = {}): RoomInput {
  return { roomType: "bathroom", name: ROOM_NAME, ...overrides } as unknown as RoomInput;
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Organisasjon med admin, ett kontor og ett oppdrag med eiendom. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id });
  const { property } = await createProperty(org.id, { assignmentId: assignment.id });
  return { org, admin, adminEmployee, office, assignment, property };
}

/** En person med rollene i organisasjonen. */
async function person(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor = await createUser(name ? { name } : {});
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/** Bygning med én etasje, areal og ett rom, direkte i databasen. */
async function tree(organizationId: string, assignmentId: string) {
  const building = await createBuilding(organizationId, { assignmentId, name: BUILDING_NAME });
  const floor = await createFloor(organizationId, { buildingId: building.id, name: FIRST_FLOOR });
  const area = await createFloorArea(organizationId, {
    floorId: floor.id,
    braI: 123.4,
    braE: 56.7,
    braB: 8.9,
    alh: 210.3,
    method: "laser",
    comment: COMMENT,
  });
  const room = await createRoom(organizationId, { floorId: floor.id, name: ROOM_NAME });
  return { building, floor, area, room };
}

const TABLES = ["report_buildings", "floors", "floor_areas", "rooms"] as const;
type TableName = (typeof TABLES)[number];
type DbRow = Record<string, unknown>;

async function rawRows(table: TableName, where = sql`true`): Promise<DbRow[]> {
  return (await db.execute(
    sql`select * from ${sql.identifier(table)} where ${where} order by id`,
  )) as unknown as DbRow[];
}

async function rowById(table: TableName, id: string): Promise<DbRow> {
  const [row] = await rawRows(table, sql`id = ${id}`);
  if (!row) throw new Error(`fant ikke raden i ${table}`);
  return row;
}

async function rowCount(table: TableName | "events" | "audit_log"): Promise<number> {
  if (table === "events") return (await db.select({ n: count() }).from(events))[0]?.n ?? 0;
  if (table === "audit_log") return (await db.select({ n: count() }).from(auditLog))[0]?.n ?? 0;
  return (await rawRows(table)).length;
}

async function tableCounts() {
  const counts: Record<string, number> = {};
  for (const table of [...TABLES, "events", "audit_log"] as const) {
    counts[table] = await rowCount(table);
  }
  return counts;
}

/** Alle radene i de fire tabellene for organisasjonen, som tekst (for «uendret»-sjekker). */
async function snapshot(organizationId: string): Promise<string> {
  const all: Record<string, DbRow[]> = {};
  for (const table of TABLES)
    all[table] = await rawRows(table, sql`organization_id = ${organizationId}`);
  return JSON.stringify(all);
}

async function eventsFor(organizationId: string, type?: string) {
  const rows = await db.select().from(events).where(eq(events.organizationId, organizationId));
  return rows.filter((row) => type === undefined || row.type === type);
}

async function auditFor(organizationId: string, entityType?: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, organizationId));
  return rows.filter((row) => entityType === undefined || row.entityType === entityType);
}

/** Fanger feilen fra en handling som skal feile. */
async function caught(run: Promise<unknown>): Promise<unknown> {
  return run.then(
    () => null,
    (error: unknown) => error,
  );
}

type Result = Awaited<ReturnType<typeof getAssignmentBuildings>>;
type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value as AnyRecord;
}

function buildingsOf(result: Result): AnyRecord[] {
  return asRecord(result).buildings as AnyRecord[];
}

function floorsOf(building: AnyRecord): AnyRecord[] {
  return building.floors as AnyRecord[];
}

function roomsOf(floor: AnyRecord): AnyRecord[] {
  return floor.rooms as AnyRecord[];
}

/** Alle id-er i svaret: bygninger, etasjer, arealrader og rom. */
function idsIn(result: Result): string[] {
  const ids: string[] = [];
  for (const building of buildingsOf(result)) {
    ids.push(building.id as string);
    for (const floor of floorsOf(building)) {
      ids.push(floor.id as string);
      const area = floor.area as AnyRecord | null;
      if (area && typeof area.id === "string") ids.push(area.id);
      for (const room of roomsOf(floor)) ids.push(room.id as string);
    }
  }
  return ids;
}

type Sum = { braI: number; braE: number; braB: number; bra: number };

function isSum(value: unknown): value is Sum {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return ["braI", "braE", "braB", "bra"].every((key) => keys.includes(key));
}

/** Summen på nivået (oppdrag, bygning eller etasje): objektet med braI, braE, braB og bra. */
function sumOf(level: unknown): Sum {
  const record = asRecord(level);
  for (const name of ["sum", "sums", "total", "totals", "areaSum", "areaTotal", "area"]) {
    if (isSum(record[name])) return record[name];
  }
  const found = Object.values(record).find(isSum);
  if (!found) throw new Error(`fant ingen sum (braI, braE, braB, bra) i ${Object.keys(record)}`);
  return found;
}

/** Alle nøkler i svaret, rekursivt. */
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys);
  } else if (typeof value === "object" && value !== null && !(value instanceof Date)) {
    for (const [key, inner] of Object.entries(value)) {
      keys.add(key);
      allKeys(inner, keys);
    }
  }
  return keys;
}

function expectNoSensitive(values: unknown[]) {
  const text = JSON.stringify(values);
  for (const value of SENSITIVE) expect(text, value).not.toContain(value);
}

/** Tidspunkt fra en rå rad (tekst eller `Date`) som millisekunder. */
function timeOf(value: unknown): number {
  return new Date(value as string | Date).getTime();
}

/** Ansatt-id-en til admin i organisasjonen (fra `expectTenantIsolation`). */
async function adminEmployeeIdOf(organizationId: string): Promise<string> {
  const [row] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  return row!.id;
}

/** Admin-aktøren i organisasjonen (fra `expectTenantIsolation`). */
async function adminActorOf(organizationId: string): Promise<Actor> {
  const [row] = await db
    .select({ userId: employees.userId, name: employees.name })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  return { id: row!.userId!, email: `${row!.userId}@example.com`, name: row!.name };
}

// ---------------------------------------------------------------------------------------------
// De sju skrivetjenestene, med et oppsett som gjør at hver av dem lykkes for en som har lov
// ---------------------------------------------------------------------------------------------

type WriteSetup = Awaited<ReturnType<typeof orgWithAdmin>> & {
  emptyBuildingId: string;
  emptyFloorId: string;
  floorId: string;
  roomId: string;
};

async function writeSetup(name?: string): Promise<WriteSetup> {
  const base = await orgWithAdmin(name);
  const emptyBuilding = await createBuilding(base.org.id, {
    assignmentId: base.assignment.id,
    name: GARAGE_NAME,
  });
  const building = await createBuilding(base.org.id, { assignmentId: base.assignment.id });
  const emptyFloor = await createFloor(base.org.id, { buildingId: building.id, name: BASEMENT });
  const floor = await createFloor(base.org.id, { buildingId: building.id });
  const room = await createRoom(base.org.id, { floorId: floor.id });
  return {
    ...base,
    emptyBuildingId: emptyBuilding.id,
    emptyFloorId: emptyFloor.id,
    floorId: floor.id,
    roomId: room.id,
  };
}

const WRITES = [
  "saveBuilding",
  "removeBuilding",
  "saveFloor",
  "removeFloor",
  "saveFloorArea",
  "saveRoom",
  "removeRoom",
] as const;
type WriteName = (typeof WRITES)[number];

function runWrite(name: WriteName, actor: Actor, organizationId: string, s: WriteSetup) {
  switch (name) {
    case "saveBuilding":
      return saveBuilding(actor, organizationId, s.assignment.id, null, buildingInput());
    case "removeBuilding":
      return removeBuilding(actor, organizationId, s.emptyBuildingId);
    case "saveFloor":
      return saveFloor(actor, organizationId, s.emptyBuildingId, null, floorInput());
    case "removeFloor":
      return removeFloor(actor, organizationId, s.emptyFloorId);
    case "saveFloorArea":
      return saveFloorArea(actor, organizationId, s.floorId, areaInput());
    case "saveRoom":
      return saveRoom(actor, organizationId, s.floorId, null, roomInput());
    case "removeRoom":
      return removeRoom(actor, organizationId, s.roomId);
  }
}

// ---------------------------------------------------------------------------------------------
// 4.1 Tilgang per rolle (innstillingen på og av)
// ---------------------------------------------------------------------------------------------

type RoleCase = { name: string; roles: EmployeeRole[] };

const ROLE_CASES: RoleCase[] = [
  { name: "takstmann", roles: ["inspector"] },
  { name: "kontor", roles: ["office"] },
  { name: "leder", roles: ["manager"] },
  { name: "admin", roles: ["admin"] },
];

const SETTINGS = [
  { setting: "på", editAll: true },
  { setting: "av", editAll: false },
] as const;

const MATRIX = SETTINGS.flatMap((s) => ROLE_CASES.map((r) => ({ ...r, ...s })));
const WRITE_ALLOWED = MATRIX.filter((c) => c.editAll || c.roles[0] !== "inspector");
const WRITE_MATRIX = WRITE_ALLOWED.flatMap((c) => WRITES.map((write) => ({ ...c, write })));

describe("4.1 tilgang per rolle", () => {
  it.each(MATRIX)(
    "4.1.1 $name med innstillingen $setting kan lese bygningene",
    async ({ roles, editAll }) => {
      const { org, assignment } = await orgWithAdmin();
      const { building } = await tree(org.id, assignment.id);
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);

      const result = await getAssignmentBuildings(actor, org.id, assignment.id);
      expect(buildingsOf(result).map((row) => row.id)).toEqual([building.id]);
    },
  );

  it.each(WRITE_MATRIX)(
    "4.1.2 $name med innstillingen $setting kan bruke $write",
    async ({ roles, editAll, write }) => {
      const s = await writeSetup();
      await setInspectorsEditAll(s.org.id, editAll);
      const { actor } = await person(s.org.id, roles);
      const before = await tableCounts();

      await runWrite(write, actor, s.org.id, s);

      const after = await tableCounts();
      expect(after.events, "en hendelse er skrevet").toBe(before.events! + 1);
      expect(after.audit_log, "en loggrad er skrevet").toBeGreaterThan(before.audit_log!);
    },
  );

  it.each(WRITES)(
    "4.1.2 takstmann med innstillingen av får AccessDeniedError på %s, og ingen tabell endres",
    async (write) => {
      const s = await writeSetup();
      await setInspectorsEditAll(s.org.id, false);
      const { actor } = await person(s.org.id, ["inspector"]);
      const before = await tableCounts();
      const rows = await snapshot(s.org.id);

      await expect(runWrite(write, actor, s.org.id, s)).rejects.toThrow(AccessDeniedError);

      expect(await tableCounts()).toEqual(before);
      expect(await snapshot(s.org.id)).toBe(rows);
    },
  );

  it.each(WRITES)(
    "4.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan bruke %s",
    async (write) => {
      const s = await writeSetup();
      await setInspectorsEditAll(s.org.id, false);
      const { actor, employee } = await person(s.org.id, ["inspector"]);
      await grantPermission(employee, "assignment.edit");

      await runWrite(write, actor, s.org.id, s);
      expect(await rowCount("events")).toBe(1);
    },
  );

  it("4.1.4 bruker uten ansattrad får AccessDeniedError på lesing og lagring", async () => {
    const s = await writeSetup();
    const stranger = await createUser();
    const before = await tableCounts();

    await expect(getAssignmentBuildings(stranger, s.org.id, s.assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(runWrite("saveBuilding", stranger, s.org.id, s)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await tableCounts()).toEqual(before);
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)(
    "4.1.4 %s ansatt (admin) får AccessDeniedError på lesing og lagring",
    async (_name, set) => {
      const s = await writeSetup();
      const { actor, employee } = await person(s.org.id, ["admin"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));
      const before = await tableCounts();

      await expect(getAssignmentBuildings(actor, s.org.id, s.assignment.id)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(runWrite("saveFloorArea", actor, s.org.id, s)).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await tableCounts()).toEqual(before);
    },
  );

  it("4.1.4 ansatt uten roller får AccessDeniedError på lesing og lagring", async () => {
    const s = await writeSetup();
    const { actor } = await person(s.org.id, []);
    await expect(getAssignmentBuildings(actor, s.org.id, s.assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(runWrite("saveRoom", actor, s.org.id, s)).rejects.toThrow(AccessDeniedError);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.5 admin uten andre roller og med innstillingen av kan lese og bruke alle sju skrivetjenestene", async () => {
    const s = await writeSetup();
    await setInspectorsEditAll(s.org.id, false);

    await getAssignmentBuildings(s.admin, s.org.id, s.assignment.id);
    // Fjerningene først, så lagringene (saveFloor bruker den tomme bygningen fra oppsettet)
    await runWrite("removeRoom", s.admin, s.org.id, s);
    await runWrite("removeFloor", s.admin, s.org.id, s);
    await runWrite("removeBuilding", s.admin, s.org.id, s);
    const result = await getAssignmentBuildings(s.admin, s.org.id, s.assignment.id);
    const ids = idsIn(result);
    expect(ids).not.toContain(s.emptyBuildingId);
    expect(ids).not.toContain(s.emptyFloorId);
    expect(ids).not.toContain(s.roomId);

    // De fire lagringene, hver på et nytt oppsett med admin og innstillingen av
    for (const write of ["saveBuilding", "saveFloor", "saveFloorArea", "saveRoom"] as const) {
      const fresh = await writeSetup();
      await setInspectorsEditAll(fresh.org.id, false);
      await runWrite(write, fresh.admin, fresh.org.id, fresh);
    }
    expect(await rowCount("events")).toBe(WRITES.length);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon (regel 2): åtte kall til expectTenantIsolation, ett per tjeneste
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 getAssignmentBuildings gir aldri bygning, etasje, areal eller rom fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgA = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        const ids: Record<string, string[]> = {};
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          await createProperty(grant.organizationId, { assignmentId: assignment.id });
          const { building, floor, room } = await tree(grant.organizationId, assignment.id);
          assignmentFor.set(grant.organizationId, assignment.id);
          // Arealradens id er ikke nødvendigvis med i svaret; den sjekkes under (Bs id-er)
          ids[grant.organizationId] = [building.id, floor.id, room.id];
        }
        return { a: ids[orgA]!, b: ids[orgB]! };
      },
      query: async (actor, organizationId) => {
        const result = await getAssignmentBuildings(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
        );
        return idsIn(result).map((id) => ({ id }));
      },
      idOf: (row) => row.id,
    });

    // Ingen av Bs id-er står i As svar
    const text = JSON.stringify(
      await getAssignmentBuildings(await adminActorOf(orgA), orgA, assignmentFor.get(orgA)!),
    );
    for (const table of TABLES) {
      for (const row of await rawRows(table, sql`organization_id = ${orgB}`)) {
        expect(text).not.toContain(row.id as string);
      }
    }
  });

  it("4.2.2 saveBuilding lagrer alltid i egen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgA = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          const assignment = await createAssignment(grant.organizationId);
          await createProperty(grant.organizationId, { assignmentId: assignment.id });
          assignmentFor.set(grant.organizationId, assignment.id);
        }
        return { a: [orgA], b: [orgB] };
      },
      query: async (actor, organizationId) => {
        const assignmentId = assignmentFor.get(organizationId) ?? randomUUID();
        await saveBuilding(actor, organizationId, assignmentId, null, buildingInput());
        return rawRows("report_buildings", sql`assignment_id = ${assignmentId}`);
      },
      idOf: (row) => row.organization_id as string,
    });

    for (const org of [orgA, orgB]) {
      const own = await rawRows("report_buildings", sql`organization_id = ${org}`);
      expect(own).toHaveLength(1);
      expect(own[0]!.assignment_id).toBe(assignmentFor.get(org));
      for (const row of await eventsFor(org)) expect(row.assignmentId).toBe(assignmentFor.get(org));
      for (const row of await auditFor(org)) expect(row.entityId).toBe(own[0]!.id);
    }
    expect(await rowCount("report_buildings")).toBe(2);
  });

  it("4.2.2 saveFloor lagrer alltid i egen organisasjon", async () => {
    const buildingFor = new Map<string, string>();
    const ids: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          const building = await createBuilding(grant.organizationId);
          buildingFor.set(grant.organizationId, building.id);
          ids.push(grant.organizationId);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const buildingId = buildingFor.get(organizationId) ?? randomUUID();
        await saveFloor(actor, organizationId, buildingId, null, floorInput());
        return rawRows("floors", sql`report_building_id = ${buildingId}`);
      },
      idOf: (row) => row.organization_id as string,
    });

    for (const org of ids) {
      const own = await rawRows("floors", sql`organization_id = ${org}`);
      expect(own).toHaveLength(1);
      expect(own[0]!.report_building_id).toBe(buildingFor.get(org));
      for (const row of await auditFor(org)) expect(row.entityId).toBe(own[0]!.id);
    }
    expect(await rowCount("floors")).toBe(2);
  });

  it("4.2.2 saveFloorArea lagrer alltid i egen organisasjon", async () => {
    const floorFor = new Map<string, string>();
    const orgs: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          floorFor.set(grant.organizationId, (await createFloor(grant.organizationId)).id);
          orgs.push(grant.organizationId);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const floorId = floorFor.get(organizationId) ?? randomUUID();
        await saveFloorArea(actor, organizationId, floorId, areaInput());
        return rawRows("floor_areas", sql`floor_id = ${floorId}`);
      },
      idOf: (row) => row.organization_id as string,
    });

    for (const org of orgs) {
      const own = await rawRows("floor_areas", sql`organization_id = ${org}`);
      expect(own).toHaveLength(1);
      expect(own[0]!.floor_id).toBe(floorFor.get(org));
      // «Målt av» er den innloggede i egen organisasjon
      const [measurer] = await db
        .select()
        .from(employees)
        .where(eq(employees.id, own[0]!.measured_by as string));
      expect(measurer!.organizationId).toBe(org);
    }
    expect(await rowCount("floor_areas")).toBe(2);
  });

  it("4.2.2 saveRoom lagrer alltid i egen organisasjon", async () => {
    const floorFor = new Map<string, string>();
    const orgs: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          floorFor.set(grant.organizationId, (await createFloor(grant.organizationId)).id);
          orgs.push(grant.organizationId);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const floorId = floorFor.get(organizationId) ?? randomUUID();
        await saveRoom(actor, organizationId, floorId, null, roomInput());
        return rawRows("rooms", sql`floor_id = ${floorId}`);
      },
      idOf: (row) => row.organization_id as string,
    });

    for (const org of orgs) {
      const own = await rawRows("rooms", sql`organization_id = ${org}`);
      expect(own).toHaveLength(1);
      expect(own[0]!.floor_id).toBe(floorFor.get(org));
      for (const row of await auditFor(org)) expect(row.entityId).toBe(own[0]!.id);
    }
    expect(await rowCount("rooms")).toBe(2);
  });

  /*
   * Fjerning: seed lager en tom rad og en rad som ikke skal røres i A og B. Hver admin fjerner
   * sin egen; forsøket mot den andre organisasjonen avvises. Etterpå er hver rad fjernet av egen
   * admin, og radene som ikke skulle røres, har deleted_at = null.
   */
  async function expectRemoveIsolation(
    table: TableName,
    make: (organizationId: string) => Promise<{ id: string }>,
    remove: (actor: Actor, organizationId: string, id: string) => Promise<unknown>,
  ) {
    const target = new Map<string, string>();
    const untouched: string[] = [];
    const orgs: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          target.set(grant.organizationId, (await make(grant.organizationId)).id);
          untouched.push((await make(grant.organizationId)).id);
          orgs.push(grant.organizationId);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const id = target.get(organizationId) ?? randomUUID();
        await remove(actor, organizationId, id);
        return rawRows(table, sql`id = ${id}`);
      },
      idOf: (row) => row.organization_id as string,
    });

    for (const org of orgs) {
      const removed = await rowById(table, target.get(org)!);
      expect(removed.deleted_at).not.toBeNull();
      // deleted_by er den ansattes id (samme som resten av kjernen, grant.employeeId)
      expect(removed.deleted_by).toBe(await adminEmployeeIdOf(org));
    }
    for (const id of untouched) expect((await rowById(table, id)).deleted_at).toBeNull();
  }

  it("4.2.3 removeBuilding fjerner bare i egen organisasjon", async () => {
    await expectRemoveIsolation(
      "report_buildings",
      (org) => createBuilding(org),
      (actor, org, id) => removeBuilding(actor, org, id),
    );
  });

  it("4.2.3 removeFloor fjerner bare i egen organisasjon", async () => {
    await expectRemoveIsolation(
      "floors",
      (org) => createFloor(org),
      (actor, org, id) => removeFloor(actor, org, id),
    );
  });

  it("4.2.3 removeRoom fjerner bare i egen organisasjon", async () => {
    await expectRemoveIsolation(
      "rooms",
      (org) => createRoom(org),
      (actor, org, id) => removeRoom(actor, org, id),
    );
  });

  it("4.2.4 employees og summene i getAssignmentBuildings tar aldri med ansatte eller rader fra B", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const { employee: inspectorA } = await person(a.org.id, ["inspector"], "Takstmann A");
    await tree(a.org.id, a.assignment.id);

    const expected = await getAssignmentBuildings(a.admin, a.org.id, a.assignment.id);

    // B får flere ansatte og bygninger med store arealtall, også på oppdrag med samme oppsett
    for (let i = 0; i < 3; i++) await person(b.org.id, ["inspector"], `Takstmann B${i}`);
    for (let i = 0; i < 2; i++) {
      const building = await createBuilding(b.org.id, { assignmentId: b.assignment.id });
      const floor = await createFloor(b.org.id, { buildingId: building.id });
      await createFloorArea(b.org.id, { floorId: floor.id, braI: 9999.9, braE: 9999.9 });
    }

    const result = await getAssignmentBuildings(a.admin, a.org.id, a.assignment.id);
    const list = asRecord(result).employees as { id: string; name: string }[];
    expect(list.map((row) => row.id).sort()).toEqual([a.adminEmployee.id, inspectorA.id].sort());
    for (const row of list) expect(Object.keys(row).sort()).toEqual(["id", "name"]);
    expect(JSON.stringify(list)).not.toContain("Takstmann B");
    expect(sumOf(result)).toEqual(sumOf(expected));
    expect(sumOf(result)).toEqual({ braI: 123.4, braE: 56.7, braB: 8.9, bra: 189 });
    expect(JSON.stringify(result)).not.toContain("9999.9");
  });

  it("4.2.4 employees har bare aktive ansatte (ikke deaktiverte eller slettede)", async () => {
    const a = await orgWithAdmin();
    const { employee: deactivated } = await person(a.org.id, ["inspector"], "Takstmann deaktivert");
    const { employee: deleted } = await person(a.org.id, ["inspector"], "Takstmann slettet");
    await db
      .update(employees)
      .set({ deactivatedAt: DELETED_AT })
      .where(eq(employees.id, deactivated.id));
    await db.update(employees).set({ deletedAt: DELETED_AT }).where(eq(employees.id, deleted.id));

    const result = await getAssignmentBuildings(a.admin, a.org.id, a.assignment.id);
    const list = asRecord(result).employees as { id: string }[];
    expect(list.map((row) => row.id)).toEqual([a.adminEmployee.id]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed, ukjent og ugyldig id", () => {
  async function twoOrgs() {
    const a = await writeSetup("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const treeB = await tree(b.org.id, b.assignment.id);
    const emptyBuildingB = await createBuilding(b.org.id, { assignmentId: b.assignment.id });
    const emptyFloorB = await createFloor(b.org.id, { buildingId: treeB.building.id });
    const { employee: employeeB } = await person(b.org.id, ["inspector"], "Takstmann B");
    return { a, b, treeB, emptyBuildingB, emptyFloorB, employeeB };
  }

  /** Kjører handlingen, venter AccessDeniedError, og viser at ingenting er endret. */
  async function expectDeniedWithoutChange(
    orgs: { a: WriteSetup; b: { org: { id: string } } },
    run: () => Promise<unknown>,
  ) {
    const counts = await tableCounts();
    const rowsA = await snapshot(orgs.a.org.id);
    const rowsB = await snapshot(orgs.b.org.id);
    await expect(run()).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(counts);
    expect(await snapshot(orgs.a.org.id)).toBe(rowsA);
    expect(await snapshot(orgs.b.org.id)).toBe(rowsB);
  }

  it("4.3.1 Bs oppdrags-id i getAssignmentBuildings og saveBuilding", async () => {
    const o = await twoOrgs();
    const { a, b } = o;
    await expectDeniedWithoutChange(o, () =>
      getAssignmentBuildings(a.admin, a.org.id, b.assignment.id),
    );
    await expectDeniedWithoutChange(o, () =>
      saveBuilding(a.admin, a.org.id, b.assignment.id, null, buildingInput()),
    );
  });

  it("4.3.2 Bs bygnings-id i saveBuilding, removeBuilding og saveFloor", async () => {
    const o = await twoOrgs();
    const { a, treeB, emptyBuildingB } = o;
    await expectDeniedWithoutChange(o, () =>
      saveBuilding(a.admin, a.org.id, a.assignment.id, treeB.building.id, buildingInput()),
    );
    await expectDeniedWithoutChange(o, () => removeBuilding(a.admin, a.org.id, emptyBuildingB.id));
    await expectDeniedWithoutChange(o, () =>
      saveFloor(a.admin, a.org.id, treeB.building.id, null, floorInput()),
    );
  });

  it("4.3.3 Bs etasje-id i saveFloor, removeFloor, saveFloorArea og saveRoom", async () => {
    const o = await twoOrgs();
    const { a, treeB, emptyFloorB } = o;
    await expectDeniedWithoutChange(o, () =>
      saveFloor(a.admin, a.org.id, a.emptyBuildingId, treeB.floor.id, floorInput()),
    );
    await expectDeniedWithoutChange(o, () => removeFloor(a.admin, a.org.id, emptyFloorB.id));
    await expectDeniedWithoutChange(o, () =>
      saveFloorArea(a.admin, a.org.id, treeB.floor.id, areaInput()),
    );
    await expectDeniedWithoutChange(o, () =>
      saveRoom(a.admin, a.org.id, treeB.floor.id, null, roomInput()),
    );
  });

  it("4.3.4 Bs rom-id i saveRoom og removeRoom", async () => {
    const o = await twoOrgs();
    const { a, treeB } = o;
    await expectDeniedWithoutChange(o, () =>
      saveRoom(a.admin, a.org.id, a.floorId, treeB.room.id, roomInput({ roomType: "garage" })),
    );
    await expectDeniedWithoutChange(o, () => removeRoom(a.admin, a.org.id, treeB.room.id));
  });

  it("4.3.5 Bs ansatt-id som «Målt av» i saveFloorArea", async () => {
    const o = await twoOrgs();
    const { a, employeeB } = o;
    await expectDeniedWithoutChange(o, () =>
      saveFloorArea(a.admin, a.org.id, a.floorId, areaInput({ measuredBy: employeeB.id })),
    );
  });

  it("4.3.6 bygning fra et annet oppdrag i A sammen med oppdrag X i saveBuilding", async () => {
    const o = await twoOrgs();
    const { a } = o;
    const other = await createAssignment(a.org.id, { officeId: a.office.id });
    await createProperty(a.org.id, { assignmentId: other.id });
    const foreign = await createBuilding(a.org.id, { assignmentId: other.id, name: GARAGE_NAME });
    await expectDeniedWithoutChange(o, () =>
      saveBuilding(a.admin, a.org.id, a.assignment.id, foreign.id, buildingInput()),
    );
    expect((await rowById("report_buildings", foreign.id)).assignment_id).toBe(other.id);
  });

  it("4.3.6 (utvidet) etasje fra en annen bygning i saveFloor, og rom fra en annen etasje i saveRoom", async () => {
    const o = await twoOrgs();
    const { a } = o;
    // a.floorId hører til en annen bygning enn a.emptyBuildingId; a.roomId til a.floorId
    await expectDeniedWithoutChange(o, () =>
      saveFloor(a.admin, a.org.id, a.emptyBuildingId, a.floorId, floorInput()),
    );
    await expectDeniedWithoutChange(o, () =>
      saveRoom(a.admin, a.org.id, a.emptyFloorId, a.roomId, roomInput()),
    );
  });

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])(
    "4.3.8 %s som id i hver tjeneste gir AccessDeniedError, aldri databasefeil",
    async (_name, id) => {
      const s = await writeSetup();
      const counts = await tableCounts();
      const calls: [string, () => Promise<unknown>][] = [
        ["getAssignmentBuildings", () => getAssignmentBuildings(s.admin, s.org.id, id)],
        [
          "saveBuilding (oppdrag)",
          () => saveBuilding(s.admin, s.org.id, id, null, buildingInput()),
        ],
        [
          "saveBuilding (bygning)",
          () => saveBuilding(s.admin, s.org.id, s.assignment.id, id, buildingInput()),
        ],
        ["removeBuilding", () => removeBuilding(s.admin, s.org.id, id)],
        ["saveFloor (bygning)", () => saveFloor(s.admin, s.org.id, id, null, floorInput())],
        [
          "saveFloor (etasje)",
          () => saveFloor(s.admin, s.org.id, s.emptyBuildingId, id, floorInput()),
        ],
        ["removeFloor", () => removeFloor(s.admin, s.org.id, id)],
        ["saveFloorArea", () => saveFloorArea(s.admin, s.org.id, id, areaInput())],
        [
          "saveFloorArea (Målt av)",
          () => saveFloorArea(s.admin, s.org.id, s.floorId, areaInput({ measuredBy: id })),
        ],
        ["saveRoom (etasje)", () => saveRoom(s.admin, s.org.id, id, null, roomInput())],
        ["saveRoom (rom)", () => saveRoom(s.admin, s.org.id, s.floorId, id, roomInput())],
        ["removeRoom", () => removeRoom(s.admin, s.org.id, id)],
      ];
      for (const [name, call] of calls) {
        const error = await caught(call());
        // «ikke-en-id» som «Målt av» kan også avvises av skjemaet (ZodError), aldri av databasen
        if (name === "saveFloorArea (Målt av)" && error instanceof ZodError) continue;
        expect(error, name).toBeInstanceOf(AccessDeniedError);
      }
      expect(await tableCounts()).toEqual(counts);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.4 Slettede id-er og myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.4 slettede id-er og myk sletting", () => {
  it("4.4.1 slettet oppdrag gir AccessDeniedError i getAssignmentBuildings og saveBuilding", async () => {
    const s = await writeSetup();
    await db
      .update(assignments)
      .set({ deletedAt: DELETED_AT })
      .where(eq(assignments.id, s.assignment.id));
    const counts = await tableCounts();

    await expect(getAssignmentBuildings(s.admin, s.org.id, s.assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveBuilding(s.admin, s.org.id, s.assignment.id, null, buildingInput()),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      saveBuilding(s.admin, s.org.id, s.assignment.id, s.emptyBuildingId, buildingInput()),
    ).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(counts);
  });

  const DELETED_CASES = [
    ["myk-slettet bygning i saveBuilding", "building", "saveBuilding"],
    ["myk-slettet bygning i removeBuilding", "building", "removeBuilding"],
    ["myk-slettet bygning i saveFloor", "building", "saveFloor"],
    ["myk-slettet etasje i saveFloor", "floor", "saveFloor"],
    ["myk-slettet etasje i removeFloor", "floor", "removeFloor"],
    ["myk-slettet etasje i saveFloorArea", "floor", "saveFloorArea"],
    ["myk-slettet etasje i saveRoom", "floor", "saveRoom"],
    ["myk-slettet rom i saveRoom", "room", "saveRoom"],
    ["myk-slettet rom i removeRoom", "room", "removeRoom"],
  ] as const;

  it.each(DELETED_CASES)("4.4.2 %s gir AccessDeniedError", async (_name, kind, service) => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, {
      assignmentId: assignment.id,
      deletedAt: kind === "building" ? DELETED_AT : null,
    });
    const floor = await createFloor(org.id, {
      buildingId: building.id,
      deletedAt: kind === "floor" ? DELETED_AT : null,
    });
    const room = await createRoom(org.id, {
      floorId: floor.id,
      deletedAt: kind === "room" ? DELETED_AT : null,
    });
    const counts = await tableCounts();
    const rows = await snapshot(org.id);

    const call = (() => {
      switch (service) {
        case "saveBuilding":
          return saveBuilding(admin, org.id, assignment.id, building.id, buildingInput());
        case "removeBuilding":
          return removeBuilding(admin, org.id, building.id);
        case "saveFloor":
          return kind === "building"
            ? saveFloor(admin, org.id, building.id, null, floorInput())
            : saveFloor(admin, org.id, building.id, floor.id, floorInput());
        case "removeFloor":
          return removeFloor(admin, org.id, floor.id);
        case "saveFloorArea":
          return saveFloorArea(admin, org.id, floor.id, areaInput());
        case "saveRoom":
          return kind === "room"
            ? saveRoom(admin, org.id, floor.id, room.id, roomInput())
            : saveRoom(admin, org.id, floor.id, null, roomInput());
        case "removeRoom":
          return removeRoom(admin, org.id, room.id);
      }
    })();
    await expect(call).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(counts);
    expect(await snapshot(org.id)).toBe(rows);
  });

  it("4.4.3 fjerning er myk: raden finnes med deleted_at og deleted_by, og vises ikke", async () => {
    const s = await writeSetup();
    await removeRoom(s.admin, s.org.id, s.roomId);
    await removeFloor(s.admin, s.org.id, s.emptyFloorId);
    await removeBuilding(s.admin, s.org.id, s.emptyBuildingId);

    for (const [table, id] of [
      ["rooms", s.roomId],
      ["floors", s.emptyFloorId],
      ["report_buildings", s.emptyBuildingId],
    ] as const) {
      const row = await rowById(table, id);
      expect(row.deleted_at, table).not.toBeNull();
      expect(row.deleted_by, table).toBe(s.adminEmployee.id);
    }
    const ids = idsIn(await getAssignmentBuildings(s.admin, s.org.id, s.assignment.id));
    expect(ids).not.toContain(s.roomId);
    expect(ids).not.toContain(s.emptyFloorId);
    expect(ids).not.toContain(s.emptyBuildingId);
  });

  it("4.4.4 fjerning av etasje myk-sletter arealraden; ingen rad slettes permanent", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    const area = await createFloorArea(org.id, { floorId: floor.id, braI: 123.4 });
    const before = await tableCounts();

    await removeFloor(admin, org.id, floor.id);

    const areaRow = await rowById("floor_areas", area.id);
    expect(areaRow.deleted_at).not.toBeNull();
    expect((await rowById("floors", floor.id)).deleted_at).not.toBeNull();
    const after = await tableCounts();
    for (const table of TABLES) expect(after[table], table).toBe(before[table]);
  });

  it("4.4.5 myk-slettet arealrad vises ikke (area = null), og saveFloorArea lager ny rad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    const old = await createFloorArea(org.id, {
      floorId: floor.id,
      braI: 56.7,
      deletedAt: DELETED_AT,
    });

    const result = await getAssignmentBuildings(admin, org.id, assignment.id);
    expect(floorsOf(buildingsOf(result)[0]!)[0]!.area).toBeNull();

    await saveFloorArea(admin, org.id, floor.id, areaInput());
    const rows = await rawRows("floor_areas", sql`floor_id = ${floor.id}`);
    expect(rows).toHaveLength(2);
    const active = rows.filter((row) => row.deleted_at === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).not.toBe(old.id);
    expect((await rowById("floor_areas", old.id)).bra_i).toBe("56.7");
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 Oppførsel
// ---------------------------------------------------------------------------------------------

describe("4.5 oppførsel", () => {
  it("4.5.1 ny bygning uten eiendom → PropertyMissingError, ingen rad, ingen hendelse", async () => {
    const org = await createOrganization();
    const admin = await createUser({ name: "Test Admin" });
    await createEmployee(admin, org.id, ["admin"]);
    const assignment = await createAssignment(org.id);

    const result = await getAssignmentBuildings(admin, org.id, assignment.id);
    expect(asRecord(result).hasProperty).toBe(false);
    await expect(saveBuilding(admin, org.id, assignment.id, null, buildingInput())).rejects.toThrow(
      PropertyMissingError,
    );
    expect(await tableCounts()).toEqual({
      report_buildings: 0,
      floors: 0,
      floor_areas: 0,
      rooms: 0,
      events: 0,
      audit_log: 0,
    });
  });

  it("4.5.2 eiendom myk-slettet etter at bygninger finnes: hasProperty = false, bygningene vises og kan endres og fjernes, ny bygning avvises", async () => {
    const { org, admin, assignment, property } = await orgWithAdmin();
    expect(asRecord(await getAssignmentBuildings(admin, org.id, assignment.id)).hasProperty).toBe(
      true,
    );
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const other = await createBuilding(org.id, { assignmentId: assignment.id, name: GARAGE_NAME });
    await db
      .update(properties)
      .set({ deletedAt: DELETED_AT })
      .where(eq(properties.id, property.id));

    const result = await getAssignmentBuildings(admin, org.id, assignment.id);
    expect(asRecord(result).hasProperty).toBe(false);
    // Rekkefølgen er ikke det som testes her (to rader kan få samme created_at).
    expect(
      buildingsOf(result)
        .map((row) => row.id)
        .sort(),
    ).toEqual([building.id, other.id].sort());

    await saveBuilding(admin, org.id, assignment.id, building.id, buildingInput({ name: "Hus" }));
    expect((await rowById("report_buildings", building.id)).name).toBe("Hus");
    await removeBuilding(admin, org.id, other.id);
    expect((await rowById("report_buildings", other.id)).deleted_at).not.toBeNull();

    const counts = await tableCounts();
    await expect(saveBuilding(admin, org.id, assignment.id, null, buildingInput())).rejects.toThrow(
      PropertyMissingError,
    );
    expect(await tableCounts()).toEqual(counts);
  });

  it("4.5.3 bygning med aktiv etasje → BuildingNotEmptyError; etasje med aktivt rom → FloorNotEmptyError", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { building, floor } = await tree(org.id, assignment.id);
    const counts = await tableCounts();
    const rows = await snapshot(org.id);

    await expect(removeBuilding(admin, org.id, building.id)).rejects.toThrow(BuildingNotEmptyError);
    await expect(removeFloor(admin, org.id, floor.id)).rejects.toThrow(FloorNotEmptyError);
    expect(await tableCounts()).toEqual(counts);
    expect(await snapshot(org.id)).toBe(rows);
  });

  it("4.5.3 med bare myk-slettede barn går fjerningen gjennom", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    await createRoom(org.id, { floorId: floor.id, deletedAt: DELETED_AT });
    await createFloor(org.id, { buildingId: building.id, deletedAt: DELETED_AT });

    await removeFloor(admin, org.id, floor.id);
    await removeBuilding(admin, org.id, building.id);
    expect((await rowById("report_buildings", building.id)).deleted_at).not.toBeNull();
  });

  it("4.5.4 sortering: bygninger og rom på created_at, så id; etasjer på level, så created_at, så id", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const same = new Date("2026-11-03T08:00:00Z");
    const earlier = new Date("2026-11-03T07:00:00Z");
    const later = new Date("2026-11-03T09:00:00Z");

    const b3 = await createBuilding(org.id, { assignmentId: assignment.id, createdAt: later });
    const b1 = await createBuilding(org.id, { assignmentId: assignment.id, createdAt: same });
    const b2 = await createBuilding(org.id, { assignmentId: assignment.id, createdAt: same });
    const b0 = await createBuilding(org.id, { assignmentId: assignment.id, createdAt: earlier });
    const tied = [b1.id, b2.id].sort();
    const expectedBuildings = [b0.id, ...tied, b3.id];

    const fUp = await createFloor(org.id, { buildingId: b0.id, level: 1, createdAt: earlier });
    const fGround = await createFloor(org.id, { buildingId: b0.id, level: 0, createdAt: later });
    const fDownLate = await createFloor(org.id, { buildingId: b0.id, level: -1, createdAt: later });
    const fDownA = await createFloor(org.id, { buildingId: b0.id, level: -1, createdAt: same });
    const fDownB = await createFloor(org.id, { buildingId: b0.id, level: -1, createdAt: same });
    const expectedFloors = [...[fDownA.id, fDownB.id].sort(), fDownLate.id, fGround.id, fUp.id];

    const r3 = await createRoom(org.id, { floorId: fUp.id, createdAt: later });
    const r1 = await createRoom(org.id, { floorId: fUp.id, createdAt: same });
    const r2 = await createRoom(org.id, { floorId: fUp.id, createdAt: same });
    const r0 = await createRoom(org.id, { floorId: fUp.id, createdAt: earlier });
    const expectedRooms = [r0.id, ...[r1.id, r2.id].sort(), r3.id];

    const result = await getAssignmentBuildings(admin, org.id, assignment.id);
    const buildings = buildingsOf(result);
    expect(buildings.map((row) => row.id)).toEqual(expectedBuildings);
    const floors = floorsOf(buildings[0]!);
    expect(floors.map((row) => row.id)).toEqual(expectedFloors);
    const upper = floors.find((row) => row.id === fUp.id)!;
    expect(roomsOf(upper).map((row) => row.id)).toEqual(expectedRooms);
  });

  describe("4.5.5 «Målt av»", () => {
    async function areaSetup() {
      const base = await orgWithAdmin();
      const building = await createBuilding(base.org.id, { assignmentId: base.assignment.id });
      const floor = await createFloor(base.org.id, { buildingId: building.id });
      return { ...base, floor };
    }

    async function activeArea(floorId: string) {
      const rows = await rawRows("floor_areas", sql`floor_id = ${floorId} and deleted_at is null`);
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    it("areal fylt ut uten «Målt av» → den innloggede ansatte", async () => {
      const { org, floor } = await areaSetup();
      const { actor, employee } = await person(org.id, ["office"]);
      await saveFloorArea(actor, org.id, floor.id, areaInput({ measuredBy: "" }));
      expect((await activeArea(floor.id)).measured_by).toBe(employee.id);
    });

    it("bare ett arealfelt fylt ut uten «Målt av» → den innloggede", async () => {
      const { org, admin, adminEmployee, floor } = await areaSetup();
      await saveFloorArea(admin, org.id, floor.id, areaInput({ ...EMPTY_AREA, alh: "210.3" }));
      expect((await activeArea(floor.id)).measured_by).toBe(adminEmployee.id);
    });

    it("alle felt tomme og «Målt av» tom → null", async () => {
      const { org, admin, floor } = await areaSetup();
      await saveFloorArea(admin, org.id, floor.id, areaInput(EMPTY_AREA));
      expect((await activeArea(floor.id)).measured_by).toBeNull();
    });

    it("ny aktiv ansatt i A lagres", async () => {
      const { org, admin, floor } = await areaSetup();
      const { employee } = await person(org.id, ["inspector"], "Takstmann måler");
      await saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: employee.id }));
      expect((await activeArea(floor.id)).measured_by).toBe(employee.id);
    });

    it("deaktivert ansatt som ny id → AccessDeniedError, ingenting endres", async () => {
      const { org, admin, adminEmployee, floor } = await areaSetup();
      await createFloorArea(org.id, {
        floorId: floor.id,
        braI: 123.4,
        measuredBy: adminEmployee.id,
      });
      const { employee } = await person(org.id, ["inspector"], "Takstmann deaktivert");
      await db
        .update(employees)
        .set({ deactivatedAt: DELETED_AT })
        .where(eq(employees.id, employee.id));
      const rows = await snapshot(org.id);

      await expect(
        saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: employee.id })),
      ).rejects.toThrow(AccessDeniedError);
      expect(await snapshot(org.id)).toBe(rows);
      expect(await rowCount("events")).toBe(0);
    });

    it("slettet ansatt som ny id → AccessDeniedError", async () => {
      const { org, admin, floor } = await areaSetup();
      const { employee } = await person(org.id, ["inspector"], "Takstmann slettet");
      await db
        .update(employees)
        .set({ deletedAt: DELETED_AT })
        .where(eq(employees.id, employee.id));
      await expect(
        saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: employee.id })),
      ).rejects.toThrow(AccessDeniedError);
      expect(await rowCount("floor_areas")).toBe(0);
    });

    it("deaktivert ansatt som samme id som før → godtas", async () => {
      const { org, admin, floor } = await areaSetup();
      const { employee } = await person(org.id, ["inspector"], "Takstmann tidligere");
      await createFloorArea(org.id, { floorId: floor.id, braI: 123.4, measuredBy: employee.id });
      await db
        .update(employees)
        .set({ deactivatedAt: DELETED_AT })
        .where(eq(employees.id, employee.id));

      await saveFloorArea(
        admin,
        org.id,
        floor.id,
        areaInput({ measuredBy: employee.id, comment: "Ny kommentar test" }),
      );
      const row = await activeArea(floor.id);
      expect(row.measured_by).toBe(employee.id);
      expect(row.comment).toBe("Ny kommentar test");
    });
  });

  it("4.5.6 rom uten arealtype og «under terreng» får forslagene; oppgitte verdier vinner", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const upper = await createFloor(org.id, { buildingId: building.id, level: 1 });
    const basement = await createFloor(org.id, {
      buildingId: building.id,
      name: BASEMENT,
      level: -1,
      belowGround: true,
    });

    await saveRoom(admin, org.id, upper.id, null, roomInput({ roomType: "garage", name: "" }));
    await saveRoom(admin, org.id, basement.id, null, roomInput({ roomType: "bathroom" }));
    await saveRoom(admin, org.id, upper.id, null, roomInput({ roomType: "basement_living_room" }));
    await saveRoom(
      admin,
      org.id,
      upper.id,
      null,
      roomInput({ roomType: "garage", areaType: "bra_i", belowGround: true }),
    );
    await saveRoom(
      admin,
      org.id,
      basement.id,
      null,
      roomInput({ roomType: "bathroom", belowGround: false }),
    );

    const rows = (await rawRows("rooms")).sort(
      // Rå tekst fra databasen har mikrosekunder og sorterer riktig som tekst
      (x, y) => String(x.created_at).localeCompare(String(y.created_at)),
    );
    const view = rows.map((row) => [row.room_type, row.area_type, row.below_ground]);
    expect(view).toEqual([
      ["garage", "bra_e", false],
      ["bathroom", "bra_i", true],
      ["basement_living_room", "bra_i", true],
      ["garage", "bra_i", true],
      ["bathroom", "bra_i", false],
    ]);
    expect(rows[0]!.name).toBeNull();
  });

  describe("4.5.7 ingen endring: samme verdier gir ingen hendelse, ingen loggrad og samme updated_at", () => {
    it.each(["bygning", "etasje", "areal", "rom"] as const)("%s", async (kind) => {
      const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
      let table: TableName;
      let save: () => Promise<unknown>;
      if (kind === "bygning") {
        table = "report_buildings";
        save = () => saveBuilding(admin, org.id, assignment.id, null, buildingInput());
        await save();
        const [row] = await rawRows(table);
        save = () => saveBuilding(admin, org.id, assignment.id, row!.id as string, buildingInput());
      } else if (kind === "etasje") {
        table = "floors";
        const building = await createBuilding(org.id, { assignmentId: assignment.id });
        await saveFloor(admin, org.id, building.id, null, floorInput());
        const [row] = await rawRows(table);
        save = () => saveFloor(admin, org.id, building.id, row!.id as string, floorInput());
      } else if (kind === "areal") {
        table = "floor_areas";
        const floor = await createFloor(org.id);
        const input = areaInput({ measuredBy: adminEmployee.id });
        save = () => saveFloorArea(admin, org.id, floor.id, input);
        await save();
      } else {
        table = "rooms";
        const floor = await createFloor(org.id);
        const input = roomInput({ areaType: "bra_i", belowGround: false });
        await saveRoom(admin, org.id, floor.id, null, input);
        const [row] = await rawRows(table);
        save = () => saveRoom(admin, org.id, floor.id, row!.id as string, input);
      }
      const [before] = await rawRows(table);
      const counts = await tableCounts();

      await save();

      const [after] = await rawRows(table);
      expect(await tableCounts()).toEqual(counts);
      expect(timeOf(after!.updated_at)).toBe(timeOf(before!.updated_at));
      expect(after!.row_version).toBe(before!.row_version);
    });
  });

  it("4.5.8 getAssignmentBuildings har faste felt uten deletedAt, rowVersion og organizationId; summene stemmer", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const { building } = await tree(org.id, assignment.id);
    const basement = await createFloor(org.id, {
      buildingId: building.id,
      name: BASEMENT,
      level: -1,
      belowGround: true,
    });
    await createFloorArea(org.id, { floorId: basement.id, braI: 56.7 });
    await createFloor(org.id, { buildingId: building.id, level: 2, name: "2. etasje" });
    const garage = await createBuilding(org.id, { assignmentId: assignment.id, name: GARAGE_NAME });
    const garageFloor = await createFloor(org.id, { buildingId: garage.id });
    await createFloorArea(org.id, { floorId: garageFloor.id, braE: 0.1, braB: 0.2 });

    const result = await getAssignmentBuildings(admin, org.id, assignment.id);
    const keys = allKeys(result);
    for (const forbidden of [
      "deletedAt",
      "deletedBy",
      "rowVersion",
      "organizationId",
      "deleted_at",
      "row_version",
      "organization_id",
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }
    expect(asRecord(result).hasProperty).toBe(true);

    const buildings = buildingsOf(result);
    expect(buildings.map((row) => row.name)).toEqual([BUILDING_NAME, GARAGE_NAME]);
    const floors = floorsOf(buildings[0]!);
    expect(floors.map((row) => [row.name, row.level, row.belowGround])).toEqual([
      [BASEMENT, -1, true],
      [FIRST_FLOOR, 1, false],
      ["2. etasje", 2, false],
    ]);
    expect(floors[2]!.area).toBeNull();
    expect(floors[1]!.area).toMatchObject({
      braI: 123.4,
      braE: 56.7,
      braB: 8.9,
      alh: 210.3,
      method: "laser",
      comment: COMMENT,
    });
    expect(roomsOf(floors[1]!)[0]).toMatchObject({
      roomType: "bathroom",
      name: ROOM_NAME,
      areaType: "bra_i",
      belowGround: false,
    });

    // Summene per etasje, bygning og oppdrag
    expect(sumOf(floors[1]!)).toEqual({ braI: 123.4, braE: 56.7, braB: 8.9, bra: 189 });
    expect(sumOf(buildings[0]!)).toEqual({ braI: 180.1, braE: 56.7, braB: 8.9, bra: 245.7 });
    expect(sumOf(buildings[1]!)).toEqual({ braI: 0, braE: 0.1, braB: 0.2, bra: 0.3 });
    expect(sumOf(result)).toEqual({ braI: 180.1, braE: 56.8, braB: 9.1, bra: 246 });
    expect(sumOf(result)).toEqual(sumAssignmentArea(buildings as never));
  });

  it.each([
    ["saveBuilding", "building"],
    ["saveFloor", "floor"],
    ["saveFloorArea", "area"],
    ["saveRoom", "room"],
  ] as const)(
    "4.5.9 valideringsfeil i %s gir ZodError, ingen rad og ingen hendelse",
    async (_n, kind) => {
      const s = await writeSetup();
      const counts = await tableCounts();
      const rows = await snapshot(s.org.id);
      const call =
        kind === "building"
          ? saveBuilding(s.admin, s.org.id, s.assignment.id, null, buildingInput({ name: " " }))
          : kind === "floor"
            ? saveFloor(s.admin, s.org.id, s.emptyBuildingId, null, floorInput({ level: "21" }))
            : kind === "area"
              ? saveFloorArea(s.admin, s.org.id, s.floorId, areaInput({ braI: "12.34" }))
              : saveRoom(s.admin, s.org.id, s.floorId, null, roomInput({ roomType: "villa" }));
      await expect(call).rejects.toBeInstanceOf(ZodError);
      expect(await tableCounts()).toEqual(counts);
      expect(await snapshot(s.org.id)).toBe(rows);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.6 Hendelser og revisjonslogg
// ---------------------------------------------------------------------------------------------

describe("4.6 hendelser og revisjonslogg", () => {
  it("4.6.1–4.6.2 bygning: building_saved med { buildingId, created }, så building_removed; logg report_building create, update, delete", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveBuilding(admin, org.id, assignment.id, null, buildingInput());
    const [row] = await rawRows("report_buildings");
    const id = row!.id as string;
    await saveBuilding(admin, org.id, assignment.id, id, buildingInput({ name: GARAGE_NAME }));
    await removeBuilding(admin, org.id, id);

    const saved = await eventsFor(org.id, "assignment.building_saved");
    expect(saved.map((event) => event.data)).toEqual([
      { buildingId: id, created: true },
      { buildingId: id, created: false },
    ]);
    for (const event of saved) expect(event.assignmentId).toBe(assignment.id);
    const [removed] = await eventsFor(org.id, "assignment.building_removed");
    expect(removed!.data).toMatchObject({ buildingId: id });
    expect(removed!.assignmentId).toBe(assignment.id);

    const audit = await auditFor(org.id, "report_building");
    expect(audit.map((entry) => `${entry.action}:${entry.entityId}`).sort()).toEqual(
      [`create:${id}`, `update:${id}`, `delete:${id}`].sort(),
    );
    const update = audit.find((entry) => entry.action === "update")!;
    expect(JSON.stringify(update.changes)).toContain("name");
  });

  it("4.6.1–4.6.2 etasje: floor_saved og floor_removed med { floorId, created }; logg floor", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    await saveFloor(admin, org.id, building.id, null, floorInput());
    const [row] = await rawRows("floors");
    const id = row!.id as string;
    await saveFloor(admin, org.id, building.id, id, floorInput({ level: "2" }));
    await removeFloor(admin, org.id, id);

    const saved = await eventsFor(org.id, "assignment.floor_saved");
    expect(saved.map((event) => event.data)).toEqual([
      { floorId: id, created: true },
      { floorId: id, created: false },
    ]);
    for (const event of saved) expect(event.assignmentId).toBe(assignment.id);
    const [removed] = await eventsFor(org.id, "assignment.floor_removed");
    expect(removed!.data).toMatchObject({ floorId: id });

    const audit = await auditFor(org.id, "floor");
    expect(audit.map((entry) => entry.action).sort()).toEqual(["create", "delete", "update"]);
    const update = audit.find((entry) => entry.action === "update")!;
    const text = JSON.stringify(update.changes);
    expect(text).toContain("level");
    expect(text).not.toContain(FIRST_FLOOR);
  });

  it("4.6.1–4.6.2 areal: floor_area_saved med { floorAreaId, created }; logg floor_area med feltnavn uten tall", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    await saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: adminEmployee.id }));
    const [row] = await rawRows("floor_areas");
    const id = row!.id as string;
    await saveFloorArea(
      admin,
      org.id,
      floor.id,
      areaInput({ measuredBy: adminEmployee.id, braI: "8.9", alh: "56.7" }),
    );

    const saved = await eventsFor(org.id, "assignment.floor_area_saved");
    expect(saved.map((event) => event.data)).toEqual([
      { floorAreaId: id, created: true },
      { floorAreaId: id, created: false },
    ]);
    for (const event of saved) expect(event.assignmentId).toBe(assignment.id);

    const audit = await auditFor(org.id, "floor_area");
    expect(audit.map((entry) => `${entry.action}:${entry.entityId}`).sort()).toEqual(
      [`create:${id}`, `update:${id}`].sort(),
    );
    const update = audit.find((entry) => entry.action === "update")!;
    const text = JSON.stringify(update.changes);
    expect(text).toMatch(/bra_?[iI]/);
    expect(text).toMatch(/alh/);
    expect(text).not.toMatch(/bra_?[eE]/);
  });

  it("4.6.1–4.6.2 rom: room_saved og room_removed med { roomId, created }; logg room med koden", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    await saveRoom(admin, org.id, floor.id, null, roomInput());
    const [row] = await rawRows("rooms");
    const id = row!.id as string;
    await saveRoom(admin, org.id, floor.id, id, roomInput({ roomType: "laundry" }));
    await removeRoom(admin, org.id, id);

    const saved = await eventsFor(org.id, "assignment.room_saved");
    expect(saved.map((event) => event.data)).toEqual([
      { roomId: id, created: true },
      { roomId: id, created: false },
    ]);
    for (const event of saved) expect(event.assignmentId).toBe(assignment.id);
    const [removed] = await eventsFor(org.id, "assignment.room_removed");
    expect(removed!.data).toMatchObject({ roomId: id });

    const audit = await auditFor(org.id, "room");
    expect(audit.map((entry) => entry.action).sort()).toEqual(["create", "delete", "update"]);
    const update = audit.find((entry) => entry.action === "update")!;
    expect(JSON.stringify(update.changes)).toMatch(/room_?[tT]ype/);
  });

  it("4.6.3 ingen navn, kommentar eller arealtall i events.data eller audit_log.changes, for alle sju skrivetjenestene", async () => {
    const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
    await saveBuilding(admin, org.id, assignment.id, null, buildingInput());
    const [building] = await rawRows("report_buildings");
    const buildingId = building!.id as string;
    await saveBuilding(
      admin,
      org.id,
      assignment.id,
      buildingId,
      buildingInput({ name: GARAGE_NAME }),
    );

    await saveFloor(admin, org.id, buildingId, null, floorInput({ name: BASEMENT, level: "-1" }));
    await saveFloor(admin, org.id, buildingId, null, floorInput());
    const floors = await rawRows("floors");
    const basement = floors.find((row) => row.name === BASEMENT)!.id as string;
    const upper = floors.find((row) => row.name === FIRST_FLOOR)!.id as string;
    await saveFloor(admin, org.id, buildingId, upper, floorInput({ name: `${FIRST_FLOOR} B` }));

    await saveFloorArea(admin, org.id, upper, areaInput());
    await saveFloorArea(
      admin,
      org.id,
      upper,
      areaInput({
        measuredBy: adminEmployee.id,
        braI: "56.7",
        braE: "123.4",
        comment: `${COMMENT} B`,
      }),
    );

    await saveRoom(admin, org.id, upper, null, roomInput());
    const [room] = await rawRows("rooms");
    await saveRoom(admin, org.id, upper, room!.id as string, roomInput({ name: `${ROOM_NAME} B` }));
    await removeRoom(admin, org.id, room!.id as string);
    await removeFloor(admin, org.id, basement);
    const other = await createBuilding(org.id, { assignmentId: assignment.id, name: GARAGE_NAME });
    await removeBuilding(admin, org.id, other.id);

    const allEvents = await eventsFor(org.id);
    const allAudit = await auditFor(org.id);
    expect(new Set(allEvents.map((row) => row.type))).toEqual(
      new Set([
        "assignment.building_saved",
        "assignment.building_removed",
        "assignment.floor_saved",
        "assignment.floor_removed",
        "assignment.floor_area_saved",
        "assignment.room_saved",
        "assignment.room_removed",
      ]),
    );
    expect(allAudit.length).toBeGreaterThanOrEqual(allEvents.length);
    expectNoSensitive([allEvents.map((row) => row.data), allAudit.map((row) => row.changes)]);
    for (const event of allEvents) {
      const keys = Object.keys(event.data).sort();
      expect(keys.includes("created") || keys.length === 1, JSON.stringify(keys)).toBe(true);
      for (const value of Object.values(event.data)) {
        expect(typeof value === "boolean" || /^[0-9a-f-]{36}$/.test(String(value))).toBe(true);
      }
    }
  });

  it("4.6.4 ingen hendelse ved avvist tilgang, valideringsfeil eller de tre kjente feilene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor: inspector } = await person(org.id, ["inspector"]);
    const { building, floor } = await tree(org.id, assignment.id);
    const noProperty = await createAssignment(org.id);

    await caught(saveBuilding(inspector, org.id, assignment.id, null, buildingInput()));
    await caught(saveBuilding(admin, org.id, assignment.id, null, buildingInput({ name: "" })));
    await caught(saveBuilding(admin, org.id, noProperty.id, null, buildingInput()));
    await caught(removeBuilding(admin, org.id, building.id));
    await caught(removeFloor(admin, org.id, floor.id));
    expect(await rowCount("events")).toBe(0);
    expect(await rowCount("audit_log")).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Svarene i bygningene (F6, F7): docs/funksjoner/fase2a-svar-regler-bygninger-testplan.md 6 og 7
// ---------------------------------------------------------------------------------------------

describe("B6.8 og T7.3 not_bra og to etasjer på -1", () => {
  const SAVERS = [
    { name: "admin", roles: ["admin"] as EmployeeRole[] },
    { name: "takstmann med access.inspectors_edit_all", roles: ["inspector"] as EmployeeRole[] },
  ];

  it.each(SAVERS)("$name lagrer og leser tilbake", async ({ roles }) => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, true);
    const actor = roles[0] === "admin" ? admin : (await person(org.id, roles)).actor;
    const building = await createBuilding(org.id, { assignmentId: assignment.id });

    const basement = await saveFloor(
      actor,
      org.id,
      building.id,
      null,
      floorInput({ name: BASEMENT, level: "-1", belowGround: true }),
    );
    const lower = await saveFloor(
      actor,
      org.id,
      building.id,
      null,
      floorInput({ name: "Underetasje", level: "-1", belowGround: true }),
    );
    await saveRoom(actor, org.id, basement.id, null, roomInput({ roomType: "crawl_space" }));
    await saveRoom(
      actor,
      org.id,
      lower.id,
      null,
      roomInput({ roomType: "unfinished_attic", areaType: "not_bra" }),
    );

    const result = await getAssignmentBuildings(actor, org.id, assignment.id);
    const floors = floorsOf(buildingsOf(result)[0]!);
    expect(floors.map((floor) => [floor.level, floor.belowGround])).toEqual([
      [-1, true],
      [-1, true],
    ]);
    const rooms = floors.flatMap((floor) => roomsOf(floor));
    expect(rooms.map((room) => [room.roomType, room.areaType]).sort()).toEqual([
      ["crawl_space", "not_bra"],
      ["unfinished_attic", "not_bra"],
    ]);
    // Kryperom i etasje under terreng er fortsatt under terreng (A239).
    expect(rooms.find((room) => room.roomType === "crawl_space")?.belowGround).toBe(true);
  });

  it("kryperom i etasje over terreng får not_bra og ikke «under terreng»", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id, level: 1 });
    await saveRoom(admin, org.id, floor.id, null, roomInput({ roomType: "crawl_space" }));
    const [row] = await rawRows("rooms");
    expect([row!.area_type, row!.below_ground]).toEqual(["not_bra", false]);
  });
});

describe("B6.9 etasjelisten har ikke myk-slettede etasjer", () => {
  it("slettet etasje 3 er borte fra listen, så «Loft» gir 3", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    await createFloor(org.id, { buildingId: building.id, level: 1 });
    await createFloor(org.id, { buildingId: building.id, level: 2, name: "2. etasje" });
    const third = await createFloor(org.id, { buildingId: building.id, level: 3, name: "Tredje" });
    await removeFloor(admin, org.id, third.id);

    const result = await getAssignmentBuildings(admin, org.id, assignment.id);
    const levels = floorsOf(buildingsOf(result)[0]!).map((floor) => floor.level as number);
    expect([...levels].sort()).toEqual([1, 2]);
    expect(suggestFloor("Loft", levels)).toEqual({ level: 3, belowGround: false });
    expect(await rawRows("floors")).toHaveLength(3);
  });
});
