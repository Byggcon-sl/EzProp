import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import {
  auditLog,
  events,
  floorAreas,
  floors,
  organizations,
  reportBuildings,
  rooms,
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
  resetDatabase,
} from "../../../../../../tests/factories";
import { initialFormState, NO_ACCESS, type FormState } from "../../../form-state";

/*
 * Testplan 6.4 (runde 2): takstmann med `access.inspectors_edit_all` av bruker de sju
 * skrivehandlingene på bygningssiden mot den ekte kjernen og testdatabasen. Hver handling gir
 * NO_ACCESS, siden friskes ikke opp, og ingen rad, hendelse eller loggrad er endret. Dekker hullet
 * hvis en «Legg til»-, «Lagre»- eller «Fjern»-knapp likevel skulle vises for takstmannen.
 *
 * Bare konteksten (innlogget bruker), next/cache og loggeren er byttet ut. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (bare de som har skriverett, endrer areal og rom).
 */

const mocks = vi.hoisted(() => ({ getEmployeeContext: vi.fn(), logError: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  notFound: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));

const actions = await import("./actions");

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
});

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

async function setup() {
  const org = await createOrganization("Testfirma takst");
  const office = await createOffice(org.id, { name: "Testkontor Bodø" });
  const assignment = await createAssignment(org.id, { officeId: office.id });
  await createProperty(org.id, { assignmentId: assignment.id });
  const building = await createBuilding(org.id, { assignmentId: assignment.id, name: "Bolighus" });
  const emptyBuilding = await createBuilding(org.id, {
    assignmentId: assignment.id,
    name: "Garasje test",
  });
  const floor = await createFloor(org.id, { buildingId: building.id, name: "Kjeller", level: -1 });
  const emptyFloor = await createFloor(org.id, { buildingId: building.id, name: "1. etasje" });
  await createFloorArea(org.id, { floorId: floor.id, braI: 56.7, method: "laser" });
  const room = await createRoom(org.id, { floorId: floor.id, roomType: "bathroom" });

  const inspector = await createUser({ name: "Takst Testsen" });
  await createEmployee(inspector, org.id, ["inspector"]);
  await setInspectorsEditAll(org.id, false);
  mocks.getEmployeeContext.mockResolvedValue({
    actor: inspector,
    organizationId: org.id,
    canEditOrders: false,
    officeId: null,
  });
  return { org, assignment, building, emptyBuilding, floor, emptyFloor, room };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

const CASES: [string, (s: Setup) => Promise<FormState>][] = [
  [
    "saveBuildingAction (ny)",
    (s) =>
      actions.saveBuildingAction(
        initialFormState,
        form({ assignmentId: s.assignment.id, buildingId: "", name: "Ny bygning test" }),
      ),
  ],
  [
    "saveBuildingAction (endring)",
    (s) =>
      actions.saveBuildingAction(
        initialFormState,
        form({ assignmentId: s.assignment.id, buildingId: s.building.id, name: "Endret" }),
      ),
  ],
  [
    "removeBuildingAction",
    (s) =>
      actions.removeBuildingAction(
        initialFormState,
        form({ assignmentId: s.assignment.id, buildingId: s.emptyBuilding.id }),
      ),
  ],
  [
    "saveFloorAction",
    (s) =>
      actions.saveFloorAction(
        initialFormState,
        form({
          assignmentId: s.assignment.id,
          buildingId: s.building.id,
          floorId: "",
          name: "2. etasje",
          level: "2",
        }),
      ),
  ],
  [
    "removeFloorAction",
    (s) =>
      actions.removeFloorAction(
        initialFormState,
        form({ assignmentId: s.assignment.id, floorId: s.emptyFloor.id }),
      ),
  ],
  [
    "saveFloorAreaAction",
    (s) =>
      actions.saveFloorAreaAction(
        initialFormState,
        form({
          assignmentId: s.assignment.id,
          floorId: s.floor.id,
          braI: "123,4",
          braE: "",
          braB: "",
          alh: "",
          measuredBy: "",
          method: "drawing",
          comment: "",
        }),
      ),
  ],
  [
    "saveRoomAction",
    (s) =>
      actions.saveRoomAction(
        initialFormState,
        form({
          assignmentId: s.assignment.id,
          floorId: s.floor.id,
          roomId: "",
          roomType: "garage",
          name: "",
          areaType: "bra_e",
        }),
      ),
  ],
  [
    "removeRoomAction",
    (s) =>
      actions.removeRoomAction(
        initialFormState,
        form({ assignmentId: s.assignment.id, roomId: s.room.id }),
      ),
  ],
];

/** Alle radene i de fire tabellene, og antall hendelser og loggrader, som tekst. */
async function snapshot() {
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
  const [b, f, a, r] = await Promise.all([
    db.select().from(reportBuildings),
    db.select().from(floors),
    db.select().from(floorAreas),
    db.select().from(rooms),
  ]);
  const [e] = await db.select({ n: count() }).from(events);
  const [l] = await db.select({ n: count() }).from(auditLog);
  return JSON.stringify([b.sort(byId), f.sort(byId), a.sort(byId), r.sort(byId), e, l]);
}

describe("6.4 takstmann med access.inspectors_edit_all av, mot den ekte kjernen", () => {
  it.each(CASES)("%s → NO_ACCESS, ingen revalidatePath, ingenting lagret", async (_name, run) => {
    const s = await setup();
    const before = await snapshot();

    const state = await run(s);

    expect(state.message).toBe(NO_ACCESS);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(await snapshot()).toBe(before);
  });

  it("kontrollen: med innstillingen på kan den samme takstmannen lagre en bygning", async () => {
    const s = await setup();
    await setInspectorsEditAll(s.org.id, true);

    const state = await actions.saveBuildingAction(
      initialFormState,
      form({ assignmentId: s.assignment.id, buildingId: "", name: "Ny bygning test" }),
    );

    expect(state.message).toBeNull();
    expect(vi.mocked(revalidatePath)).toHaveBeenCalled();
    const [row] = await db
      .select({ n: count() })
      .from(reportBuildings)
      .where(eq(reportBuildings.name, "Ny bygning test"));
    expect(row!.n).toBe(1);
  });
});
