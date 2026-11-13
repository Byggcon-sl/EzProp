import type { HousingType } from "@/core/properties";
import { roomTypeLabel, type RoomType } from "./codes";

/*
 * Flere rom på én gang (T4, A280–A283). Rene funksjoner uten server, database eller Next, slik at
 * dialogen, kjernen, befaringsvisningen uten nett (2b) og KI-forslaget fra plantegning (2a-3) kan
 * bruke dem uendret. Romutkastene (`RoomDraft`) er den ene listen som settene, tellerne og senere
 * KI-forslaget fyller; `addRooms` i kjernen lagrer dem.
 */

/** Ett romutkast: romtype og antall. Navnet lages av `numberRoomDrafts`, aldri av klienten. */
export type RoomDraft = { roomType: RoomType; count: number };

/**
 * Kilden til romutkastene (regel 6: kodene endres aldri). `ai_floor_plan` legges til først når
 * KI-forslaget fra plantegning kommer (2a-3).
 */
export const ROOM_DRAFT_SOURCES = ["manual", "preset"] as const;
export type RoomDraftSource = (typeof ROOM_DRAFT_SOURCES)[number];

type RoomPresetDefinition = {
  readonly key: string;
  readonly label: string;
  /** Utkast, ikke godkjent av fagrådet (A280). */
  readonly draft: true;
  readonly drafts: readonly RoomDraft[];
};

/**
 * Ferdige sett med rom (A280). Utkast, ikke godkjent av fagrådet. Romtypenøkler, ikke navn.
 * Rekkefølgen er den som vises i dialogen (etter det foreslåtte settet).
 */
export const ROOM_PRESETS = [
  {
    key: "apartment",
    label: "Leilighet",
    draft: true,
    drafts: [
      { roomType: "entrance", count: 1 },
      { roomType: "living_room", count: 1 },
      { roomType: "kitchen", count: 1 },
      { roomType: "bathroom", count: 1 },
      { roomType: "bedroom", count: 2 },
      { roomType: "storage", count: 1 },
    ],
  },
  {
    key: "house_main_floor",
    label: "Bolig, inngangsetasje",
    draft: true,
    drafts: [
      { roomType: "entrance", count: 1 },
      { roomType: "hallway", count: 1 },
      { roomType: "living_room", count: 1 },
      { roomType: "kitchen", count: 1 },
      { roomType: "bathroom", count: 1 },
      { roomType: "toilet", count: 1 },
      { roomType: "bedroom", count: 1 },
      { roomType: "storage", count: 1 },
    ],
  },
  {
    key: "house_upper_floor",
    label: "Bolig, etasje over",
    draft: true,
    drafts: [
      { roomType: "hallway", count: 1 },
      { roomType: "bedroom", count: 3 },
      { roomType: "bathroom", count: 1 },
    ],
  },
  {
    key: "basement",
    label: "Kjeller eller underetasje",
    draft: true,
    drafts: [
      { roomType: "hallway", count: 1 },
      { roomType: "laundry", count: 1 },
      { roomType: "storage", count: 1 },
      { roomType: "technical_room", count: 1 },
      { roomType: "basement_living_room", count: 1 },
    ],
  },
] as const satisfies readonly RoomPresetDefinition[];

export type RoomPresetKey = (typeof ROOM_PRESETS)[number]["key"];
export type RoomPreset = RoomPresetDefinition & { readonly key: RoomPresetKey };

/** Nøklene i `ROOM_PRESETS`, i samme rekkefølge. */
export const ROOM_PRESET_KEYS = ROOM_PRESETS.map((preset) => preset.key) as [
  RoomPresetKey,
  ...RoomPresetKey[],
];

/** Vanlige romtyper, som fliser med teller i dialogen. */
export const COMMON_ROOM_TYPES = [
  "entrance",
  "hallway",
  "living_room",
  "kitchen",
  "living_kitchen",
  "bedroom",
  "bathroom",
  "toilet",
  "laundry",
  "storage",
  "technical_room",
] as const satisfies readonly RoomType[];

/**
 * Forslag til ferdig sett ut fra boligtypen og etasjen (fast regel, ikke KI). Under terreng gir
 * kjeller, leilighet gir leilighet, etasje 1 eller lavere gir inngangsetasje, ellers etasje over.
 */
export function suggestRoomPreset({
  housingType,
  floorLevel,
  floorBelowGround,
}: {
  housingType: HousingType | null;
  floorLevel: number;
  floorBelowGround: boolean;
}): RoomPresetKey {
  if (floorBelowGround) return "basement";
  if (housingType === "apartment" || housingType === "apartment_in_house") return "apartment";
  if (floorLevel <= 1) return "house_main_floor";
  return "house_upper_floor";
}

/** Høyeste N i navn på formen «<romtypens navn> N» (store og små bokstaver likt), eller 0. */
function highestNumber(label: string, names: readonly (string | null)[]): number {
  const prefix = `${label.toLocaleLowerCase("nb")} `;
  let highest = 0;
  for (const name of names) {
    const trimmed = (name ?? "").trim().toLocaleLowerCase("nb");
    if (!trimmed.startsWith(prefix)) continue;
    const digits = trimmed.slice(prefix.length);
    if (!/^\d+$/.test(digits)) continue;
    highest = Math.max(highest, Number(digits));
  }
  return highest;
}

/**
 * Navnene på de nye rommene (A281). `existingRooms` er de aktive rommene i etasjen. Har en romtype
 * bare ett rom i etasjen totalt, får det nye rommet tomt navn. Ellers får de nye
 * «<romtypens navn> N», der første N er høyeste av antall rom av typen og høyeste nummer i
 * navnene i etasjen, pluss 1. «soverom 7» teller som 7 (store og små bokstaver likt); «Soverommet 3»,
 * «Soverom 3b» og «Soverom  4» teller ikke. Rom som finnes, endres aldri. Resultatet følger rekkefølgen i `drafts`.
 */
export function numberRoomDrafts(
  drafts: readonly RoomDraft[],
  existingRooms: readonly { roomType: string; name: string | null }[],
): { roomType: RoomType; name: string }[] {
  const newCounts = new Map<RoomType, number>();
  for (const draft of drafts) {
    newCounts.set(draft.roomType, (newCounts.get(draft.roomType) ?? 0) + draft.count);
  }

  const next = new Map<RoomType, number | null>();
  for (const [roomType, added] of newCounts) {
    const existing = existingRooms.filter((room) => room.roomType === roomType);
    if (existing.length + added === 1) {
      next.set(roomType, null);
      continue;
    }
    // Alle navn i etasjen telles, også på rom av en annen type, så det aldri blir to like navn.
    const highest = highestNumber(
      roomTypeLabel(roomType),
      existingRooms.map((room) => room.name),
    );
    const start = Math.max(existing.length, highest) + 1;
    next.set(roomType, start);
  }

  const result: { roomType: RoomType; name: string }[] = [];
  for (const draft of drafts) {
    for (let i = 0; i < draft.count; i += 1) {
      const number = next.get(draft.roomType) ?? null;
      if (number === null) {
        result.push({ roomType: draft.roomType, name: "" });
        continue;
      }
      result.push({ roomType: draft.roomType, name: `${roomTypeLabel(draft.roomType)} ${number}` });
      next.set(draft.roomType, number + 1);
    }
  }
  return result;
}
