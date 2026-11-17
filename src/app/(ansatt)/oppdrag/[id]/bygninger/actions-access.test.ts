import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { auditLog, events, organizations, reportBuildings } from "@/db/schema";
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
  resetDatabase,
} from "../../../../../../tests/factories";
import { initialFormState, NO_ACCESS, type FormState } from "../../../form-state";

/*
 * 6.4: takstmann uten skriverett (innstillingen `access.inspectors_edit_all` av) får «ingen
 * tilgang» fra kjernen, også om en knapp skulle vises. Integrasjonstest mot testdatabasen: bare
 * innloggingen (getEmployeeContext), revalidatePath og loggeren er byttet ut; kjernen er ekte.
 * Testplan: docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md punkt 6.4. Oppgavekort:
 * docs/funksjoner/fase2a-bygninger-areal-rom.md punkt 9.
 *
 * Hver av de åtte handlingene (F11.1 i docs/funksjoner/fase2a-flere-rom-testplan.md) får gyldige uuid-er og gyldige skjemaverdier. Svaret skal være
 * NO_ACCESS, ingen rader skal være laget eller endret, ingen hendelser eller loggrader, og
 * loggeren skal ikke ha fått skjemaverdier.
 *
 * Ingen ny spørring testes her, så filen har ikke `expectTenantIsolation`.
 *
 * Testdata er oppdiktet. Støtter hovedmål: reklamasjoner (bare den som har skriverett, kan
 * endre areal og rom).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  /** Sann: getEmployeeContextForAction svarer «logget ut» (rett T-0070). */
  signedOut: { value: false },
  revalidatePath: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
// Handlingene som tåler utløpt innlogging (rett T-0070) bruker getEmployeeContextForAction. Her
// bygges svaret fra den samme falske konteksten: null gir «ingen tilgang», og `signedOut` gir
// «logget ut».
vi.mock("../../../employee-context", () => ({
  getEmployeeContext: mocks.getEmployeeContext,
  getEmployeeContextForAction: async () => {
    if (mocks.signedOut.value) return { status: "signed_out" };
    const context = await mocks.getEmployeeContext();
    return context ? { status: "ok", context } : { status: "no_access" };
  },
}));

const {
  saveBuildingAction,
  removeBuildingAction,
  saveFloorAction,
  removeFloorAction,
  saveFloorAreaAction,
  saveRoomAction,
  removeRoomAction,
  addRoomsAction,
  restoreStructureAction,
} = await import("./actions");

const TABLES = ["report_buildings", "floors", "floor_areas", "rooms"] as const;
type DbRow = Record<string, unknown>;

const NEW_BUILDING = "Anneks test";
const NEW_FLOOR = "Loft test";
const NEW_ROOM = "Soverom test";
const NEW_COMMENT = "Endret uten rett test";
const NEW_AREAS = ["99,9", "11,1", "2,2", "120,5"];
const FORM_VALUES = [NEW_BUILDING, NEW_FLOOR, NEW_ROOM, NEW_COMMENT, ...NEW_AREAS];

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  mocks.signedOut.value = false;
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

/** Alle radene i de fire tabellene, med alle kolonnene (også updated_at og deleted_at). */
async function snapshot(organizationId: string): Promise<string> {
  const all: Record<string, DbRow[]> = {};
  for (const table of TABLES) {
    all[table] = (await db.execute(
      sql`select * from ${sql.identifier(table)} where organization_id = ${organizationId} order by id`,
    )) as unknown as DbRow[];
  }
  return JSON.stringify(all);
}

async function eventAndAuditCounts() {
  const [eventRow] = await db.select({ n: count() }).from(events);
  const [auditRow] = await db.select({ n: count() }).from(auditLog);
  return { events: eventRow?.n ?? 0, audit: auditRow?.n ?? 0 };
}

/**
 * Organisasjon med innstillingen av, en takstmann (innlogget) og en admin (måler), og et oppdrag
 * med eiendom, bygning, etasje med areal og rom, en tom bygning og en tom etasje.
 */
async function setup() {
  const org = await createOrganization("Testfirma takst");
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": false } })
    .where(eq(organizations.id, org.id));
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const inspector = await createUser({ name: "Test Takstmann" });
  await createEmployee(inspector, org.id, ["inspector"]);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);

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
  // Papirkurven: en fjernet bygning, en fjernet etasje og et fjernet rom (fjernet av admin)
  const removedAt = new Date("2026-11-16T10:00:00Z");
  const removedBuilding = await createBuilding(org.id, {
    assignmentId: assignment.id,
    name: "Anneks fjernet test",
    deletedAt: removedAt,
    deletedBy: adminEmployee.id,
  });
  const removedFloor = await createFloor(org.id, {
    buildingId: building.id,
    name: "Loft fjernet test",
    deletedAt: removedAt,
    deletedBy: adminEmployee.id,
  });
  const removedRoom = await createRoom(org.id, {
    floorId: floor.id,
    name: "Bad fjernet test",
    deletedAt: removedAt,
    deletedBy: adminEmployee.id,
  });

  mocks.getEmployeeContext.mockResolvedValue({
    actor: inspector,
    organizationId: org.id,
    canEditOrders: false,
    canReadClaims: false,
    canManageClaims: false,
    canManageContacts: false,
    officeId: null,
  });

  return {
    org,
    adminEmployee,
    assignment,
    building,
    floor,
    room,
    emptyBuilding,
    emptyFloor,
    removedBuilding,
    removedFloor,
    removedRoom,
  };
}

describe("6.4 takstmann uten skriverett får NO_ACCESS fra kjernen", () => {
  it("alle åtte handlingene gir NO_ACCESS, og ingenting lagres eller logges", async () => {
    const { org, adminEmployee, assignment, building, floor, room, emptyBuilding, emptyFloor } =
      await setup();

    const area = {
      braI: NEW_AREAS[0]!,
      braE: NEW_AREAS[1]!,
      braB: NEW_AREAS[2]!,
      alh: NEW_AREAS[3]!,
      measuredBy: adminEmployee.id,
      method: "laser",
      comment: NEW_COMMENT,
    };
    const cases: [string, (previous: FormState, data: FormData) => Promise<FormState>, FormData][] =
      [
        [
          "saveBuildingAction (ny)",
          saveBuildingAction,
          form({ assignmentId: assignment.id, buildingId: "", name: NEW_BUILDING }),
        ],
        [
          "saveBuildingAction (eksisterende)",
          saveBuildingAction,
          form({ assignmentId: assignment.id, buildingId: building.id, name: NEW_BUILDING }),
        ],
        [
          "removeBuildingAction",
          removeBuildingAction,
          form({ assignmentId: assignment.id, buildingId: emptyBuilding.id }),
        ],
        [
          "saveFloorAction (ny)",
          saveFloorAction,
          form({
            assignmentId: assignment.id,
            buildingId: building.id,
            floorId: "",
            name: NEW_FLOOR,
            level: "2",
          }),
        ],
        [
          "saveFloorAction (eksisterende)",
          saveFloorAction,
          form({
            assignmentId: assignment.id,
            buildingId: building.id,
            floorId: floor.id,
            name: NEW_FLOOR,
            level: "-1",
            belowGround: "on",
          }),
        ],
        [
          "removeFloorAction",
          removeFloorAction,
          form({ assignmentId: assignment.id, floorId: emptyFloor.id }),
        ],
        [
          "saveFloorAreaAction",
          saveFloorAreaAction,
          form({ assignmentId: assignment.id, floorId: floor.id, ...area }),
        ],
        [
          "saveRoomAction (ny)",
          saveRoomAction,
          form({
            assignmentId: assignment.id,
            floorId: floor.id,
            roomId: "",
            roomType: "bedroom",
            name: NEW_ROOM,
            areaType: "bra_i",
          }),
        ],
        [
          "saveRoomAction (eksisterende)",
          saveRoomAction,
          form({
            assignmentId: assignment.id,
            floorId: floor.id,
            roomId: room.id,
            roomType: "bedroom",
            name: NEW_ROOM,
            areaType: "bra_e",
            belowGround: "on",
          }),
        ],
        [
          "removeRoomAction",
          removeRoomAction,
          form({ assignmentId: assignment.id, roomId: room.id }),
        ],
        // F11.1: også addRoomsAction gir NO_ACCESS fra kjernen for takstmann uten skriverett
        [
          "addRoomsAction",
          addRoomsAction,
          form({
            assignmentId: assignment.id,
            floorId: emptyFloor.id,
            source: "preset",
            presetKey: "apartment",
            drafts: JSON.stringify([{ roomType: "bedroom", count: 2 }]),
          }),
        ],
      ];

    const before = await snapshot(org.id);
    const countsBefore = await eventAndAuditCounts();

    for (const [name, action, data] of cases) {
      const state = await action(initialFormState, data);
      expect(state.message, name).toBe(NO_ACCESS);
      expect(state.fieldErrors, name).toEqual({});
    }

    expect(mocks.getEmployeeContext).toHaveBeenCalledTimes(cases.length);
    expect(await snapshot(org.id)).toBe(before);
    expect(await eventAndAuditCounts()).toEqual(countsBefore);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();

    const logged = JSON.stringify([
      mocks.log.error.mock.calls,
      mocks.log.warn.mock.calls,
      mocks.log.info.mock.calls,
    ]);
    for (const value of FORM_VALUES) expect(logged).not.toContain(value);
  });

  it("kontrollen: med innstillingen på kan den samme takstmannen lagre en bygning", async () => {
    const { org, assignment } = await setup();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": true } })
      .where(eq(organizations.id, org.id));

    const state = await saveBuildingAction(
      initialFormState,
      form({ assignmentId: assignment.id, buildingId: "", name: NEW_BUILDING }),
    );

    expect(state.message).toBeNull();
    expect(mocks.revalidatePath).toHaveBeenCalled();
    const [row] = await db
      .select({ n: count() })
      .from(reportBuildings)
      .where(eq(reportBuildings.name, NEW_BUILDING));
    expect(row!.n).toBe(1);
  });
});

describe("8 papirkurv: «Angre» og «Gjenopprett» med ekte kjerne", () => {
  it("8.1 takstmann uten skriverett: alle tre gir fast tekst, og ingenting hentes tilbake eller logges", async () => {
    const { org, removedBuilding, removedFloor, removedRoom } = await setup();
    const before = await snapshot(org.id);
    const countsBefore = await eventAndAuditCounts();

    for (const [type, id] of [
      ["building", removedBuilding.id],
      ["floor", removedFloor.id],
      ["room", removedRoom.id],
    ] as const) {
      for (const how of ["undo", "trash"] as const) {
        const result = await restoreStructureAction({ type, id, how });
        expect(result, `${type} ${how}`).toEqual({ ok: false, message: NO_ACCESS });
      }
    }

    expect(await snapshot(org.id)).toBe(before);
    expect(await eventAndAuditCounts()).toEqual(countsBefore);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.log.error).not.toHaveBeenCalled();
  });

  it("8.1 organisasjonen fra økten: rom i en annen organisasjon gir avslag, selv om kalleren sender organisasjonen", async () => {
    const { org, removedRoom } = await setup();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": true } })
      .where(eq(organizations.id, org.id));
    // Den andre organisasjonen har sin egen innlogging; takstmannen i org prøver rommet der.
    const other = await createOrganization("Annet testfirma");
    const otherAssignment = await createAssignment(other.id);
    const otherBuilding = await createBuilding(other.id, { assignmentId: otherAssignment.id });
    const otherFloor = await createFloor(other.id, { buildingId: otherBuilding.id });
    const otherRoom = await createRoom(other.id, {
      floorId: otherFloor.id,
      deletedAt: new Date("2026-11-16T10:00:00Z"),
    });

    const denied = await restoreStructureAction({
      type: "room",
      id: otherRoom.id,
      how: "trash",
      organizationId: other.id,
    } as never);
    expect(denied).toEqual({ ok: false, message: NO_ACCESS });
    const [stillRemoved] = (await db.execute(
      sql`select deleted_at from rooms where id = ${otherRoom.id}`,
    )) as unknown as { deleted_at: Date | null }[];
    expect(stillRemoved!.deleted_at).not.toBeNull();

    // Kontrollen: eget rom kommer tilbake, og begge sidene friskes opp
    const ok = await restoreStructureAction({ type: "room", id: removedRoom.id, how: "trash" });
    expect(ok).toMatchObject({ ok: true, changed: true });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/oppdrag/[id]/bygninger", "page");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/oppdrag/[id]", "page");
  });

  it("«Fjern» på etasje med rom er ett trykk og svarer med slettegruppen (A414)", async () => {
    const { org, floor, room } = await setup();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": true } })
      .where(eq(organizations.id, org.id));

    const state = await removeFloorAction(initialFormState, form({ floorId: floor.id }));
    expect(state.message).toBeNull();
    expect(state.removed).toEqual(
      expect.arrayContaining([
        { type: "floor", id: floor.id },
        { type: "room", id: room.id },
      ]),
    );
  });
});
