import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ZodError } from "zod";
import { ROOM_TYPES } from "./codes";
import {
  buildingInputSchema,
  floorAreaInputSchema,
  floorInputSchema,
  roomInputSchema,
} from "./schemas";

/*
 * Skjemaene for bygning, etasje, areal og rom (docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md
 * avsnitt 2). Ren enhetstest. Feilmeldingene er fra kortet punkt 8; meldinger for for lange
 * tekster, ukjent metode og ugyldig «Målt av» står ikke i kortet, så der sjekkes bare at feilen
 * står ved feltet.
 *
 * Verdiene sendes som tekst, slik skjemaet på siden sender dem. Testdata er oppdiktet:
 * «Bolighus», «Kjeller», «Rom test», «Målt langs innvendig vegg test». «Fødselsnummer» er alltid
 * 12345678901 (oppdiktet, 11 sifre).
 *
 * Støtter hovedmål: reklamasjoner (bare faste koder, areal med høyst én desimal, aldri
 * fødselsnummer) og tid (komma og punktum godtas, feil vises ved feltet med én fast tekst).
 */

const BUILDING_NAME = "Skriv inn navnet på bygningen.";
const FLOOR_NAME = "Skriv inn navnet på etasjen.";
const LEVEL = "Etasjenummeret må være mellom −3 og 20.";
const AREA = "Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.";
const ROOM_TYPE = "Velg romtype.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";

/** Alle norske meldinger i kortet punkt 8. Hver må brukes i minst én test (2.14). */
const CARD_MESSAGES = [BUILDING_NAME, FLOOR_NAME, LEVEL, AREA, ROOM_TYPE, NATIONAL_ID];
const usedMessages = new Set<string>();

const NATIONAL_ID_VALUE = "12345678901";

type Schema =
  | typeof buildingInputSchema
  | typeof floorInputSchema
  | typeof floorAreaInputSchema
  | typeof roomInputSchema;

const VALID = {
  building: { name: "Bolighus" },
  floor: { name: "Kjeller", level: "-1", belowGround: "on" },
  area: {
    braI: "123,4",
    braE: "56.7",
    braB: "8,9",
    alh: "210,3",
    measuredBy: "",
    method: "laser",
    comment: "Målt langs innvendig vegg test",
  },
  room: { roomType: "bathroom", name: "Rom test" },
};

function parse(schema: Schema, input: Record<string, unknown>) {
  return schema.safeParse(input);
}

function ok(schema: Schema, input: Record<string, unknown>): Record<string, unknown> {
  const result = parse(schema, input);
  if (!result.success) {
    throw new Error(`skulle godtatt ${JSON.stringify(input)}: ${result.error.message}`);
  }
  return result.data as Record<string, unknown>;
}

/** Meldingene per felt (første ledd i stien), slik handlingene viser dem. */
function fieldErrors(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    (result[field] ??= []).push(issue.message);
  }
  return result;
}

/** Skjemaet avviser, og feilen står ved feltet (med meldingen når den er gitt). */
function expectFieldError(
  schema: Schema,
  input: Record<string, unknown>,
  field: string,
  message?: string,
) {
  const result = parse(schema, input);
  expect(result.success, `skulle avvist ${JSON.stringify(input)}`).toBe(false);
  if (result.success) return;
  const errors = fieldErrors(result.error);
  expect(Object.keys(errors), `feilen står ved ${field}`).toContain(field);
  if (message !== undefined) {
    expect(errors[field]).toContain(message);
    usedMessages.add(message);
  }
}

const chars = (n: number, base = "a") => base.repeat(n);

describe("2.1 bygningsnavn", () => {
  it.each(["", "   ", undefined])("navn «%s» → «Skriv inn navnet på bygningen.»", (name) => {
    expectFieldError(buildingInputSchema, { name }, "name", BUILDING_NAME);
  });

  it("100 tegn godtas, 101 avvises", () => {
    expect(ok(buildingInputSchema, { name: chars(100) }).name).toBe(chars(100));
    expectFieldError(buildingInputSchema, { name: chars(101) }, "name");
  });

  it("navnet trimmes", () => {
    expect(ok(buildingInputSchema, { name: "  Bolighus  " }).name).toBe("Bolighus");
  });
});

describe("2.2 etasjenavn", () => {
  it.each(["", "   ", undefined])("navn «%s» → «Skriv inn navnet på etasjen.»", (name) => {
    expectFieldError(floorInputSchema, { ...VALID.floor, name }, "name", FLOOR_NAME);
  });

  it("50 tegn godtas, 51 avvises", () => {
    expect(ok(floorInputSchema, { ...VALID.floor, name: chars(50) }).name).toBe(chars(50));
    expectFieldError(floorInputSchema, { ...VALID.floor, name: chars(51) }, "name");
  });

  it("navnet trimmes", () => {
    expect(ok(floorInputSchema, { ...VALID.floor, name: " 1. etasje " }).name).toBe("1. etasje");
  });
});

describe("2.3 etasjenummer", () => {
  it.each(["-4", "21"])("%s → «Etasjenummeret må være mellom −3 og 20.»", (level) => {
    expectFieldError(floorInputSchema, { ...VALID.floor, level }, "level", LEVEL);
  });

  it.each([
    ["-3", -3],
    ["0", 0],
    ["20", 20],
  ] as const)("%s godtas og gir tallet %d", (level, expected) => {
    expect(ok(floorInputSchema, { ...VALID.floor, level }).level).toBe(expected);
  });

  it.each(["1.5", "a", ""])("«%s» avvises ved feltet", (level) => {
    expectFieldError(floorInputSchema, { ...VALID.floor, level }, "level");
  });
});

describe("2.4 «under terreng» på etasjen", () => {
  it("mangler → false", () => {
    const { belowGround: _ignored, ...rest } = VALID.floor;
    expect(ok(floorInputSchema, rest).belowGround).toBe(false);
  });

  it.each(["on", true])("%s → true", (belowGround) => {
    expect(ok(floorInputSchema, { ...VALID.floor, belowGround }).belowGround).toBe(true);
  });
});

const AREA_FIELDS = ["braI", "braE", "braB", "alh"] as const;

describe("2.5 areal (BRA-i, BRA-e, BRA-b, ALH)", () => {
  const cases = AREA_FIELDS.flatMap((field) =>
    ["-0.1", "-0,1", "10000", "12.34", "12,34", "abc", "1e3"].map((value) => ({ field, value })),
  );

  it.each(AREA_FIELDS)("%s tom → null", (field) => {
    expect(ok(floorAreaInputSchema, { ...VALID.area, [field]: "" })[field]).toBeNull();
    expect(ok(floorAreaInputSchema, { ...VALID.area, [field]: "  " })[field]).toBeNull();
  });

  it.each(cases)("$field «$value» → arealmeldingen ved feltet", ({ field, value }) => {
    expectFieldError(floorAreaInputSchema, { ...VALID.area, [field]: value }, field, AREA);
  });

  const accepted = AREA_FIELDS.flatMap((field) =>
    (
      [
        ["0", 0],
        ["9999.9", 9999.9],
        ["9999,9", 9999.9],
        ["12,3", 12.3],
        ["12.3", 12.3],
        ["123", 123],
      ] as const
    ).map(([value, expected]) => ({ field, value, expected })),
  );

  it.each(accepted)(
    "$field «$value» godtas og gir tallet $expected",
    ({ field, value, expected }) => {
      expect(ok(floorAreaInputSchema, { ...VALID.area, [field]: value })[field]).toBe(expected);
    },
  );

  it("alle fire felt tomme godtas (etasjen er ikke målt ennå)", () => {
    const data = ok(floorAreaInputSchema, {
      braI: "",
      braE: "",
      braB: "",
      alh: "",
      measuredBy: "",
      method: "",
      comment: "",
    });
    expect(data).toMatchObject({ braI: null, braE: null, braB: null, alh: null });
  });
});

describe("2.6 metode", () => {
  it("tom → null", () => {
    expect(ok(floorAreaInputSchema, { ...VALID.area, method: "" }).method).toBeNull();
  });

  it.each(["laser", "drawing", "other"])("%s godtas", (method) => {
    expect(ok(floorAreaInputSchema, { ...VALID.area, method }).method).toBe(method);
  });

  it.each(["lidar", "ukjent", "Laser"])("%s avvises ved feltet", (method) => {
    expectFieldError(floorAreaInputSchema, { ...VALID.area, method }, "method");
  });
});

describe("2.7 kommentar", () => {
  it("valgfri: tom → null", () => {
    expect(ok(floorAreaInputSchema, { ...VALID.area, comment: "" }).comment).toBeNull();
    expect(ok(floorAreaInputSchema, { ...VALID.area, comment: "   " }).comment).toBeNull();
  });

  it("1000 tegn godtas, 1001 avvises", () => {
    expect(ok(floorAreaInputSchema, { ...VALID.area, comment: chars(1000) }).comment).toBe(
      chars(1000),
    );
    expectFieldError(floorAreaInputSchema, { ...VALID.area, comment: chars(1001) }, "comment");
  });

  it("kommentaren trimmes", () => {
    expect(
      ok(floorAreaInputSchema, { ...VALID.area, comment: "  Målt langs innvendig vegg test " })
        .comment,
    ).toBe("Målt langs innvendig vegg test");
  });
});

describe("2.8 «Målt av» (measuredBy)", () => {
  it("tom → null (kjernen setter den innloggede når areal er fylt ut)", () => {
    expect(ok(floorAreaInputSchema, { ...VALID.area, measuredBy: "" }).measuredBy).toBeNull();
  });

  it("uuid godtas", () => {
    const id = randomUUID();
    expect(ok(floorAreaInputSchema, { ...VALID.area, measuredBy: id }).measuredBy).toBe(id);
  });

  it("«ikke-en-id» avvises ved feltet", () => {
    expectFieldError(
      floorAreaInputSchema,
      { ...VALID.area, measuredBy: "ikke-en-id" },
      "measuredBy",
    );
  });
});

describe("2.9 romtype", () => {
  it.each([
    ["mangler", undefined],
    ["tom", ""],
    ["ukjent", "villa"],
    ["etikett i stedet for kode", "Bad"],
  ])("%s → «Velg romtype.»", (_name, roomType) => {
    expectFieldError(roomInputSchema, { ...VALID.room, roomType }, "roomType", ROOM_TYPE);
  });

  const keys = (ROOM_TYPES as readonly { key: string }[]).map((row) => row.key);

  it("listen har 33 koder", () => {
    expect(keys).toHaveLength(33);
  });

  it.each(keys)("%s godtas", (roomType) => {
    expect(ok(roomInputSchema, { ...VALID.room, roomType }).roomType).toBe(roomType);
  });
});

describe("2.10 romnavn", () => {
  it("valgfritt: mangler eller tomt → null", () => {
    expect(ok(roomInputSchema, { roomType: "bathroom" }).name ?? null).toBeNull();
    expect(ok(roomInputSchema, { roomType: "bathroom", name: "" }).name).toBeNull();
    expect(ok(roomInputSchema, { roomType: "bathroom", name: "  " }).name).toBeNull();
  });

  it("100 tegn godtas, 101 avvises", () => {
    expect(ok(roomInputSchema, { ...VALID.room, name: chars(100) }).name).toBe(chars(100));
    expectFieldError(roomInputSchema, { ...VALID.room, name: chars(101) }, "name");
  });

  it("navnet trimmes", () => {
    expect(ok(roomInputSchema, { ...VALID.room, name: " Rom test " }).name).toBe("Rom test");
  });
});

describe("2.11 arealtype og «under terreng» på rom", () => {
  it("arealtype mangler → undefined (kjernen bruker forslaget)", () => {
    expect(ok(roomInputSchema, VALID.room).areaType).toBeUndefined();
  });

  it("«under terreng» mangler → undefined (kjernen bruker forslaget)", () => {
    expect(ok(roomInputSchema, VALID.room).belowGround).toBeUndefined();
  });

  it.each(["bra_i", "bra_e", "bra_b"])("arealtype %s godtas", (areaType) => {
    expect(ok(roomInputSchema, { ...VALID.room, areaType }).areaType).toBe(areaType);
  });

  it.each(["alh", "tba", "BRA-i", "ukjent"])("arealtype %s avvises ved feltet", (areaType) => {
    expectFieldError(roomInputSchema, { ...VALID.room, areaType }, "areaType");
  });

  it.each([true, false])("«under terreng» %s beholdes", (belowGround) => {
    expect(ok(roomInputSchema, { ...VALID.room, belowGround }).belowGround).toBe(belowGround);
  });
});

describe("2.12 fødselsnummer i fritekst", () => {
  const FIELDS = [
    ["bygningsnavn", buildingInputSchema, VALID.building, "name"],
    ["etasjenavn", floorInputSchema, VALID.floor, "name"],
    ["kommentar", floorAreaInputSchema, VALID.area, "comment"],
    ["romnavn", roomInputSchema, VALID.room, "name"],
  ] as const;

  const cases = FIELDS.flatMap(([label, schema, base, field]) =>
    [NATIONAL_ID_VALUE, `Bolig ${NATIONAL_ID_VALUE}`].map((value) => ({
      label,
      schema,
      base,
      field,
      value,
    })),
  );

  it.each(cases)("$label «$value» → «Fødselsnummer skal ikke lagres her.»", (c) => {
    expectFieldError(c.schema, { ...c.base, [c.field]: c.value }, c.field, NATIONAL_ID);
  });

  it.each(FIELDS)("%s med 10 sifre godtas", (_label, schema, base, field) => {
    const data = ok(schema, { ...base, [field]: "1234567890" });
    expect(data[field]).toBe("1234567890");
  });
});

describe("2.13 id-er og organisasjon i input blir aldri med i resultatet", () => {
  const FOREIGN = {
    organizationId: randomUUID(),
    id: randomUUID(),
    assignmentId: randomUUID(),
    buildingId: randomUUID(),
    floorId: randomUUID(),
    roomId: randomUUID(),
    reportBuildingId: randomUUID(),
  };

  it.each([
    ["bygning", buildingInputSchema, VALID.building],
    ["etasje", floorInputSchema, VALID.floor],
    ["areal", floorAreaInputSchema, VALID.area],
    ["rom", roomInputSchema, VALID.room],
  ] as const)("%s: ingen av feltene står i resultatet", (_name, schema, base) => {
    const data = ok(schema, { ...base, ...FOREIGN });
    for (const key of Object.keys(FOREIGN)) expect(data, key).not.toHaveProperty(key);
    const text = JSON.stringify(data);
    for (const value of Object.values(FOREIGN)) expect(text).not.toContain(value);
  });
});

describe("2.14 alle norske meldinger i kortet punkt 8 er brukt", () => {
  it("hver melding er sjekket i en test over", () => {
    // Kjøres sist i filen (Vitest kjører i rekkefølge innen filen)
    for (const message of CARD_MESSAGES) {
      expect(usedMessages.has(message), `meldingen «${message}» er ikke testet`).toBe(true);
    }
  });
});
