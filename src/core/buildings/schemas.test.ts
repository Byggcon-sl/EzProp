import { describe, expect, it } from "vitest";
import { ROOM_TYPES } from "./codes";
import { BuildingNotEmptyError, FloorNotEmptyError, PropertyMissingError } from "./errors";
import {
  addRoomsInputSchema,
  buildingInputSchema,
  floorAreaInputSchema,
  floorInputSchema,
  roomInputSchema,
} from "./schemas";

/*
 * Skjemaene for bygning, etasje, areal og rom
 * (docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 2). Ren enhetstest.
 * Feilmeldingene er fra kortet punkt 7 og 8; meldinger for for lange tekster står ikke i kortet,
 * så der sjekkes bare at feilen står ved feltet.
 *
 * Verdiene sendes som tekst, slik de kommer fra skjemaet på siden (areal med komma eller punktum,
 * etasjenummer som tekst). Testdata er oppdiktet: «Bolighus», «Kjeller», «Rom test», «Målt langs
 * innvendig vegg test». «Fødselsnummer» er alltid 12345678901 (oppdiktet, 11 sifre).
 *
 * Støtter hovedmål: reklamasjoner (bare faste koder, areal med høyst én desimal, aldri
 * fødselsnummer) og tid (feil vises ved feltet med én fast tekst).
 */

const BUILDING_NAME = "Skriv inn navnet på bygningen.";
const FLOOR_NAME = "Skriv inn navnet på etasjen.";
const LEVEL = "Etasjenummeret må være mellom −3 og 20.";
const AREA = "Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.";
const ROOM_TYPE = "Velg romtype.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const PROPERTY_MISSING = "Legg inn eiendommen før du legger til bygninger.";
const BUILDING_NOT_EMPTY = "Fjern etasjene først.";
const FLOOR_NOT_EMPTY = "Fjern rommene først.";

/** Alle norske meldinger i kortet punkt 7 og 8. Hver må brukes i minst én test (2.14). */
const CARD_MESSAGES = [
  BUILDING_NAME,
  FLOOR_NAME,
  LEVEL,
  AREA,
  ROOM_TYPE,
  NATIONAL_ID,
  PROPERTY_MISSING,
  BUILDING_NOT_EMPTY,
  FLOOR_NOT_EMPTY,
];
const usedMessages = new Set<string>();

const NATIONAL_ID_VALUE = "12345678901";
const MEASURER = "0190a000-0000-7000-8000-000000000060";
const FOREIGN = "0190a000-0000-7000-8000-000000000099";

const VALID_BUILDING = { name: "Bolighus" };
const VALID_FLOOR = { name: "Kjeller", level: "-1", belowGround: "on" };
const VALID_AREA = {
  braI: "123,4",
  braE: "56.7",
  braB: "8,9",
  alh: "210,3",
  measuredBy: MEASURER,
  method: "laser",
  comment: "Målt langs innvendig vegg test",
};
const VALID_ROOM = { roomType: "bathroom", name: "Rom test" };

type AnySchema =
  | typeof buildingInputSchema
  | typeof floorInputSchema
  | typeof floorAreaInputSchema
  | typeof roomInputSchema;

function parse(schema: AnySchema, input: Record<string, unknown>) {
  return schema.safeParse(input);
}

const parseBuilding = (overrides: Record<string, unknown>) =>
  parse(buildingInputSchema, { ...VALID_BUILDING, ...overrides });
const parseFloor = (overrides: Record<string, unknown>) =>
  parse(floorInputSchema, { ...VALID_FLOOR, ...overrides });
const parseArea = (overrides: Record<string, unknown>) =>
  parse(floorAreaInputSchema, { ...VALID_AREA, ...overrides });
const parseRoom = (overrides: Record<string, unknown>) =>
  parse(roomInputSchema, { ...VALID_ROOM, ...overrides });

type Result = ReturnType<typeof parse>;

/** Meldingene for feltet når skjemaet avviser. */
function messagesFor(result: Result, field: string): string[] {
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => String(issue.path[0] ?? "") === field)
    .map((issue) => issue.message);
}

function expectFieldMessage(result: Result, field: string, message: string) {
  expect(result.success, `${field} skulle vært avvist`).toBe(false);
  expect(messagesFor(result, field)).toContain(message);
  usedMessages.add(message);
}

function expectRejected(result: Result, field: string) {
  expect(result.success, `${field} skulle vært avvist`).toBe(false);
  expect(messagesFor(result, field).length, `feilen står ved ${field}`).toBeGreaterThan(0);
}

function expectAccepted(result: Result): Record<string, unknown> {
  expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  return result.success ? (result.data as Record<string, unknown>) : {};
}

describe("2.1 bygningsnavn", () => {
  it.each([
    ["tomt", ""],
    ["bare mellomrom", "   "],
    ["mangler", undefined],
  ])("%s → «Skriv inn navnet på bygningen.»", (_name, name) => {
    expectFieldMessage(parseBuilding({ name }), "name", BUILDING_NAME);
  });

  it("100 tegn godtas, 101 avvises", () => {
    expectAccepted(parseBuilding({ name: "a".repeat(100) }));
    expectRejected(parseBuilding({ name: "a".repeat(101) }), "name");
  });

  it("trimmes", () => {
    expect(expectAccepted(parseBuilding({ name: "  Bolighus  " })).name).toBe("Bolighus");
  });
});

describe("2.2 etasjenavn", () => {
  it.each([
    ["tomt", ""],
    ["bare mellomrom", "  "],
    ["mangler", undefined],
  ])("%s → «Skriv inn navnet på etasjen.»", (_name, name) => {
    expectFieldMessage(parseFloor({ name }), "name", FLOOR_NAME);
  });

  it("50 tegn godtas, 51 avvises", () => {
    expectAccepted(parseFloor({ name: "a".repeat(50) }));
    expectRejected(parseFloor({ name: "a".repeat(51) }), "name");
  });

  it("trimmes", () => {
    expect(expectAccepted(parseFloor({ name: " Kjeller " })).name).toBe("Kjeller");
  });
});

describe("2.3 etasjenummer", () => {
  it.each(["-4", "21"])("%s → «Etasjenummeret må være mellom −3 og 20.»", (level) => {
    expectFieldMessage(parseFloor({ level }), "level", LEVEL);
  });

  it.each([
    ["-3", -3],
    ["0", 0],
    ["20", 20],
    ["1", 1],
  ])("%s godtas og gir tallet %s", (level, expected) => {
    expect(expectAccepted(parseFloor({ level })).level).toBe(expected);
  });

  it.each(["1.5", "1,5", "a", ""])("«%s» avvises", (level) => {
    expectRejected(parseFloor({ level }), "level");
  });

  it("mangler → avvist", () => {
    expectRejected(parse(floorInputSchema, { name: "Kjeller" }), "level");
  });
});

describe("2.4 under terreng på etasje", () => {
  it("mangler → false", () => {
    expect(
      expectAccepted(parse(floorInputSchema, { name: "Kjeller", level: "0" })).belowGround,
    ).toBe(false);
  });

  it.each([
    ["on", "on"],
    ["true", true],
  ] as const)("%s → true", (_name, value) => {
    expect(expectAccepted(parseFloor({ belowGround: value })).belowGround).toBe(true);
  });

  it("false → false", () => {
    expect(expectAccepted(parseFloor({ belowGround: false })).belowGround).toBe(false);
  });
});

const AREA_FIELDS = ["braI", "braE", "braB", "alh"] as const;

describe("2.5 areal", () => {
  it.each(AREA_FIELDS)("%s: tom og mellomrom → null, mangler → null", (field) => {
    expect(expectAccepted(parseArea({ [field]: "" }))[field]).toBeNull();
    expect(expectAccepted(parseArea({ [field]: "  " }))[field]).toBeNull();
    const without: Record<string, unknown> = { ...VALID_AREA };
    delete without[field];
    expect(expectAccepted(parse(floorAreaInputSchema, without))[field] ?? null).toBeNull();
  });

  const BAD = ["-0.1", "-0,1", "10000", "12.34", "12,34", "abc", "12,3,4"];
  const CASES = AREA_FIELDS.flatMap((field) => BAD.map((value) => [field, value] as const));

  it.each(CASES)("%s «%s» → kortets melding", (field, value) => {
    expectFieldMessage(parseArea({ [field]: value }), field, AREA);
  });

  const GOOD = [
    ["0", 0],
    ["9999.9", 9999.9],
    ["9999,9", 9999.9],
    ["12,3", 12.3],
    ["12.3", 12.3],
    ["123,4", 123.4],
    [" 56,7 ", 56.7],
  ] as const;
  const GOOD_CASES = AREA_FIELDS.flatMap((field) =>
    GOOD.map(([value, expected]) => [field, value, expected] as const),
  );

  it.each(GOOD_CASES)("%s «%s» godtas og gir tallet %s", (field, value, expected) => {
    expect(expectAccepted(parseArea({ [field]: value }))[field]).toBe(expected);
  });
});

describe("2.6 metode", () => {
  it("tom → null", () => {
    expect(expectAccepted(parseArea({ method: "" })).method).toBeNull();
  });

  it.each(["laser", "drawing", "other"])("%s godtas", (method) => {
    expect(expectAccepted(parseArea({ method })).method).toBe(method);
  });

  it.each(["lidar", "ukjent", "Laser"])("%s avvises", (method) => {
    expectRejected(parseArea({ method }), "method");
  });
});

describe("2.7 kommentar", () => {
  it("valgfri: tom og mellomrom → null", () => {
    expect(expectAccepted(parseArea({ comment: "" })).comment).toBeNull();
    expect(expectAccepted(parseArea({ comment: "  " })).comment).toBeNull();
  });

  it("1000 tegn godtas, 1001 avvises", () => {
    expectAccepted(parseArea({ comment: "a".repeat(1000) }));
    expectRejected(parseArea({ comment: "a".repeat(1001) }), "comment");
  });

  it("trimmes", () => {
    expect(
      expectAccepted(parseArea({ comment: "  Målt langs innvendig vegg test " })).comment,
    ).toBe("Målt langs innvendig vegg test");
  });
});

describe("2.8 «Målt av»", () => {
  it("tom → null", () => {
    expect(expectAccepted(parseArea({ measuredBy: "" })).measuredBy).toBeNull();
  });

  it("uuid godtas", () => {
    expect(expectAccepted(parseArea({ measuredBy: MEASURER })).measuredBy).toBe(MEASURER);
  });

  it.each(["ikke-en-id", "1 or 1=1"])("«%s» avvises", (measuredBy) => {
    expectRejected(parseArea({ measuredBy }), "measuredBy");
  });

  it("alle felt tomme godtas (en tom arealrad)", () => {
    const data = expectAccepted(
      parse(floorAreaInputSchema, {
        braI: "",
        braE: "",
        braB: "",
        alh: "",
        measuredBy: "",
        method: "",
        comment: "",
      }),
    );
    for (const field of [...AREA_FIELDS, "measuredBy", "method", "comment"]) {
      expect(data[field], field).toBeNull();
    }
  });
});

describe("2.9 romtype", () => {
  it.each([
    ["mangler", undefined],
    ["tom", ""],
    ["ukjent «villa»", "villa"],
    ["arealtype som romtype", "bra_i"],
  ])("%s → «Velg romtype.»", (_name, roomType) => {
    expectFieldMessage(parseRoom({ roomType }), "roomType", ROOM_TYPE);
  });

  const KEYS = (ROOM_TYPES as unknown as readonly { key: string }[]).map((row) => row.key);

  it("alle 33 kodene er med", () => {
    expect(KEYS).toHaveLength(33);
  });

  it.each(KEYS)("%s godtas", (roomType) => {
    expect(expectAccepted(parseRoom({ roomType })).roomType).toBe(roomType);
  });
});

describe("2.10 romnavn", () => {
  it("valgfritt: tomt og mellomrom → null, mangler går bra", () => {
    expect(expectAccepted(parseRoom({ name: "" })).name).toBeNull();
    expect(expectAccepted(parseRoom({ name: "  " })).name).toBeNull();
    expect(
      expectAccepted(parse(roomInputSchema, { roomType: "bathroom" })).name ?? null,
    ).toBeNull();
  });

  it("100 tegn godtas, 101 avvises", () => {
    expectAccepted(parseRoom({ name: "a".repeat(100) }));
    expectRejected(parseRoom({ name: "a".repeat(101) }), "name");
  });

  it("trimmes", () => {
    expect(expectAccepted(parseRoom({ name: " Rom test " })).name).toBe("Rom test");
  });
});

describe("2.11 arealtype og under terreng på rom", () => {
  it("arealtype mangler → undefined (kjernen bruker forslaget)", () => {
    expect(expectAccepted(parse(roomInputSchema, VALID_ROOM)).areaType).toBeUndefined();
  });

  it.each(["bra_i", "bra_e", "bra_b", "not_bra"])("%s godtas (B6.5: not_bra, F6)", (areaType) => {
    expect(expectAccepted(parseRoom({ areaType })).areaType).toBe(areaType);
  });

  it.each(["alh", "bra", "BRA-i", "ukjent", "not-bra", "NOT_BRA"])("%s avvises", (areaType) => {
    expectRejected(parseRoom({ areaType }), "areaType");
  });

  it("under terreng mangler → undefined (kjernen bruker forslaget)", () => {
    expect(expectAccepted(parse(roomInputSchema, VALID_ROOM)).belowGround).toBeUndefined();
  });

  it.each([
    [true, true],
    [false, false],
  ])("under terreng %s → %s", (value, expected) => {
    expect(expectAccepted(parseRoom({ belowGround: value })).belowGround).toBe(expected);
  });
});

describe("2.12 fødselsnummer i fritekst", () => {
  const FIELDS = [
    ["bygningsnavn", parseBuilding, "name"],
    ["etasjenavn", parseFloor, "name"],
    ["kommentar", parseArea, "comment"],
    ["romnavn", parseRoom, "name"],
  ] as const;

  const CASES = FIELDS.flatMap(([label, run, field]) =>
    [NATIONAL_ID_VALUE, `Bolighus ${NATIONAL_ID_VALUE}`].map(
      (value) => [label, value, run, field] as const,
    ),
  );

  it.each(CASES)("%s «%s» → «Fødselsnummer skal ikke lagres her.»", (_label, value, run, field) => {
    expectFieldMessage(run({ [field]: value }), field, NATIONAL_ID);
  });

  it.each(FIELDS)("%s med 10 sifre godtas", (_label, run, field) => {
    expect(expectAccepted(run({ [field]: "1234567890" }))[field]).toBe("1234567890");
  });
});

describe("2.13 id-er i input blir aldri med", () => {
  const EXTRA = {
    organizationId: FOREIGN,
    id: FOREIGN,
    assignmentId: FOREIGN,
    buildingId: FOREIGN,
    floorId: FOREIGN,
    roomId: FOREIGN,
    reportBuildingId: FOREIGN,
  };

  it.each([
    ["bygning", buildingInputSchema, VALID_BUILDING],
    ["etasje", floorInputSchema, VALID_FLOOR],
    ["areal", floorAreaInputSchema, VALID_AREA],
    ["rom", roomInputSchema, VALID_ROOM],
  ] as const)(
    "%s: organizationId, id, assignmentId, floorId og co. tas bort",
    (_n, schema, valid) => {
      const data = expectAccepted(parse(schema, { ...valid, ...EXTRA }));
      for (const key of Object.keys(EXTRA)) expect(data, key).not.toHaveProperty(key);
      expect(JSON.stringify(data)).not.toContain(FOREIGN);
    },
  );
});

describe("hele skjemaene", () => {
  it("full arealrad gir tallene og verdiene", () => {
    expect(expectAccepted(parse(floorAreaInputSchema, VALID_AREA))).toMatchObject({
      braI: 123.4,
      braE: 56.7,
      braB: 8.9,
      alh: 210.3,
      measuredBy: MEASURER,
      method: "laser",
      comment: "Målt langs innvendig vegg test",
    });
  });

  it("etasje gir navn, tall og boolsk verdi", () => {
    expect(expectAccepted(parse(floorInputSchema, VALID_FLOOR))).toMatchObject({
      name: "Kjeller",
      level: -1,
      belowGround: true,
    });
  });

  it.each([
    [PROPERTY_MISSING, "PropertyMissingError", () => new PropertyMissingError()],
    [BUILDING_NOT_EMPTY, "BuildingNotEmptyError", () => new BuildingNotEmptyError()],
    [FLOOR_NOT_EMPTY, "FloorNotEmptyError", () => new FloorNotEmptyError()],
  ] as const)("feilen har kortets tekst «%s» (%s)", (message, name, make) => {
    const error = make();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(message);
    expect(error.name).toBe(name);
    usedMessages.add(message);
  });
});

describe("2.14 alle meldingene i kortet er dekket", () => {
  it("hver norske melding i kortet punkt 7–8 er brukt i en test over", () => {
    expect(CARD_MESSAGES.filter((message) => !usedMessages.has(message))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// F4 Flere rom på én gang: addRoomsInputSchema
// docs/funksjoner/fase2a-flere-rom-testplan.md F4
// ---------------------------------------------------------------------------------------------

/** Ingen engelsk Zod-standardtekst skal slippe ut; meldingen skal være norsk. */
function expectNorwegian(result: ReturnType<typeof addRoomsInputSchema.safeParse>) {
  expect(result.success).toBe(false);
  if (result.success) return;
  for (const issue of result.error.issues) {
    expect(issue.message, `norsk melding, ikke «${issue.message}»`).toMatch(/[æøå]|rom|sett|antall/i);
    expect(issue.message).not.toMatch(/expected|required|invalid|must contain|unrecognized/i);
  }
}

describe("F4 addRoomsInputSchema", () => {
  it("F4.1 valid_manual: ett sett med soverom og kilde manual godtas", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count: 2 }],
      source: "manual",
    });
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it("F4.2 valid_preset: source preset med presetKey apartment godtas", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count: 2 }],
      source: "preset",
      presetKey: "apartment",
    });
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it("F4.3 unknown_room_type: ukjent romtype avvises med norsk melding", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "ballroom", count: 1 }],
      source: "manual",
    });
    expectNorwegian(result);
    // Arkivert romtype: ROOM_TYPES har ingen arkiverte koder i dag (rapporten noterer «ikke testbart»).
  });

  it.each([
    ["0", 0],
    ["-1", -1],
    ["21", 21],
    ["1,5", 1.5],
  ])("F4.4 count_bounds: count %s avvises", (_name, count) => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count }],
      source: "manual",
    });
    expectNorwegian(result);
  });

  it("F4.4 count_bounds: tekst «2» avvises (tall kreves)", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count: "2" }],
      source: "manual",
    });
    expect(result.success).toBe(false);
  });

  it.each([1, 20])("F4.4 count_bounds: count %s godtas", (count) => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count }],
      source: "manual",
    });
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it("F4.5 total_max_40: 40 rom totalt godtas", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [
        { roomType: "bedroom", count: 20 },
        { roomType: "storage", count: 20 },
      ],
      source: "manual",
    });
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it("F4.5 total_max_40: 41 rom avvises med melding om høyst 40", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [
        { roomType: "bedroom", count: 20 },
        { roomType: "storage", count: 20 },
        { roomType: "kitchen", count: 1 },
      ],
      source: "manual",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message).join(" ")).toMatch(/40/);
    }
  });

  it("F4.6 empty_drafts: tom liste avvises", () => {
    const result = addRoomsInputSchema.safeParse({ drafts: [], source: "manual" });
    expectNorwegian(result);
  });

  it("F4.7 duplicate_type: samme romtype to ganger avvises (låst valg: avvis)", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [
        { roomType: "bedroom", count: 1 },
        { roomType: "bedroom", count: 1 },
      ],
      source: "manual",
    });
    // Utvikleren avviser duplikat (schemas.ts: DRAFTS_DUPLICATE). Summen teller mot 40 uansett.
    expect(result.success).toBe(false);
  });

  it.each([
    ["mangler", undefined],
    ["ai_floor_plan", "ai_floor_plan"],
    ["ai", "ai"],
    ["tom", ""],
  ])("F4.8 source_closed: source %s avvises", (_name, source) => {
    const input: Record<string, unknown> = { drafts: [{ roomType: "bedroom", count: 1 }] };
    if (source !== undefined) input.source = source;
    const result = addRoomsInputSchema.safeParse(input);
    expectNorwegian(result);
  });

  it("F4.9 preset_key_rules: preset uten presetKey avvises", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count: 1 }],
      source: "preset",
    });
    expectNorwegian(result);
  });

  it("F4.9 preset_key_rules: preset med ukjent presetKey «villa» avvises", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count: 1 }],
      source: "preset",
      presetKey: "villa",
    });
    expectNorwegian(result);
  });

  it("F4.9 preset_key_rules: manual med presetKey avvises", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count: 1 }],
      source: "manual",
      presetKey: "apartment",
    });
    expectNorwegian(result);
  });

  it("F4.10 no_name_field: et ekstra name i utkastet slipper ikke gjennom", () => {
    const result = addRoomsInputSchema.safeParse({
      drafts: [{ roomType: "bedroom", count: 1, name: "Hovedsoverom" }],
      source: "manual",
    });
    // Låst valg: strict avviser ekstra felt (schemas.ts: strictObject på utkastet).
    if (result.success) {
      // Dersom utvikleren heller bruker strip: navnet skal uansett ikke være med i resultatet.
      expect((result.data.drafts[0] as Record<string, unknown>).name).toBeUndefined();
    } else {
      expect(result.success).toBe(false);
    }
  });
});
