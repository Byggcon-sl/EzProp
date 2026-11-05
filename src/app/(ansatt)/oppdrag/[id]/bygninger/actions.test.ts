import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  BuildingNotEmptyError,
  buildingInputSchema,
  FloorNotEmptyError,
  floorAreaInputSchema,
  floorInputSchema,
  PropertyMissingError,
  roomInputSchema,
} from "@/core/buildings";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../../form-state";

/*
 * Server actions på bygningssiden /oppdrag/[id]/bygninger
 * (docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 6). Kjernen og konteksten er
 * byttet ut her; kjernen testes i src/core/buildings. Testene viser at hver handling henter
 * organisasjonen på serveren, sjekker id-er før kjernen kalles, og gir de faste meldingene uten
 * skjemaverdier i loggen.
 *
 * Kortet navngir ikke handlingene. Testene bruker saveBuildingAction, removeBuildingAction,
 * saveFloorAction, removeFloorAction, saveFloorAreaAction, saveRoomAction og removeRoomAction,
 * med feltene assignmentId, buildingId, floorId, roomId («» = ny), name, level, belowGround,
 * braI, braE, braB, alh, measuredBy, method, comment, roomType og areaType (samme som kjernen).
 * Avviker utvikleren, rettes navnene ved sammenslåingen.
 *
 * Testdata er oppdiktet. Støtter hovedmål: tid (feil vises ved feltet) og reklamasjoner (aldri
 * feil organisasjon, aldri navn, kommentar eller arealtall i loggen).
 */

const mocks = vi.hoisted(() => ({
  getEmployeeContext: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
  logError: vi.fn(),
  core: {
    getAssignmentBuildings: vi.fn(),
    saveBuilding: vi.fn(),
    removeBuilding: vi.fn(),
    saveFloor: vi.fn(),
    removeFloor: vi.fn(),
    saveFloorArea: vi.fn(),
    saveRoom: vi.fn(),
    removeRoom: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../employee-context", () => ({ getEmployeeContext: mocks.getEmployeeContext }));
vi.mock("@/core/buildings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/core/buildings")>()),
  ...mocks.core,
}));

const {
  saveBuildingAction,
  removeBuildingAction,
  saveFloorAction,
  removeFloorAction,
  saveFloorAreaAction,
  saveRoomAction,
  removeRoomAction,
} = await import("./actions");

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const BUILDING = "0190a000-0000-7000-8000-000000000051";
const FLOOR = "0190a000-0000-7000-8000-000000000052";
const ROOM = "0190a000-0000-7000-8000-000000000053";
const MEASURER = "0190a000-0000-7000-8000-000000000060";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

const BUILDING_NAME = "Bolighus";
const FLOOR_NAME = "Kjeller";
const ROOM_NAME = "Rom test";
const COMMENT = "Målt langs innvendig vegg test";
const AREAS = ["123,4", "56,7", "8,9", "210,3"];
const PERSONAL = [BUILDING_NAME, FLOOR_NAME, ROOM_NAME, "Målt langs innvendig vegg"];

const PROPERTY_MISSING = "Legg inn eiendommen før du legger til bygninger.";
const BUILDING_NOT_EMPTY = "Fjern etasjene først.";
const FLOOR_NOT_EMPTY = "Fjern rommene først.";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

const FORMS = {
  saveBuildingAction: { assignmentId: ASSIGNMENT, buildingId: "", name: BUILDING_NAME },
  removeBuildingAction: { assignmentId: ASSIGNMENT, buildingId: BUILDING },
  saveFloorAction: {
    assignmentId: ASSIGNMENT,
    buildingId: BUILDING,
    floorId: "",
    name: FLOOR_NAME,
    level: "-1",
    belowGround: "on",
  },
  removeFloorAction: { assignmentId: ASSIGNMENT, floorId: FLOOR },
  saveFloorAreaAction: {
    assignmentId: ASSIGNMENT,
    floorId: FLOOR,
    braI: AREAS[0]!,
    braE: AREAS[1]!,
    braB: AREAS[2]!,
    alh: AREAS[3]!,
    measuredBy: MEASURER,
    method: "laser",
    comment: COMMENT,
  },
  saveRoomAction: {
    assignmentId: ASSIGNMENT,
    floorId: FLOOR,
    roomId: "",
    roomType: "bathroom",
    name: ROOM_NAME,
    areaType: "bra_i",
  },
  removeRoomAction: { assignmentId: ASSIGNMENT, roomId: ROOM },
} as const;

type ActionName = keyof typeof FORMS;

const ACTION_FNS = {
  saveBuildingAction,
  removeBuildingAction,
  saveFloorAction,
  removeFloorAction,
  saveFloorAreaAction,
  saveRoomAction,
  removeRoomAction,
} as const;

const CORE_FOR_ACTION = {
  saveBuildingAction: mocks.core.saveBuilding,
  removeBuildingAction: mocks.core.removeBuilding,
  saveFloorAction: mocks.core.saveFloor,
  removeFloorAction: mocks.core.removeFloor,
  saveFloorAreaAction: mocks.core.saveFloorArea,
  saveRoomAction: mocks.core.saveRoom,
  removeRoomAction: mocks.core.removeRoom,
} as const;

const ACTION_NAMES = Object.keys(FORMS) as ActionName[];

function call(name: ActionName, overrides: Record<string, string> = {}) {
  return ACTION_FNS[name](initialFormState, form({ ...FORMS[name], ...overrides }));
}

/** Id-feltene hver handling bruker (det kjernen får), som skal være uuid. */
const ID_FIELDS: Record<ActionName, string[]> = {
  saveBuildingAction: ["assignmentId"],
  removeBuildingAction: ["buildingId"],
  saveFloorAction: ["buildingId"],
  removeFloorAction: ["floorId"],
  saveFloorAreaAction: ["floorId"],
  saveRoomAction: ["floorId"],
  removeRoomAction: ["roomId"],
};

/** Valgfrie id-er («» = ny), som likevel må være uuid når de er fylt ut. */
const OPTIONAL_ID_FIELDS: [ActionName, string][] = [
  ["saveBuildingAction", "buildingId"],
  ["saveFloorAction", "floorId"],
  ["saveRoomAction", "roomId"],
];

function coreCalls() {
  return Object.values(mocks.core).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

/** Alt loggeren fikk, som tekst, med uuid-er byttet ut med «<id>». */
function loggedWithoutIds(): string {
  return JSON.stringify(mocks.logError.mock.calls).replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "<id>",
  );
}

/** Alle meldinger i svaret, ved feltene og øverst. */
function allMessages(state: FormState): string[] {
  return [...Object.values(state.fieldErrors), state.message ?? ""];
}

/** Kjører handlingen; videresending ved suksess (redirect kaster) regnes ikke som feil. */
async function run(promise: Promise<FormState>): Promise<FormState | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("REDIRECT ")) return null;
    throw error;
  }
}

/** Svaret fra en handling som skal feile (ingen videresending). */
async function failed(promise: Promise<FormState>): Promise<FormState> {
  const state = await run(promise);
  expect(state, "handlingen skulle svart med en feil, ikke sendt videre").not.toBeNull();
  return state!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    officeId: null,
  });
  for (const fn of Object.values(mocks.core)) fn.mockResolvedValue(undefined);
});

describe("6.1 uten ansattkontekst", () => {
  it.each(ACTION_NAMES)(
    "%s: getEmployeeContext gir null → NO_ACCESS uten kall til kjernen",
    async (name) => {
      mocks.getEmployeeContext.mockResolvedValue(null);
      const state = await failed(call(name));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("6.2 id som ikke er uuid", () => {
  const BAD_IDS = ["ikke-en-id", "1 or 1=1", "../x"];
  const REQUIRED = ACTION_NAMES.flatMap((name) =>
    ID_FIELDS[name].flatMap((field) => [...BAD_IDS, ""].map((id) => [name, field, id] as const)),
  );
  const OPTIONAL = OPTIONAL_ID_FIELDS.flatMap(([name, field]) =>
    BAD_IDS.map((id) => [name, field, id] as const),
  );

  it.each([...REQUIRED, ...OPTIONAL])(
    "%s: %s «%s» → NO_ACCESS uten kall",
    async (name, field, id) => {
      const state = await failed(call(name, { [field]: id }));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("6.3 organisasjonen kommer fra konteksten", () => {
  it.each(ACTION_NAMES)(
    "%s: organizationId i skjemaet endrer ikke kallet; kjernen får aktøren og ORG",
    async (name) => {
      await run(call(name, { organizationId: OTHER_ORG }));
      const core = CORE_FOR_ACTION[name];
      expect(core).toHaveBeenCalledTimes(1);
      const [calledActor, calledOrg] = core.mock.calls[0]!;
      expect([calledActor, calledOrg]).toEqual([actor, ORG]);
      expect(JSON.stringify(core.mock.calls)).not.toContain(OTHER_ORG);
    },
  );

  it("saveBuildingAction: ny bygning gir (oppdrag, null, { name })", async () => {
    await run(call("saveBuildingAction"));
    const [, , assignmentId, buildingId, input] = mocks.core.saveBuilding.mock.calls[0]!;
    expect([assignmentId, buildingId]).toEqual([ASSIGNMENT, null]);
    expect(input).toMatchObject({ name: BUILDING_NAME });
  });

  it("saveBuildingAction: endring gir bygningens id", async () => {
    await run(call("saveBuildingAction", { buildingId: BUILDING }));
    const [, , assignmentId, buildingId] = mocks.core.saveBuilding.mock.calls[0]!;
    expect([assignmentId, buildingId]).toEqual([ASSIGNMENT, BUILDING]);
  });

  it("saveFloorAction: (bygning, null, input) og (bygning, etasje, input)", async () => {
    await run(call("saveFloorAction"));
    await run(call("saveFloorAction", { floorId: FLOOR }));
    const [first, second] = mocks.core.saveFloor.mock.calls;
    expect(first!.slice(2, 4)).toEqual([BUILDING, null]);
    expect(second!.slice(2, 4)).toEqual([BUILDING, FLOOR]);
    expect(first![4]).toMatchObject({ name: FLOOR_NAME });
  });

  it("saveFloorAreaAction: (etasje, input) med arealene og «Målt av»", async () => {
    await run(call("saveFloorAreaAction"));
    const [, , floorId, input] = mocks.core.saveFloorArea.mock.calls[0]!;
    expect(floorId).toBe(FLOOR);
    expect(input).toMatchObject({ method: "laser", comment: COMMENT, measuredBy: MEASURER });
  });

  it("saveRoomAction: (etasje, null, input) og (etasje, rom, input)", async () => {
    await run(call("saveRoomAction"));
    await run(call("saveRoomAction", { roomId: ROOM }));
    const [first, second] = mocks.core.saveRoom.mock.calls;
    expect(first!.slice(2, 4)).toEqual([FLOOR, null]);
    expect(second!.slice(2, 4)).toEqual([FLOOR, ROOM]);
    expect(first![4]).toMatchObject({ roomType: "bathroom", areaType: "bra_i" });
  });

  it.each([
    ["removeBuildingAction", BUILDING],
    ["removeFloorAction", FLOOR],
    ["removeRoomAction", ROOM],
  ] as const)("%s: kjernen får id-en fra skjemaet", async (name, id) => {
    await run(call(name));
    expect(CORE_FOR_ACTION[name].mock.calls[0]).toContain(id);
  });

  it.each(ACTION_NAMES)("%s: lykket lagring gir ingen feil", async (name) => {
    const state = await run(call(name));
    if (state) {
      expect(state.message).toBeNull();
      expect(state.fieldErrors).toEqual({});
    }
  });
});

describe("6.4 feil fra kjernen", () => {
  it.each(ACTION_NAMES)("%s: AccessDeniedError → NO_ACCESS", async (name) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new AccessDeniedError());
    const state = await failed(call(name));
    expect(state.message).toBe(NO_ACCESS);
  });

  it.each([
    ["saveBuildingAction", () => new PropertyMissingError(), PROPERTY_MISSING],
    ["removeBuildingAction", () => new BuildingNotEmptyError(), BUILDING_NOT_EMPTY],
    ["removeFloorAction", () => new FloorNotEmptyError(), FLOOR_NOT_EMPTY],
  ] as const)("%s: kjent feil → «%s»", async (name, make, message) => {
    CORE_FOR_ACTION[name].mockRejectedValue(make());
    const state = await failed(call(name));
    expect(allMessages(state)).toContain(message);
    expect(state.message).not.toBe(UNKNOWN_ERROR);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it.each([
    [
      "saveBuildingAction",
      buildingInputSchema,
      { name: "" },
      "name",
      "Skriv inn navnet på bygningen.",
    ],
    [
      "saveFloorAction",
      floorInputSchema,
      { name: "Kjeller", level: "21" },
      "level",
      "Etasjenummeret må være mellom −3 og 20.",
    ],
    [
      "saveFloorAreaAction",
      floorAreaInputSchema,
      { braI: "12,34" },
      "braI",
      "Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.",
    ],
    ["saveRoomAction", roomInputSchema, { roomType: "villa" }, "roomType", "Velg romtype."],
  ] as const)("%s: ZodError → feil ved feltet %s", async (name, schema, bad, field, message) => {
    const result = (
      schema as { safeParse: (v: unknown) => { success: boolean; error?: unknown } }
    ).safeParse(bad);
    expect(result.success).toBe(false);
    CORE_FOR_ACTION[name].mockRejectedValue(result.error);

    const state = await failed(call(name, bad as Record<string, string>));
    expect(state.fieldErrors[field]).toBe(message);
    // Verdien står igjen i skjemaet
    expect(state.values[field]).toBe((bad as Record<string, string>)[field]);
  });

  it.each(ACTION_NAMES)("%s: ukjent feil → UNKNOWN_ERROR", async (name) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new Error("oppdiktet feil"));
    const state = await failed(call(name));
    expect(state.message).toBe(UNKNOWN_ERROR);
  });
});

describe("6.5 loggkontrakt", () => {
  it.each(ACTION_NAMES)(
    "%s: ukjent feil logges bare med rute, bruker-id, id-er og feilnavn",
    async (name) => {
      const boom = new Error(`databasen sa nei til ${PERSONAL.join(" ")} ${AREAS.join(" ")}`);
      boom.name = "OppdiktetFeil";
      CORE_FOR_ACTION[name].mockRejectedValue(boom);

      const state = await failed(call(name));
      expect(state.message).toBe(UNKNOWN_ERROR);
      expect(mocks.logError).toHaveBeenCalledTimes(1);
      const logged = loggedWithoutIds();
      expect(logged).toContain("OppdiktetFeil");
      expect(logged).toContain(actor.id);
      for (const value of [...PERSONAL, ...AREAS, "123.4", "56.7", "210.3"]) {
        expect(logged, value).not.toContain(value);
      }
    },
  );

  it("ingen kall til loggeren gir skjemaverdier, heller ikke ved kjente feil", async () => {
    mocks.core.saveBuilding.mockRejectedValue(new PropertyMissingError());
    mocks.core.removeBuilding.mockRejectedValue(new BuildingNotEmptyError());
    mocks.core.removeFloor.mockRejectedValue(new FloorNotEmptyError());
    mocks.core.saveFloorArea.mockRejectedValue(new AccessDeniedError());
    for (const name of ACTION_NAMES) await run(call(name));
    const logged = loggedWithoutIds();
    for (const value of [...PERSONAL, ...AREAS]) expect(logged, value).not.toContain(value);
  });
});
