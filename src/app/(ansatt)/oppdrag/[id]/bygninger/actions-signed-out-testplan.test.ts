import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees, organizations } from "@/db/schema";
import { SIGNED_OUT_MESSAGE } from "@/shared/forms/messages";
import {
  createAssignment,
  createBuilding,
  createEmployee,
  createFloor,
  createOffice,
  createOrganization,
  createProperty,
  createRoom,
  createUser,
  resetDatabase,
} from "../../../../../../tests/factories";
import { initialFormState, NO_ACCESS, type FormState } from "../../../form-state";

/*
 * Rett T-0070: bygningshandlingene og «Legg til flere rom» med utløpt innlogging (testplan
 * docs/agenter/oppgaver/rett-t0070-t0071-testplan.md avsnitt 1d). Integrasjon mot testdatabasen.
 * Bare Better Auth (økten), forespørselshodene, `redirect`, `revalidatePath` og loggeren er
 * byttet ut. `session.ts`, `employee-context.ts` og kjernen er ekte; kjernefunksjonene er pakket
 * i spioner som kaller de ekte.
 *
 * Testdata er oppdiktet («Anneks test», «Loft test», «Soverom test»). Støtter hovedmål: de
 * ansatte (dialog, tellere og verdier kommer tilbake med «Du er logget ut») og færre
 * reklamasjoner (aldri lagret i feil organisasjon, aldri skjemaverdier i loggen).
 */

const CORE_NAMES = [
  "saveBuilding",
  "removeBuilding",
  "saveFloor",
  "removeFloor",
  "saveFloorArea",
  "saveRoom",
  "removeRoom",
  "addRooms",
] as const;

const mocks = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string; name: string } },
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
  revalidatePath: vi.fn(),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  core: {} as Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/shared/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@/core/auth/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => mocks.session) } },
}));
vi.mock("@/core/buildings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/buildings")>();
  const wrapped: Record<string, unknown> = {};
  for (const name of [
    "saveBuilding",
    "removeBuilding",
    "saveFloor",
    "removeFloor",
    "saveFloorArea",
    "saveRoom",
    "removeRoom",
    "addRooms",
  ] as const) {
    const spy = vi.fn(actual[name] as (...args: unknown[]) => unknown);
    mocks.core[name] = spy;
    wrapped[name] = spy;
  }
  return { ...actual, ...wrapped };
});

const actions = await import("./actions");

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

const NEW_BUILDING = "Anneks test";
const NEW_FLOOR = "Loft test";
const NEW_ROOM = "Soverom test";
const NEW_COMMENT = "Oppdiktet kommentar test";
const FORM_TEXTS = [NEW_BUILDING, NEW_FLOOR, NEW_ROOM, NEW_COMMENT, "77,7"];
const MISSING_ID = "0190a000-0000-7000-8000-00000000dead";
const TABLES = ["report_buildings", "floors", "floor_areas", "rooms", "events"] as const;

beforeEach(async () => {
  await resetDatabase();
  vi.clearAllMocks();
  mocks.session = null;
});

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function signIn(actor: Actor) {
  mocks.session = { user: { id: actor.id, email: actor.email, name: actor.name } };
}

function coreCalls(): number {
  return CORE_NAMES.reduce((sum, name) => sum + (mocks.core[name]?.mock.calls.length ?? 0), 0);
}

async function setInspectorsEditAll(organizationId: string, value: boolean) {
  await db
    .update(organizations)
    .set({ settings: { "access.inspectors_edit_all": value } })
    .where(eq(organizations.id, organizationId));
}

/** Alle rader i bygningstabellene for organisasjonen, med alle kolonnene (også updated_at). */
async function snapshot(organizationId: string): Promise<string> {
  const all: Record<string, unknown> = {};
  for (const table of TABLES) {
    all[table] = await db.execute(
      sql`select * from ${sql.identifier(table)} where organization_id = ${organizationId} order by id`,
    );
  }
  return JSON.stringify(all);
}

async function activeCount(table: (typeof TABLES)[number], organizationId: string) {
  const rows = (await db.execute(
    sql`select count(*)::int as n from ${sql.identifier(table)}
        where organization_id = ${organizationId} and deleted_at is null`,
  )) as unknown as { n: number }[];
  return rows[0]?.n ?? 0;
}

/** Oppdrag med eiendom, en bygning med etasje og rom, en tom bygning og en tom etasje. */
async function setup(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const office = await createOffice(org.id);
  const assignment = await createAssignment(org.id, { officeId: office.id });
  await createProperty(org.id, { assignmentId: assignment.id });
  const building = await createBuilding(org.id, { assignmentId: assignment.id, name: "Bolighus" });
  const floor = await createFloor(org.id, { buildingId: building.id, name: "1. etasje" });
  const room = await createRoom(org.id, { floorId: floor.id, name: "Rom test" });
  const emptyBuilding = await createBuilding(org.id, {
    assignmentId: assignment.id,
    name: "Garasje test",
  });
  const emptyFloor = await createFloor(org.id, { buildingId: building.id, name: "Kjeller" });
  return { org, assignment, building, floor, room, emptyBuilding, emptyFloor };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Skjemaet for hver handling, med gyldige verdier. `measuredBy` er en ansatt i organisasjonen. */
function cases(s: Setup, measuredBy: string): [string, Action, Record<string, string>][] {
  return [
    [
      "saveBuildingAction (ny)",
      actions.saveBuildingAction,
      { assignmentId: s.assignment.id, buildingId: "", name: NEW_BUILDING },
    ],
    [
      "saveBuildingAction (eksisterende)",
      actions.saveBuildingAction,
      { assignmentId: s.assignment.id, buildingId: s.building.id, name: NEW_BUILDING },
    ],
    [
      "removeBuildingAction",
      actions.removeBuildingAction,
      { assignmentId: s.assignment.id, buildingId: s.emptyBuilding.id },
    ],
    [
      "saveFloorAction (ny)",
      actions.saveFloorAction,
      {
        assignmentId: s.assignment.id,
        buildingId: s.building.id,
        floorId: "",
        name: NEW_FLOOR,
        level: "2",
      },
    ],
    [
      "saveFloorAreaAction",
      actions.saveFloorAreaAction,
      {
        assignmentId: s.assignment.id,
        floorId: s.floor.id,
        braI: "77,7",
        braE: "",
        braB: "",
        alh: "",
        measuredBy,
        method: "laser",
        comment: NEW_COMMENT,
      },
    ],
    [
      "saveRoomAction (ny)",
      actions.saveRoomAction,
      {
        assignmentId: s.assignment.id,
        floorId: s.floor.id,
        roomId: "",
        roomType: "bedroom",
        name: NEW_ROOM,
        areaType: "bra_i",
      },
    ],
    [
      "addRoomsAction",
      actions.addRoomsAction,
      {
        assignmentId: s.assignment.id,
        floorId: s.floor.id,
        source: "manual",
        presetKey: "",
        drafts: JSON.stringify([
          { roomType: "bedroom", count: 2 },
          { roomType: "bathroom", count: 1 },
        ]),
      },
    ],
    [
      "removeRoomAction",
      actions.removeRoomAction,
      { assignmentId: s.assignment.id, roomId: s.room.id },
    ],
    [
      "removeFloorAction",
      actions.removeFloorAction,
      { assignmentId: s.assignment.id, floorId: s.emptyFloor.id },
    ],
  ];
}

function expectOnlySentFields(name: string, state: FormState, sent: Record<string, string>) {
  for (const [key, value] of Object.entries(state.values)) {
    if (key === "belowGround") {
      // Avkrysningen: «on» bare når den ble sendt
      expect(value, `${name}: ${key}`).toBe(sent[key] ?? "");
      continue;
    }
    expect(Object.keys(sent), `${name}: feltet ${key} ble sendt`).toContain(key);
    expect(value, `${name}: ${key}`).toBe(sent[key]);
  }
  expect(state.values, name).not.toHaveProperty("organizationId");
}

describe("1d bygningshandlingene: logget ut", () => {
  it("hver handling svarer «logget ut» med bare feltene skjemaet sendte; ingen videresending, ingenting lagret, kjernen kalles ikke", async () => {
    const s = await setup();
    const before = await snapshot(s.org.id);

    for (const [name, action, entries] of cases(s, MISSING_ID)) {
      const sent = { ...entries, organizationId: s.org.id };
      const state = await action(initialFormState, form(sent));
      expect(state.signedOut, name).toBe(true);
      expect(state.message, name).toBe(SIGNED_OUT_MESSAGE);
      expect(state.fieldErrors, name).toEqual({});
      expect(state.attempt, name).toBe(1);
      expectOnlySentFields(name, state, sent);
    }

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(coreCalls()).toBe(0);
    expect(await snapshot(s.org.id)).toBe(before);
  });

  it("«Legg til flere rom» gir tilbake romlisten (tellere og valg) uendret", async () => {
    const s = await setup();
    const drafts = JSON.stringify([
      { roomType: "bedroom", count: 3 },
      { roomType: "kitchen", count: 1 },
    ]);
    const state = await actions.addRoomsAction(
      initialFormState,
      form({
        assignmentId: s.assignment.id,
        floorId: s.emptyFloor.id,
        source: "preset",
        presetKey: "apartment",
        drafts,
      }),
    );
    expect(state.signedOut).toBe(true);
    expect(state.values).toMatchObject({ source: "preset", presetKey: "apartment", drafts });
    expect(await activeCount("rooms", s.org.id)).toBe(1);
  });

  it("ugyldig skjema og ugyldige id-er gir også «logget ut», og kjernen kalles ikke", async () => {
    const s = await setup();
    const invalid: [string, Action, Record<string, string>][] = [
      [
        "saveBuildingAction uten navn",
        actions.saveBuildingAction,
        { assignmentId: s.assignment.id, buildingId: "", name: "" },
      ],
      [
        "saveFloorAction med ugyldig nivå",
        actions.saveFloorAction,
        {
          assignmentId: s.assignment.id,
          buildingId: s.building.id,
          floorId: "",
          name: NEW_FLOOR,
          level: "x",
        },
      ],
      [
        "saveFloorAreaAction med ugyldig tall",
        actions.saveFloorAreaAction,
        {
          assignmentId: s.assignment.id,
          floorId: s.floor.id,
          braI: "12,345",
          braE: "",
          braB: "",
          alh: "",
          measuredBy: "",
          method: "",
          comment: "",
        },
      ],
      [
        "addRoomsAction med ødelagt liste",
        actions.addRoomsAction,
        {
          assignmentId: s.assignment.id,
          floorId: s.emptyFloor.id,
          source: "manual",
          presetKey: "",
          drafts: "{ikke json",
        },
      ],
      [
        "saveRoomAction med id som ikke er uuid",
        actions.saveRoomAction,
        {
          assignmentId: s.assignment.id,
          floorId: "ikke-en-id",
          roomId: "",
          roomType: "bedroom",
          name: NEW_ROOM,
          areaType: "bra_i",
        },
      ],
    ];
    for (const [name, action, entries] of invalid) {
      const state = await action(initialFormState, form(entries));
      expect(state.signedOut, name).toBe(true);
      expect(state.message, name).toBe(SIGNED_OUT_MESSAGE);
      expect(state.fieldErrors, name).toEqual({});
    }
    expect(coreCalls()).toBe(0);
  });

  it("svaret er det samme for en id som finnes og en som ikke finnes", async () => {
    const s = await setup();
    const pairs: [string, Action, Record<string, string>, Record<string, string>][] = [
      ["removeRoomAction", actions.removeRoomAction, { roomId: s.room.id }, { roomId: MISSING_ID }],
      [
        "removeFloorAction",
        actions.removeFloorAction,
        { floorId: s.emptyFloor.id },
        { floorId: MISSING_ID },
      ],
      [
        "removeBuildingAction",
        actions.removeBuildingAction,
        { buildingId: s.emptyBuilding.id },
        { buildingId: MISSING_ID },
      ],
      [
        "saveRoomAction",
        actions.saveRoomAction,
        {
          floorId: s.floor.id,
          roomId: s.room.id,
          roomType: "bedroom",
          name: NEW_ROOM,
          areaType: "bra_i",
        },
        {
          floorId: MISSING_ID,
          roomId: MISSING_ID,
          roomType: "bedroom",
          name: NEW_ROOM,
          areaType: "bra_i",
        },
      ],
    ];
    for (const [name, action, existing, missing] of pairs) {
      const a = await action(
        initialFormState,
        form({ assignmentId: s.assignment.id, ...existing }),
      );
      const b = await action(initialFormState, form({ assignmentId: s.assignment.id, ...missing }));
      expect(b, name).toEqual(a);
      expect(a.signedOut, name).toBe(true);
    }
    expect(coreCalls()).toBe(0);
  });

  it("ingen skjemaverdier i loggen", async () => {
    const s = await setup();
    for (const [, action, entries] of cases(s, MISSING_ID)) {
      await action(initialFormState, form(entries));
    }
    const logged = JSON.stringify(Object.values(mocks.log).map((fn) => fn.mock.calls));
    for (const text of FORM_TEXTS) expect(logged).not.toContain(text);
  });
});

describe("1d bygningshandlingene: innlogget uten aktiv ansattrad", () => {
  it("myk slettet ansatt får NO_ACCESS (ikke «logget ut») i hver handling, og ingenting lagres", async () => {
    const s = await setup();
    const user = await createUser();
    const employee = await createEmployee(user, s.org.id, ["admin"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employee.id));
    signIn(user);
    const before = await snapshot(s.org.id);

    for (const [name, action, entries] of cases(s, employee.id)) {
      const state = await action(initialFormState, form(entries));
      expect(state.message, name).toBe(NO_ACCESS);
      expect(state.signedOut, name).toBeUndefined();
    }
    expect(coreCalls()).toBe(0);
    expect(await snapshot(s.org.id)).toBe(before);
  });
});

describe("1d bygningshandlingene: tenant", () => {
  it("en bruker i A som sender organizationId og id-er fra B får NO_ACCESS, og radene i B er uendret", async () => {
    const a = await setup("Organisasjon A test");
    const b = await setup("Organisasjon B test");
    const userA = await createUser();
    const employeeA = await createEmployee(userA, a.org.id, ["admin"]);
    signIn(userA);
    const beforeB = await snapshot(b.org.id);

    for (const [name, action, entries] of cases(b, employeeA.id)) {
      const state = await action(initialFormState, form({ ...entries, organizationId: b.org.id }));
      expect(state.message, name).toBe(NO_ACCESS);
    }
    expect(await snapshot(b.org.id)).toBe(beforeB);
    // Kjernen fikk alltid organisasjonen fra tilgangssjekken (A), aldri B fra skjemaet
    for (const name of CORE_NAMES) {
      for (const call of mocks.core[name]!.mock.calls) expect(call[1], name).toBe(a.org.id);
    }
  });

  it("etter ny innlogging som en bruker fra B gir Lagre på A sitt oppdrag NO_ACCESS", async () => {
    const a = await setup("Organisasjon A test");
    const b = await setup("Organisasjon B test");
    const userB = await createUser();
    const employeeB = await createEmployee(userB, b.org.id, ["admin"]);

    const signedOut = await actions.saveBuildingAction(
      initialFormState,
      form({ assignmentId: a.assignment.id, buildingId: "", name: NEW_BUILDING }),
    );
    expect(signedOut.signedOut).toBe(true);

    signIn(userB);
    const beforeA = await snapshot(a.org.id);
    for (const [name, action, entries] of cases(a, employeeB.id)) {
      const state = await action(signedOut, form(entries));
      expect(state.message, name).toBe(NO_ACCESS);
    }
    expect(await snapshot(a.org.id)).toBe(beforeA);
  });
});

describe("1d bygningshandlingene: roller (admin stenges aldri ute)", () => {
  it.each(["admin", "manager", "office", "inspector"] as const)(
    "%s får lagret i hver handling",
    async (role) => {
      const s = await setup();
      await setInspectorsEditAll(s.org.id, true);
      const user = await createUser();
      const employee = await createEmployee(user, s.org.id, [role]);
      signIn(user);

      for (const [name, action, entries] of cases(s, employee.id)) {
        const state = await action(initialFormState, form(entries));
        expect(state.message, name).toBeNull();
        expect(state.signedOut, name).toBeUndefined();
      }
      // 1 + ny bygning − tom bygning = 2 bygninger; rommene fra dialogen er lagt til
      expect(await activeCount("report_buildings", s.org.id)).toBe(2);
      expect(await activeCount("rooms", s.org.id)).toBeGreaterThanOrEqual(1);
      for (const name of CORE_NAMES) {
        for (const call of mocks.core[name]!.mock.calls) expect(call[1], name).toBe(s.org.id);
      }
    },
  );

  it("utløpt innlogging, så ny innlogging som samme ansatt: «Legg til flere rom» lagrer rommene", async () => {
    const s = await setup();
    await setInspectorsEditAll(s.org.id, true);
    const user = await createUser();
    await createEmployee(user, s.org.id, ["inspector"]);
    const entries = {
      assignmentId: s.assignment.id,
      floorId: s.emptyFloor.id,
      source: "manual",
      presetKey: "",
      drafts: JSON.stringify([{ roomType: "bedroom", count: 2 }]),
    };

    const signedOut = await actions.addRoomsAction(initialFormState, form(entries));
    expect(signedOut.signedOut).toBe(true);
    const roomsBefore = await activeCount("rooms", s.org.id);

    signIn(user);
    const state = await actions.addRoomsAction(signedOut, form(entries));
    expect(state.message).toBeNull();
    expect(await activeCount("rooms", s.org.id)).toBe(roomsBefore + 2);
  });
});
