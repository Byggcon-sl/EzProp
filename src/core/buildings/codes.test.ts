import { describe, expect, it } from "vitest";
import * as codes from "./codes";
import {
  AREA_TYPES,
  MEASURING_METHODS,
  ROOM_TYPE_GROUPS,
  ROOM_TYPES,
  sumAssignmentArea,
  sumBuildingArea,
  sumFloorArea,
  suggestAreaType,
  suggestBelowGround,
} from "./codes";

/*
 * Faste koder og dataregler for bygninger, etasjer, areal og rom
 * (docs/funksjoner/fase2a-bygninger-areal-rom-testplan.md avsnitt 1). Ren enhetstest. Kodene
 * endres aldri (regel 6); en ny romtype uten testsak gjør 1.11 rød.
 *
 * Kortet sier ikke om `AREA_TYPES`, `MEASURING_METHODS` og `ROOM_TYPE_GROUPS` er lister med
 * tekst eller med `{ key, label }`; `keysOf` og `labelOf` tåler begge. Etikettfunksjonene finnes
 * under de vanlige navnene (`areaTypeLabel`, `measuringMethodLabel`, `roomTypeLabel`).
 *
 * Romtypenes etiketter i kortet har noen ganger en merknad etter navnet («Bod, ute, BRA-e»,
 * «Kjellerstue, under terreng»). Merknaden er standardverdien, ikke en del av navnet, så testen
 * sjekker bare at etiketten begynner med navnet.
 *
 * Summene tar etasjene som `{ area }` (arealraden eller `null`) og bygningene som `{ floors }`.
 * Avviker utvikleren, rettes `floorsOf` og `buildingsOf` ved sammenslåingen.
 *
 * Støtter hovedmål: tid (forslag til arealtype og «under terreng», summene regnes av systemet),
 * reklamasjoner (låste koder, ingen flyttallsfeil i BRA) og KI først (faste koder som et senere
 * forslag fra plantegning eller LiDAR kan fylle ut).
 */

type Entry = string | { key: string; label?: string };

function keysOf(list: readonly unknown[]): string[] {
  return (list as Entry[]).map((entry) => (typeof entry === "string" ? entry : entry.key));
}

const LABEL_FUNCTIONS = {
  area: ["areaTypeLabel", "areaTypeLabelOf"],
  method: ["measuringMethodLabel", "methodLabel", "measuringMethodLabelOf"],
  room: ["roomTypeLabel", "roomTypeLabelOf"],
} as const;

type LabelKind = keyof typeof LABEL_FUNCTIONS;

function labelFunction(kind: LabelKind): (code: string) => string {
  const names = LABEL_FUNCTIONS[kind];
  const found = names
    .map((name) => (codes as unknown as Record<string, unknown>)[name])
    .find((value) => typeof value === "function");
  if (!found) {
    throw new Error(`fant ikke etikettfunksjonen i ./codes (prøvde ${names.join(", ")})`);
  }
  return found as (code: string) => string;
}

/** Etiketten fra lista (`{ key, label }`) eller etikettfunksjonen. */
function labelOf(list: readonly unknown[], kind: LabelKind, key: string) {
  const entry = (list as Entry[]).find(
    (candidate) => (typeof candidate === "string" ? candidate : candidate.key) === key,
  );
  if (entry && typeof entry !== "string" && typeof entry.label === "string") return entry.label;
  return labelFunction(kind)(key);
}

type RoomTypeRow = {
  key: string;
  label: string;
  group: string;
  defaultAreaType: string;
  defaultBelowGround: boolean;
  draft: boolean;
};

const ROOMS = ROOM_TYPES as unknown as readonly RoomTypeRow[];

/** Kortets 33 romtyper i fast rekkefølge, med navnet (uten merknaden om standardverdi). */
const EXPECTED_ROOM_TYPES: [string, string][] = [
  ["bathroom", "Bad"],
  ["laundry", "Vaskerom"],
  ["bathroom_laundry", "Bad og vaskerom"],
  ["room_with_drain", "Annet rom med sluk"],
  ["other_wet_room", "Annet våtrom"],
  ["kitchen", "Kjøkken"],
  ["living_kitchen", "Stue og kjøkken"],
  ["toilet", "Toalettrom"],
  ["sauna", "Badstue"],
  ["boiler_room", "Fyrrom"],
  ["technical_room", "Teknisk rom"],
  ["cold_room", "Kjølerom"],
  ["swimming_pool", "Svømmebasseng"],
  ["living_room", "Stue"],
  ["bedroom", "Soverom"],
  ["office", "Kontor eller arbeidsrom"],
  ["family_room", "Allrom"],
  ["dining_room", "Spisestue"],
  ["entrance", "Entré og vindfang"],
  ["hallway", "Gang og hall"],
  ["stairwell", "Trapperom"],
  ["wardrobe", "Garderobe"],
  ["storage", "Bod, inne"],
  ["external_storage", "Bod, ute"],
  ["basement_living_room", "Kjellerstue"],
  ["basement_room", "Kjellerrom, uinnredet"],
  ["crawl_space", "Kryperom"],
  ["attic_living_room", "Loftstue"],
  ["unfinished_attic", "Loft, uinnredet"],
  ["garage", "Garasje"],
  ["glazed_balcony", "Innglasset balkong"],
  ["workshop", "Verksted"],
  ["other", "Annet"],
];

/** 1.6 Grupper som testsaker. Én rad per romtype. */
const GROUP_CASES: [string, string][] = [
  ["bathroom", "wet_room"],
  ["laundry", "wet_room"],
  ["bathroom_laundry", "wet_room"],
  ["room_with_drain", "wet_room"],
  ["other_wet_room", "wet_room"],
  ["kitchen", "kitchen"],
  ["living_kitchen", "kitchen"],
  ["toilet", "toilet"],
  ["sauna", "special"],
  ["boiler_room", "special"],
  ["technical_room", "special"],
  ["cold_room", "special"],
  ["swimming_pool", "special"],
  ["living_room", "other"],
  ["bedroom", "other"],
  ["office", "other"],
  ["family_room", "other"],
  ["dining_room", "other"],
  ["entrance", "other"],
  ["hallway", "other"],
  ["stairwell", "other"],
  ["wardrobe", "other"],
  ["storage", "other"],
  ["external_storage", "other"],
  ["basement_living_room", "other"],
  ["basement_room", "other"],
  ["crawl_space", "other"],
  ["attic_living_room", "other"],
  ["unfinished_attic", "other"],
  ["garage", "other"],
  ["glazed_balcony", "other"],
  ["workshop", "other"],
  ["other", "other"],
];

/** 1.7 Arealtype som testsaker. Én rad per romtype. */
const NOT_BRA_I: Record<string, string> = {
  garage: "bra_e",
  external_storage: "bra_e",
  glazed_balcony: "bra_b",
};
const AREA_TYPE_CASES: [string, string][] = EXPECTED_ROOM_TYPES.map(([key]) => [
  key,
  NOT_BRA_I[key] ?? "bra_i",
]);

const USUALLY_BELOW_GROUND = ["basement_living_room", "basement_room", "crawl_space"];

describe("1.1–1.4 faste koder og etiketter", () => {
  it("1.1 AREA_TYPES er bra_i, bra_e, bra_b i fast rekkefølge, med BRA-i, BRA-e, BRA-b", () => {
    expect(keysOf(AREA_TYPES)).toEqual(["bra_i", "bra_e", "bra_b"]);
    expect(keysOf(AREA_TYPES).map((key) => labelOf(AREA_TYPES, "area", key))).toEqual([
      "BRA-i",
      "BRA-e",
      "BRA-b",
    ]);
  });

  it("1.2 MEASURING_METHODS er laser, drawing, other; lidar finnes ikke ennå (K7)", () => {
    expect(keysOf(MEASURING_METHODS)).toEqual(["laser", "drawing", "other"]);
    expect(keysOf(MEASURING_METHODS)).not.toContain("lidar");
    expect(
      keysOf(MEASURING_METHODS).map((key) => labelOf(MEASURING_METHODS, "method", key)),
    ).toEqual(["Oppmålt med laser", "Fra tegning", "Annen kilde"]);
  });

  it("1.3 ROOM_TYPE_GROUPS er wet_room, kitchen, toilet, special, other", () => {
    expect(keysOf(ROOM_TYPE_GROUPS)).toEqual(["wet_room", "kitchen", "toilet", "special", "other"]);
  });

  it("1.4 ROOM_TYPES har nøyaktig de 33 kodene i kortets rekkefølge, uten dubletter", () => {
    expect(ROOMS.map((row) => row.key)).toEqual(EXPECTED_ROOM_TYPES.map(([key]) => key));
    expect(ROOMS).toHaveLength(33);
    expect(new Set(ROOMS.map((row) => row.key)).size).toBe(33);
  });

  it.each(EXPECTED_ROOM_TYPES)("1.4 %s har etiketten «%s»", (key, label) => {
    const row = ROOMS.find((candidate) => candidate.key === key);
    expect(row, key).toBeDefined();
    expect(row!.label.startsWith(label), `«${row!.label}» begynner med «${label}»`).toBe(true);
    expect(labelFunction("room")(key)).toBe(row!.label);
  });

  it("1.4 alle romtypene er merket utkast (draft: true), ikke godkjent av fagrådet", () => {
    for (const row of ROOMS) expect(row.draft, row.key).toBe(true);
  });

  it.each([
    ["area", "alh"],
    ["method", "lidar"],
    ["room", "villa"],
  ] as const)("etiketten for ukjent %s-kode «%s» er koden selv", (kind, code) => {
    expect(labelFunction(kind)(code)).toBe(code);
  });
});

describe("1.5 gyldige felt per romtype", () => {
  it.each(ROOMS.map((row) => [row.key, row] as const))("%s", (_key, row) => {
    expect(keysOf(ROOM_TYPE_GROUPS)).toContain(row.group);
    expect(keysOf(AREA_TYPES)).toContain(row.defaultAreaType);
    expect(typeof row.defaultBelowGround).toBe("boolean");
  });
});

describe("1.6 grupper som testsaker", () => {
  it.each(GROUP_CASES)("%s har gruppen %s", (key, group) => {
    expect(ROOMS.find((row) => row.key === key)?.group).toBe(group);
  });
});

describe("1.7 suggestAreaType", () => {
  it.each([
    ["bathroom", "bra_i"],
    ["garage", "bra_e"],
    ["external_storage", "bra_e"],
    ["glazed_balcony", "bra_b"],
  ])("%s → %s", (key, expected) => {
    expect(suggestAreaType(key as never)).toBe(expected);
  });

  const OTHERS = AREA_TYPE_CASES.filter(([key]) => !(key in NOT_BRA_I) && key !== "bathroom");

  it.each(OTHERS)("%s → %s (alle andre 29 gir bra_i)", (key, expected) => {
    expect(suggestAreaType(key as never)).toBe(expected);
  });

  it("de andre 29 gir bra_i, og 30 av 33 romtyper (med bad) gir bra_i", () => {
    expect(OTHERS).toHaveLength(29);
    expect(OTHERS.every(([, type]) => type === "bra_i")).toBe(true);
    expect(AREA_TYPE_CASES.filter(([, type]) => type === "bra_i")).toHaveLength(30);
  });

  it.each(AREA_TYPE_CASES)("%s: romtypens defaultAreaType er %s", (key, expected) => {
    expect(ROOMS.find((row) => row.key === key)?.defaultAreaType).toBe(expected);
  });
});

describe("1.8 suggestBelowGround (A87)", () => {
  it.each([
    ["basement_living_room", true, true],
    ["basement_living_room", false, true],
    ["bathroom", true, true],
    ["bathroom", false, false],
  ] as const)("%s i etasje under terreng = %s → %s", (roomType, floorBelowGround, expected) => {
    expect(suggestBelowGround({ roomType: roomType as never, floorBelowGround })).toBe(expected);
  });

  it.each(EXPECTED_ROOM_TYPES.map(([key]) => key))(
    "%s i etasje over terreng: sann bare for kjellerstue, kjellerrom og kryperom",
    (key) => {
      const expected = USUALLY_BELOW_GROUND.includes(key);
      expect(suggestBelowGround({ roomType: key as never, floorBelowGround: false })).toBe(
        expected,
      );
      expect(ROOMS.find((row) => row.key === key)?.defaultBelowGround).toBe(expected);
    },
  );

  it.each(EXPECTED_ROOM_TYPES.map(([key]) => key))(
    "%s i etasje under terreng: alltid sann",
    (key) => {
      expect(suggestBelowGround({ roomType: key as never, floorBelowGround: true })).toBe(true);
    },
  );
});

type AreaValues = {
  braI: number | null;
  braE: number | null;
  braB: number | null;
  alh: number | null;
};

type Sum = { braI: number; braE: number; braB: number; bra: number };

const EMPTY: AreaValues = { braI: null, braE: null, braB: null, alh: null };
const ZERO: Sum = { braI: 0, braE: 0, braB: 0, bra: 0 };

function area(values: Partial<AreaValues>): AreaValues {
  return { ...EMPTY, ...values };
}

function floorSum(values: AreaValues): Sum {
  return sumFloorArea(values as never) as unknown as Sum;
}

/** Etasjene slik summene tar dem: `{ area }`, der `area` er arealraden eller `null`. */
function floorsOf(areas: (AreaValues | null)[]) {
  return areas.map((value) => ({ area: value }));
}

function buildingSum(areas: (AreaValues | null)[]): Sum {
  return sumBuildingArea(floorsOf(areas) as never) as unknown as Sum;
}

function assignmentSum(buildings: (AreaValues | null)[][]): Sum {
  return sumAssignmentArea(
    buildings.map((areas) => ({ floors: floorsOf(areas) })) as never,
  ) as unknown as Sum;
}

function decimals(value: number): number {
  return (String(value).split(".")[1] ?? "").length;
}

describe("1.9 sumFloorArea", () => {
  it("alle tomme → 0", () => {
    expect(floorSum(EMPTY)).toEqual(ZERO);
  });

  it("bare BRA-i → BRA = BRA-i", () => {
    expect(floorSum(area({ braI: 123.4 }))).toEqual({ ...ZERO, braI: 123.4, bra: 123.4 });
  });

  it("0,1 + 0,2 = 0,3 nøyaktig (ingen flyttallsfeil)", () => {
    const sum = floorSum(area({ braI: 0.1, braE: 0.2 }));
    expect(sum.bra).toBe(0.3);
    expect(String(sum.bra)).toBe("0.3");
  });

  it("123,4 + 56,7 + 8,9 = 189,0", () => {
    const sum = floorSum(area({ braI: 123.4, braE: 56.7, braB: 8.9 }));
    expect(sum).toEqual({ braI: 123.4, braE: 56.7, braB: 8.9, bra: 189 });
  });

  it("ALH 210,3 endrer ikke BRA og er ikke med i summen", () => {
    const sum = floorSum(area({ braI: 123.4, alh: 210.3 }));
    expect(sum.bra).toBe(123.4);
    expect(Object.values(sum)).not.toContain(210.3);
    expect(Object.values(sum)).not.toContain(333.7);
  });

  it.each([
    [0.1, 0.2, 0.4],
    [0.7, 0.1, 0.1],
    [1.1, 2.2, 3.3],
    [9999.9, 9999.9, 9999.9],
    [56.7, 123.4, 0.3],
  ])("resultatet har aldri mer enn én desimal (%s + %s + %s)", (braI, braE, braB) => {
    const sum = floorSum(area({ braI, braE, braB }));
    for (const value of Object.values(sum)) {
      expect(decimals(value), String(value)).toBeLessThanOrEqual(1);
    }
    expect(sum.bra).toBe(Math.round((braI + braE + braB) * 10) / 10);
  });
});

describe("1.10 sumBuildingArea og sumAssignmentArea", () => {
  it("to etasjer, én uten areal (null): summen per arealtype og totalt", () => {
    expect(buildingSum([area({ braI: 123.4, braE: 8.9, alh: 210.3 }), null])).toEqual({
      braI: 123.4,
      braE: 8.9,
      braB: 0,
      bra: 132.3,
    });
  });

  it("to etasjer med areal: 56,7 + 123,4 = 180,1", () => {
    expect(buildingSum([area({ braI: 56.7 }), area({ braI: 123.4 })])).toEqual({
      ...ZERO,
      braI: 180.1,
      bra: 180.1,
    });
  });

  it("to bygninger: totalen er summen av bygningene", () => {
    const first = [area({ braI: 56.7 }), area({ braI: 123.4, braB: 8.9 })];
    const second = [area({ braE: 0.1 }), area({ braE: 0.2 }), null];
    const total = assignmentSum([first, second]);
    expect(total).toEqual({ braI: 180.1, braE: 0.3, braB: 8.9, bra: 189.3 });
    const a = buildingSum(first);
    const b = buildingSum(second);
    expect(total.bra).toBe(Math.round((a.bra + b.bra) * 10) / 10);
    for (const value of Object.values(total)) expect(decimals(value)).toBeLessThanOrEqual(1);
  });

  it("tom liste → 0", () => {
    expect(buildingSum([])).toEqual(ZERO);
    expect(assignmentSum([])).toEqual(ZERO);
  });

  it("bygning uten etasjer teller som 0 i totalen", () => {
    expect(assignmentSum([[], [area({ braI: 12.3 })]])).toEqual({
      ...ZERO,
      braI: 12.3,
      bra: 12.3,
    });
  });
});

describe("1.11 alle koder er dekket", () => {
  it("testsakene i 1.6 og 1.7 har like mange rader som ROOM_TYPES", () => {
    expect(GROUP_CASES).toHaveLength(ROOMS.length);
    expect(AREA_TYPE_CASES).toHaveLength(ROOMS.length);
    expect(GROUP_CASES.map(([key]) => key).sort()).toEqual(ROOMS.map((row) => row.key).sort());
  });
});
