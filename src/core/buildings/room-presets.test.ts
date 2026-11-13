import { describe, expect, it } from "vitest";
import {
  ROOM_DRAFT_SOURCES,
  ROOM_PRESETS,
  ROOM_TYPE_KEYS,
  addRoomsInputSchema,
  numberRoomDrafts,
  roomTypeLabel,
  suggestRoomPreset,
  type RoomDraft,
} from "@/core/buildings";
import { HOUSING_TYPES, type HousingType } from "@/core/properties";

/*
 * Flere rom på én gang (T4, A280–A283). De rene funksjonene: ferdige sett (F1), forslag til sett
 * (F2) og nummerering (F3). Ingen database, ingen Next, ingen KI.
 * Testplan: docs/funksjoner/fase2a-flere-rom-testplan.md F1–F3.
 *
 * Testdata er oppdiktet. Støtter hovedmål: de ansatte (settene gir «færrest klikk»), KI i bunnen
 * (samme `RoomDraft`-liste som KI-forslaget fra plantegning fyller senere) og færre reklamasjoner
 * (unike romnavn som aldri kolliderer).
 */

/** Innholdet i settene fra kortet punkt 3 (romtype → antall). */
const EXPECTED_PRESETS: Record<string, Record<string, number>> = {
  apartment: {
    entrance: 1,
    living_room: 1,
    kitchen: 1,
    bathroom: 1,
    bedroom: 2,
    storage: 1,
  },
  house_main_floor: {
    entrance: 1,
    hallway: 1,
    living_room: 1,
    kitchen: 1,
    bathroom: 1,
    toilet: 1,
    bedroom: 1,
    storage: 1,
  },
  house_upper_floor: {
    hallway: 1,
    bedroom: 3,
    bathroom: 1,
  },
  basement: {
    hallway: 1,
    laundry: 1,
    storage: 1,
    technical_room: 1,
    basement_living_room: 1,
  },
};

/** Alle boligtypene og «ingen eiendom». */
const HOUSING_CASES: (HousingType | null)[] = [...HOUSING_TYPES, null];

/** Samler romutkastene i et sett som et kart romtype → antall. */
function draftsOf(presetKey: string): Record<string, number> {
  const preset = ROOM_PRESETS.find((candidate) => candidate.key === presetKey);
  if (!preset) throw new Error(`fant ikke settet ${presetKey}`);
  const counts: Record<string, number> = {};
  for (const draft of preset.drafts) {
    counts[draft.roomType] = (counts[draft.roomType] ?? 0) + draft.count;
  }
  return counts;
}

describe("F1 ferdige sett (ROOM_PRESETS)", () => {
  it("F1.1 preset_keys_snapshot: nøklene er nøyaktig de fire, i fast rekkefølge", () => {
    expect(ROOM_PRESETS.map((preset) => preset.key)).toEqual([
      "apartment",
      "house_main_floor",
      "house_upper_floor",
      "basement",
    ]);
  });

  it.each(Object.keys(EXPECTED_PRESETS))("F1.2 preset_contents: %s har riktig innhold", (key) => {
    expect(draftsOf(key)).toEqual(EXPECTED_PRESETS[key]);
  });

  it("F1.2 preset_contents: apartment har 2 soverom og 7 rom totalt", () => {
    const apartment = ROOM_PRESETS.find((preset) => preset.key === "apartment")!;
    const bedrooms = apartment.drafts
      .filter((draft) => draft.roomType === "bedroom")
      .reduce((sum, draft) => sum + draft.count, 0);
    const total = apartment.drafts.reduce((sum, draft) => sum + draft.count, 0);
    expect(bedrooms).toBe(2);
    expect(total).toBe(7);
  });

  const ALL_ROOMS = ROOM_PRESETS.flatMap((preset) =>
    preset.drafts.map((draft) => ({ key: preset.key, roomType: draft.roomType })),
  );
  it.each(ALL_ROOMS)(
    "F1.3 preset_room_types_active: $key sin $roomType er en aktiv romtype",
    ({ roomType }) => {
      expect(ROOM_TYPE_KEYS as readonly string[]).toContain(roomType);
    },
  );

  it.each(ROOM_PRESETS.map((preset) => preset.key))(
    "F1.4 preset_marked_draft: %s er merket utkast",
    (key) => {
      const preset = ROOM_PRESETS.find((candidate) => candidate.key === key)!;
      expect(preset.draft).toBe(true);
    },
  );

  it.each(ROOM_PRESETS.map((preset) => preset.key))(
    "F1.5 preset_counts_valid: %s har gyldige tellere og går gjennom skjemaet",
    (key) => {
      const preset = ROOM_PRESETS.find((candidate) => candidate.key === key)!;
      const seen = new Set<string>();
      let total = 0;
      for (const draft of preset.drafts) {
        expect(draft.count, `${key}.${draft.roomType} er 1–20`).toBeGreaterThanOrEqual(1);
        expect(draft.count).toBeLessThanOrEqual(20);
        expect(seen.has(draft.roomType), `${draft.roomType} står bare én gang i ${key}`).toBe(false);
        seen.add(draft.roomType);
        total += draft.count;
      }
      expect(total, `${key} har høyst 40 rom`).toBeLessThanOrEqual(40);

      const parsed = addRoomsInputSchema.safeParse({
        drafts: preset.drafts.map((draft) => ({ roomType: draft.roomType, count: draft.count })),
        source: "preset",
        presetKey: key,
      });
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    },
  );

  it("F1.6 draft_sources: ROOM_DRAFT_SOURCES er nøyaktig manual og preset", () => {
    expect([...ROOM_DRAFT_SOURCES]).toEqual(["manual", "preset"]);
    expect(ROOM_DRAFT_SOURCES as readonly string[]).not.toContain("ai_floor_plan");
  });
});

describe("F2 forslag til sett (suggestRoomPreset)", () => {
  it.each(HOUSING_CASES)(
    "F2.1 below_ground_wins: under terreng gir basement (boligtype %s)",
    (housingType) => {
      for (const floorLevel of [-2, 1, 2]) {
        expect(suggestRoomPreset({ housingType, floorLevel, floorBelowGround: true })).toBe(
          "basement",
        );
      }
    },
  );

  it.each(["apartment", "apartment_in_house"] as const)(
    "F2.2 apartment: %s (ikke under terreng) gir apartment",
    (housingType) => {
      for (const floorLevel of [-1, 0, 1, 2, 5]) {
        expect(suggestRoomPreset({ housingType, floorLevel, floorBelowGround: false })).toBe(
          "apartment",
        );
      }
    },
  );

  const MAIN_FLOOR_TYPES: (HousingType | null)[] = [
    "detached",
    "semi_detached",
    "terraced",
    "holiday_home",
    "farm",
    "other",
    null,
  ];
  it.each(MAIN_FLOOR_TYPES)(
    "F2.3 main_floor: %s på nivå 1, 0 og -1 (over terreng) gir house_main_floor",
    (housingType) => {
      for (const floorLevel of [1, 0, -1]) {
        expect(suggestRoomPreset({ housingType, floorLevel, floorBelowGround: false })).toBe(
          "house_main_floor",
        );
      }
    },
  );

  it.each(MAIN_FLOOR_TYPES)(
    "F2.4 upper_floor: %s på nivå 2 og 20 gir house_upper_floor",
    (housingType) => {
      for (const floorLevel of [2, 20]) {
        expect(suggestRoomPreset({ housingType, floorLevel, floorBelowGround: false })).toBe(
          "house_upper_floor",
        );
      }
    },
  );

  it("F2.5 total: hver kombinasjon gir en kjent nøkkel, aldri undefined", () => {
    const keys = new Set(ROOM_PRESETS.map((preset) => preset.key));
    for (const housingType of HOUSING_CASES) {
      for (let floorLevel = -2; floorLevel <= 20; floorLevel += 1) {
        for (const floorBelowGround of [true, false]) {
          const key = suggestRoomPreset({ housingType, floorLevel, floorBelowGround });
          expect(keys.has(key), `${housingType}/${floorLevel}/${floorBelowGround}`).toBe(true);
        }
      }
    }
  });
});

describe("F3 nummerering (numberRoomDrafts)", () => {
  const bedroom = roomTypeLabel("bedroom"); // «Soverom»
  const bathroom = roomTypeLabel("bathroom"); // «Bad»

  function drafts(entries: [string, number][]): RoomDraft[] {
    return entries.map(([roomType, count]) => ({ roomType, count }) as RoomDraft);
  }
  function existing(entries: [string, string | null][]) {
    return entries.map(([roomType, name]) => ({ roomType, name }));
  }
  function names(result: { name: string }[]) {
    return result.map((room) => room.name);
  }

  it("F3.1 single_empty_name: ett soverom i tom etasje gir tomt navn", () => {
    expect(names(numberRoomDrafts(drafts([["bedroom", 1]]), []))).toEqual([""]);
  });

  it("F3.2 two_new: to soverom i tom etasje gir Soverom 1 og 2", () => {
    expect(names(numberRoomDrafts(drafts([["bedroom", 2]]), []))).toEqual([
      `${bedroom} 1`,
      `${bedroom} 2`,
    ]);
  });

  it("F3.3 continue_after_existing: Soverom 1 og 2 finnes, +1 gir Soverom 3", () => {
    const result = numberRoomDrafts(
      drafts([["bedroom", 1]]),
      existing([
        ["bedroom", `${bedroom} 1`],
        ["bedroom", `${bedroom} 2`],
      ]),
    );
    expect(names(result)).toEqual([`${bedroom} 3`]);
  });

  it("F3.4 gap_uses_max: bare Soverom 2 finnes, +1 gir Soverom 3", () => {
    const result = numberRoomDrafts(drafts([["bedroom", 1]]), existing([["bedroom", `${bedroom} 2`]]));
    expect(names(result)).toEqual([`${bedroom} 3`]);
  });

  it("F3.5 existing_unnamed: ett soverom uten navn finnes, +1 gir Soverom 2; det som finnes er ikke i resultatet", () => {
    const result = numberRoomDrafts(drafts([["bedroom", 1]]), existing([["bedroom", null]]));
    expect(names(result)).toEqual([`${bedroom} 2`]);
    expect(result).toHaveLength(1);
  });

  it("F3.6 count_beats_names: tre soverom uten tallnavn finnes, +2 gir Soverom 4 og 5", () => {
    const result = numberRoomDrafts(
      drafts([["bedroom", 2]]),
      existing([
        ["bedroom", null],
        ["bedroom", "Hovedsoverom"],
        ["bedroom", ""],
      ]),
    );
    expect(names(result)).toEqual([`${bedroom} 4`, `${bedroom} 5`]);
  });

  it("F3.7 high_number: Soverom 9 og ett til finnes, +1 gir Soverom 10", () => {
    const result = numberRoomDrafts(
      drafts([["bedroom", 1]]),
      existing([
        ["bedroom", `${bedroom} 9`],
        ["bedroom", null],
      ]),
    );
    expect(names(result)).toEqual([`${bedroom} 10`]);
  });

  it("F3.8 types_independent: soverom og bad teller hver for seg; nytt kjøkken får tomt navn", () => {
    const result = numberRoomDrafts(
      drafts([
        ["bedroom", 2],
        ["bathroom", 1],
        ["kitchen", 1],
      ]),
      existing([["bathroom", `${bathroom} 1`]]),
    );
    expect(names(result)).toEqual([`${bedroom} 1`, `${bedroom} 2`, `${bathroom} 2`, ""]);
  });

  // F3.9: bare formen «<romtypens navn> N» teller. Valg om store/små bokstaver: likt (case-ufølsomt),
  // så «soverom 7» teller som 7. «Soverommet 3», «Soverom 3b» og «Soverom  4» (dobbelt mellomrom)
  // teller ikke. Dokumentert valg: utvikleren normaliserer med toLocaleLowerCase.
  it("F3.9 lookalike_names: bare «Soverom N» teller; lignende navn teller ikke", () => {
    const result = numberRoomDrafts(
      drafts([["bedroom", 1]]),
      existing([
        ["bedroom", "Soverommet 3"],
        ["bedroom", `${bedroom} 3b`],
        ["bedroom", `${bedroom}  4`],
      ]),
    );
    // Fire rom av typen (tre finnes + ett nytt), ingen gyldig N i navnene → start = 3 + 1 = 4
    expect(names(result)).toEqual([`${bedroom} 4`]);
  });

  it("F3.9 lookalike_names: «soverom 7» med små bokstaver teller som 7", () => {
    const result = numberRoomDrafts(
      drafts([["bedroom", 1]]),
      existing([
        ["bedroom", "soverom 7"],
        ["bedroom", null],
      ]),
    );
    expect(names(result)).toEqual([`${bedroom} 8`]);
  });

  it("F3.10 unique_property: alle ikke-tomme navn i etasjen er unike etter nummerering", () => {
    let seed = 20261113;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };
    const types = ["bedroom", "bathroom", "kitchen", "storage"];
    for (let round = 0; round < 60; round += 1) {
      const existingRooms: { roomType: string; name: string | null }[] = [];
      const existingNames: string[] = [];
      for (let i = 0; i < rand(6); i += 1) {
        const roomType = types[rand(types.length)]!;
        const label = roomTypeLabel(roomType);
        const choice = rand(3);
        const name =
          choice === 0 ? null : choice === 1 ? `${label} ${rand(5) + 1}` : "Fritekst";
        existingRooms.push({ roomType, name });
        if (name) existingNames.push(name);
      }
      const draftList: RoomDraft[] = [];
      const used = new Set<string>();
      let totalNew = 0;
      for (let i = 0; i < rand(4); i += 1) {
        const roomType = types[rand(types.length)]!;
        if (used.has(roomType)) continue;
        used.add(roomType);
        const count = rand(3) + 1;
        draftList.push({ roomType, count } as RoomDraft);
        totalNew += count;
      }
      const result = numberRoomDrafts(draftList, existingRooms);
      expect(result).toHaveLength(totalNew);
      // De nye, ikke-tomme navnene er unike seg imellom, og krasjer aldri med et navn som finnes.
      const newNames = names(result).filter((name) => name !== "");
      expect(new Set(newNames).size, `runde ${round}: nye navn unike`).toBe(newNames.length);
      const existingSet = new Set(existingNames);
      for (const name of newNames) {
        expect(existingSet.has(name), `runde ${round}: ${name} krasjer med et navn som finnes`).toBe(
          false,
        );
      }
    }
  });

  it("F3.11 order_stable: utdata følger rekkefølgen i utkastene", () => {
    const result = numberRoomDrafts(
      drafts([
        ["bedroom", 2],
        ["bathroom", 1],
      ]),
      [],
    );
    expect(result.map((room) => room.roomType)).toEqual(["bedroom", "bedroom", "bathroom"]);
  });
});
