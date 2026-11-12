/*
 * Faste koder for bygninger, etasjer, areal og rom (docs/05-domenemodell.md 4.4). Kodene står bare
 * her og i CHECK-reglene i `src/db/schema/floor-areas.ts` og `rooms.ts`. En kode endres aldri;
 * skal den få ny betydning, arkiveres den og det lages en ny (regel 6). Nye koder legges til sist.
 */

/**
 * Arealtype for rom (forskriften § 2-20). ALH er ikke en arealtype for rom. `not_bra` («Ikke del
 * av BRA», Ståle 12.11.2026, F6; A235) er en merking på rommet for kryperom og uinnredet loft. Den
 * påvirker ikke summene: BRA regnes fra etasjearealet (`sumFloorArea`), og rom har ikke areal.
 */
export const AREA_TYPES = ["bra_i", "bra_e", "bra_b", "not_bra"] as const;
export type AreaType = (typeof AREA_TYPES)[number];

const AREA_TYPE_LABELS: Record<AreaType, string> = {
  bra_i: "BRA-i",
  bra_e: "BRA-e",
  bra_b: "BRA-b",
  not_bra: "Ikke del av BRA",
};

/** Norsk navn på arealtypen. Ukjent kode gis tilbake som den er. */
export function areaTypeLabel(code: string): string {
  return AREA_TYPE_LABELS[code as AreaType] ?? code;
}

/** Hvordan arealet er målt (A96). `lidar` kommer som ny kode med iPadens LiDAR (K7). */
export const MEASURING_METHODS = ["laser", "drawing", "other"] as const;
export type MeasuringMethod = (typeof MEASURING_METHODS)[number];

const MEASURING_METHOD_LABELS: Record<MeasuringMethod, string> = {
  laser: "Oppmålt med laser",
  drawing: "Fra tegning",
  other: "Annen kilde",
};

/** Norsk navn på målemetoden. Ukjent kode gis tilbake som den er. */
export function measuringMethodLabel(code: string): string {
  return MEASURING_METHOD_LABELS[code as MeasuringMethod] ?? code;
}

/** Romgruppen styrer senere hvilke kontrollpunkter rommet får (regelmotoren). */
export const ROOM_TYPE_GROUPS = ["wet_room", "kitchen", "toilet", "special", "other"] as const;
export type RoomTypeGroup = (typeof ROOM_TYPE_GROUPS)[number];

const ROOM_TYPE_GROUP_LABELS: Record<RoomTypeGroup, string> = {
  wet_room: "Våtrom",
  kitchen: "Kjøkken",
  toilet: "Toalett",
  special: "Spesialrom",
  other: "Andre rom",
};

/** Norsk navn på romgruppen. Ukjent kode gis tilbake som den er. */
export function roomTypeGroupLabel(code: string): string {
  return ROOM_TYPE_GROUP_LABELS[code as RoomTypeGroup] ?? code;
}

type RoomTypeDefinition = {
  readonly key: string;
  readonly label: string;
  readonly group: RoomTypeGroup;
  readonly defaultAreaType: AreaType;
  readonly defaultBelowGround: boolean;
  /** Utkast, ikke godkjent av fagrådet (A95). */
  readonly draft: true;
};

/**
 * Romtypene (A95): Byggcons egen liste, kortere enn IVITs. Utkast, ikke godkjent av fagrådet.
 * Rekkefølgen er den som vises i nedtrekkslisten, gruppert etter `group`.
 */
export const ROOM_TYPES = [
  // Våtrom
  {
    key: "bathroom",
    label: "Bad",
    group: "wet_room",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "laundry",
    label: "Vaskerom",
    group: "wet_room",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "bathroom_laundry",
    label: "Bad og vaskerom",
    group: "wet_room",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "room_with_drain",
    label: "Annet rom med sluk",
    group: "wet_room",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "other_wet_room",
    label: "Annet våtrom",
    group: "wet_room",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  // Kjøkken
  {
    key: "kitchen",
    label: "Kjøkken",
    group: "kitchen",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "living_kitchen",
    label: "Stue og kjøkken",
    group: "kitchen",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  // Toalett
  {
    key: "toilet",
    label: "Toalettrom",
    group: "toilet",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  // Spesialrom
  {
    key: "sauna",
    label: "Badstue",
    group: "special",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "boiler_room",
    label: "Fyrrom",
    group: "special",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "technical_room",
    label: "Teknisk rom",
    group: "special",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "cold_room",
    label: "Kjølerom",
    group: "special",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "swimming_pool",
    label: "Svømmebasseng",
    group: "special",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  // Andre rom
  {
    key: "living_room",
    label: "Stue",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "bedroom",
    label: "Soverom",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "office",
    label: "Kontor eller arbeidsrom",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "family_room",
    label: "Allrom",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "dining_room",
    label: "Spisestue",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "entrance",
    label: "Entré og vindfang",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "hallway",
    label: "Gang og hall",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "stairwell",
    label: "Trapperom",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "wardrobe",
    label: "Garderobe",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "storage",
    label: "Bod, inne",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "external_storage",
    label: "Bod, ute",
    group: "other",
    defaultAreaType: "bra_e",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "basement_living_room",
    label: "Kjellerstue",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: true,
    draft: true,
  },
  {
    key: "basement_room",
    label: "Kjellerrom, uinnredet",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: true,
    draft: true,
  },
  {
    key: "crawl_space",
    label: "Kryperom",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: true,
    draft: true,
  },
  {
    key: "attic_living_room",
    label: "Loftstue",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "unfinished_attic",
    label: "Loft, uinnredet",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "garage",
    label: "Garasje",
    group: "other",
    defaultAreaType: "bra_e",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "glazed_balcony",
    label: "Innglasset balkong",
    group: "other",
    defaultAreaType: "bra_b",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "workshop",
    label: "Verksted",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
  {
    key: "other",
    label: "Annet",
    group: "other",
    defaultAreaType: "bra_i",
    defaultBelowGround: false,
    draft: true,
  },
] as const satisfies readonly RoomTypeDefinition[];
export type RoomType = (typeof ROOM_TYPES)[number]["key"];

/** Kodene i `ROOM_TYPES`, i samme rekkefølge. */
export const ROOM_TYPE_KEYS = ROOM_TYPES.map((type) => type.key) as [RoomType, ...RoomType[]];

function findRoomType(code: string): RoomTypeDefinition | undefined {
  return ROOM_TYPES.find((type) => type.key === code);
}

/** Norsk navn på romtypen. Ukjent kode gis tilbake som den er. */
export function roomTypeLabel(code: string): string {
  return findRoomType(code)?.label ?? code;
}

/** Dataregel (A97): romtypens standard arealtype. Ukjent kode gir `bra_i`. */
export function suggestAreaType(roomType: string): AreaType {
  return findRoomType(roomType)?.defaultAreaType ?? "bra_i";
}

/**
 * Dataregel (A97): forslag til «under terreng» for et rom. Sant når etasjen er under terreng, eller
 * romtypen vanligvis er det. Hellere ett forslag for mye enn ett for lite (styrer hulltaking).
 */
export function suggestBelowGround({
  roomType,
  floorBelowGround,
}: {
  roomType: string;
  floorBelowGround: boolean;
}): boolean {
  return floorBelowGround || (findRoomType(roomType)?.defaultBelowGround ?? false);
}

/** Forslaget når et etasjenavn velges fra listen: etasjenummer og «under terreng». */
export type FloorSuggestion = { level: number; belowGround: boolean };

/**
 * Dataregel (Ståle 12.11.2026, F7; A236): forslag til etasjenummer og «under terreng» fra
 * etasjenavnet. Ren funksjon, bygges i denne fila som `suggestFloor` og brukes av skjermen
 * (klientkode importerer fra denne fila, ikke fra `service.ts`).
 *
 * - Navnet sammenlignes uten forskjell på store og små bokstaver og uten mellomrom foran og bak.
 * - «Kjeller» og «Underetasje» gir `{ level: -1, belowGround: true }`, også når -1 er i bruk.
 * - «Loft» gir `max(høyeste i existingLevels, 0) + 1`, aldri over 20, og `belowGround: false`.
 * - Alt annet gir `null`: da gjelder neste ledige nummer, og «under terreng» endres ikke.
 * - `existingLevels` er numrene på etasjene i bygningen som ikke er slettet.
 *
 * Bare et forslag: takstmannen kan endre begge feltene før lagring.
 */
export type SuggestFloor = (
  name: string,
  existingLevels: readonly number[],
) => FloorSuggestion | null;

/** Arealfeltene i én etasje. Tomme felt (`null` eller mangler) teller som 0. */
export type AreaValues = {
  braI?: number | null;
  braE?: number | null;
  braB?: number | null;
  alh?: number | null;
};

/** Summen per arealtype og BRA totalt, med én desimal. ALH er ikke med i BRA (A96). */
export type AreaSum = { braI: number; braE: number; braB: number; bra: number };

/** Tideler som heltall, så 0,1 + 0,2 blir 0,3 uten flyttallsfeil. */
function tenths(value: number | null | undefined): number {
  return value == null ? 0 : Math.round(value * 10);
}

function fromTenths(braI: number, braE: number, braB: number): AreaSum {
  return { braI: braI / 10, braE: braE / 10, braB: braB / 10, bra: (braI + braE + braB) / 10 };
}

function addSums(sums: readonly AreaSum[]): AreaSum {
  let braI = 0;
  let braE = 0;
  let braB = 0;
  for (const sum of sums) {
    braI += tenths(sum.braI);
    braE += tenths(sum.braE);
    braB += tenths(sum.braB);
  }
  return fromTenths(braI, braE, braB);
}

/** Dataregel (A96): BRA i én etasje = BRA-i + BRA-e + BRA-b. Uten areal (`null`) gir 0. */
export function sumFloorArea(area: AreaValues | null | undefined): AreaSum {
  return fromTenths(tenths(area?.braI), tenths(area?.braE), tenths(area?.braB));
}

/** Summen for en bygning: alle etasjene, hver med sitt areal eller `null`. */
export function sumBuildingArea(
  floors: readonly { area: AreaValues | null | undefined }[],
): AreaSum {
  return addSums(floors.map((floor) => sumFloorArea(floor.area)));
}

/** Summen for oppdraget: alle bygningene med sine etasjer. */
export function sumAssignmentArea(
  buildings: readonly { floors: readonly { area: AreaValues | null | undefined }[] }[],
): AreaSum {
  return addSums(buildings.map((building) => sumBuildingArea(building.floors)));
}
