import { randomUUID } from "node:crypto";
import { and, count, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { cancelAssignment } from "@/core/assignments";
import { recordAuditEvent } from "@/core/audit";
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
  sumAssignmentArea,
} from "@/core/buildings";
import { recordEvent } from "@/core/events";
import { db } from "@/db/client";
import {
  assignments,
  auditLog,
  employees,
  events,
  floorAreas,
  floors,
  organizations,
  properties,
  reportBuildings,
  rooms,
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
 * Bygninger, etasjer, areal per etasje og rom på oppdraget: kjernen i src/core/buildings.
 * Testplan: docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 4.
 *
 * Signaturene er fra kortet punkt 7:
 * - getAssignmentBuildings(actor, organizationId, assignmentId) → { hasProperty, employees,
 *   buildings: [{ id, name, floors: [{ id, name, level, belowGround, area | null, rooms }] }] }
 *   pluss summene per etasje, bygning og oppdrag.
 * - saveBuilding(actor, organizationId, assignmentId, buildingId | null, input)
 * - removeBuilding(actor, organizationId, buildingId)
 * - saveFloor(actor, organizationId, buildingId, floorId | null, input), removeFloor(…, floorId)
 * - saveFloorArea(actor, organizationId, floorId, input)
 * - saveRoom(actor, organizationId, floorId, roomId | null, input), removeRoom(…, roomId)
 * Kortet sier ikke hva summene heter i svaret; `sumsOf` finner dem under de vanlige navnene
 * (`sum`, `sums`, `total`, `totals`). Returverdien fra skrivingene brukes ikke; testene leser
 * databasen. Tallene fra `numeric(7,1)` sammenlignes med `Number(…)`, så tekst og tall godtas.
 *
 * Inndata sendes som tekst, slik skjemaet på siden sender dem («123,4», «-1»).
 *
 * Hendelse og logg i samme transaksjon (4.6.5) står her: `recordEvent` og `recordAuditEvent` er
 * pakket inn. De kaller den ekte funksjonen og kaster bare der testen ber om det.
 *
 * Testdata er oppdiktet: «Bolighus», «Garasje test», «Kjeller», «1. etasje», «Rom test»,
 * «Målt langs innvendig vegg test», arealtallene 123.4, 56.7, 8.9 og 210.3.
 *
 * Støtter hovedmål: reklamasjoner (aldri data fra en annen organisasjon, sporbar måler og metode,
 * summer uten regnefeil, ikke-tomme rader kan ikke fjernes), tid (forslag til arealtype og «under
 * terreng», «Målt av» settes selv) og KI først (faste koder; aldri navn, kommentar eller
 * arealtall i hendelser og logg).
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

const HOUSE = "Bolighus";
const GARAGE = "Garasje test";
const BASEMENT = "Kjeller";
const FIRST_FLOOR = "1. etasje";
const ROOM_NAME = "Rom test";
const COMMENT = "Målt langs innvendig vegg test";
const DELETED_AT = new Date("2026-11-03T09:00:00Z");
const T0 = new Date("2026-11-03T08:00:00Z");

type BuildingInput = Parameters<typeof saveBuilding>[4];
type FloorInput = Parameters<typeof saveFloor>[4];
type FloorAreaInput = Parameters<typeof saveFloorArea>[3];
type RoomInput = Parameters<typeof saveRoom>[4];

function buildingInput(overrides: Record<string, unknown> = {}): BuildingInput {
  return { name: HOUSE, ...overrides } as unknown as BuildingInput;
}

function floorInput(overrides: Record<string, unknown> = {}): FloorInput {
  return { name: BASEMENT, level: "-1", belowGround: true, ...overrides } as unknown as FloorInput;
}

function areaInput(overrides: Record<string, unknown> = {}): FloorAreaInput {
  return {
    braI: "123,4",
    braE: "56,7",
    braB: "8,9",
    alh: "210,3",
    measuredBy: "",
    method: "laser",
    comment: COMMENT,
    ...overrides,
  } as unknown as FloorAreaInput;
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

/** Organisasjon med admin og ett oppdrag med eiendom. */
async function orgWithAdmin(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id });
  await createProperty(org.id, { assignmentId: assignment.id });
  return { org, admin, adminEmployee, office, assignment };
}

/** En person med rollene i organisasjonen. */
async function person(organizationId: string, roles: EmployeeRole[], name?: string) {
  const actor = await createUser(name ? { name } : {});
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

/**
 * Bygning «Bolighus» med kjeller (under terreng, areal og ett rom), en tom etasje og en tom
 * bygning, på oppdraget. Satt inn med fabrikkene.
 */
async function fixture(organizationId: string, assignmentId: string) {
  const building = await createBuilding(organizationId, { assignmentId, name: HOUSE });
  const floor = await createFloor(organizationId, {
    buildingId: building.id,
    name: BASEMENT,
    level: -1,
    belowGround: true,
  });
  const area = await createFloorArea(organizationId, {
    floorId: floor.id,
    braI: 56.7,
    method: "laser",
    comment: COMMENT,
  });
  const room = await createRoom(organizationId, {
    floorId: floor.id,
    roomType: "basement_living_room",
    name: ROOM_NAME,
    belowGround: true,
  });
  const emptyFloor = await createFloor(organizationId, {
    buildingId: building.id,
    name: FIRST_FLOOR,
    level: 1,
  });
  const emptyBuilding = await createBuilding(organizationId, { assignmentId, name: GARAGE });
  return { building, floor, area, room, emptyFloor, emptyBuilding };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

type CountedTable =
  | typeof reportBuildings
  | typeof floors
  | typeof floorAreas
  | typeof rooms
  | typeof events
  | typeof auditLog;

async function rowCount(table: CountedTable) {
  const [row] = await db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

async function tableCounts() {
  return {
    buildings: await rowCount(reportBuildings),
    floors: await rowCount(floors),
    floorAreas: await rowCount(floorAreas),
    rooms: await rowCount(rooms),
    events: await rowCount(events),
    auditLog: await rowCount(auditLog),
  };
}

async function activeCounts() {
  const active = async (
    table: typeof reportBuildings | typeof floors | typeof floorAreas | typeof rooms,
  ) => {
    const [row] = await db.select({ n: count() }).from(table).where(isNull(table.deletedAt));
    return row?.n ?? 0;
  };
  return {
    buildings: await active(reportBuildings),
    floors: await active(floors),
    floorAreas: await active(floorAreas),
    rooms: await active(rooms),
  };
}

/** Alle radene i de fire tabellene for organisasjonen, som tekst (til «uendret»-sjekker). */
async function snapshot(organizationId: string) {
  const [b, f, a, r] = await Promise.all([
    db.select().from(reportBuildings).where(eq(reportBuildings.organizationId, organizationId)),
    db.select().from(floors).where(eq(floors.organizationId, organizationId)),
    db.select().from(floorAreas).where(eq(floorAreas.organizationId, organizationId)),
    db.select().from(rooms).where(eq(rooms.organizationId, organizationId)),
  ]);
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
  return JSON.stringify([b.sort(byId), f.sort(byId), a.sort(byId), r.sort(byId)]);
}

async function buildingRow(id: string) {
  const [row] = await db.select().from(reportBuildings).where(eq(reportBuildings.id, id));
  if (!row) throw new Error("fant ikke bygningen");
  return row;
}

async function floorRow(id: string) {
  const [row] = await db.select().from(floors).where(eq(floors.id, id));
  if (!row) throw new Error("fant ikke etasjen");
  return row;
}

async function roomRow(id: string) {
  const [row] = await db.select().from(rooms).where(eq(rooms.id, id));
  if (!row) throw new Error("fant ikke rommet");
  return row;
}

async function areaRowsFor(floorId: string) {
  return db.select().from(floorAreas).where(eq(floorAreas.floorId, floorId));
}

async function activeAreaFor(floorId: string) {
  const rows = (await areaRowsFor(floorId)).filter((row) => row.deletedAt === null);
  expect(rows.length, "høyst én aktiv arealrad").toBeLessThanOrEqual(1);
  return rows[0] ?? null;
}

async function buildingsFor(assignmentId: string) {
  return db.select().from(reportBuildings).where(eq(reportBuildings.assignmentId, assignmentId));
}

async function floorsFor(buildingId: string) {
  return db.select().from(floors).where(eq(floors.reportBuildingId, buildingId));
}

async function roomsFor(floorId: string) {
  return db.select().from(rooms).where(eq(rooms.floorId, floorId));
}

/** Den eneste aktive raden med navnet (bygning eller etasje), etter en lagring. */
async function newestBuilding(assignmentId: string, name: string) {
  const rows = (await buildingsFor(assignmentId)).filter(
    (row) => row.name === name && row.deletedAt === null,
  );
  expect(rows, `én aktiv bygning «${name}»`).toHaveLength(1);
  return rows[0]!;
}

async function newestFloor(buildingId: string, name: string) {
  const rows = (await floorsFor(buildingId)).filter(
    (row) => row.name === name && row.deletedAt === null,
  );
  expect(rows, `én aktiv etasje «${name}»`).toHaveLength(1);
  return rows[0]!;
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

/** Admin-aktøren i organisasjonen (fra `expectTenantIsolation`). */
async function adminActorOf(organizationId: string): Promise<Actor> {
  const [row] = await db
    .select({ userId: employees.userId, name: employees.name })
    .from(employees)
    .where(eq(employees.organizationId, organizationId));
  return { id: row!.userId!, email: `${row!.userId}@example.com`, name: row!.name };
}

// --- Svaret fra getAssignmentBuildings, lest løst (kortet låser ikke typene i detalj) ---

type Sums = { braI: number; braE: number; braB: number; bra: number };
type AreaView = {
  id: string;
  braI: unknown;
  braE: unknown;
  braB: unknown;
  alh: unknown;
  measuredBy: string | null;
  method: string | null;
  comment: string | null;
};
type RoomView = {
  id: string;
  roomType: string;
  name: string | null;
  areaType: string;
  belowGround: boolean;
};
type FloorView = {
  id: string;
  name: string;
  level: number;
  belowGround: boolean;
  area: AreaView | null;
  rooms: RoomView[];
};
type BuildingView = { id: string; name: string; floors: FloorView[] };
type View = {
  hasProperty: boolean;
  employees: { id: string; name: string }[];
  buildings: BuildingView[];
};

async function view(actor: Actor, organizationId: string, assignmentId: string): Promise<View> {
  return (await getAssignmentBuildings(actor, organizationId, assignmentId)) as unknown as View;
}

const SUM_KEYS = ["sum", "sums", "total", "totals", "areaSum", "areaSums", "areaTotal"] as const;

/** Summene på et nivå i svaret (oppdrag, bygning eller etasje), under et av de vanlige navnene. */
function sumsOf(value: unknown): Sums {
  const record = value as Record<string, unknown>;
  for (const key of SUM_KEYS) {
    const candidate = record[key] as Record<string, unknown> | undefined;
    if (candidate && typeof candidate === "object" && "bra" in candidate) {
      return {
        braI: Number(candidate.braI),
        braE: Number(candidate.braE),
        braB: Number(candidate.braB),
        bra: Number(candidate.bra),
      };
    }
  }
  throw new Error(`fant ikke summene i svaret (prøvde ${SUM_KEYS.join(", ")})`);
}

function allIds(result: View): string[] {
  return result.buildings.flatMap((building) => [
    building.id,
    ...building.floors.flatMap((floor) => [
      floor.id,
      ...(floor.area ? [floor.area.id] : []),
      ...floor.rooms.map((room) => room.id),
    ]),
  ]);
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

const WRITE_SERVICES = [
  "saveBuilding",
  "removeBuilding",
  "saveFloor",
  "removeFloor",
  "saveFloorArea",
  "saveRoom",
  "removeRoom",
] as const;
type WriteService = (typeof WRITE_SERVICES)[number];

/** Ett kall til skrivetjenesten mot radene i `fixture`. */
function callWrite(
  name: WriteService,
  actor: Actor,
  organizationId: string,
  assignmentId: string,
  t: Fixture,
): Promise<unknown> {
  switch (name) {
    case "saveBuilding":
      return saveBuilding(
        actor,
        organizationId,
        assignmentId,
        t.building.id,
        buildingInput({ name: "Bolighus endret" }),
      );
    case "removeBuilding":
      return removeBuilding(actor, organizationId, t.emptyBuilding.id);
    case "saveFloor":
      return saveFloor(
        actor,
        organizationId,
        t.building.id,
        null,
        floorInput({ name: "Loft", level: "2", belowGround: false }),
      );
    case "removeFloor":
      return removeFloor(actor, organizationId, t.emptyFloor.id);
    case "saveFloorArea":
      return saveFloorArea(actor, organizationId, t.floor.id, areaInput());
    case "saveRoom":
      return saveRoom(actor, organizationId, t.floor.id, null, roomInput({ roomType: "laundry" }));
    case "removeRoom":
      return removeRoom(actor, organizationId, t.room.id);
  }
}

/** Alle sju skrivetjenestene i en flyt, fra ny bygning til fjernet bygning. */
async function exerciseAllWrites(actor: Actor, organizationId: string, assignmentId: string) {
  await saveBuilding(actor, organizationId, assignmentId, null, buildingInput({ name: GARAGE }));
  const building = await newestBuilding(assignmentId, GARAGE);
  await saveBuilding(
    actor,
    organizationId,
    assignmentId,
    building.id,
    buildingInput({ name: "Garasje test 2" }),
  );
  expect((await buildingRow(building.id)).name).toBe("Garasje test 2");

  await saveFloor(
    actor,
    organizationId,
    building.id,
    null,
    floorInput({ name: FIRST_FLOOR, level: "1", belowGround: false }),
  );
  const floor = await newestFloor(building.id, FIRST_FLOOR);
  await saveFloorArea(actor, organizationId, floor.id, areaInput());
  expect(Number((await activeAreaFor(floor.id))?.braI)).toBe(123.4);

  await saveRoom(actor, organizationId, floor.id, null, roomInput());
  const [room] = await roomsFor(floor.id);
  expect(room).toBeDefined();

  await removeRoom(actor, organizationId, room!.id);
  await removeFloor(actor, organizationId, floor.id);
  await removeBuilding(actor, organizationId, building.id);
  expect((await buildingRow(building.id)).deletedAt).not.toBeNull();
}

describe("4.1 tilgang per rolle", () => {
  it.each(MATRIX)(
    "4.1.1 $name med innstillingen $setting kan lese bygningene",
    async ({ roles, editAll }) => {
      const { org, assignment } = await orgWithAdmin();
      const t = await fixture(org.id, assignment.id);
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);

      const result = await view(actor, org.id, assignment.id);
      expect(result.buildings.map((b) => b.id)).toEqual([t.building.id, t.emptyBuilding.id]);
    },
  );

  it.each(WRITE_ALLOWED)(
    "4.1.2 $name med innstillingen $setting kan bruke alle sju skrivetjenestene",
    async ({ roles, editAll }) => {
      const { org, assignment } = await orgWithAdmin();
      await setInspectorsEditAll(org.id, editAll);
      const { actor } = await person(org.id, roles);
      await exerciseAllWrites(actor, org.id, assignment.id);
    },
  );

  it.each(WRITE_SERVICES)(
    "4.1.2 takstmann med innstillingen av får AccessDeniedError på %s, og ingen tabell endres",
    async (name) => {
      const { org, assignment } = await orgWithAdmin();
      const t = await fixture(org.id, assignment.id);
      await setInspectorsEditAll(org.id, false);
      const { actor } = await person(org.id, ["inspector"]);
      const before = await tableCounts();
      const rowsBefore = await snapshot(org.id);

      await expect(callWrite(name, actor, org.id, assignment.id, t)).rejects.toThrow(
        AccessDeniedError,
      );

      expect(await tableCounts()).toEqual(before);
      expect(await snapshot(org.id)).toBe(rowsBefore);
    },
  );

  it("4.1.2 takstmann med innstillingen av kan fortsatt lese alt", async () => {
    const { org, assignment } = await orgWithAdmin();
    const t = await fixture(org.id, assignment.id);
    await setInspectorsEditAll(org.id, false);
    const { actor } = await person(org.id, ["inspector"]);

    const result = await view(actor, org.id, assignment.id);
    const house = result.buildings.find((b) => b.id === t.building.id)!;
    const basement = house.floors.find((f) => f.id === t.floor.id)!;
    expect(basement.area?.id).toBe(t.area.id);
    expect(basement.rooms.map((r) => r.id)).toEqual([t.room.id]);
  });

  it("4.1.3 takstmann med innstillingen av og enkeltrettigheten assignment.edit kan skrive", async () => {
    const { org, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);
    const { actor, employee } = await person(org.id, ["inspector"]);
    await grantPermission(employee, "assignment.edit");

    await exerciseAllWrites(actor, org.id, assignment.id);
  });

  it("4.1.4 bruker uten ansattrad får AccessDeniedError på lesing og lagring", async () => {
    const { org, assignment } = await orgWithAdmin();
    const stranger = await createUser();

    await expect(getAssignmentBuildings(stranger, org.id, assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveBuilding(stranger, org.id, assignment.id, null, buildingInput()),
    ).rejects.toThrow(AccessDeniedError);
    expect(await rowCount(reportBuildings)).toBe(0);
  });

  it.each([
    ["deaktivert", { deactivatedAt: new Date("2026-11-01T08:00:00Z") }],
    ["slettet", { deletedAt: new Date("2026-11-01T08:00:00Z") }],
  ] as const)(
    "4.1.4 %s ansatt (admin) får AccessDeniedError på lesing og lagring",
    async (_name, set) => {
      const { org, assignment } = await orgWithAdmin();
      const { actor, employee } = await person(org.id, ["admin"]);
      await db.update(employees).set(set).where(eq(employees.id, employee.id));

      await expect(getAssignmentBuildings(actor, org.id, assignment.id)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        saveBuilding(actor, org.id, assignment.id, null, buildingInput()),
      ).rejects.toThrow(AccessDeniedError);
      expect(await rowCount(reportBuildings)).toBe(0);
    },
  );

  it("4.1.4 ansatt uten roller får AccessDeniedError på lesing og lagring", async () => {
    const { org, assignment } = await orgWithAdmin();
    const { actor } = await person(org.id, []);
    await expect(getAssignmentBuildings(actor, org.id, assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(saveBuilding(actor, org.id, assignment.id, null, buildingInput())).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await rowCount(reportBuildings)).toBe(0);
  });

  // Regel 11: admin stenges aldri ute. Testen skal aldri fjernes.
  it("4.1.5 admin uten andre roller og med innstillingen av kan lese og bruke alle sju skrivetjenestene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await setInspectorsEditAll(org.id, false);

    expect((await view(admin, org.id, assignment.id)).buildings).toEqual([]);
    await exerciseAllWrites(admin, org.id, assignment.id);
    const t = await fixture(org.id, assignment.id);
    for (const name of WRITE_SERVICES) {
      await callWrite(name, admin, org.id, assignment.id, t);
    }
    expect((await view(admin, org.id, assignment.id)).buildings.map((b) => b.id)).toEqual([
      t.building.id,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.2 Tenant-isolasjon (regel 2): åtte kall til expectTenantIsolation, ett per tjeneste
// ---------------------------------------------------------------------------------------------

describe("4.2 tenant-isolasjon", () => {
  it("4.2.1 getAssignmentBuildings gir aldri bygninger, etasjer, areal eller rom fra en annen organisasjon", async () => {
    const assignmentFor = new Map<string, string>();
    let orgA = "";
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        const ids: Record<string, string[]> = {};
        for (const grant of [grantA, grantB]) {
          const orgId = grant.organizationId;
          const assignment = await createAssignment(orgId);
          await createProperty(orgId, { assignmentId: assignment.id });
          const t = await fixture(orgId, assignment.id);
          assignmentFor.set(orgId, assignment.id);
          ids[orgId] = [
            t.building.id,
            t.floor.id,
            t.area.id,
            t.room.id,
            t.emptyFloor.id,
            t.emptyBuilding.id,
          ];
        }
        return { a: ids[orgA]!, b: ids[orgB]! };
      },
      query: async (actor, organizationId) => {
        const result = await view(
          actor,
          organizationId,
          assignmentFor.get(organizationId) ?? randomUUID(),
        );
        return allIds(result).map((id) => ({ id }));
      },
      idOf: (row) => row.id,
    });

    // Ingen id fra B står noe sted i As svar
    const text = JSON.stringify(
      await getAssignmentBuildings(await adminActorOf(orgA), orgA, assignmentFor.get(orgA)!),
    );
    for (const row of await db
      .select()
      .from(reportBuildings)
      .where(eq(reportBuildings.organizationId, orgB))) {
      expect(text).not.toContain(row.id);
    }
  });

  it("4.2.2 saveBuilding lagrer alltid bygningen i egen organisasjon", async () => {
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
        return buildingsFor(assignmentId);
      },
      idOf: (row) => row.organizationId,
    });

    for (const org of [orgA, orgB]) {
      const own = await db
        .select()
        .from(reportBuildings)
        .where(eq(reportBuildings.organizationId, org));
      expect(own).toHaveLength(1);
      expect(own[0]!.assignmentId).toBe(assignmentFor.get(org));
      for (const row of await eventsFor(org)) expect(row.assignmentId).toBe(assignmentFor.get(org));
      expect((await auditFor(org)).length).toBeGreaterThan(0);
    }
    expect(await rowCount(reportBuildings)).toBe(2);
  });

  it("4.2.2 saveFloor lagrer alltid etasjen i egen organisasjon", async () => {
    const buildingFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          buildingFor.set(grant.organizationId, (await createBuilding(grant.organizationId)).id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const buildingId = buildingFor.get(organizationId) ?? randomUUID();
        await saveFloor(actor, organizationId, buildingId, null, floorInput());
        return floorsFor(buildingId);
      },
      idOf: (row) => row.organizationId,
    });

    const rowsB = await db.select().from(floors).where(eq(floors.organizationId, orgB));
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.reportBuildingId).toBe(buildingFor.get(orgB));
    expect(await rowCount(floors)).toBe(2);
  });

  it("4.2.2 saveFloorArea lagrer alltid arealet i egen organisasjon", async () => {
    const floorFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          floorFor.set(grant.organizationId, (await createFloor(grant.organizationId)).id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const floorId = floorFor.get(organizationId) ?? randomUUID();
        await saveFloorArea(actor, organizationId, floorId, areaInput());
        return areaRowsFor(floorId);
      },
      idOf: (row) => row.organizationId,
    });

    const rowsB = await db.select().from(floorAreas).where(eq(floorAreas.organizationId, orgB));
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.floorId).toBe(floorFor.get(orgB));
    // «Målt av» er Bs egen admin, ikke en ansatt i A
    const [measurer] = await db
      .select()
      .from(employees)
      .where(eq(employees.id, rowsB[0]!.measuredBy!));
    expect(measurer!.organizationId).toBe(orgB);
    expect(await rowCount(floorAreas)).toBe(2);
  });

  it("4.2.2 saveRoom lagrer alltid rommet i egen organisasjon", async () => {
    const floorFor = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          floorFor.set(grant.organizationId, (await createFloor(grant.organizationId)).id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const floorId = floorFor.get(organizationId) ?? randomUUID();
        await saveRoom(actor, organizationId, floorId, null, roomInput());
        return roomsFor(floorId);
      },
      idOf: (row) => row.organizationId,
    });

    const rowsB = await db.select().from(rooms).where(eq(rooms.organizationId, orgB));
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]!.floorId).toBe(floorFor.get(orgB));
    expect(await rowCount(rooms)).toBe(2);
  });

  it("4.2.3 removeBuilding fjerner bare i egen organisasjon", async () => {
    const buildingFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          buildingFor.set(grant.organizationId, (await createBuilding(grant.organizationId)).id);
        }
        return {
          a: [buildingFor.get(grantA.organizationId)!],
          b: [buildingFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => {
        const id = buildingFor.get(organizationId) ?? randomUUID();
        await removeBuilding(actor, organizationId, id);
        return [{ id }];
      },
      idOf: (row) => row.id,
    });
    expect(await rowCount(reportBuildings)).toBe(2);
  });

  it("4.2.3 removeFloor fjerner bare i egen organisasjon", async () => {
    const floorFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          floorFor.set(grant.organizationId, (await createFloor(grant.organizationId)).id);
        }
        return {
          a: [floorFor.get(grantA.organizationId)!],
          b: [floorFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => {
        const id = floorFor.get(organizationId) ?? randomUUID();
        await removeFloor(actor, organizationId, id);
        return [{ id }];
      },
      idOf: (row) => row.id,
    });
    expect(await rowCount(floors)).toBe(2);
  });

  it("4.2.3 removeRoom fjerner bare i egen organisasjon", async () => {
    const roomFor = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const grant of [grantA, grantB]) {
          roomFor.set(grant.organizationId, (await createRoom(grant.organizationId)).id);
        }
        return {
          a: [roomFor.get(grantA.organizationId)!],
          b: [roomFor.get(grantB.organizationId)!],
        };
      },
      query: async (actor, organizationId) => {
        const id = roomFor.get(organizationId) ?? randomUUID();
        await removeRoom(actor, organizationId, id);
        return [{ id }];
      },
      idOf: (row) => row.id,
    });
    expect(await rowCount(rooms)).toBe(2);
  });

  it("4.2.4 employees og summene i getAssignmentBuildings tar aldri med ansatte eller rader fra organisasjon B", async () => {
    const a = await orgWithAdmin("Organisasjon A");
    const { employee: inspectorA } = await person(a.org.id, ["inspector"], "Takstmann A test");
    const house = await createBuilding(a.org.id, { assignmentId: a.assignment.id });
    const floor = await createFloor(a.org.id, { buildingId: house.id });
    await createFloorArea(a.org.id, { floorId: floor.id, braI: 123.4, braE: 8.9, alh: 210.3 });

    const before = await view(a.admin, a.org.id, a.assignment.id);

    // B: flere ansatte og bygninger med store arealtall
    const b = await orgWithAdmin("Organisasjon B");
    const namesB = ["Ansatt B en test", "Ansatt B to test", "Ansatt B tre test"];
    const employeesB = [];
    for (const name of namesB)
      employeesB.push((await person(b.org.id, ["inspector"], name)).employee);
    for (let i = 0; i < 2; i++) {
      const building = await createBuilding(b.org.id, { assignmentId: b.assignment.id });
      const floorB = await createFloor(b.org.id, { buildingId: building.id });
      await createFloorArea(b.org.id, {
        floorId: floorB.id,
        braI: 9999.9,
        braE: 9999.9,
        braB: 9999.9,
        measuredBy: employeesB[i]!.id,
      });
    }

    const after = await view(a.admin, a.org.id, a.assignment.id);
    expect(after.employees.map((e) => e.id).sort()).toEqual(
      [a.adminEmployee.id, inspectorA.id].sort(),
    );
    for (const entry of after.employees) expect(Object.keys(entry).sort()).toEqual(["id", "name"]);
    const text = JSON.stringify(after);
    for (const name of namesB) expect(text).not.toContain(name);
    for (const employee of employeesB) expect(text).not.toContain(employee.id);
    expect(text).not.toContain("9999.9");

    expect(sumsOf(after)).toEqual(sumsOf(before));
    expect(sumsOf(after)).toEqual({ braI: 123.4, braE: 8.9, braB: 0, bra: 132.3 });
    expect(sumsOf(after.buildings[0])).toEqual(sumsOf(before.buildings[0]));
  });

  it("4.2.4 employees har bare aktive ansatte (ikke deaktiverte eller slettede)", async () => {
    const a = await orgWithAdmin();
    const { employee: active } = await person(a.org.id, ["inspector"], "Aktiv test");
    const { employee: deactivated } = await person(a.org.id, ["inspector"], "Deaktivert test");
    const { employee: deleted } = await person(a.org.id, ["inspector"], "Slettet test");
    await db
      .update(employees)
      .set({ deactivatedAt: DELETED_AT })
      .where(eq(employees.id, deactivated.id));
    await db.update(employees).set({ deletedAt: DELETED_AT }).where(eq(employees.id, deleted.id));

    const result = await view(a.admin, a.org.id, a.assignment.id);
    const ids = result.employees.map((e) => e.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(a.adminEmployee.id);
    expect(ids).not.toContain(deactivated.id);
    expect(ids).not.toContain(deleted.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.3 Fremmed id i egen organisasjon (IDOR)
// ---------------------------------------------------------------------------------------------

describe("4.3 fremmed, ukjent og ugyldig id", () => {
  async function twoOrgs() {
    const a = await orgWithAdmin("Organisasjon A");
    const b = await orgWithAdmin("Organisasjon B");
    const tA = await fixture(a.org.id, a.assignment.id);
    const tB = await fixture(b.org.id, b.assignment.id);
    const { employee: employeeB } = await person(b.org.id, ["inspector"], "Måler B test");
    return { a, b, tA, tB, employeeB };
  }

  /** Kallet gir AccessDeniedError, og ingenting i B (eller A) er endret. */
  async function expectDeniedWithoutChange(
    ctx: Awaited<ReturnType<typeof twoOrgs>>,
    run: () => Promise<unknown>,
  ) {
    const before = await tableCounts();
    const rowsA = await snapshot(ctx.a.org.id);
    const rowsB = await snapshot(ctx.b.org.id);
    await expect(run()).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(before);
    expect(await snapshot(ctx.a.org.id)).toBe(rowsA);
    expect(await snapshot(ctx.b.org.id)).toBe(rowsB);
  }

  it("4.3.1 Bs oppdrags-id i getAssignmentBuildings og saveBuilding", async () => {
    const ctx = await twoOrgs();
    const { a, b } = ctx;
    await expectDeniedWithoutChange(ctx, () =>
      getAssignmentBuildings(a.admin, a.org.id, b.assignment.id),
    );
    await expectDeniedWithoutChange(ctx, () =>
      saveBuilding(a.admin, a.org.id, b.assignment.id, null, buildingInput({ name: "Endret" })),
    );
  });

  it("4.3.2 Bs bygnings-id i saveBuilding, removeBuilding og saveFloor", async () => {
    const ctx = await twoOrgs();
    const { a, b, tB } = ctx;
    await expectDeniedWithoutChange(ctx, () =>
      saveBuilding(
        a.admin,
        a.org.id,
        a.assignment.id,
        tB.building.id,
        buildingInput({ name: "Endret" }),
      ),
    );
    await expectDeniedWithoutChange(ctx, () =>
      saveBuilding(
        a.admin,
        a.org.id,
        b.assignment.id,
        tB.building.id,
        buildingInput({ name: "Endret" }),
      ),
    );
    await expectDeniedWithoutChange(ctx, () =>
      removeBuilding(a.admin, a.org.id, tB.emptyBuilding.id),
    );
    await expectDeniedWithoutChange(ctx, () =>
      saveFloor(a.admin, a.org.id, tB.building.id, null, floorInput()),
    );
  });

  it("4.3.3 Bs etasje-id i saveFloor, removeFloor, saveFloorArea og saveRoom", async () => {
    const ctx = await twoOrgs();
    const { a, tA, tB } = ctx;
    await expectDeniedWithoutChange(ctx, () =>
      saveFloor(a.admin, a.org.id, tA.building.id, tB.floor.id, floorInput({ name: "Endret" })),
    );
    await expectDeniedWithoutChange(ctx, () =>
      saveFloor(a.admin, a.org.id, tB.building.id, tB.floor.id, floorInput({ name: "Endret" })),
    );
    await expectDeniedWithoutChange(ctx, () => removeFloor(a.admin, a.org.id, tB.emptyFloor.id));
    await expectDeniedWithoutChange(ctx, () =>
      saveFloorArea(a.admin, a.org.id, tB.floor.id, areaInput()),
    );
    await expectDeniedWithoutChange(ctx, () =>
      saveRoom(a.admin, a.org.id, tB.floor.id, null, roomInput()),
    );
  });

  it("4.3.4 Bs rom-id i saveRoom og removeRoom", async () => {
    const ctx = await twoOrgs();
    const { a, tA, tB } = ctx;
    await expectDeniedWithoutChange(ctx, () =>
      saveRoom(a.admin, a.org.id, tA.floor.id, tB.room.id, roomInput({ name: "Endret" })),
    );
    await expectDeniedWithoutChange(ctx, () =>
      saveRoom(a.admin, a.org.id, tB.floor.id, tB.room.id, roomInput({ name: "Endret" })),
    );
    await expectDeniedWithoutChange(ctx, () => removeRoom(a.admin, a.org.id, tB.room.id));
  });

  it("4.3.5 Bs ansatt-id som «Målt av» i saveFloorArea", async () => {
    const ctx = await twoOrgs();
    const { a, tA, employeeB, b } = ctx;
    await expectDeniedWithoutChange(ctx, () =>
      saveFloorArea(a.admin, a.org.id, tA.floor.id, areaInput({ measuredBy: employeeB.id })),
    );
    await expectDeniedWithoutChange(ctx, () =>
      saveFloorArea(a.admin, a.org.id, tA.floor.id, areaInput({ measuredBy: b.adminEmployee.id })),
    );
    // Også på en etasje uten areal fra før
    await expectDeniedWithoutChange(ctx, () =>
      saveFloorArea(a.admin, a.org.id, tA.emptyFloor.id, areaInput({ measuredBy: employeeB.id })),
    );
  });

  it("4.3.6 bygning fra et annet oppdrag i A sammen med oppdrag X gir AccessDeniedError", async () => {
    const ctx = await twoOrgs();
    const { a, tA } = ctx;
    const other = await createAssignment(a.org.id, { officeId: a.office.id });
    await createProperty(a.org.id, { assignmentId: other.id });
    await expectDeniedWithoutChange(ctx, () =>
      saveBuilding(a.admin, a.org.id, other.id, tA.building.id, buildingInput({ name: "Endret" })),
    );
  });

  it("4.3.6 etasje fra en annen bygning i A, og rom fra en annen etasje i A, gir AccessDeniedError", async () => {
    const ctx = await twoOrgs();
    const { a, tA } = ctx;
    await expectDeniedWithoutChange(ctx, () =>
      saveFloor(
        a.admin,
        a.org.id,
        tA.emptyBuilding.id,
        tA.floor.id,
        floorInput({ name: "Endret" }),
      ),
    );
    await expectDeniedWithoutChange(ctx, () =>
      saveRoom(a.admin, a.org.id, tA.emptyFloor.id, tA.room.id, roomInput({ name: "Endret" })),
    );
  });

  it("4.3.7 etter alle forsøkene: ingen hendelse eller loggrad i noen organisasjon", async () => {
    const { a, b, tB, employeeB, tA } = await twoOrgs();
    const attempts = [
      () => getAssignmentBuildings(a.admin, a.org.id, b.assignment.id),
      () => saveBuilding(a.admin, a.org.id, b.assignment.id, null, buildingInput()),
      () => removeBuilding(a.admin, a.org.id, tB.emptyBuilding.id),
      () => saveFloor(a.admin, a.org.id, tB.building.id, null, floorInput()),
      () => removeFloor(a.admin, a.org.id, tB.emptyFloor.id),
      () => saveFloorArea(a.admin, a.org.id, tB.floor.id, areaInput()),
      () => saveFloorArea(a.admin, a.org.id, tA.floor.id, areaInput({ measuredBy: employeeB.id })),
      () => saveRoom(a.admin, a.org.id, tB.floor.id, null, roomInput()),
      () => removeRoom(a.admin, a.org.id, tB.room.id),
    ];
    for (const attempt of attempts) {
      expect(await caught(attempt())).toBeInstanceOf(AccessDeniedError);
    }
    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
    expect((await buildingRow(tB.emptyBuilding.id)).deletedAt).toBeNull();
    expect((await floorRow(tB.emptyFloor.id)).deletedAt).toBeNull();
    expect((await roomRow(tB.room.id)).deletedAt).toBeNull();
  });

  const BAD_IDS = [
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
    ["tom tekst", ""],
  ] as const;

  it.each(BAD_IDS)(
    "4.3.8 %s som id i hver tjeneste gir AccessDeniedError, aldri databasefeil",
    async (_name, id) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const t = await fixture(org.id, assignment.id);
      const before = await tableCounts();
      const calls: [string, () => Promise<unknown>][] = [
        ["getAssignmentBuildings", () => getAssignmentBuildings(admin, org.id, id)],
        ["saveBuilding (oppdrag)", () => saveBuilding(admin, org.id, id, null, buildingInput())],
        [
          "saveBuilding (bygning)",
          () => saveBuilding(admin, org.id, assignment.id, id, buildingInput()),
        ],
        ["removeBuilding", () => removeBuilding(admin, org.id, id)],
        ["saveFloor (bygning)", () => saveFloor(admin, org.id, id, null, floorInput())],
        ["saveFloor (etasje)", () => saveFloor(admin, org.id, t.building.id, id, floorInput())],
        ["removeFloor", () => removeFloor(admin, org.id, id)],
        ["saveFloorArea", () => saveFloorArea(admin, org.id, id, areaInput())],
        ["saveRoom (etasje)", () => saveRoom(admin, org.id, id, null, roomInput())],
        ["saveRoom (rom)", () => saveRoom(admin, org.id, t.floor.id, id, roomInput())],
        ["removeRoom", () => removeRoom(admin, org.id, id)],
      ];
      for (const [name, call] of calls) {
        const error = await caught(call());
        expect(error, name).toBeInstanceOf(AccessDeniedError);
      }
      expect(await tableCounts()).toEqual(before);
    },
  );

  it.each([
    ["tilfeldig uuid", randomUUID()],
    ["ikke en id", "ikke-en-id"],
  ])(
    "4.3.8 %s som «Målt av» gir AccessDeniedError eller ZodError, aldri databasefeil",
    async (_name, id) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const t = await fixture(org.id, assignment.id);
      const error = await caught(
        saveFloorArea(admin, org.id, t.floor.id, areaInput({ measuredBy: id })),
      );
      expect(error instanceof AccessDeniedError || error instanceof ZodError, String(error)).toBe(
        true,
      );
      expect(Number((await activeAreaFor(t.floor.id))!.braI)).toBe(56.7);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 4.4 Slettede id-er og myk sletting
// ---------------------------------------------------------------------------------------------

describe("4.4 slettede id-er og myk sletting", () => {
  it("4.4.1 slettet oppdrag gir AccessDeniedError i getAssignmentBuildings og saveBuilding", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const t = await fixture(org.id, assignment.id);
    await db
      .update(assignments)
      .set({ deletedAt: DELETED_AT })
      .where(eq(assignments.id, assignment.id));

    await expect(getAssignmentBuildings(admin, org.id, assignment.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(saveBuilding(admin, org.id, assignment.id, null, buildingInput())).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      saveBuilding(admin, org.id, assignment.id, t.building.id, buildingInput({ name: "Endret" })),
    ).rejects.toThrow(AccessDeniedError);
    expect((await buildingRow(t.building.id)).name).toBe(HOUSE);
  });

  it("4.4.1b kansellert gjennom statustjenesten (A76): bygningene kan verken leses eller endres", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const t = await fixture(org.id, assignment.id);
    const [before] = await db
      .select({ status: assignments.status })
      .from(assignments)
      .where(eq(assignments.id, assignment.id));
    await cancelAssignment(admin, org.id, assignment.id, {
      expectedStatus: before!.status as "ordered" | "in_progress",
      reason: "Avbestilt av kunden test",
    });
    const cancelled = (
      await db.select().from(assignments).where(eq(assignments.id, assignment.id))
    )[0]!;
    expect(cancelled.deletedAt, "statustjenesten myk-sletter oppdraget").not.toBeNull();

    const rowsBefore = await snapshot(org.id);
    const countsBefore = await tableCounts();

    const calls: [string, () => Promise<unknown>][] = [
      ["getAssignmentBuildings", () => getAssignmentBuildings(admin, org.id, assignment.id)],
      ["saveBuilding ny", () => saveBuilding(admin, org.id, assignment.id, null, buildingInput())],
      [
        "saveBuilding eksisterende",
        () =>
          saveBuilding(
            admin,
            org.id,
            assignment.id,
            t.building.id,
            buildingInput({ name: "Endret" }),
          ),
      ],
      [
        "saveFloor",
        () => saveFloor(admin, org.id, t.building.id, null, floorInput({ name: "2. etasje" })),
      ],
      ["saveFloorArea", () => saveFloorArea(admin, org.id, t.floor.id, areaInput())],
      ["saveRoom", () => saveRoom(admin, org.id, t.floor.id, null, roomInput())],
      ["removeRoom", () => removeRoom(admin, org.id, t.room.id)],
    ];
    for (const [name, call] of calls) {
      expect(await caught(call()), name).toBeInstanceOf(AccessDeniedError);
    }

    expect(await snapshot(org.id), "radene i de fire tabellene er uendret").toBe(rowsBefore);
    expect(await tableCounts()).toEqual(countsBefore);
    expect((await roomRow(t.room.id)).deletedAt).toBeNull();
    expect((await buildingRow(t.building.id)).deletedAt).toBeNull();
  });

  type DeletedCase = [string, (ctx: Awaited<ReturnType<typeof deletedSetup>>) => Promise<unknown>];

  async function deletedSetup() {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, {
      assignmentId: assignment.id,
      deletedAt: DELETED_AT,
    });
    const liveBuilding = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: liveBuilding.id, deletedAt: DELETED_AT });
    const liveFloor = await createFloor(org.id, { buildingId: liveBuilding.id });
    const room = await createRoom(org.id, { floorId: liveFloor.id, deletedAt: DELETED_AT });
    return { org, admin, assignment, building, floor, room, liveFloor };
  }

  const DELETED_CASES: DeletedCase[] = [
    [
      "slettet bygning i saveBuilding",
      (c) =>
        saveBuilding(
          c.admin,
          c.org.id,
          c.assignment.id,
          c.building.id,
          buildingInput({ name: "Endret" }),
        ),
    ],
    ["slettet bygning i removeBuilding", (c) => removeBuilding(c.admin, c.org.id, c.building.id)],
    [
      "slettet bygning i saveFloor",
      (c) => saveFloor(c.admin, c.org.id, c.building.id, null, floorInput()),
    ],
    [
      "slettet etasje i saveFloor",
      (c) =>
        saveFloor(
          c.admin,
          c.org.id,
          c.floor.reportBuildingId,
          c.floor.id,
          floorInput({ name: "Endret" }),
        ),
    ],
    ["slettet etasje i removeFloor", (c) => removeFloor(c.admin, c.org.id, c.floor.id)],
    [
      "slettet etasje i saveFloorArea",
      (c) => saveFloorArea(c.admin, c.org.id, c.floor.id, areaInput()),
    ],
    [
      "slettet etasje i saveRoom",
      (c) => saveRoom(c.admin, c.org.id, c.floor.id, null, roomInput()),
    ],
    [
      "slettet rom i saveRoom",
      (c) => saveRoom(c.admin, c.org.id, c.liveFloor.id, c.room.id, roomInput({ name: "Endret" })),
    ],
    ["slettet rom i removeRoom", (c) => removeRoom(c.admin, c.org.id, c.room.id)],
  ];

  it.each(DELETED_CASES)(
    "4.4.2 %s gir AccessDeniedError, og ingenting endres",
    async (_name, run) => {
      const ctx = await deletedSetup();
      const before = await tableCounts();
      const rows = await snapshot(ctx.org.id);
      await expect(run(ctx)).rejects.toThrow(AccessDeniedError);
      expect(await tableCounts()).toEqual(before);
      expect(await snapshot(ctx.org.id)).toBe(rows);
    },
  );

  it("4.4.3 fjerning er myk: radene finnes med deleted_at og deleted_by, og vises ikke", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const t = await fixture(org.id, assignment.id);

    await removeRoom(admin, org.id, t.room.id);
    await removeFloor(admin, org.id, t.emptyFloor.id);
    await removeBuilding(admin, org.id, t.emptyBuilding.id);

    for (const row of [
      await roomRow(t.room.id),
      await floorRow(t.emptyFloor.id),
      await buildingRow(t.emptyBuilding.id),
    ]) {
      expect(row.deletedAt).not.toBeNull();
      expect(row.deletedBy).toBeTruthy();
    }

    const result = await view(admin, org.id, assignment.id);
    const ids = allIds(result);
    expect(ids).not.toContain(t.room.id);
    expect(ids).not.toContain(t.emptyFloor.id);
    expect(ids).not.toContain(t.emptyBuilding.id);
    expect(ids).toContain(t.building.id);
    expect(ids).toContain(t.floor.id);
  });

  it("4.4.4 fjerning av etasje myk-sletter arealraden; ingen rad slettes permanent", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    const area = await createFloorArea(org.id, { floorId: floor.id, braI: 123.4 });
    const before = await tableCounts();

    await removeFloor(admin, org.id, floor.id);

    const after = await tableCounts();
    expect({ ...after, events: 0, auditLog: 0 }).toEqual({ ...before, events: 0, auditLog: 0 });
    const [areaAfter] = await areaRowsFor(floor.id);
    expect(areaAfter!.id).toBe(area.id);
    expect(areaAfter!.deletedAt).not.toBeNull();
    expect(Number(areaAfter!.braI)).toBe(123.4);
    expect((await floorRow(floor.id)).deletedAt).not.toBeNull();
  });

  it("4.4.5 myk-slettet arealrad vises ikke (area = null), og saveFloorArea lager en ny rad", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    const old = await createFloorArea(org.id, {
      floorId: floor.id,
      braI: 8.9,
      deletedAt: DELETED_AT,
    });

    const result = await view(admin, org.id, assignment.id);
    expect(result.buildings[0]!.floors[0]!.area).toBeNull();

    await saveFloorArea(admin, org.id, floor.id, areaInput());
    const rows = await areaRowsFor(floor.id);
    expect(rows).toHaveLength(2);
    const active = rows.filter((row) => row.deletedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).not.toBe(old.id);
    const oldAfter = rows.find((row) => row.id === old.id)!;
    expect(Number(oldAfter.braI)).toBe(8.9);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.5 Oppførsel
// ---------------------------------------------------------------------------------------------

describe("4.5 oppførsel", () => {
  it("4.5.1 ny bygning uten eiendom gir PropertyMissingError med kortets tekst, og ingen rad", async () => {
    const { org, admin, office } = await orgWithAdmin();
    const noProperty = await createAssignment(org.id, { officeId: office.id });

    const error = await caught(saveBuilding(admin, org.id, noProperty.id, null, buildingInput()));
    expect(error).toBeInstanceOf(PropertyMissingError);
    expect((error as Error).message).toBe("Legg inn eiendommen før du legger til bygninger.");
    expect(await rowCount(reportBuildings)).toBe(0);
    expect(await rowCount(events)).toBe(0);
    expect((await view(admin, org.id, noProperty.id)).hasProperty).toBe(false);
  });

  it("4.5.2 eiendom myk-slettet etter at bygninger finnes: hasProperty = false, bygningene vises og kan endres og fjernes, ny bygning avvises", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const t = await fixture(org.id, assignment.id);
    expect((await view(admin, org.id, assignment.id)).hasProperty).toBe(true);

    const [row] = await db.select().from(assignments).where(eq(assignments.id, assignment.id));
    await db
      .update(properties)
      .set({ deletedAt: DELETED_AT })
      .where(eq(properties.id, row!.propertyId!));

    const result = await view(admin, org.id, assignment.id);
    expect(result.hasProperty).toBe(false);
    expect(result.buildings.map((b) => b.id)).toEqual([t.building.id, t.emptyBuilding.id]);

    await saveBuilding(
      admin,
      org.id,
      assignment.id,
      t.building.id,
      buildingInput({ name: "Bolighus endret" }),
    );
    expect((await buildingRow(t.building.id)).name).toBe("Bolighus endret");
    await removeBuilding(admin, org.id, t.emptyBuilding.id);
    expect((await buildingRow(t.emptyBuilding.id)).deletedAt).not.toBeNull();

    await expect(
      saveBuilding(admin, org.id, assignment.id, null, buildingInput({ name: GARAGE })),
    ).rejects.toThrow(PropertyMissingError);
    expect((await buildingsFor(assignment.id)).filter((b) => b.deletedAt === null)).toHaveLength(1);
  });

  it("4.5.3 bygning med aktiv etasje gir BuildingNotEmptyError; etasje med aktivt rom gir FloorNotEmptyError", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const t = await fixture(org.id, assignment.id);
    const before = await tableCounts();

    const buildingError = await caught(removeBuilding(admin, org.id, t.building.id));
    expect(buildingError).toBeInstanceOf(BuildingNotEmptyError);
    expect((buildingError as Error).message).toBe("Fjern etasjene først.");

    const floorError = await caught(removeFloor(admin, org.id, t.floor.id));
    expect(floorError).toBeInstanceOf(FloorNotEmptyError);
    expect((floorError as Error).message).toBe("Fjern rommene først.");

    expect(await tableCounts()).toEqual(before);
    expect((await buildingRow(t.building.id)).deletedAt).toBeNull();
    expect((await floorRow(t.floor.id)).deletedAt).toBeNull();
    expect((await activeAreaFor(t.floor.id))?.id).toBe(t.area.id);
  });

  it("4.5.3 med bare myk-slettede barn går fjerningen gjennom", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    await createRoom(org.id, { floorId: floor.id, deletedAt: DELETED_AT });
    await createFloor(org.id, {
      buildingId: building.id,
      name: "Loft",
      level: 2,
      deletedAt: DELETED_AT,
    });

    await removeFloor(admin, org.id, floor.id);
    await removeBuilding(admin, org.id, building.id);
    expect((await buildingRow(building.id)).deletedAt).not.toBeNull();
  });

  it("4.5.4 bygninger sorteres på created_at, så id (også med lik created_at)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const late = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: "Sist",
      createdAt: new Date(T0.getTime() + 60_000),
    });
    const sameA = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: "Lik A",
      createdAt: T0,
    });
    const sameB = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: "Lik B",
      createdAt: T0,
    });
    const sameC = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: "Lik C",
      createdAt: T0,
    });
    const early = await createBuilding(org.id, {
      assignmentId: assignment.id,
      name: "Først",
      createdAt: new Date(T0.getTime() - 60_000),
    });

    const same = [sameA, sameB, sameC].map((b) => b.id).sort();
    const result = await view(admin, org.id, assignment.id);
    expect(result.buildings.map((b) => b.id)).toEqual([early.id, ...same, late.id]);
  });

  it("4.5.4 etasjer sorteres på level, så created_at, så id", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const first = await createFloor(org.id, {
      buildingId: building.id,
      name: FIRST_FLOOR,
      level: 1,
      createdAt: T0,
    });
    const groundLate = await createFloor(org.id, {
      buildingId: building.id,
      name: "Sokkel sen",
      level: 0,
      createdAt: new Date(T0.getTime() + 60_000),
    });
    const groundEarly = await createFloor(org.id, {
      buildingId: building.id,
      name: "Sokkel tidlig",
      level: 0,
      createdAt: new Date(T0.getTime() + 30_000),
    });
    const basementA = await createFloor(org.id, {
      buildingId: building.id,
      name: "Kjeller A",
      level: -1,
      belowGround: true,
      createdAt: new Date(T0.getTime() + 90_000),
    });
    const basementB = await createFloor(org.id, {
      buildingId: building.id,
      name: "Kjeller B",
      level: -1,
      belowGround: true,
      createdAt: new Date(T0.getTime() + 90_000),
    });

    const basements = [basementA, basementB].map((f) => f.id).sort();
    const result = await view(admin, org.id, assignment.id);
    expect(result.buildings[0]!.floors.map((f) => f.id)).toEqual([
      ...basements,
      groundEarly.id,
      groundLate.id,
      first.id,
    ]);
  });

  it("4.5.4 rom sorteres på created_at, så id (også med lik created_at)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    const late = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "bedroom",
      createdAt: new Date(T0.getTime() + 60_000),
    });
    const sameA = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "bathroom",
      createdAt: T0,
    });
    const sameB = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "kitchen",
      createdAt: T0,
    });
    const early = await createRoom(org.id, {
      floorId: floor.id,
      roomType: "hallway",
      createdAt: new Date(T0.getTime() - 60_000),
    });

    const same = [sameA, sameB].map((r) => r.id).sort();
    const result = await view(admin, org.id, assignment.id);
    expect(result.buildings[0]!.floors[0]!.rooms.map((r) => r.id)).toEqual([
      early.id,
      ...same,
      late.id,
    ]);
  });

  describe("4.5.5 «Målt av»", () => {
    it("areal fylt ut uten «Målt av» gir den innloggede", async () => {
      const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });

      await saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: "" }));
      expect((await activeAreaFor(floor.id))!.measuredBy).toBe(adminEmployee.id);
    });

    it("bare ALH fylt ut regnes også som areal: den innloggede settes", async () => {
      const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });

      await saveFloorArea(admin, org.id, floor.id, {
        ...EMPTY_AREA,
        alh: "210,3",
      } as unknown as FloorAreaInput);
      expect((await activeAreaFor(floor.id))!.measuredBy).toBe(adminEmployee.id);
    });

    it("alle arealfelt tomme og «Målt av» tom gir null", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });

      await saveFloorArea(admin, org.id, floor.id, {
        ...EMPTY_AREA,
        method: "drawing",
        comment: COMMENT,
      } as unknown as FloorAreaInput);
      const row = await activeAreaFor(floor.id);
      if (row) {
        expect(row.measuredBy).toBeNull();
        expect([row.braI, row.braE, row.braB, row.alh]).toEqual([null, null, null, null]);
      }
    });

    it("ny aktiv ansatt i A lagres", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      const { employee } = await person(org.id, ["inspector"], "Måler test");

      await saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: employee.id }));
      expect((await activeAreaFor(floor.id))!.measuredBy).toBe(employee.id);
    });

    it.each([
      ["deaktivert", { deactivatedAt: DELETED_AT }],
      ["slettet", { deletedAt: DELETED_AT }],
    ] as const)(
      "%s ansatt som ny id gir AccessDeniedError, og raden er uendret",
      async (_name, set) => {
        const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
        const floor = await createFloor(org.id, {
          buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
        });
        const area = await createFloorArea(org.id, {
          floorId: floor.id,
          braI: 56.7,
          measuredBy: adminEmployee.id,
        });
        const { employee } = await person(org.id, ["inspector"], "Tidligere måler test");
        await db.update(employees).set(set).where(eq(employees.id, employee.id));
        const before = await tableCounts();

        await expect(
          saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: employee.id })),
        ).rejects.toThrow(AccessDeniedError);
        const row = await activeAreaFor(floor.id);
        expect(row!.id).toBe(area.id);
        expect(row!.measuredBy).toBe(adminEmployee.id);
        expect(Number(row!.braI)).toBe(56.7);
        expect(row!.rowVersion).toBe(area.rowVersion);
        expect(await tableCounts()).toEqual(before);
      },
    );

    it("deaktivert ansatt som ny id på etasje uten areal gir AccessDeniedError og ingen rad", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      const { employee } = await person(org.id, ["inspector"], "Tidligere måler test");
      await db
        .update(employees)
        .set({ deactivatedAt: DELETED_AT })
        .where(eq(employees.id, employee.id));

      await expect(
        saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: employee.id })),
      ).rejects.toThrow(AccessDeniedError);
      expect(await areaRowsFor(floor.id)).toHaveLength(0);
    });

    it("deaktivert ansatt som samme id som før godtas, og arealet kan endres", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      const { employee } = await person(org.id, ["inspector"], "Tidligere måler test");
      const area = await createFloorArea(org.id, {
        floorId: floor.id,
        braI: 56.7,
        measuredBy: employee.id,
        method: "laser",
      });
      await db
        .update(employees)
        .set({ deactivatedAt: DELETED_AT })
        .where(eq(employees.id, employee.id));

      await saveFloorArea(
        admin,
        org.id,
        floor.id,
        areaInput({ measuredBy: employee.id, braI: "123,4" }),
      );
      const row = await activeAreaFor(floor.id);
      expect(row!.id).toBe(area.id);
      expect(row!.measuredBy).toBe(employee.id);
      expect(Number(row!.braI)).toBe(123.4);
    });
  });

  describe("4.5.6 forslag for rom (A87)", () => {
    async function floorWith(belowGround: boolean) {
      const { org, admin, assignment } = await orgWithAdmin();
      const building = await createBuilding(org.id, { assignmentId: assignment.id });
      const floor = await createFloor(org.id, {
        buildingId: building.id,
        name: belowGround ? BASEMENT : FIRST_FLOOR,
        level: belowGround ? -1 : 1,
        belowGround,
      });
      return { org, admin, floor };
    }

    it.each([
      ["garage", false, "bra_e", false],
      ["external_storage", false, "bra_e", false],
      ["glazed_balcony", false, "bra_b", false],
      ["bathroom", false, "bra_i", false],
      ["bathroom", true, "bra_i", true],
      ["basement_living_room", false, "bra_i", true],
      ["crawl_space", true, "bra_i", true],
    ] as const)(
      "%s i etasje under terreng = %s uten arealtype og «under terreng» gir %s og %s",
      async (roomType, floorBelow, areaType, belowGround) => {
        const { org, admin, floor } = await floorWith(floorBelow);
        await saveRoom(admin, org.id, floor.id, null, { roomType } as unknown as RoomInput);
        const [room] = await roomsFor(floor.id);
        expect(room).toMatchObject({ roomType, areaType, belowGround, name: null });
      },
    );

    it("oppgitte verdier vinner over forslaget", async () => {
      const { org, admin, floor } = await floorWith(true);
      await saveRoom(
        admin,
        org.id,
        floor.id,
        null,
        roomInput({ roomType: "garage", areaType: "bra_i", belowGround: false }),
      );
      const [room] = await roomsFor(floor.id);
      expect(room).toMatchObject({ roomType: "garage", areaType: "bra_i", belowGround: false });
    });
  });

  describe("4.5.7 lagring uten endring gir ingen hendelse, ingen loggrad og samme updated_at", () => {
    async function expectNoChange(
      run: () => Promise<unknown>,
      read: () => Promise<{ updatedAt: Date; rowVersion: number }>,
    ) {
      const before = await tableCounts();
      const rowBefore = await read();
      await run();
      expect(await tableCounts()).toEqual(before);
      const rowAfter = await read();
      expect(rowAfter.updatedAt.toISOString()).toBe(rowBefore.updatedAt.toISOString());
      expect(rowAfter.rowVersion).toBe(rowBefore.rowVersion);
    }

    it("bygning", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      await saveBuilding(admin, org.id, assignment.id, null, buildingInput());
      const building = await newestBuilding(assignment.id, HOUSE);
      await expectNoChange(
        () =>
          saveBuilding(
            admin,
            org.id,
            assignment.id,
            building.id,
            buildingInput({ name: ` ${HOUSE} ` }),
          ),
        () => buildingRow(building.id),
      );
    });

    it("etasje", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const building = await createBuilding(org.id, { assignmentId: assignment.id });
      await saveFloor(admin, org.id, building.id, null, floorInput());
      const floor = await newestFloor(building.id, BASEMENT);
      await expectNoChange(
        () => saveFloor(admin, org.id, building.id, floor.id, floorInput()),
        () => floorRow(floor.id),
      );
    });

    it("areal (med komma og punktum om hverandre)", async () => {
      const { org, admin, adminEmployee, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      await saveFloorArea(admin, org.id, floor.id, areaInput({ measuredBy: adminEmployee.id }));
      const area = (await activeAreaFor(floor.id))!;
      await expectNoChange(
        () =>
          saveFloorArea(
            admin,
            org.id,
            floor.id,
            areaInput({ measuredBy: adminEmployee.id, braI: "123.4", braE: "56.7" }),
          ),
        async () => (await activeAreaFor(floor.id)) ?? area,
      );
    });

    it("areal med «Målt av» tom etter første lagring (den innloggede står fortsatt)", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      await saveFloorArea(admin, org.id, floor.id, areaInput());
      const area = (await activeAreaFor(floor.id))!;
      await expectNoChange(
        () => saveFloorArea(admin, org.id, floor.id, areaInput()),
        async () => (await activeAreaFor(floor.id)) ?? area,
      );
    });

    it("rom", async () => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      await saveRoom(admin, org.id, floor.id, null, roomInput());
      const [room] = await roomsFor(floor.id);
      await expectNoChange(
        () =>
          saveRoom(
            admin,
            org.id,
            floor.id,
            room!.id,
            roomInput({ areaType: room!.areaType, belowGround: room!.belowGround }),
          ),
        () => roomRow(room!.id),
      );
    });
  });

  it("4.5.8 getAssignmentBuildings har faste felt uten deletedAt, rowVersion og organizationId, og summene stemmer", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const house = await createBuilding(org.id, { assignmentId: assignment.id, name: HOUSE });
    const basement = await createFloor(org.id, {
      buildingId: house.id,
      name: BASEMENT,
      level: -1,
      belowGround: true,
    });
    const first = await createFloor(org.id, { buildingId: house.id, name: FIRST_FLOOR, level: 1 });
    await createFloorArea(org.id, { floorId: basement.id, braI: 56.7, alh: 210.3 });
    await createFloorArea(org.id, { floorId: first.id, braI: 123.4 });
    await createRoom(org.id, { floorId: first.id, roomType: "bathroom" });
    const garage = await createBuilding(org.id, { assignmentId: assignment.id, name: GARAGE });
    const garageFloor = await createFloor(org.id, { buildingId: garage.id });
    await createFloorArea(org.id, { floorId: garageFloor.id, braE: 0.1, braB: 0.2 });

    const raw = await getAssignmentBuildings(admin, org.id, assignment.id);
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object" && !(value instanceof Date)) {
        for (const [key, inner] of Object.entries(value)) {
          keys.add(key);
          walk(inner);
        }
      }
    };
    walk(raw);
    for (const forbidden of ["deletedAt", "deletedBy", "rowVersion", "organizationId"]) {
      expect(keys.has(forbidden), forbidden).toBe(false);
    }

    const result = raw as unknown as View;
    expect(result.hasProperty).toBe(true);
    const [houseView, garageView] = result.buildings;
    expect(houseView!.name).toBe(HOUSE);
    expect(houseView!.floors.map((f) => [f.name, f.level, f.belowGround])).toEqual([
      [BASEMENT, -1, true],
      [FIRST_FLOOR, 1, false],
    ]);
    expect(Number(houseView!.floors[0]!.area!.alh)).toBe(210.3);
    expect(houseView!.floors[1]!.rooms[0]).toMatchObject({
      roomType: "bathroom",
      areaType: "bra_i",
      belowGround: false,
    });

    expect(sumsOf(houseView!.floors[0])).toEqual({ braI: 56.7, braE: 0, braB: 0, bra: 56.7 });
    expect(sumsOf(houseView)).toEqual({ braI: 180.1, braE: 0, braB: 0, bra: 180.1 });
    expect(sumsOf(garageView)).toEqual({ braI: 0, braE: 0.1, braB: 0.2, bra: 0.3 });
    expect(sumsOf(result)).toEqual({ braI: 180.1, braE: 0.1, braB: 0.2, bra: 180.4 });
    const expected = sumAssignmentArea(
      result.buildings as unknown as Parameters<typeof sumAssignmentArea>[0],
    );
    expect(sumsOf(result)).toEqual(sumsOf({ sum: expected }));
  });

  it("4.5.8 etasje uten areal har area = null og summen 0", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    await createFloor(org.id, { buildingId: building.id });

    const result = await view(admin, org.id, assignment.id);
    expect(result.buildings[0]!.floors[0]!.area).toBeNull();
    expect(sumsOf(result.buildings[0]!.floors[0])).toEqual({ braI: 0, braE: 0, braB: 0, bra: 0 });
    expect(sumsOf(result).bra).toBe(0);
  });

  it.each([
    ["tomt bygningsnavn", () => ({ kind: "building", input: buildingInput({ name: " " }) })],
    [
      "fødselsnummer i bygningsnavnet",
      () => ({ kind: "building", input: buildingInput({ name: "Bolighus 12345678901" }) }),
    ],
    ["etasje −4", () => ({ kind: "floor", input: floorInput({ level: "-4" }) })],
    ["areal med to desimaler", () => ({ kind: "area", input: areaInput({ braI: "12,34" }) })],
    ["negativt areal", () => ({ kind: "area", input: areaInput({ braE: "-0,1" }) })],
    ["ukjent metode", () => ({ kind: "area", input: areaInput({ method: "lidar" }) })],
    ["ukjent romtype", () => ({ kind: "room", input: roomInput({ roomType: "villa" }) })],
    ["arealtype alh på rom", () => ({ kind: "room", input: roomInput({ areaType: "alh" }) })],
  ] as const)("4.5.9 %s gir ZodError, ingen rad og ingen hendelse", async (_name, make) => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    const floor = await createFloor(org.id, { buildingId: building.id });
    const before = await tableCounts();
    const { kind, input } = make();
    const run =
      kind === "building"
        ? saveBuilding(admin, org.id, assignment.id, null, input as BuildingInput)
        : kind === "floor"
          ? saveFloor(admin, org.id, building.id, null, input as FloorInput)
          : kind === "area"
            ? saveFloorArea(admin, org.id, floor.id, input as FloorAreaInput)
            : saveRoom(admin, org.id, floor.id, null, input as RoomInput);
    await expect(run).rejects.toThrow(ZodError);
    expect(await tableCounts()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.6 Hendelser og revisjonslogg
// ---------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Verdier som aldri skal stå i hendelser eller revisjonslogg (raden er kilden). */
const SENSITIVE_TEXT = [
  HOUSE,
  GARAGE,
  BASEMENT,
  FIRST_FLOOR,
  ROOM_NAME,
  "Målt langs innvendig vegg",
  "Loft test",
  "Rom endret test",
];
const SENSITIVE_NUMBERS = [
  "123.4",
  "123,4",
  "56.7",
  "56,7",
  "8.9",
  "8,9",
  "210.3",
  "210,3",
  "77.7",
];

/** Alle tekst- og tallverdier i strukturen (ikke nøklene). */
function leaves(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (typeof value === "object") return Object.values(value).flatMap(leaves);
  return [];
}

function expectNoSensitive(payload: unknown) {
  const text = JSON.stringify(payload);
  for (const value of SENSITIVE_TEXT) expect(text, value).not.toContain(value);
  for (const leaf of leaves(payload)) {
    if (UUID.test(leaf) || ISO_TIME.test(leaf)) continue;
    for (const value of SENSITIVE_NUMBERS) {
      expect(leaf.includes(value), `«${leaf}» inneholder ${value}`).toBe(false);
    }
  }
}

/** `data` i hendelsen har bare id-er (uuid) og `created`, og id-en til raden står der. */
function expectEventData(data: unknown, entityId: string, created?: boolean) {
  const record = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (key === "created") expect(typeof value).toBe("boolean");
    else expect(typeof value === "string" && UUID.test(value), `${key} er en id`).toBe(true);
  }
  expect(Object.values(record)).toContain(entityId);
  if (created !== undefined) expect(record.created).toBe(created);
}

describe("4.6 hendelser og revisjonslogg", () => {
  it("4.6.1–4.6.2 bygning: building_saved med created true, så false; building_removed; logg report_building create/update/delete", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveBuilding(admin, org.id, assignment.id, null, buildingInput({ name: GARAGE }));
    const building = await newestBuilding(assignment.id, GARAGE);
    await saveBuilding(
      admin,
      org.id,
      assignment.id,
      building.id,
      buildingInput({ name: "Loft test" }),
    );
    await removeBuilding(admin, org.id, building.id);

    const saved = await eventsFor(org.id, "assignment.building_saved");
    expect(saved).toHaveLength(2);
    expectEventData(
      saved.find((e) => (e.data as { created?: boolean }).created === true)!.data,
      building.id,
      true,
    );
    expectEventData(
      saved.find((e) => (e.data as { created?: boolean }).created === false)!.data,
      building.id,
      false,
    );
    const removed = await eventsFor(org.id, "assignment.building_removed");
    expect(removed).toHaveLength(1);
    expectEventData(removed[0]!.data, building.id);
    for (const event of [...saved, ...removed]) expect(event.assignmentId).toBe(assignment.id);

    const audit = await auditFor(org.id, "report_building");
    expect(audit.map((row) => `${row.action}:${row.entityId}`).sort()).toEqual(
      [`create:${building.id}`, `update:${building.id}`, `delete:${building.id}`].sort(),
    );
    const update = audit.find((row) => row.action === "update")!;
    expect(JSON.stringify(update.changes)).toContain("name");
  });

  it("4.6.1–4.6.2 etasje: floor_saved og floor_removed; logg floor med feltnavnene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const building = await createBuilding(org.id, { assignmentId: assignment.id });
    await saveFloor(admin, org.id, building.id, null, floorInput());
    const floor = await newestFloor(building.id, BASEMENT);
    await saveFloor(admin, org.id, building.id, floor.id, floorInput({ level: "-2" }));
    await removeFloor(admin, org.id, floor.id);

    const saved = await eventsFor(org.id, "assignment.floor_saved");
    expect(saved.map((e) => (e.data as { created: boolean }).created).sort()).toEqual([
      false,
      true,
    ]);
    for (const event of saved) expectEventData(event.data, floor.id);
    const removed = await eventsFor(org.id, "assignment.floor_removed");
    expect(removed).toHaveLength(1);
    expectEventData(removed[0]!.data, floor.id);
    for (const event of [...saved, ...removed]) expect(event.assignmentId).toBe(assignment.id);

    const audit = await auditFor(org.id, "floor");
    expect(audit.map((row) => row.action).sort()).toEqual(["create", "delete", "update"]);
    for (const row of audit) expect(row.entityId).toBe(floor.id);
    expect(JSON.stringify(audit.find((row) => row.action === "update")!.changes)).toContain(
      "level",
    );
  });

  it("4.6.1–4.6.2 areal: floor_area_saved med created true, så false; logg floor_area create/update", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const floor = await createFloor(org.id, {
      buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
    });
    await saveFloorArea(admin, org.id, floor.id, areaInput());
    const area = (await activeAreaFor(floor.id))!;
    await saveFloorArea(admin, org.id, floor.id, areaInput({ braI: "77,7", method: "drawing" }));

    const saved = await eventsFor(org.id, "assignment.floor_area_saved");
    expect(saved.map((e) => (e.data as { created: boolean }).created).sort()).toEqual([
      false,
      true,
    ]);
    for (const event of saved) {
      expectEventData(event.data, area.id);
      expect(event.assignmentId).toBe(assignment.id);
    }

    const audit = await auditFor(org.id, "floor_area");
    expect(audit.map((row) => `${row.action}:${row.entityId}`).sort()).toEqual(
      [`create:${area.id}`, `update:${area.id}`].sort(),
    );
    const text = JSON.stringify(audit.find((row) => row.action === "update")!.changes);
    expect(text).toMatch(/bra_?[iI]/);
    expect(text).not.toContain("77.7");
  });

  it("4.6.1–4.6.2 rom: room_saved og room_removed; logg room med romtypen som kode", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    const floor = await createFloor(org.id, {
      buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
    });
    await saveRoom(admin, org.id, floor.id, null, roomInput());
    const [room] = await roomsFor(floor.id);
    await saveRoom(
      admin,
      org.id,
      floor.id,
      room!.id,
      roomInput({ roomType: "laundry", name: "Rom endret test" }),
    );
    await removeRoom(admin, org.id, room!.id);

    const saved = await eventsFor(org.id, "assignment.room_saved");
    expect(saved.map((e) => (e.data as { created: boolean }).created).sort()).toEqual([
      false,
      true,
    ]);
    for (const event of saved) expectEventData(event.data, room!.id);
    const removed = await eventsFor(org.id, "assignment.room_removed");
    expect(removed).toHaveLength(1);
    expectEventData(removed[0]!.data, room!.id);
    for (const event of [...saved, ...removed]) expect(event.assignmentId).toBe(assignment.id);

    const audit = await auditFor(org.id, "room");
    expect(audit.map((row) => row.action).sort()).toEqual(["create", "delete", "update"]);
    const update = JSON.stringify(audit.find((row) => row.action === "update")!.changes);
    expect(update).toMatch(/room_?[tT]ype/);
    expect(update).toMatch(/name/);
  });

  it("4.6.3 ingen navn, kommentar eller arealtall i events.data eller audit_log.changes, for alle sju skrivetjenestene", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveBuilding(admin, org.id, assignment.id, null, buildingInput({ name: HOUSE }));
    const house = await newestBuilding(assignment.id, HOUSE);
    await saveBuilding(admin, org.id, assignment.id, house.id, buildingInput({ name: GARAGE }));
    await saveBuilding(admin, org.id, assignment.id, house.id, buildingInput({ name: HOUSE }));

    await saveFloor(admin, org.id, house.id, null, floorInput({ name: BASEMENT }));
    const basement = await newestFloor(house.id, BASEMENT);
    await saveFloor(
      admin,
      org.id,
      house.id,
      basement.id,
      floorInput({ name: FIRST_FLOOR, level: "1", belowGround: false }),
    );
    await saveFloor(admin, org.id, house.id, basement.id, floorInput({ name: BASEMENT }));

    await saveFloorArea(admin, org.id, basement.id, areaInput());
    await saveFloorArea(
      admin,
      org.id,
      basement.id,
      areaInput({ braI: "77,7", comment: `${COMMENT} igjen` }),
    );
    await saveFloorArea(admin, org.id, basement.id, areaInput());

    await saveRoom(admin, org.id, basement.id, null, roomInput({ name: ROOM_NAME }));
    const [room] = await roomsFor(basement.id);
    await saveRoom(admin, org.id, basement.id, room!.id, roomInput({ name: "Rom endret test" }));
    await removeRoom(admin, org.id, room!.id);

    await saveFloor(
      admin,
      org.id,
      house.id,
      null,
      floorInput({ name: "Loft test", level: "2", belowGround: false }),
    );
    const attic = await newestFloor(house.id, "Loft test");
    await saveFloorArea(admin, org.id, attic.id, areaInput({ braI: "8,9" }));
    await removeFloor(admin, org.id, attic.id);

    await saveBuilding(admin, org.id, assignment.id, null, buildingInput({ name: GARAGE }));
    const garage = await newestBuilding(assignment.id, GARAGE);
    await removeBuilding(admin, org.id, garage.id);

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
    expect(new Set(allAudit.map((row) => row.entityType))).toEqual(
      new Set(["report_building", "floor", "floor_area", "room"]),
    );
    expectNoSensitive([allEvents.map((row) => row.data), allAudit.map((row) => row.changes)]);
  });

  it("4.6.4 ingen hendelse ved avvist tilgang, valideringsfeil eller de tre kjente feilene", async () => {
    const { org, admin, assignment, office } = await orgWithAdmin();
    const t = await fixture(org.id, assignment.id);
    const noProperty = await createAssignment(org.id, { officeId: office.id });
    await setInspectorsEditAll(org.id, false);
    const { actor: inspector } = await person(org.id, ["inspector"]);

    expect(
      await caught(saveBuilding(inspector, org.id, assignment.id, null, buildingInput())),
    ).toBeInstanceOf(AccessDeniedError);
    expect(
      await caught(saveFloorArea(admin, org.id, t.floor.id, areaInput({ braI: "12,34" }))),
    ).toBeInstanceOf(ZodError);
    expect(
      await caught(saveBuilding(admin, org.id, noProperty.id, null, buildingInput())),
    ).toBeInstanceOf(PropertyMissingError);
    expect(await caught(removeBuilding(admin, org.id, t.building.id))).toBeInstanceOf(
      BuildingNotEmptyError,
    );
    expect(await caught(removeFloor(admin, org.id, t.floor.id))).toBeInstanceOf(FloorNotEmptyError);

    expect(await rowCount(events)).toBe(0);
    expect(await rowCount(auditLog)).toBe(0);
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
      "recordAuditEvent",
      () =>
        vi.mocked(recordAuditEvent).mockImplementationOnce(async () => {
          throw new Error("revisjonsloggen feilet (test)");
        }),
    ],
  ] as const;

  it("4.6.5 modulene er pakket inn (ellers tester 4.6.5 ingenting)", async () => {
    const { org, admin, assignment } = await orgWithAdmin();
    await saveBuilding(admin, org.id, assignment.id, null, buildingInput());
    expect(vi.mocked(recordEvent)).toHaveBeenCalled();
    expect(vi.mocked(recordAuditEvent)).toHaveBeenCalled();
  });

  it.each(FAILURES)(
    "4.6.5 saveBuilding: %s kaster → ingen bygning står igjen",
    async (_name, fail) => {
      const { org, admin, assignment } = await orgWithAdmin();
      fail();
      await expect(
        saveBuilding(admin, org.id, assignment.id, null, buildingInput()),
      ).rejects.toThrow();
      expect(await tableCounts()).toMatchObject({ buildings: 0, events: 0, auditLog: 0 });
    },
  );

  it.each(FAILURES)(
    "4.6.5 saveBuilding (endring): %s kaster → navnet er uendret",
    async (_name, fail) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const building = await createBuilding(org.id, { assignmentId: assignment.id });
      fail();
      await expect(
        saveBuilding(admin, org.id, assignment.id, building.id, buildingInput({ name: GARAGE })),
      ).rejects.toThrow();
      const row = await buildingRow(building.id);
      expect(row.name).toBe(HOUSE);
      expect(row.rowVersion).toBe(building.rowVersion);
    },
  );

  it.each(FAILURES)(
    "4.6.5 saveFloorArea: %s kaster → ingen arealrad står igjen",
    async (_name, fail) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      fail();
      await expect(saveFloorArea(admin, org.id, floor.id, areaInput())).rejects.toThrow();
      expect(await areaRowsFor(floor.id)).toHaveLength(0);
      expect(await rowCount(events)).toBe(0);
      expect(await rowCount(auditLog)).toBe(0);
    },
  );

  it.each(FAILURES)(
    "4.6.5 removeFloor: %s kaster → etasjen og arealet er ikke myk-slettet",
    async (_name, fail) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      const area = await createFloorArea(org.id, { floorId: floor.id, braI: 56.7 });
      fail();
      await expect(removeFloor(admin, org.id, floor.id)).rejects.toThrow();
      expect((await floorRow(floor.id)).deletedAt).toBeNull();
      expect((await activeAreaFor(floor.id))?.id).toBe(area.id);
      expect(await activeCounts()).toMatchObject({ floors: 1, floorAreas: 1 });
    },
  );

  it.each(FAILURES)(
    "4.6.5 saveRoom og removeRoom: %s kaster → ingen endring står igjen",
    async (_name, fail) => {
      const { org, admin, assignment } = await orgWithAdmin();
      const floor = await createFloor(org.id, {
        buildingId: (await createBuilding(org.id, { assignmentId: assignment.id })).id,
      });
      const room = await createRoom(org.id, { floorId: floor.id });
      fail();
      await expect(saveRoom(admin, org.id, floor.id, null, roomInput())).rejects.toThrow();
      fail();
      await expect(removeRoom(admin, org.id, room.id)).rejects.toThrow();
      const rows = await db
        .select()
        .from(rooms)
        .where(and(eq(rooms.floorId, floor.id), isNull(rooms.deletedAt)));
      expect(rows.map((row) => row.id)).toEqual([room.id]);
      expect(await rowCount(events)).toBe(0);
    },
  );
});
