import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import {
  BuildingNotEmptyError,
  floorAreaInputSchema,
  FloorNotEmptyError,
  PropertyMissingError,
} from "@/core/buildings";
import { initialFormState, NO_ACCESS, UNKNOWN_ERROR, type FormState } from "../../../form-state";

/*
 * Server actions på bygningssiden /oppdrag/[id]/bygninger
 * (docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 6). Kjernen og konteksten er
 * byttet ut her; kjernen testes i src/core/buildings. Testene viser at hver handling henter
 * organisasjonen på serveren, stopper id-er som ikke er uuid før kjernen kalles, gir de faste
 * meldingene, og aldri sender skjemaverdier til loggen.
 *
 * Kortet låser ikke navnene på handlingene eller feltene. Testen finner alle eksporterte
 * funksjoner i ./actions og sender et skjema med alle feltene fra kortet (assignmentId,
 * buildingId, floorId, roomId, name, level, belowGround, braI, braE, braB, alh, measuredBy,
 * method, comment, roomType, areaType). Hvilken kjernefunksjon en handling bruker, finnes ved å
 * kjøre den én gang.
 *
 * Testdata er oppdiktet. Støtter hovedmål: tid (feil vises ved feltet med fast tekst) og
 * reklamasjoner (aldri feil organisasjon; aldri navn, kommentar eller arealtall i loggen).
 */

const CORE_NAMES = [
  "getAssignmentBuildings",
  "saveBuilding",
  "removeBuilding",
  "saveFloor",
  "removeFloor",
  "saveFloorArea",
  "saveRoom",
  "removeRoom",
] as const;
type CoreName = (typeof CORE_NAMES)[number];

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

const actionsModule = (await import("./actions")) as unknown as Record<string, unknown>;

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;
const ACTIONS: [string, Action][] = Object.entries(actionsModule)
  .filter((entry): entry is [string, Action] => typeof entry[1] === "function")
  .sort(([a], [b]) => a.localeCompare(b));

const ORG = "0190a000-0000-7000-8000-000000000001";
const OTHER_ORG = "0190a000-0000-7000-8000-000000000002";
const ASSIGNMENT = "0190a000-0000-7000-8000-000000000050";
const BUILDING = "0190a000-0000-7000-8000-000000000051";
const FLOOR = "0190a000-0000-7000-8000-000000000052";
const ROOM = "0190a000-0000-7000-8000-000000000053";
const EMPLOYEE = "0190a000-0000-7000-8000-000000000060";
/** Et felt `id` i skjemaet (kortet bruker det ikke), med egen verdi så testen ser om det leses. */
const OTHER_ID = "0190a000-0000-7000-8000-000000000054";
const actor = { id: "user-kontor", email: "kontor@eksempel.no", name: "Kontor Testdatter" };

const HOUSE = "Bolighus";
const ROOM_NAME = "Rom test";
const COMMENT = "Målt langs innvendig vegg test";
const SENSITIVE = [HOUSE, ROOM_NAME, COMMENT, "Målt langs", "123,4", "56,7", "210,3", "8,9"];

const ID_FIELDS = ["assignmentId", "buildingId", "floorId", "roomId", "id"] as const;

/** Alle feltene fra kortet, med gyldige verdier. */
function allFields(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    assignmentId: ASSIGNMENT,
    buildingId: BUILDING,
    floorId: FLOOR,
    roomId: ROOM,
    id: OTHER_ID,
    name: HOUSE,
    level: "-1",
    belowGround: "on",
    braI: "123,4",
    braE: "56,7",
    braB: "8,9",
    alh: "210,3",
    measuredBy: EMPLOYEE,
    method: "laser",
    comment: COMMENT,
    roomType: "bathroom",
    areaType: "bra_i",
    ...overrides,
  };
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function coreCalls() {
  return Object.values(mocks.core).reduce((sum, fn) => sum + fn.mock.calls.length, 0);
}

function calledCore(): CoreName[] {
  return CORE_NAMES.filter((name) => mocks.core[name].mock.calls.length > 0);
}

/**
 * Alt loggeren fikk, som tekst, med uuid-er byttet ut med «<id>». Id-ene kan stå i loggen, men
 * skjemaverdiene skal ikke.
 */
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

function resolveAll() {
  for (const name of CORE_NAMES) {
    mocks.core[name].mockReset();
    mocks.core[name].mockResolvedValue({ id: ROOM, created: false, changed: true });
  }
}

/** Kjernefunksjonene handlingen bruker med et gyldig skjema. */
async function coreUsedBy(action: Action): Promise<CoreName[]> {
  resolveAll();
  await run(action(initialFormState, form(allFields())));
  const used = calledCore();
  resolveAll();
  return used;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEmployeeContext.mockResolvedValue({
    actor,
    organizationId: ORG,
    canEditOrders: true,
    officeId: null,
  });
  resolveAll();
});

describe("handlingene finnes", () => {
  it("modulen eksporterer minst sju handlinger, og hver bruker en kjernefunksjon med et gyldig skjema", async () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(7);
    const used = new Set<CoreName>();
    for (const [name, action] of ACTIONS) {
      const core = await coreUsedBy(action);
      expect(core.length, `${name} kaller kjernen`).toBeGreaterThan(0);
      for (const entry of core) used.add(entry);
    }
    for (const name of CORE_NAMES.filter((n) => n !== "getAssignmentBuildings")) {
      expect(used.has(name), `en handling bruker ${name}`).toBe(true);
    }
  });
});

describe("6.1 uten kontekst", () => {
  it.each(ACTIONS)(
    "%s: getEmployeeContext gir null → NO_ACCESS uten kall til kjernen",
    async (_name, action) => {
      mocks.getEmployeeContext.mockResolvedValue(null);
      const state = await failed(action(initialFormState, form(allFields())));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );
});

describe("6.2 id som ikke er uuid", () => {
  const BAD_IDS = ["ikke-en-id", "1 or 1=1", "../x", "0190a000-0000-7000-8000-00000000005"];
  const cases = ACTIONS.flatMap(([name, action]) => BAD_IDS.map((bad) => ({ name, action, bad })));

  it.each(cases)(
    "$name: alle id-felt «$bad» → NO_ACCESS uten kall til kjernen",
    async ({ action, bad }) => {
      const ids = Object.fromEntries(ID_FIELDS.map((field) => [field, bad]));
      const state = await failed(action(initialFormState, form(allFields(ids))));
      expect(state.message).toBe(NO_ACCESS);
      expect(coreCalls()).toBe(0);
    },
  );

  it.each(ACTIONS)(
    "%s: hvert id-felt kjernen får, er stoppet når det ikke er uuid",
    async (_name, action) => {
      const used = await coreUsedBy(action);
      // Id-feltene handlingen sender til kjernen (de står i kallet)
      await run(action(initialFormState, form(allFields())));
      const called = JSON.stringify(used.map((name) => mocks.core[name].mock.calls));
      const sent = ID_FIELDS.filter((field) => called.includes(allFields()[field]!));
      expect(sent.length, "handlingen sender minst én id til kjernen").toBeGreaterThan(0);
      for (const field of sent) {
        resolveAll();
        const state = await failed(
          action(initialFormState, form(allFields({ [field]: "ikke-en-id" }))),
        );
        expect(state.message, field).toBe(NO_ACCESS);
        expect(coreCalls(), field).toBe(0);
      }
    },
  );
});

describe("6.3 organisasjonen kommer fra konteksten", () => {
  it.each(ACTIONS)(
    "%s: organizationId i skjemaet endrer ikke kallet; kjernen får aktøren og ORG",
    async (_name, action) => {
      await run(action(initialFormState, form(allFields({ organizationId: OTHER_ORG }))));
      const used = calledCore();
      expect(used.length).toBeGreaterThan(0);
      for (const name of used) {
        const [calledActor, calledOrg] = mocks.core[name].mock.calls[0]!;
        expect(calledActor).toEqual(actor);
        expect(calledOrg).toBe(ORG);
      }
      expect(JSON.stringify(used.map((name) => mocks.core[name].mock.calls))).not.toContain(
        OTHER_ORG,
      );
    },
  );

  it.each(ACTIONS)("%s: lykket lagring gir ingen feil", async (_name, action) => {
    const state = await run(action(initialFormState, form(allFields())));
    if (state) {
      expect(state.message).toBeNull();
      expect(state.fieldErrors).toEqual({});
    }
  });
});

function rejectAll(error: unknown) {
  for (const name of CORE_NAMES) mocks.core[name].mockRejectedValue(error);
}

describe("6.4 feil fra kjernen", () => {
  it.each(ACTIONS)("%s: AccessDeniedError → NO_ACCESS", async (_name, action) => {
    rejectAll(new AccessDeniedError());
    const state = await failed(action(initialFormState, form(allFields())));
    expect(state.message).toBe(NO_ACCESS);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  const KNOWN = [
    [
      "PropertyMissingError",
      () => new PropertyMissingError(),
      "saveBuilding",
      "Legg inn eiendommen før du legger til bygninger.",
    ],
    [
      "BuildingNotEmptyError",
      () => new BuildingNotEmptyError(),
      "removeBuilding",
      "Fjern etasjene først.",
    ],
    ["FloorNotEmptyError", () => new FloorNotEmptyError(), "removeFloor", "Fjern rommene først."],
  ] as const;

  it.each(KNOWN)(
    "%s → norsk melding i handlingen som bruker %s, ikke UNKNOWN_ERROR, og ingen logg",
    async (_name, make, coreName, message) => {
      let checked = 0;
      for (const [actionName, action] of ACTIONS) {
        const used = await coreUsedBy(action);
        if (!used.includes(coreName)) continue;
        vi.clearAllMocks();
        rejectAll(make());
        const state = await failed(action(initialFormState, form(allFields())));
        expect(allMessages(state), actionName).toContain(message);
        expect(state.message, actionName).not.toBe(UNKNOWN_ERROR);
        expect(mocks.logError, actionName).not.toHaveBeenCalled();
        checked += 1;
      }
      expect(checked, `minst én handling bruker ${coreName}`).toBeGreaterThan(0);
    },
  );

  it.each(KNOWN)("%s → aldri UNKNOWN_ERROR i noen handling", async (_name, make) => {
    for (const [actionName, action] of ACTIONS) {
      vi.clearAllMocks();
      rejectAll(make());
      const state = await failed(action(initialFormState, form(allFields())));
      expect(state.message, actionName).not.toBe(UNKNOWN_ERROR);
    }
  });

  it("ZodError fra arealet → arealmeldingen ved feltet, og verdien står igjen", async () => {
    const result = floorAreaInputSchema.safeParse({ braI: "12,34" });
    expect(result.success).toBe(false);
    let checked = 0;
    for (const [actionName, action] of ACTIONS) {
      const used = await coreUsedBy(action);
      if (!used.includes("saveFloorArea")) continue;
      rejectAll(result.error);
      const state = await failed(action(initialFormState, form(allFields({ braI: "12,34" }))));
      expect(state.fieldErrors.braI, actionName).toBe(
        "Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.",
      );
      expect(state.values, actionName).toMatchObject({ braI: "12,34" });
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it.each(ACTIONS)("%s: ukjent feil → UNKNOWN_ERROR", async (_name, action) => {
    rejectAll(new Error("oppdiktet feil"));
    const state = await failed(action(initialFormState, form(allFields())));
    expect(state.message).toBe(UNKNOWN_ERROR);
  });
});

describe("6.5 loggkontrakt", () => {
  it.each(ACTIONS)(
    "%s: ukjent feil logges bare med rute, bruker-id, id-er og feilnavn",
    async (_name, action) => {
      const boom = new Error(`databasen sa nei til ${SENSITIVE.join(" ")}`);
      boom.name = "OppdiktetFeil";
      rejectAll(boom);

      const state = await failed(action(initialFormState, form(allFields())));
      expect(state.message).toBe(UNKNOWN_ERROR);
      expect(mocks.logError).toHaveBeenCalledTimes(1);
      const logged = loggedWithoutIds();
      expect(logged).toContain("OppdiktetFeil");
      expect(logged).toContain(actor.id);
      for (const value of SENSITIVE) expect(logged, value).not.toContain(value);
      expect(logged).not.toContain("databasen sa nei");
    },
  );

  it("ingen kall til loggeren gir skjemaverdier, heller ikke ved kjente feil eller valideringsfeil", async () => {
    const zod = floorAreaInputSchema.safeParse({ braI: "12,34", comment: "12345678901" });
    const errors = [
      new AccessDeniedError(),
      new PropertyMissingError(),
      new BuildingNotEmptyError(),
      new FloorNotEmptyError(),
      zod.error,
      new Error("oppdiktet feil"),
    ];
    for (const error of errors) {
      for (const [, action] of ACTIONS) {
        rejectAll(error);
        await run(action(initialFormState, form(allFields())));
      }
    }
    const logged = loggedWithoutIds();
    for (const value of SENSITIVE) expect(logged, value).not.toContain(value);
    expect(logged).not.toContain("12345678901");
  });
});
