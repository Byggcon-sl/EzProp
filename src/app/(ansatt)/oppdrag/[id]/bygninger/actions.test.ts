import { readFileSync } from "node:fs";
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  addRoomsInputSchema,
  buildingInputSchema,
  floorAreaInputSchema,
  floorInputSchema,
  PropertyMissingError,
  roomInputSchema,
} from "@/core/buildings";
import {
  initialFormState,
  NO_ACCESS,
  SIGNED_OUT_MESSAGE,
  UNKNOWN_ERROR,
  type FormState,
} from "../../../form-state";

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
  /** Sann: getEmployeeContextForAction svarer «logget ut» (rett T-0070). */
  signedOut: { value: false },
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
    addRooms: vi.fn(),
    restoreBuilding: vi.fn(),
    restoreFloor: vi.fn(),
    restoreRoom: vi.fn(),
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/shared/lib/logger", () => ({
  logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn() },
}));
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
  addRoomsAction,
  restoreStructureAction,
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
  addRoomsAction: {
    assignmentId: ASSIGNMENT,
    floorId: FLOOR,
    source: "preset",
    presetKey: "apartment",
    drafts: JSON.stringify([
      { roomType: "bedroom", count: 2 },
      { roomType: "bathroom", count: 1 },
    ]),
  },
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
  addRoomsAction,
} as const;

const CORE_FOR_ACTION = {
  saveBuildingAction: mocks.core.saveBuilding,
  removeBuildingAction: mocks.core.removeBuilding,
  saveFloorAction: mocks.core.saveFloor,
  removeFloorAction: mocks.core.removeFloor,
  saveFloorAreaAction: mocks.core.saveFloorArea,
  saveRoomAction: mocks.core.saveRoom,
  removeRoomAction: mocks.core.removeRoom,
  addRoomsAction: mocks.core.addRooms,
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
  addRoomsAction: ["floorId"],
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

const ROOM_2 = "0190a000-0000-7000-8000-000000000054";

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
  mocks.signedOut.value = false;
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    canReadClaims: false,
    canManageClaims: false,
    canManageContacts: false,
    officeId: null,
  });
  for (const fn of Object.values(mocks.core)) fn.mockResolvedValue(undefined);
  // «Fjern» gir det som ble fjernet (slettegruppen, A414)
  mocks.core.removeBuilding.mockResolvedValue({ removed: [{ type: "building", id: BUILDING }] });
  mocks.core.removeFloor.mockResolvedValue({
    removed: [
      { type: "floor", id: FLOOR },
      { type: "room", id: ROOM },
      { type: "room", id: ROOM_2 },
    ],
  });
  mocks.core.removeRoom.mockResolvedValue({ id: ROOM });
});

/*
 * Rett T-0070 (docs/agenter/oppgaver/rett-t0070-t0071.md punkt 3, testplan 1d): utløpt innlogging
 * gir «logget ut»-svaret med bare de kjente feltene skjemaet sendte, før id-er sjekkes og før
 * kjernen kalles. Ingen videresending, ingen logg.
 */
describe("logget ut (rett T-0070)", () => {
  /** De kjente feltene hver handling gir tilbake (aldri id-er eller ukjente felt). */
  const SIGNED_OUT_VALUES: Record<ActionName, Record<string, string>> = {
    saveBuildingAction: { name: BUILDING_NAME },
    removeBuildingAction: {},
    saveFloorAction: { name: FLOOR_NAME, level: "-1", belowGround: "on" },
    removeFloorAction: {},
    saveFloorAreaAction: {
      braI: AREAS[0]!,
      braE: AREAS[1]!,
      braB: AREAS[2]!,
      alh: AREAS[3]!,
      measuredBy: MEASURER,
      method: "laser",
      comment: COMMENT,
    },
    saveRoomAction: { roomType: "bathroom", name: ROOM_NAME, areaType: "bra_i", belowGround: "" },
    removeRoomAction: {},
    addRoomsAction: {
      source: "preset",
      presetKey: "apartment",
      drafts: FORMS.addRoomsAction.drafts,
    },
  };

  beforeEach(() => {
    mocks.signedOut.value = true;
  });

  it.each(ACTION_NAMES)(
    "%s: signedOut med meldingen og verdiene, uten kjerne og uten logg",
    async (name) => {
      const state = await failed(call(name, { organizationId: OTHER_ORG }));
      expect(state).toEqual({
        fieldErrors: {},
        message: SIGNED_OUT_MESSAGE,
        values: SIGNED_OUT_VALUES[name],
        attempt: 1,
        signedOut: true,
        // «Fjern» svarer med `removed: null` når ingenting ble fjernet (papirkurven, A414).
        ...(name.startsWith("remove") ? { removed: null } : {}),
      });
      expect(coreCalls()).toBe(0);
      expect(mocks.getEmployeeContext).not.toHaveBeenCalled();
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.logError).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each(ACTION_NAMES)(
    "%s: samme svar for ugyldig id og gyldig id (ingen sjekk før innloggingen)",
    async (name) => {
      const invalid = Object.fromEntries(ID_FIELDS[name].map((field) => [field, "ikke-en-id"]));
      const withValid = await failed(call(name));
      const withInvalid = await failed(call(name, invalid));
      expect(withInvalid).toEqual(withValid);
      expect(coreCalls()).toBe(0);
    },
  );

  it("addRoomsAction: ugyldig romliste gir også bare «logget ut»", async () => {
    const state = await failed(call("addRoomsAction", { drafts: "ikke json" }));
    expect(state.signedOut).toBe(true);
    expect(state.message).toBe(SIGNED_OUT_MESSAGE);
    expect(coreCalls()).toBe(0);
  });
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

describe("6.4 takstmann uten skriverett (access.inspectors_edit_all av)", () => {
  // Kjernen avgjør: takstmannen får AccessDeniedError når innstillingen er av. Handlingen skal
  // ikke sjekke rollen selv, bare gi NO_ACCESS og ikke friske opp siden. Dekker hullet hvis en
  // knapp likevel skulle vises.
  beforeEach(() => {
    mocks.getEmployeeContext.mockResolvedValue({
      actor: { id: "user-takst", email: "takst@eksempel.no", name: "Takst Testsen" },
      organizationId: ORG,
      canEditOrders: false,
      canReadClaims: false,
      canManageClaims: false,
      canManageContacts: false,
      officeId: null,
    });
  });

  it.each(ACTION_NAMES)(
    "%s: kjernen kalles én gang, kaster AccessDeniedError, og svaret er NO_ACCESS uten revalidatePath",
    async (name) => {
      CORE_FOR_ACTION[name].mockRejectedValue(new AccessDeniedError());
      const state = await failed(call(name));
      expect(state.message).toBe(NO_ACCESS);
      expect(CORE_FOR_ACTION[name]).toHaveBeenCalledTimes(1);
      expect(CORE_FOR_ACTION[name].mock.calls[0]![1]).toBe(ORG);
      expect(coreCalls(), "ingen andre kjernekall").toBe(1);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    },
  );
});

describe("6.4 feil fra kjernen", () => {
  it.each(ACTION_NAMES)("%s: AccessDeniedError → NO_ACCESS", async (name) => {
    CORE_FOR_ACTION[name].mockRejectedValue(new AccessDeniedError());
    const state = await failed(call(name));
    expect(state.message).toBe(NO_ACCESS);
  });

  it.each([["saveBuildingAction", () => new PropertyMissingError(), PROPERTY_MISSING]] as const)(
    "%s: kjent feil → «%s»",
    async (name, make, message) => {
      CORE_FOR_ACTION[name].mockRejectedValue(make());
      const state = await failed(call(name));
      expect(allMessages(state)).toContain(message);
      expect(state.message).not.toBe(UNKNOWN_ERROR);
      expect(mocks.logError).not.toHaveBeenCalled();
    },
  );

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

  it.each([["PropertyMissingError", () => new PropertyMissingError()]] as const)(
    "%s → aldri UNKNOWN_ERROR i noen handling",
    async (_name, make) => {
      for (const name of ACTION_NAMES) {
        CORE_FOR_ACTION[name].mockRejectedValue(make());
        const state = await failed(call(name));
        expect(state.message, name).not.toBe(UNKNOWN_ERROR);
      }
    },
  );

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
    mocks.core.removeFloor.mockRejectedValue(new AccessDeniedError());
    mocks.core.saveFloorArea.mockRejectedValue(new AccessDeniedError());
    for (const name of ACTION_NAMES) await run(call(name));
    const logged = loggedWithoutIds();
    for (const value of [...PERSONAL, ...AREAS]) expect(logged, value).not.toContain(value);
  });
});

describe("F11 addRoomsAction (flere rom på én gang)", () => {
  const TOO_MANY = "Du kan legge til høyst 40 rom om gangen.";

  it("F11.3 gyldig sett: kjernen får (etasje, { drafts, source, presetKey }) og siden friskes opp", async () => {
    const state = await run(call("addRoomsAction"));
    expect(state?.message ?? null).toBeNull();
    const [calledActor, calledOrg, floorId, input] = mocks.core.addRooms.mock.calls[0]!;
    expect([calledActor, calledOrg, floorId]).toEqual([actor, ORG, FLOOR]);
    expect(input).toEqual({
      drafts: [
        { roomType: "bedroom", count: 2 },
        { roomType: "bathroom", count: 1 },
      ],
      source: "preset",
      presetKey: "apartment",
    });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/oppdrag/[id]/bygninger", "page");
  });

  it("F11.3 manuell: tomt presetKey sendes ikke videre", async () => {
    await run(call("addRoomsAction", { source: "manual", presetKey: "" }));
    const input = mocks.core.addRooms.mock.calls[0]![3] as Record<string, unknown>;
    expect(input.source).toBe("manual");
    expect("presetKey" in input).toBe(false);
  });

  it("F11.3 navn fra klienten sendes aldri videre (kjernen lager navnene)", async () => {
    await run(call("addRoomsAction", { name: ROOM_NAME, names: ROOM_NAME }));
    expect(JSON.stringify(mocks.core.addRooms.mock.calls)).not.toContain(ROOM_NAME);
  });

  it.each(["", "ikke json", "[{", "{roomType: bedroom}"])(
    "F11.2 ugyldig JSON «%s» → norsk melding uten kall til kjernen",
    async (drafts) => {
      const state = await failed(call("addRoomsAction", { drafts }));
      expect(state.message).toBe("Noe gikk galt med romlisten. Prøv igjen.");
      expect(state.values.drafts).toBe(drafts);
      expect(coreCalls()).toBe(0);
      expect(mocks.logError).not.toHaveBeenCalled();
    },
  );

  it("F11.2 over 40 rom: meldingen fra kjernen vises, verdiene står igjen, ingen oppfrisking", async () => {
    mocks.core.addRooms.mockRejectedValue(
      new ZodError([{ code: "custom", path: ["drafts"], message: TOO_MANY, input: undefined }]),
    );
    const drafts = JSON.stringify([
      { roomType: "bedroom", count: 20 },
      { roomType: "storage", count: 20 },
      { roomType: "bathroom", count: 1 },
    ]);
    const state = await failed(call("addRoomsAction", { source: "manual", presetKey: "", drafts }));
    expect(allMessages(state)).toContain(TOO_MANY);
    expect(state.message).not.toBe(UNKNOWN_ERROR);
    expect(state.values.drafts).toBe(drafts);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
    expect(mocks.logError).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// F11 addRoomsAction (serverhandlingen for flere rom)
// docs/funksjoner/fase2a-flere-rom-testplan.md F11
// ---------------------------------------------------------------------------------------------

describe("F11 addRoomsAction (feilformer og ok)", () => {
  it("F11.2 action_error_shape: 41 rom gir ZodError fra kjernen med norsk melding, aldri 500", async () => {
    const parsed = addRoomsInputSchema.safeParse({
      drafts: [
        { roomType: "bedroom", count: 20 },
        { roomType: "storage", count: 20 },
        { roomType: "kitchen", count: 1 },
      ],
      source: "manual",
    });
    expect(parsed.success).toBe(false);
    mocks.core.addRooms.mockRejectedValue(parsed.error);

    const state = await failed(
      call("addRoomsAction", {
        drafts: JSON.stringify([
          { roomType: "bedroom", count: 20 },
          { roomType: "storage", count: 20 },
          { roomType: "kitchen", count: 1 },
        ]),
      }),
    );
    expect(state.message).not.toBe(UNKNOWN_ERROR);
    const messages = allMessages(state).join(" ");
    expect(messages).toMatch(/40/);
    expect(messages).not.toMatch(/expected|required|invalid/i);
  });

  it("F11.2 action_error_shape: ugyldig JSON i romlisten gir norsk melding, aldri 500", async () => {
    const state = await failed(call("addRoomsAction", { drafts: "{ikke json" }));
    expect(state.message).not.toBe(UNKNOWN_ERROR);
    expect(state.message ?? "").toMatch(/[æøå]|rom/i);
    // Kjernen ble aldri kalt med ødelagt liste
    expect(mocks.core.addRooms).not.toHaveBeenCalled();
  });

  it("F11.3 action_ok: gyldig sett gir ok og revalidatePath for bygningssiden", async () => {
    const state = await run(call("addRoomsAction"));
    expect(state?.message ?? null).toBeNull();
    expect(mocks.core.addRooms).toHaveBeenCalledTimes(1);
    const [, org, floorId, input] = mocks.core.addRooms.mock.calls[0]!;
    expect(org).toBe(ORG);
    expect(floorId).toBe(FLOOR);
    expect(input).toMatchObject({ source: "preset" });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Papirkurv: «Fjern» gir slettegruppen, og «Angre»/«Gjenopprett» (restoreStructureAction)
// docs/funksjoner/fase2a-papirkurv-testplan.md avsnitt 8
// ---------------------------------------------------------------------------------------------

describe("8 papirkurv: «Fjern» svarer med det som ble fjernet", () => {
  it("removeFloorAction: etasjen og rommene i slettegruppen står i svaret (A414)", async () => {
    const state = await removeFloorAction(initialFormState, form(FORMS.removeFloorAction));
    expect(state.message).toBeNull();
    expect(state.removed).toEqual([
      { type: "floor", id: FLOOR },
      { type: "room", id: ROOM },
      { type: "room", id: ROOM_2 },
    ]);
  });

  it("removeBuildingAction og removeRoomAction gir det som ble fjernet", async () => {
    const building = await removeBuildingAction(initialFormState, form(FORMS.removeBuildingAction));
    expect(building.removed).toEqual([{ type: "building", id: BUILDING }]);
    const room = await removeRoomAction(initialFormState, form(FORMS.removeRoomAction));
    expect(room.removed).toEqual([{ type: "room", id: ROOM }]);
  });

  it("feil gir `removed: null` og ingen oppfrisking", async () => {
    mocks.core.removeFloor.mockRejectedValue(new AccessDeniedError());
    const state = await removeFloorAction(initialFormState, form(FORMS.removeFloorAction));
    expect(state.message).toBe(NO_ACCESS);
    expect(state.removed).toBeNull();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("8.3 «Fjern etasjene først.» og «Fjern rommene først.» finnes ikke lenger i handlingene", () => {
    const source = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/NotEmptyError/);
    expect(source).not.toContain("Fjern etasjene først.");
    expect(source).not.toContain("Fjern rommene først.");
  });
});

const RESTORE_CASES = [
  ["building", BUILDING, mocks.core.restoreBuilding],
  ["floor", FLOOR, mocks.core.restoreFloor],
  ["room", ROOM, mocks.core.restoreRoom],
] as const;

describe("8 restoreStructureAction («Angre» og «Gjenopprett»)", () => {
  beforeEach(() => {
    for (const [type, id, fn] of RESTORE_CASES) {
      fn.mockResolvedValue({
        restored: [{ type, id, organizationId: ORG }],
        changed: true,
        notices: [],
      });
    }
  });

  it.each(RESTORE_CASES)(
    "8.1 %s: kjernen får aktøren, ORG fra økten, id-en og how; organizationId fra kalleren leses aldri",
    async (type, id, fn) => {
      const result = await restoreStructureAction({
        type,
        id,
        how: "undo",
        organizationId: OTHER_ORG,
      } as never);
      expect(result).toEqual({ ok: true, restored: [{ type, id }], changed: true, notices: [] });
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn.mock.calls[0]).toEqual([actor, ORG, id, "undo"]);
      expect(JSON.stringify(fn.mock.calls)).not.toContain(OTHER_ORG);
      expect(coreCalls()).toBe(1);
    },
  );

  it("8.1 svaret har ingen organisasjons-id, bare type og id", async () => {
    mocks.core.restoreRoom.mockResolvedValue({
      restored: [
        { type: "floor", id: FLOOR, organizationId: ORG },
        { type: "room", id: ROOM, organizationId: ORG },
      ],
      changed: true,
      notices: ["Rommet kom tilbake, sammen med etasjen «1. etasje»."],
    });
    const result = await restoreStructureAction({ type: "room", id: ROOM, how: "trash" });
    expect(JSON.stringify(result)).not.toContain(ORG);
    expect(result).toMatchObject({
      ok: true,
      notices: ["Rommet kom tilbake, sammen med etasjen «1. etasje»."],
    });
  });

  it.each(RESTORE_CASES)(
    "8.2 %s: AccessDeniedError gir fast norsk tekst, uten stakk eller id, og ingen oppfrisking",
    async (type, id, fn) => {
      fn.mockRejectedValue(new AccessDeniedError());
      const result = await restoreStructureAction({ type, id, how: "trash" });
      expect(result).toEqual({ ok: false, message: NO_ACCESS });
      expect(JSON.stringify(result)).not.toContain(id);
      expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
      expect(mocks.logError).not.toHaveBeenCalled();
    },
  );

  it("8.2 ukjent feil: fast tekst, logges bare med rute, bruker-id, id og feilnavn", async () => {
    const boom = new Error(`databasen sa nei til ${PERSONAL.join(" ")}`);
    boom.name = "OppdiktetFeil";
    mocks.core.restoreFloor.mockRejectedValue(boom);
    const result = await restoreStructureAction({ type: "floor", id: FLOOR, how: "undo" });
    expect(result).toEqual({ ok: false, message: UNKNOWN_ERROR });
    expect(JSON.stringify(result)).not.toContain("OppdiktetFeil");
    expect(mocks.logError).toHaveBeenCalledTimes(1);
    const logged = loggedWithoutIds();
    expect(logged).toContain("OppdiktetFeil");
    expect(logged).toContain(actor.id);
    for (const value of PERSONAL) expect(logged, value).not.toContain(value);
  });

  it.each([
    ["ugyldig id", { type: "room", id: "ikke-en-id", how: "undo" }],
    ["tom id", { type: "room", id: "", how: "undo" }],
    ["ukjent type", { type: "party", id: ROOM, how: "undo" }],
    ["ukjent how", { type: "room", id: ROOM, how: "slett" }],
  ] as const)("%s → fast tekst uten kall til kjernen", async (_name, input) => {
    const result = await restoreStructureAction(input);
    expect(result).toEqual({ ok: false, message: NO_ACCESS });
    expect(coreCalls()).toBe(0);
  });

  it("uten ansattkontekst → fast tekst uten kall til kjernen", async () => {
    mocks.getEmployeeContext.mockResolvedValue(null);
    const result = await restoreStructureAction({ type: "room", id: ROOM, how: "undo" });
    expect(result).toEqual({ ok: false, message: NO_ACCESS });
    expect(coreCalls()).toBe(0);
  });

  it("8.4 revaliderer bygningsskjermen og oppdragssiden", async () => {
    await restoreStructureAction({ type: "building", id: BUILDING, how: "trash" });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/oppdrag/[id]/bygninger", "page");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/oppdrag/[id]", "page");
  });
});
