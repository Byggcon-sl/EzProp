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
  revalidatePath: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
vi.mock("../../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));

const {
  saveBuildingAction,
  removeBuildingAction,
  saveFloorAction,
  removeFloorAction,
  saveFloorAreaAction,
  saveRoomAction,
  removeRoomAction,
  addRoomsAction,
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

  mocks.getEmployeeContext.mockResolvedValue({
    actor: inspector,
    organizationId: org.id,
    canEditOrders: false,
    canReadClaims: false,
    canManageClaims: false,
    canManageContacts: false,
    officeId: null,
  });

  return { org, adminEmployee, assignment, building, floor, room, emptyBuilding, emptyFloor };
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
