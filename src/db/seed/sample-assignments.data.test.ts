import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES, PARTY_ROLES, partyInputSchema } from "@/core/assignments";
import {
  AREA_TYPES,
  MEASURING_METHODS,
  ROOM_TYPES,
  ROOM_TYPE_KEYS,
  buildingInputSchema,
  floorAreaInputSchema,
  floorInputSchema,
  roomInputSchema,
} from "@/core/buildings";
import {
  HOUSING_TYPES,
  OWNERSHIP_FORMS,
  commonAreasInputSchema,
  propertyInputSchema,
} from "@/core/properties";
import { brand } from "@/shared/config/brand";
import * as dataModule from "./sample-assignments.data";
import {
  SAMPLE_ASSIGNMENTS,
  SAMPLE_INSPECTOR,
  SAMPLE_ORGANIZATION_NAME,
} from "./sample-assignments.data";

/*
 * Datafilen for de fire testoppdragene (fase 2a). Ren test, ingen database.
 * Testplan: docs/funksjoner/fase2a-testoppdrag-testplan.md avsnitt 1.
 *
 * Formen testen forventer (avtalen i testplanen; avvik rettes i `shapeOf` under og føres i kortet):
 *   SAMPLE_ASSIGNMENTS[i] = {
 *     externalRef, status,
 *     property: PropertyInput (address, postalCode, city, municipalityNumber, housingType,
 *               ownershipForm, gnr, bnr, snr, associationName, …),
 *     commonAreas?: CommonAreasInput | null,
 *     buildings: [{ name, builtYear, floors: [{ name, level, belowGround,
 *                   area: FloorAreaInput uten measuredBy (settes til takstmannen av steget),
 *                   rooms: [RoomInput & { builtYear?, renovatedYear? }] }] }],
 *     parties: PartyInput[],
 *   }
 * Byggeår finnes ikke i databasen ennå. Det ligger i datafilen, så reglene får noe å virke på
 * senere. Testen godtar alle tallfelt med «year» i navnet (byggeår eller ombygging).
 *
 * Støtter hovedmål: tid (faste oppdrag, ingen inntasting før en prøve), reklamasjoner (regler og
 * mal prøves mot fire boligtyper) og KI først (KI-forslagene måles mot de samme oppdragene).
 */

type Loose = Record<string, unknown>;
type SampleRoom = Loose & { roomType?: string; areaType?: string; belowGround?: unknown };
type SampleFloor = Loose & {
  name: string;
  level: number;
  belowGround?: unknown;
  area?:
    | (Loose & {
        braI?: number | null;
        braE?: number | null;
        braB?: number | null;
        alh?: number | null;
        method?: string | null;
      })
    | null;
  rooms?: SampleRoom[];
};
type SampleBuilding = Loose & { name: string; floors: SampleFloor[] };
type Sample = {
  externalRef: string;
  status: string;
  property: Loose & {
    address: string;
    municipalityNumber?: string | null;
    housingType: string;
    ownershipForm: string;
    snr?: string | null;
    associationName?: string | null;
  };
  commonAreas?: Loose | null;
  buildings: SampleBuilding[];
  parties: (Loose & { role: string; name: string })[];
};

/** Ett sted å rette hvis datafilen får en annen form. */
function shapeOf(sample: unknown): Sample {
  return sample as Sample;
}

const samples = (SAMPLE_ASSIGNMENTS as readonly unknown[]).map(shapeOf);
const byRef = (ref: string): Sample => {
  const found = samples.find((sample) => sample.externalRef === ref);
  if (!found) throw new Error(`Fant ikke testoppdraget ${ref} i datafilen`);
  return found;
};

const EXPECTED = [
  {
    ref: "sample:detached-garage",
    housingType: "detached",
    ownershipForm: "freehold",
    status: "ordered",
  },
  {
    ref: "sample:apartment-section",
    housingType: "apartment",
    ownershipForm: "section",
    status: "in_progress",
  },
  {
    ref: "sample:apartment-cooperative",
    housingType: "apartment",
    ownershipForm: "cooperative",
    status: "in_progress",
  },
  {
    ref: "sample:holiday-home",
    housingType: "holiday_home",
    ownershipForm: "freehold",
    status: "in_progress",
  },
] as const;

const floorsOf = (sample: Sample) => sample.buildings.flatMap((building) => building.floors);
const roomsOf = (sample: Sample) => floorsOf(sample).flatMap((floor) => floor.rooms ?? []);

/** Feltene i arealet uten «målt av» (den er en ansatt-id og settes av steget). */
function areaWithoutMeasuredBy(area: SampleFloor["area"]) {
  const { measuredBy: _ignored, ...rest } = (area ?? {}) as Loose;
  return rest;
}

/** Alle tallfelt med «year» i navnet, i objektet og alt under det. */
function yearValues(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(yearValues);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Loose).flatMap(([key, entry]) => [
    ...(/year/i.test(key) && typeof entry === "number" ? [entry] : []),
    ...yearValues(entry),
  ]);
}

/** Tallfelt med «year» i navnet rett på objektet (ikke under det). */
function ownYears(value: Loose): number[] {
  return Object.entries(value)
    .filter(([key, entry]) => /year/i.test(key) && typeof entry === "number")
    .map(([, entry]) => entry as number);
}

/** Alle strenger i datafilen. */
function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value === null || typeof value !== "object") return [];
  return Object.values(value as Loose).flatMap(allStrings);
}

/** Alle nøkler med verdien under, i datafilen. */
function allEntries(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.flatMap(allEntries);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Loose).flatMap(([key, entry]) => [
    [key, entry] as [string, unknown],
    ...allEntries(entry),
  ]);
}

/** Hele datafilen (alle eksporter) som ett objekt. */
const wholeFile: Loose = { ...dataModule };

describe("datafilen for testoppdragene: innhold", () => {
  it("1.1 har nøyaktig fire testoppdrag med faste, unike referanser som starter med sample:", () => {
    expect(samples).toHaveLength(4);
    const refs = samples.map((sample) => sample.externalRef);
    expect(new Set(refs).size).toBe(4);
    expect([...refs].sort()).toEqual(EXPECTED.map((entry) => entry.ref).sort());
    for (const ref of refs) expect(ref.startsWith("sample:")).toBe(true);
  });

  it.each(EXPECTED)("1.2 $ref har boligtype $housingType og eierform $ownershipForm", (entry) => {
    const sample = byRef(entry.ref);
    expect(sample.property.housingType).toBe(entry.housingType);
    expect(sample.property.ownershipForm).toBe(entry.ownershipForm);
    expect(HOUSING_TYPES as readonly string[]).toContain(sample.property.housingType);
    expect(OWNERSHIP_FORMS as readonly string[]).toContain(sample.property.ownershipForm);
  });

  it.each(EXPECTED)("1.3 $ref har status $status (A133)", (entry) => {
    const sample = byRef(entry.ref);
    expect(sample.status).toBe(entry.status);
    expect(ASSIGNMENT_STATUSES as readonly string[]).toContain(sample.status);
  });

  it.each(EXPECTED)("1.4 $ref har kommunenummer 9999 og går gjennom eiendomsskjemaet", (entry) => {
    const sample = byRef(entry.ref);
    expect(sample.property.municipalityNumber).toBe("9999");
    const parsed = propertyInputSchema.safeParse(sample.property);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    if (sample.commonAreas) {
      const common = commonAreasInputSchema.safeParse(sample.commonAreas);
      expect(common.error?.issues ?? []).toEqual([]);
    }
  });

  it.each(EXPECTED)(
    "1.5 $ref: bygninger, etasjer, areal og rom går gjennom skjemaene fra appen",
    (entry) => {
      const sample = byRef(entry.ref);
      expect(sample.buildings.length).toBeGreaterThan(0);
      for (const building of sample.buildings) {
        expect(buildingInputSchema.safeParse(building).error?.issues ?? []).toEqual([]);
        expect(building.floors.length, `${building.name} har etasjer`).toBeGreaterThan(0);
        for (const floor of building.floors) {
          expect(floorInputSchema.safeParse(floor).error?.issues ?? [], floor.name).toEqual([]);
          expect(floor.area, `${building.name} / ${floor.name} har areal`).toBeTruthy();
          const area = floorAreaInputSchema.safeParse(areaWithoutMeasuredBy(floor.area));
          expect(area.error?.issues ?? [], `${floor.name}: areal`).toEqual([]);
          for (const room of floor.rooms ?? []) {
            const parsed = roomInputSchema.safeParse(room);
            expect(parsed.error?.issues ?? [], `${floor.name}: ${room.roomType}`).toEqual([]);
          }
        }
      }
      expect(roomsOf(sample).length, "minst ett rom").toBeGreaterThan(0);
    },
  );

  it.each(EXPECTED)("1.6 $ref bruker bare koder fra kodelistene", (entry) => {
    const sample = byRef(entry.ref);
    for (const room of roomsOf(sample)) {
      expect(ROOM_TYPE_KEYS as readonly string[]).toContain(room.roomType);
      if (room.areaType != null) expect(AREA_TYPES as readonly string[]).toContain(room.areaType);
    }
    for (const floor of floorsOf(sample)) {
      const method = floor.area?.method;
      if (method != null) expect(MEASURING_METHODS as readonly string[]).toContain(method);
    }
    expect(sample.parties.length, "minst én part").toBeGreaterThan(0);
    for (const party of sample.parties) {
      expect(PARTY_ROLES as readonly string[]).toContain(party.role);
      expect(partyInputSchema.safeParse(party).error?.issues ?? [], party.role).toEqual([]);
    }
  });

  it("1.7 enebolig: bolig og garasje, to etasjer og kjeller under terreng, BRA-b i garasjen, gammelt våtrom", () => {
    const sample = byRef("sample:detached-garage");
    expect(sample.buildings).toHaveLength(2);
    const house = sample.buildings.find((building) => /bolig/i.test(building.name));
    const garage = sample.buildings.find((building) => /garasje/i.test(building.name));
    expect(house, "boligen").toBeDefined();
    expect(garage, "garasjen").toBeDefined();

    const aboveGround = house!.floors.filter((floor) => floor.belowGround !== true);
    const basement = house!.floors.filter((floor) => floor.belowGround === true);
    expect(aboveGround, "to etasjer over terreng").toHaveLength(2);
    expect(basement, "en kjeller").toHaveLength(1);
    expect(basement[0]!.level).toBeLessThan(0);
    expect(basement[0]!.rooms?.length ?? 0, "rom i kjelleren").toBeGreaterThan(0);
    for (const room of basement[0]!.rooms ?? []) {
      expect(room.belowGround, `${room.roomType} i kjelleren`).toBe(true);
    }

    expect(
      garage!.floors.some((floor) => (floor.area?.braB ?? 0) > 0),
      "BRA-b i garasjen",
    ).toBe(true);

    const wetRoomTypes = new Set<string>(
      ROOM_TYPES.filter((type) => type.group === "wet_room").map((type) => type.key),
    );
    const oldWetRoom = sample.buildings.some((building) =>
      building.floors.some((floor) =>
        (floor.rooms ?? []).some((room) => {
          if (!wetRoomTypes.has(room.roomType ?? "")) return false;
          const years = [...ownYears(room), ...ownYears(building)];
          return years.some((year) => year < 2000);
        }),
      ),
    );
    expect(oldWetRoom, "minst ett våtrom med byggeår eller ombygging før 2000").toBe(true);
  });

  it("1.8 sameie: seksjonsnummer og fellesdeler", () => {
    const sample = byRef("sample:apartment-section");
    expect(sample.property.snr).toMatch(/^\d+$/);
    expect(sample.commonAreas).toBeTruthy();
  });

  it("1.9 borettslag: borettslagets navn og fellesdeler", () => {
    const sample = byRef("sample:apartment-cooperative");
    expect(typeof sample.property.associationName).toBe("string");
    expect((sample.property.associationName as string).trim().length).toBeGreaterThan(0);
    expect(sample.commonAreas).toBeTruthy();
  });

  it("1.10 fritidsbolig: hytte og bod, hems med ALH", () => {
    const sample = byRef("sample:holiday-home");
    expect(sample.buildings).toHaveLength(2);
    const cabin = sample.buildings.find((building) => /hytte/i.test(building.name));
    const shed = sample.buildings.find((building) => /bod/i.test(building.name));
    expect(cabin, "hytta").toBeDefined();
    expect(shed, "boden").toBeDefined();
    const loft = cabin!.floors.find((floor) => /hems/i.test(floor.name));
    expect(loft, "hemsen").toBeDefined();
    expect(loft!.area?.alh ?? 0, "ALH på hemsen").toBeGreaterThan(0);
  });

  it.each(EXPECTED)("1.11 $ref har realistiske byggeår og arealer", (entry) => {
    const sample = byRef(entry.ref);
    for (const building of sample.buildings) {
      expect(ownYears(building).length, `${building.name} har byggeår`).toBeGreaterThan(0);
    }
    for (const year of yearValues(sample)) {
      expect(year).toBeGreaterThanOrEqual(1900);
      expect(year).toBeLessThanOrEqual(2025);
    }
    for (const floor of floorsOf(sample)) {
      const area = floor.area ?? {};
      for (const key of ["braI", "braE", "braB", "alh"] as const) {
        const value = area[key];
        if (value == null) continue;
        expect(value, `${floor.name}: ${key}`).toBeGreaterThan(0);
        expect(value, `${floor.name}: ${key}`).toBeLessThan(500);
      }
      if (area.alh != null) {
        expect(area.braI, `${floor.name}: BRA-i finnes når ALH finnes`).not.toBeNull();
        expect(area.alh, `${floor.name}: ALH ≤ BRA-i`).toBeLessThanOrEqual(area.braI ?? 0);
      }
    }
  });
});

describe("datafilen for testoppdragene: ingen kundeopplysninger og ingen fagtekster", () => {
  const json = JSON.stringify(wholeFile);
  const strings = allStrings(wholeFile);

  it("1.12 all e-post går til @example.invalid", () => {
    const emails = json.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g) ?? [];
    expect(emails.length, "takstmannen har e-post").toBeGreaterThan(0);
    for (const email of emails) expect(email.endsWith("@example.invalid"), email).toBe(true);
    expect(SAMPLE_INSPECTOR.email.endsWith("@example.invalid")).toBe(true);
  });

  it("1.12 ingen fødselsnummer, telefonnummer eller org.nr.", () => {
    for (const value of strings) {
      expect(value, "11 sifre (fødselsnummer)").not.toMatch(/\d{11}/);
      expect(value, "9 sifre (org.nr.)").not.toMatch(/\d{9}/);
      expect(value, "8 sifre (telefon)").not.toMatch(/\d{8}/);
      expect(value, "+47 (telefon)").not.toContain("+47");
      // Også med mellomrom, slik telefonnummer ofte skrives
      expect(value, "telefonnummer med mellomrom").not.toMatch(/\b\d{2,3}(?: \d{2,3}){2,3}\b/);
    }
    expect(json).not.toMatch(/\d{8}/);
  });

  it("1.12 ingen felt for telefon, org.nr. eller fødselsnummer har verdi", () => {
    const forbidden =
      /phone|tlf|telefon|orgnumber|organizationnumber|orgnr|nationalid|ssn|birth|fodsel|fødsel|personnummer/i;
    for (const [key, value] of allEntries(wholeFile)) {
      if (!forbidden.test(key)) continue;
      expect(value === null || value === undefined || value === "", `${key} har verdi`).toBe(true);
    }
  });

  it("1.13 ingen gjetteord og ingen TG", () => {
    for (const value of strings) {
      expect(value, value).not.toMatch(/antas|trolig/i);
      expect(value, value).not.toMatch(/\bTG\s?\d?\b/);
    }
  });

  it("1.13 ingen nøkler for avvik, kontrollpunkt eller regel", () => {
    const forbidden =
      /deviation|avvik|checkpoint|controlpoint|kontrollpunkt|rule|regel|conditiongrade|tilstandsgrad/i;
    for (const [key] of allEntries(wholeFile)) expect(key, key).not.toMatch(forbidden);
  });

  it("1.14 prøveorganisasjonens navn er bygget fra brand.companyName", () => {
    expect(SAMPLE_ORGANIZATION_NAME).toBe(`${brand.companyName} prøve`);
  });

  it("takstmannen har et navn og e-post på @example.invalid", () => {
    expect(SAMPLE_INSPECTOR.name.trim().length).toBeGreaterThan(0);
    expect(SAMPLE_INSPECTOR.email).toMatch(/^[^@\s]+@example\.invalid$/);
  });
});
