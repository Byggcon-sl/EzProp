import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES, PARTY_ROLES } from "@/core/assignments/codes";
import { partyInputSchema } from "@/core/assignments/schemas";
import {
  AREA_TYPES,
  MEASURING_METHODS,
  ROOM_TYPE_KEYS,
  suggestAreaType,
  suggestBelowGround,
  sumAssignmentArea,
} from "@/core/buildings/codes";
import {
  buildingInputSchema,
  floorAreaInputSchema,
  floorInputSchema,
  roomInputSchema,
} from "@/core/buildings/schemas";
import { CLAIM_OUTCOMES } from "@/core/claims/codes";
import { claimInputSchema } from "@/core/claims/schemas";
import { contactInputSchema, firmInputSchema } from "@/core/contacts/schemas";
import { orderInputSchema } from "@/core/orders/schemas";
import { HOUSING_TYPES, OWNERSHIP_FORMS } from "@/core/properties/codes";
import { commonAreasInputSchema, propertyInputSchema } from "@/core/properties/schemas";
import { employeeRoles } from "@/db/schema/organizations";
import { createSeededRandom } from "./seeded-random";
import {
  TESTDATA_EMAIL_DOMAIN,
  TESTDATA_GNR_MAX,
  TESTDATA_GNR_MIN,
  TESTDATA_LAST_NAMES,
  TESTDATA_PHONE_PATTERN,
  TESTDATA_POSTAL_AREAS,
  TESTDATA_SEED,
  TESTDATA_SHARED_STORAGE_NAME,
} from "./testdata.data";
import { buildTestdataPlan } from "./testdata-plan";
import type { TestdataAssignment, TestdataPlan } from "./testdata.types";

/*
 * Utviklerens egne tester for den rene planen (docs/funksjoner/fase2a-testdata-arbeidshverdag.md).
 * Testplanens seksjon 1 og 2 skrives i tillegg av testskriveren.
 */

const ANCHOR = new Date("2026-11-03T10:00:00Z");
const DAY = 86_400_000;
const plan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: ANCHOR });

function assignmentsOf(p: TestdataPlan): TestdataAssignment[] {
  return p.orders.flatMap((order) => (order.converted ? [order.converted.assignment] : []));
}
const assignments = assignmentsOf(plan);
const done = assignments.filter((a) => a.status === "completed" || a.status === "invoiced");
const completedAt = (a: TestdataAssignment) =>
  a.statusTimes.find((s) => s.toStatus === "completed")?.at;

/** Alle strenger i et objekt, rekursivt. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value instanceof Date || value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(strings);
}

/** Alle `Date` i et objekt, rekursivt. */
function dates(value: unknown): Date[] {
  if (value instanceof Date) return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(dates);
}

describe("createSeededRandom", () => {
  it("gir samme rekkefølge med samme frø og en annen med annet frø", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const c = createSeededRandom(43);
    const first = Array.from({ length: 200 }, () => a.next());
    expect(Array.from({ length: 200 }, () => b.next())).toEqual(first);
    expect(Array.from({ length: 20 }, () => c.next())).not.toEqual(first.slice(0, 20));
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it("int holder seg innenfor begge ender og treffer dem", () => {
    const rng = createSeededRandom(7);
    const values = Array.from({ length: 5000 }, () => rng.int(3, 6));
    expect(Math.min(...values)).toBe(3);
    expect(Math.max(...values)).toBe(6);
  });

  it("pick kaster på tom liste", () => {
    expect(() => createSeededRandom(1).pick([])).toThrow();
  });
});

describe("buildTestdataPlan: like data", () => {
  it("samme frø og anker gir lik plan", () => {
    expect(buildTestdataPlan({ seed: TESTDATA_SEED, anchor: ANCHOR })).toEqual(plan);
  });

  it("et anker 30 dager senere flytter bare datoene", () => {
    const shift = 30 * DAY;
    const later = buildTestdataPlan({
      seed: TESTDATA_SEED,
      anchor: new Date(ANCHOR.getTime() + shift),
    });
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    const walk = (a: unknown, b: unknown): void => {
      if (a instanceof Date) {
        expect((b as Date).getTime() - a.getTime()).toBe(shift);
      } else if (typeof a === "string" && isoDate.test(a)) {
        expect(Date.parse(b as string) - Date.parse(a)).toBe(shift);
      } else if (a !== null && typeof a === "object") {
        expect(Object.keys(b as object)).toEqual(Object.keys(a));
        for (const key of Object.keys(a)) {
          walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]);
        }
      } else {
        expect(b).toEqual(a);
      }
    };
    walk(plan, later);
  });

  it.each([1, 2, 3, 99, 123456])("frø %i gir en annen plan med samme mengder", (seed) => {
    const other = buildTestdataPlan({ seed, anchor: ANCHOR });
    expect(other).not.toEqual(plan);
    expect(other.employees).toHaveLength(plan.employees.length);
    expect(other.firms).toHaveLength(plan.firms.length);
    expect(other.orders).toHaveLength(plan.orders.length);
    const claims = assignmentsOf(other).filter((a) => a.claim);
    expect(claims.map((a) => a.claim?.outcome).sort()).toEqual([...CLAIM_OUTCOMES].sort());
  });
});

describe("buildTestdataPlan: mengde og tid", () => {
  it("har 12 ansatte i alle roller unntatt admin", () => {
    expect(plan.employees).toHaveLength(12);
    const roles = new Set(plan.employees.flatMap((e) => e.roles));
    expect([...roles].sort()).toEqual(employeeRoles.filter((r) => r !== "admin").sort());
    expect(plan.employees.some((e) => (e.roles as string[]).includes("admin"))).toBe(false);
  });

  it("har 4–5 meglerfirma med meglere, uten organisasjonsnummer", () => {
    expect(plan.firms.length).toBeGreaterThanOrEqual(4);
    expect(plan.firms.length).toBeLessThanOrEqual(5);
    for (const firm of plan.firms) {
      expect(firm.orgNumber).toBeNull();
      expect(plan.contacts.some((c) => c.firmKey === firm.key)).toBe(true);
    }
  });

  it("har 45–55 eiendommer av alle slag og alle statuser", () => {
    expect(assignments.length).toBeGreaterThanOrEqual(45);
    expect(assignments.length).toBeLessThanOrEqual(55);
    const types = new Set(assignments.map((a) => a.property.housingType));
    for (const type of ["detached", "terraced", "semi_detached", "apartment", "holiday_home"]) {
      expect(types.has(type as never)).toBe(true);
    }
    const forms = assignments.map((a) => `${a.property.housingType}/${a.property.ownershipForm}`);
    expect(forms).toContain("apartment/section");
    expect(forms).toContain("apartment/cooperative");
    expect(new Set(assignments.map((a) => a.status))).toEqual(new Set(ASSIGNMENT_STATUSES));
    expect(plan.orders.some((o) => o.converted === false)).toBe(true);
  });

  it("dekker minst 3 måneder bak og 3 uker fram, aldri over 4 måneder bak eller 5 uker fram", () => {
    const all = dates(plan.orders).map((d) => (d.getTime() - ANCHOR.getTime()) / DAY);
    expect(Math.min(...all)).toBeLessThanOrEqual(-92);
    expect(Math.min(...all)).toBeGreaterThan(-120);
    expect(Math.max(...all)).toBeLessThanOrEqual(35);
    const inspections = assignments.flatMap((a) => (a.inspectionAt ? [a.inspectionAt] : []));
    const latest = Math.max(...inspections.map((d) => d.getTime()));
    expect(latest - ANCHOR.getTime()).toBeGreaterThanOrEqual(21 * DAY);
  });

  it("har TD-0001 først og eldst, og unike TD-nøkler", () => {
    expect(plan.orders[0]?.externalRef).toBe("TD-0001");
    const refs = plan.orders.map((o) => o.externalRef);
    expect(new Set(refs).size).toBe(refs.length);
    expect(refs.every((r) => /^TD-\d{4}$/.test(r))).toBe(true);
    const oldest = Math.min(...plan.orders.map((o) => o.receivedAt.getTime()));
    expect(plan.orders[0]?.receivedAt.getTime()).toBe(oldest);
    expect(plan.orders.every((o) => o.receivedAt.getTime() <= ANCHOR.getTime())).toBe(true);
  });

  it("har unike nøkler for ansatte, kontakter, firma og eiendommer", () => {
    for (const keys of [
      plan.employees.map((e) => e.key),
      plan.contacts.map((c) => c.key),
      plan.firms.map((f) => f.key),
      assignments.map((a) => a.property.key),
    ]) {
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("buildTestdataPlan: ingen ekte-lignende data", () => {
  const persons = [
    ...plan.employees.map((e) => e.name),
    ...plan.contacts.map((c) => c.name),
    ...assignments.flatMap((a) => a.parties.map((p) => p.name)),
  ];

  it("bruker bare etternavn fra den faste listen", () => {
    for (const name of persons) {
      const last = name.split(" ").at(-1) as string;
      expect(TESTDATA_LAST_NAMES as readonly string[]).toContain(last);
    }
  });

  it("har bare e-post på testdata.invalid og telefon på den oppdiktede serien", () => {
    const json = JSON.stringify(plan);
    const emails = json.match(/[\w.+-]+@[\w.-]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(50);
    expect(emails.every((e) => e.endsWith(`@${TESTDATA_EMAIL_DOMAIN}`))).toBe(true);
    const phones = [
      ...plan.employees.map((e) => e.phone),
      ...plan.contacts.map((c) => c.phone),
      ...assignments.flatMap((a) => a.parties.map((p) => p.phone)),
    ];
    for (const phone of phones) {
      expect(phone).toMatch(TESTDATA_PHONE_PATTERN);
      expect(contactInputSchema.shape.phone.safeParse(phone).success).toBe(true);
    }
  });

  it("har gnr 9001–9099 og gyldige postnummer og kommuner", () => {
    for (const order of plan.orders) {
      if (order.fields.gnr === null) continue;
      expect(Number(order.fields.gnr)).toBeGreaterThanOrEqual(TESTDATA_GNR_MIN);
      expect(Number(order.fields.gnr)).toBeLessThanOrEqual(TESTDATA_GNR_MAX);
    }
    const pairs = TESTDATA_POSTAL_AREAS.map(
      (a) => `${a.postalCode}|${a.postalPlace}|${a.municipalityNumber}|${a.municipalityName}`,
    );
    for (const { property } of assignments) {
      expect(Number(property.gnr)).toBeGreaterThanOrEqual(TESTDATA_GNR_MIN);
      expect(Number(property.gnr)).toBeLessThanOrEqual(TESTDATA_GNR_MAX);
      expect(pairs).toContain(
        `${property.postalCode}|${property.city}|${property.municipalityNumber}|${property.municipalityName}`,
      );
      expect(property.municipalityNumber).toMatch(/^(18|55)\d{2}$/);
    }
  });

  it("har ingen elleve sifre på rad, gjetteord eller TG i tekst", () => {
    for (const text of strings(plan)) {
      expect(text).not.toMatch(/\d{11}/);
      expect(text).not.toMatch(/antas|trolig|sannsynligvis|\bTG(IU|[0-3])\b/i);
    }
  });
});

describe("buildTestdataPlan: faget", () => {
  const floors = assignments.flatMap((a) => a.buildings.flatMap((b) => b.floors));
  const rooms = floors.flatMap((f) => f.rooms.map((r) => ({ floor: f, room: r })));

  it("følger romtypens arealtype og etasjens terreng", () => {
    expect(rooms.length).toBeGreaterThan(100);
    for (const { floor, room } of rooms) {
      expect(room.areaType).toBe(suggestAreaType(room.roomType));
      expect(room.belowGround).toBe(
        suggestBelowGround({ roomType: room.roomType, floorBelowGround: floor.belowGround }),
      );
      expect(floor.belowGround).toBe(floor.name === "Kjeller");
    }
  });

  it("har BRA-e og BRA-b på etasjen bare med rom av samme type, og omvendt", () => {
    for (const floor of floors) {
      const types = new Set(floor.rooms.map((r) => r.areaType));
      expect((floor.area?.braE ?? 0) > 0).toBe(types.has("bra_e"));
      expect((floor.area?.braB ?? 0) > 0).toBe(types.has("bra_b"));
      expect((floor.area?.braI ?? 0) > 0).toBe(types.has("bra_i"));
    }
  });

  it("har ALH bare på loft og hems, og tegning bare på fellesbod", () => {
    for (const floor of floors) {
      if (floor.area?.alh) expect(["Loft", "Hems"]).toContain(floor.name);
      if (floor.area?.method === "drawing") {
        expect(floor.rooms.map((r) => r.name)).toEqual([TESTDATA_SHARED_STORAGE_NAME]);
      }
    }
  });

  it("har bad og kjøkken i hver befarte bolig, og størrelser innenfor rammen", () => {
    for (const a of assignments.filter((x) => x.buildings.length > 0)) {
      const types = a.buildings.flatMap((b) =>
        b.floors.flatMap((f) => f.rooms.map((r) => r.roomType)),
      );
      expect(types).toContain("bathroom");
      expect(types.some((t) => t === "kitchen" || t === "living_kitchen")).toBe(true);
      const bra = sumAssignmentArea(a.buildings).bra;
      const [min, max] =
        a.property.housingType === "apartment"
          ? [35, 120]
          : a.property.housingType === "holiday_home"
            ? [30, 120]
            : [90, 250];
      expect(bra).toBeGreaterThanOrEqual(min);
      expect(bra).toBeLessThanOrEqual(max);
    }
  });

  it("har eierform og matrikkel som henger sammen, og fellesarealer bare ved delt eierskap", () => {
    for (const { property, commonAreas } of assignments) {
      if (property.ownershipForm === "section") {
        expect(property.snr).not.toBeNull();
        expect(property.shareNumber).toBeNull();
      } else if (property.ownershipForm === "cooperative") {
        expect(property.associationName).not.toBeNull();
        expect(property.shareNumber).not.toBeNull();
        expect(property.snr).toBeNull();
      } else {
        expect(property.ownershipForm).toBe("freehold");
        expect(property.housingType).not.toBe("apartment");
      }
      expect(commonAreas !== null).toBe(property.housingType === "apartment");
    }
    expect(assignments.some((a) => a.property.fnr !== null)).toBe(true);
  });

  it("har bad før 2000, bad på 0–5 år og bad rundt 20 år", () => {
    const year = ANCHOR.getUTCFullYear();
    const bathYears = assignments.flatMap((a) =>
      a.buildings.flatMap((b) =>
        b.floors.flatMap((f) =>
          f.rooms
            .filter((r) => r.roomType === "bathroom")
            .map((r) => r.yearRenovated ?? a.property.buildYear),
        ),
      ),
    );
    expect(bathYears.some((y) => y < 2000)).toBe(true);
    expect(bathYears.some((y) => year - y >= 0 && year - y <= 5)).toBe(true);
    expect(bathYears.some((y) => year - y >= 18 && year - y <= 22)).toBe(true);
  });

  it("har tid og team i riktig rekkefølge", () => {
    for (const a of assignments) {
      expect(a.secondKey).not.toBe(a.responsibleKey);
      const times = [a.convertedAt, ...a.statusTimes.map((s) => s.at)].map((d) => d.getTime());
      expect([...times].sort((x, y) => x - y)).toEqual(times);
      expect(a.statusTimes.map((s) => s.toStatus)).toEqual(
        ASSIGNMENT_STATUSES.slice(1, ASSIGNMENT_STATUSES.indexOf(a.status) + 1),
      );
      expect(a.buildings.length > 0).toBe(
        a.inspectionAt !== null && a.inspectionAt.getTime() < ANCHOR.getTime(),
      );
    }
    for (const a of done) {
      const completed = completedAt(a) as Date;
      expect(a.inspectionAt!.getTime()).toBeLessThan(completed.getTime());
      expect(completed.getTime()).toBeLessThan(ANCHOR.getTime());
      const order = plan.orders.find((o) => o.converted && o.converted.assignment === a);
      expect(order?.fields.sellerDeclarationReceived).toBe(true);
    }
  });

  it("har arbeidsøkter bare på ferdige og fakturerte, med tider etter boligtype", () => {
    const keys = new Set(plan.employees.map((e) => e.key));
    const hours = (a: TestdataAssignment, phase: string) =>
      a.workSessions
        .filter((s) => s.phase === phase)
        .reduce((sum, s) => sum + (s.endedAt.getTime() - s.startedAt.getTime()) / 3_600_000, 0);
    for (const a of assignments) {
      expect(a.workSessions.length > 0).toBe(a.status === "completed" || a.status === "invoiced");
      for (const s of a.workSessions) {
        expect(keys.has(s.employeeKey)).toBe(true);
        expect(s.endedAt.getTime()).toBeLessThanOrEqual(completedAt(a)!.getTime());
      }
      if (a.workSessions.length === 0) continue;
      expect(hours(a, "inspection")).toBeGreaterThanOrEqual(1);
      expect(hours(a, "inspection")).toBeLessThanOrEqual(3);
      expect(hours(a, "office")).toBeGreaterThanOrEqual(2);
      expect(hours(a, "office")).toBeLessThanOrEqual(5);
    }
    const mean = (list: TestdataAssignment[]) =>
      list.reduce((sum, a) => sum + hours(a, "inspection") + hours(a, "office"), 0) / list.length;
    const apartments = done.filter((a) => a.property.housingType === "apartment");
    const basements = done.filter(
      (a) =>
        a.property.housingType === "detached" &&
        a.buildings.some((b) => b.floors.some((f) => f.belowGround)),
    );
    expect(apartments.length).toBeGreaterThan(0);
    expect(basements.length).toBeGreaterThan(0);
    expect(mean(apartments)).toBeLessThan(mean(basements));
  });

  it("har gyldig sertifisering for ansvarlig på befaringsdagen, og én utløpt", () => {
    const byKey = new Map(plan.employees.map((e) => [e.key, e]));
    for (const a of done) {
      const cert = byKey.get(a.responsibleKey)?.certification;
      const day = a.inspectionAt!.toISOString().slice(0, 10);
      expect(cert).toBeTruthy();
      expect(cert!.validFrom! <= day && day <= cert!.validTo).toBe(true);
    }
    const today = ANCHOR.toISOString().slice(0, 10);
    const expired = plan.employees.filter(
      (e) => e.certification !== null && e.certification.validTo < today,
    );
    expect(expired).toHaveLength(1);
    expect(done.some((a) => a.responsibleKey === expired[0]?.key)).toBe(false);
  });

  it("har fem reklamasjoner etter ferdig, med beløp bare ved medhold og forlik", () => {
    const claims = done.filter((a) => a.claim);
    expect(assignments.filter((a) => a.claim)).toHaveLength(claims.length);
    expect(claims.map((a) => a.claim!.outcome).sort()).toEqual([...CLAIM_OUTCOMES].sort());
    expect(new Set(claims.map((a) => a.claim!.buildingPartText)).size).toBeGreaterThanOrEqual(3);
    for (const a of claims) {
      const claim = a.claim!;
      expect(claim.receivedAt > completedAt(a)!.toISOString().slice(0, 10)).toBe(true);
      expect(claim.amount !== null).toBe(["upheld", "settled"].includes(claim.outcome));
      if (claim.amount !== null) expect(claim.amount).toBeGreaterThan(0);
      expect(claim.closedAt === null).toBe(claim.outcome === "open");
      expect(a.parties.some((p) => p.role === claim.claimantPartyRole)).toBe(true);
    }
  });
});

describe("buildTestdataPlan: skjemaene og kodelistene godtar planen", () => {
  const today = ANCHOR.toISOString().slice(0, 10);
  const fakeId = "00000000-0000-4000-8000-000000000000";

  it("godtar ordre, eiendom, fellesarealer og parter", () => {
    for (const order of plan.orders) {
      const parsed = orderInputSchema(ANCHOR).safeParse({
        ...order.fields,
        externalRef: order.externalRef,
        receivedAt: order.receivedAt,
      });
      expect(parsed.error).toBeUndefined();
    }
    for (const a of assignments) {
      expect(propertyInputSchema.safeParse(a.property).error).toBeUndefined();
      if (a.commonAreas) {
        expect(commonAreasInputSchema.safeParse(a.commonAreas).error).toBeUndefined();
      }
      for (const party of a.parties) {
        expect(PARTY_ROLES).toContain(party.role);
        expect(partyInputSchema.safeParse(party).error).toBeUndefined();
      }
      expect(ASSIGNMENT_STATUSES).toContain(a.status);
      expect(HOUSING_TYPES).toContain(a.property.housingType);
      expect(OWNERSHIP_FORMS).toContain(a.property.ownershipForm);
    }
  });

  it("godtar bygninger, etasjer, areal og rom", () => {
    for (const building of assignments.flatMap((a) => a.buildings)) {
      expect(buildingInputSchema.safeParse(building).error).toBeUndefined();
      for (const floor of building.floors) {
        expect(floorInputSchema.safeParse(floor).error).toBeUndefined();
        if (floor.area) {
          expect(MEASURING_METHODS).toContain(floor.area.method);
          expect(
            floorAreaInputSchema.safeParse({ ...floor.area, measuredBy: fakeId }).error,
          ).toBeUndefined();
        }
        for (const room of floor.rooms) {
          expect(ROOM_TYPE_KEYS).toContain(room.roomType);
          expect(AREA_TYPES).toContain(room.areaType);
          expect(roomInputSchema.safeParse(room).error).toBeUndefined();
        }
      }
    }
  });

  it("godtar kontakter, firma og reklamasjoner", () => {
    for (const contact of plan.contacts) {
      expect(contactInputSchema.safeParse({ ...contact, firmId: fakeId }).error).toBeUndefined();
    }
    for (const firm of plan.firms) {
      expect(firmInputSchema.safeParse(firm).error).toBeUndefined();
    }
    for (const a of assignments.filter((x) => x.claim)) {
      const parsed = claimInputSchema(today).safeParse({ ...a.claim, claimantPartyId: fakeId });
      expect(parsed.error).toBeUndefined();
    }
  });
});
