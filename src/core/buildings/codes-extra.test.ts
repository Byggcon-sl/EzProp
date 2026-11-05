import { describe, expect, it } from "vitest";
import * as codes from "./codes";
import {
  AREA_TYPES,
  MEASURING_METHODS,
  ROOM_TYPE_GROUPS,
  ROOM_TYPES,
  suggestAreaType,
  suggestBelowGround,
  sumAssignmentArea,
  sumBuildingArea,
  sumFloorArea,
} from "./codes";

/*
 * Faste koder for bygninger, areal og rom, og datareglene `suggestAreaType`, `suggestBelowGround`
 * og summene (docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 1). Ren enhetstest.
 *
 * Fasiten står her med vilje, ikke importert: en kode endres aldri, den arkiveres (regel 6).
 * En ny romtype uten rad i `EXPECTED_ROOM_TYPES` gjør 1.4 og 1.11 røde.
 *
 * Kortet sier ikke hvordan etikettene leses. Testen godtar `label` på raden i `ROOM_TYPES`, og
 * for arealtyper og metoder et etikettkart eller en etikettfunksjon under de vanlige navnene.
 *
 * Støtter hovedmål: reklamasjoner (låste koder, summer uten regnefeil, rom under terreng blir
 * alltid foreslått), tid (forslag fra romtype og etasje) og KI først (faste koder som et senere
 * forslag fra plantegning eller LiDAR kan fylle ut).
 */

type ExpectedRoomType = {
  key: string;
  label: string;
  group: "wet_room" | "kitchen" | "toilet" | "special" | "other";
  defaultAreaType: "bra_i" | "bra_e" | "bra_b";
  defaultBelowGround: boolean;
};

function room(
  key: string,
  label: string,
  group: ExpectedRoomType["group"],
  defaultAreaType: ExpectedRoomType["defaultAreaType"] = "bra_i",
  defaultBelowGround = false,
): ExpectedRoomType {
  return { key, label, group, defaultAreaType, defaultBelowGround };
}

/** De 33 romtypene i kortets rekkefølge (A95). */
const EXPECTED_ROOM_TYPES: ExpectedRoomType[] = [
  room("bathroom", "Bad", "wet_room"),
  room("laundry", "Vaskerom", "wet_room"),
  room("bathroom_laundry", "Bad og vaskerom", "wet_room"),
  room("room_with_drain", "Annet rom med sluk", "wet_room"),
  room("other_wet_room", "Annet våtrom", "wet_room"),
  room("kitchen", "Kjøkken", "kitchen"),
  room("living_kitchen", "Stue og kjøkken", "kitchen"),
  room("toilet", "Toalettrom", "toilet"),
  room("sauna", "Badstue", "special"),
  room("boiler_room", "Fyrrom", "special"),
  room("technical_room", "Teknisk rom", "special"),
  room("cold_room", "Kjølerom", "special"),
  room("swimming_pool", "Svømmebasseng", "special"),
  room("living_room", "Stue", "other"),
  room("bedroom", "Soverom", "other"),
  room("office", "Kontor eller arbeidsrom", "other"),
  room("family_room", "Allrom", "other"),
  room("dining_room", "Spisestue", "other"),
  room("entrance", "Entré og vindfang", "other"),
  room("hallway", "Gang og hall", "other"),
  room("stairwell", "Trapperom", "other"),
  room("wardrobe", "Garderobe", "other"),
  room("storage", "Bod, inne", "other"),
  room("external_storage", "Bod, ute", "other", "bra_e"),
  room("basement_living_room", "Kjellerstue", "other", "bra_i", true),
  room("basement_room", "Kjellerrom, uinnredet", "other", "bra_i", true),
  room("crawl_space", "Kryperom", "other", "bra_i", true),
  room("attic_living_room", "Loftstue", "other"),
  room("unfinished_attic", "Loft, uinnredet", "other"),
  room("garage", "Garasje", "other", "bra_e"),
  room("glazed_balcony", "Innglasset balkong", "other", "bra_b"),
  room("workshop", "Verksted", "other"),
  room("other", "Annet", "other"),
];

const AREA_LABELS: Record<string, string> = { bra_i: "BRA-i", bra_e: "BRA-e", bra_b: "BRA-b" };
const METHOD_LABELS: Record<string, string> = {
  laser: "Oppmålt med laser",
  drawing: "Fra tegning",
  other: "Annen kilde",
};

type RoomTypeRow = {
  key: string;
  label: string;
  group: string;
  defaultAreaType: string;
  defaultBelowGround: boolean;
  draft: boolean;
};
const roomTypes = ROOM_TYPES as unknown as readonly RoomTypeRow[];

/** Kodene i en liste, enten listen har tekster eller rader med `key`. */
function keysOf(list: readonly unknown[]): string[] {
  return list.map((entry) =>
    typeof entry === "string" ? entry : String((entry as { key: unknown }).key),
  );
}

/**
 * Etiketten for en kode: fra raden i listen (`label`), et etikettkart eller en etikettfunksjon
 * med et av navnene. Kaster når ingen finnes.
 */
function labelFor(list: readonly unknown[], names: readonly string[], code: string): string {
  const row = list.find(
    (entry) =>
      typeof entry === "object" && entry !== null && (entry as { key?: unknown }).key === code,
  ) as { label?: unknown } | undefined;
  if (row && typeof row.label === "string") return row.label;
  const exported = codes as unknown as Record<string, unknown>;
  for (const name of names) {
    const value = exported[name];
    if (typeof value === "function") return (value as (code: string) => string)(code);
    if (value && typeof value === "object") {
      const label = (value as Record<string, unknown>)[code];
      if (typeof label === "string") return label;
    }
  }
  throw new Error(`fant ingen etikett for ${code} (prøvde ${names.join(", ")})`);
}

const AREA_LABEL_NAMES = ["areaTypeLabel", "AREA_TYPE_LABELS", "areaTypeLabels"] as const;
const METHOD_LABEL_NAMES = [
  "measuringMethodLabel",
  "MEASURING_METHOD_LABELS",
  "methodLabel",
  "measuringMethodLabels",
] as const;

describe("1.1–1.4 faste koder og etiketter", () => {
  it("1.1 AREA_TYPES er nøyaktig bra_i, bra_e, bra_b i fast rekkefølge, med etikettene BRA-i, BRA-e, BRA-b", () => {
    expect(keysOf(AREA_TYPES)).toEqual(["bra_i", "bra_e", "bra_b"]);
    for (const code of keysOf(AREA_TYPES)) {
      expect(labelFor(AREA_TYPES, AREA_LABEL_NAMES, code)).toBe(AREA_LABELS[code]);
    }
  });

  it("1.2 MEASURING_METHODS er nøyaktig laser, drawing, other; lidar finnes ikke ennå (K7)", () => {
    expect(keysOf(MEASURING_METHODS)).toEqual(["laser", "drawing", "other"]);
    expect(keysOf(MEASURING_METHODS)).not.toContain("lidar");
    for (const code of keysOf(MEASURING_METHODS)) {
      expect(labelFor(MEASURING_METHODS, METHOD_LABEL_NAMES, code)).toBe(METHOD_LABELS[code]);
    }
  });

  it("1.3 ROOM_TYPE_GROUPS er nøyaktig wet_room, kitchen, toilet, special, other", () => {
    expect(keysOf(ROOM_TYPE_GROUPS)).toEqual(["wet_room", "kitchen", "toilet", "special", "other"]);
  });

  it("1.4 ROOM_TYPES har nøyaktig de 33 kodene i kortets rekkefølge, uten dubletter", () => {
    expect(EXPECTED_ROOM_TYPES).toHaveLength(33);
    expect(roomTypes.map((row) => row.key)).toEqual(EXPECTED_ROOM_TYPES.map((row) => row.key));
    expect(new Set(roomTypes.map((row) => row.key)).size).toBe(roomTypes.length);
  });

  it("1.4 alle romtypene har kortets etikett, og etikettene er ulike", () => {
    expect(roomTypes.map((row) => [row.key, row.label])).toEqual(
      EXPECTED_ROOM_TYPES.map((row) => [row.key, row.label]),
    );
    expect(new Set(roomTypes.map((row) => row.label)).size).toBe(roomTypes.length);
  });

  it("1.4 alle romtypene er merket utkast (draft: true), ikke godkjent av fagrådet (A95)", () => {
    for (const row of roomTypes) expect(row.draft, row.key).toBe(true);
  });
});

describe("1.5–1.6 gyldige felt og grupper per romtype", () => {
  it.each(EXPECTED_ROOM_TYPES)(
    "1.5 $key: gruppe, standard arealtype og «under terreng» er gyldige og som i kortet",
    (expected) => {
      const row = roomTypes.find((candidate) => candidate.key === expected.key);
      expect(row, `${expected.key} finnes`).toBeDefined();
      expect(keysOf(ROOM_TYPE_GROUPS)).toContain(row!.group);
      expect(keysOf(AREA_TYPES)).toContain(row!.defaultAreaType);
      expect(typeof row!.defaultBelowGround).toBe("boolean");
      expect({
        group: row!.group,
        defaultAreaType: row!.defaultAreaType,
        defaultBelowGround: row!.defaultBelowGround,
      }).toEqual({
        group: expected.group,
        defaultAreaType: expected.defaultAreaType,
        defaultBelowGround: expected.defaultBelowGround,
      });
    },
  );

  it("1.6 grupper: fem våtrom (også «Annet rom med sluk»), to kjøkken, ett toalett, fem spesialrom, resten andre", () => {
    const byGroup = (group: string) =>
      roomTypes.filter((row) => row.group === group).map((row) => row.key);
    expect(byGroup("wet_room")).toEqual([
      "bathroom",
      "laundry",
      "bathroom_laundry",
      "room_with_drain",
      "other_wet_room",
    ]);
    expect(byGroup("kitchen")).toEqual(["kitchen", "living_kitchen"]);
    expect(byGroup("toilet")).toEqual(["toilet"]);
    expect(byGroup("special")).toEqual([
      "sauna",
      "boiler_room",
      "technical_room",
      "cold_room",
      "swimming_pool",
    ]);
    expect(byGroup("other")).toHaveLength(20);
  });
});

describe("1.7 suggestAreaType", () => {
  it.each([
    ["bathroom", "bra_i"],
    ["garage", "bra_e"],
    ["external_storage", "bra_e"],
    ["glazed_balcony", "bra_b"],
  ])("%s gir %s", (roomType, expected) => {
    expect(suggestAreaType(roomType as never)).toBe(expected);
  });

  const OTHERS = EXPECTED_ROOM_TYPES.filter(
    (row) => !["garage", "external_storage", "glazed_balcony"].includes(row.key),
  );

  it("alle andre romtyper er 30 (33 minus tre unntak)", () => {
    expect(OTHERS).toHaveLength(30);
  });

  it.each(OTHERS.map((row) => row.key))("%s gir bra_i", (roomType) => {
    expect(suggestAreaType(roomType as never)).toBe("bra_i");
  });

  it.each(EXPECTED_ROOM_TYPES)("$key gir romtypens standard arealtype", (row) => {
    expect(suggestAreaType(row.key as never)).toBe(row.defaultAreaType);
  });
});

describe("1.8 suggestBelowGround (A97)", () => {
  it.each([
    ["basement_living_room", true, true],
    ["basement_living_room", false, true],
    ["bathroom", true, true],
    ["bathroom", false, false],
  ] as const)(
    "romtype %s, etasje under terreng %s → %s",
    (roomType, floorBelowGround, expected) => {
      expect(suggestBelowGround({ roomType: roomType as never, floorBelowGround })).toBe(expected);
    },
  );

  const BELOW = ["basement_living_room", "basement_room", "crawl_space"];

  it.each(EXPECTED_ROOM_TYPES.map((row) => row.key))(
    "%s i etasje over terreng: sann bare for kjellerstue, kjellerrom og kryperom",
    (roomType) => {
      expect(suggestBelowGround({ roomType: roomType as never, floorBelowGround: false })).toBe(
        BELOW.includes(roomType),
      );
    },
  );

  it.each(EXPECTED_ROOM_TYPES.map((row) => row.key))(
    "%s i etasje under terreng: alltid sann (hellere ett forslag for mye)",
    (roomType) => {
      expect(suggestBelowGround({ roomType: roomType as never, floorBelowGround: true })).toBe(
        true,
      );
    },
  );
});

type AreaArg = Parameters<typeof sumFloorArea>[0];

function area(values: {
  braI?: number | null;
  braE?: number | null;
  braB?: number | null;
  alh?: number | null;
}): AreaArg {
  return {
    braI: values.braI ?? null,
    braE: values.braE ?? null,
    braB: values.braB ?? null,
    alh: values.alh ?? null,
  } as unknown as AreaArg;
}

/** Høyst én desimal, uten flyttallsrest (for eksempel aldri 0.30000000000000004). */
function expectOneDecimal(value: number) {
  expect(String(value)).toMatch(/^-?\d+(\.\d)?$/);
}

describe("1.9 sumFloorArea", () => {
  it("alle felt tomme gir 0 overalt", () => {
    expect(sumFloorArea(area({}))).toMatchObject({ braI: 0, braE: 0, braB: 0, bra: 0 });
  });

  it("bare BRA-i gir BRA = BRA-i", () => {
    expect(sumFloorArea(area({ braI: 123.4 }))).toMatchObject({
      braI: 123.4,
      braE: 0,
      braB: 0,
      bra: 123.4,
    });
  });

  it("0,1 + 0,2 gir nøyaktig 0,3 (ingen flyttallsfeil)", () => {
    const sum = sumFloorArea(area({ braI: 0.1, braE: 0.2 }));
    expect(sum.bra).toBe(0.3);
    expect(String(sum.bra)).toBe("0.3");
  });

  it("123,4 + 56,7 + 8,9 gir 189,0", () => {
    const sum = sumFloorArea(area({ braI: 123.4, braE: 56.7, braB: 8.9 }));
    expect(sum.bra).toBe(189);
    expect(sum).toMatchObject({ braI: 123.4, braE: 56.7, braB: 8.9 });
  });

  it("ALH 210,3 tas ikke med i BRA (A96)", () => {
    const without = sumFloorArea(area({ braI: 123.4 }));
    const withAlh = sumFloorArea(area({ braI: 123.4, alh: 210.3 }));
    expect(withAlh.bra).toBe(without.bra);
    expect(withAlh.bra).toBe(123.4);
    expect(JSON.stringify(withAlh)).not.toContain("210.3");
  });

  it("tall som tekst fra databasen (numeric) regnes likt", () => {
    const sum = sumFloorArea({
      braI: "0.1",
      braE: "0.2",
      braB: null,
      alh: "5.0",
    } as unknown as AreaArg);
    expect(sum.bra).toBe(0.3);
  });

  it.each([
    [{ braI: 0.1, braE: 0.2, braB: 0.4 }],
    [{ braI: 9999.9, braE: 9999.9, braB: 9999.9 }],
    [{ braI: 33.3, braE: 33.3, braB: 33.4 }],
    [{ braI: 1.1, braE: 2.2 }],
  ])("summen %o har aldri mer enn én desimal", (values) => {
    const sum = sumFloorArea(area(values));
    for (const value of [sum.braI, sum.braE, sum.braB, sum.bra]) expectOneDecimal(value);
  });

  it("9999,9 × 3 gir 29999,7", () => {
    expect(sumFloorArea(area({ braI: 9999.9, braE: 9999.9, braB: 9999.9 })).bra).toBe(29999.7);
  });
});

type BuildingArg = Parameters<typeof sumBuildingArea>[0];
type AssignmentArg = Parameters<typeof sumAssignmentArea>[0];

function floorsOf(...areas: (AreaArg | null)[]): BuildingArg {
  return areas.map((entry) => ({ area: entry })) as unknown as BuildingArg;
}

describe("1.10 sumBuildingArea og sumAssignmentArea", () => {
  it("to etasjer, én uten areal (null): summen per arealtype og totalt", () => {
    const sum = sumBuildingArea(floorsOf(area({ braI: 123.4, braE: 8.9, alh: 210.3 }), null));
    expect(sum).toMatchObject({ braI: 123.4, braE: 8.9, braB: 0, bra: 132.3 });
  });

  it("to etasjer med areal: 56,7 + 123,4 gir 180,1 (som i e2e)", () => {
    const sum = sumBuildingArea(floorsOf(area({ braI: 56.7 }), area({ braI: 123.4 })));
    expect(sum).toMatchObject({ braI: 180.1, bra: 180.1 });
  });

  it("etasjer med 0,1 og 0,2 gir 0,3 uten flyttallsfeil", () => {
    const sum = sumBuildingArea(floorsOf(area({ braI: 0.1 }), area({ braI: 0.2 })));
    expect(sum.braI).toBe(0.3);
    expect(sum.bra).toBe(0.3);
  });

  it("to bygninger: totalen er summen av bygningene, per arealtype", () => {
    const house = floorsOf(area({ braI: 123.4, braB: 8.9 }), area({ braI: 56.7 }));
    const garage = floorsOf(area({ braE: 0.1 }), area({ braE: 0.2 }));
    const buildings = [{ floors: house }, { floors: garage }] as unknown as AssignmentArg;
    const total = sumAssignmentArea(buildings);
    const a = sumBuildingArea(house);
    const b = sumBuildingArea(garage);
    expect(total).toMatchObject({
      braI: 180.1,
      braE: 0.3,
      braB: 8.9,
      bra: 189.3,
    });
    expect(total.bra).toBe(Math.round((a.bra + b.bra) * 10) / 10);
  });

  it("tom liste gir 0 for bygning og oppdrag", () => {
    expect(sumBuildingArea(floorsOf())).toMatchObject({ braI: 0, braE: 0, braB: 0, bra: 0 });
    expect(sumAssignmentArea([] as unknown as AssignmentArg)).toMatchObject({
      braI: 0,
      braE: 0,
      braB: 0,
      bra: 0,
    });
  });

  it("bygning uten etasjer gir 0 i totalen", () => {
    const buildings = [
      { floors: floorsOf() },
      { floors: floorsOf(area({ braI: 12.3 })) },
    ] as unknown as AssignmentArg;
    expect(sumAssignmentArea(buildings).bra).toBe(12.3);
  });
});

describe("1.11 alle koder er dekket av testsakene", () => {
  it("fasiten over har én rad per romtype i ROOM_TYPES (ny kode uten testsak gjør testen rød)", () => {
    expect(roomTypes).toHaveLength(EXPECTED_ROOM_TYPES.length);
    const covered = new Set(EXPECTED_ROOM_TYPES.map((row) => row.key));
    for (const row of roomTypes) expect(covered.has(row.key), row.key).toBe(true);
  });
});
