import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES } from "@/core/assignments/codes";
import { suggestAreaType, suggestBelowGround } from "@/core/buildings/codes";
import { CLAIM_OUTCOMES } from "@/core/claims/codes";
import { employeeRoles } from "@/db/schema/organizations";
import { TEST_NOW } from "../../../tests/factories";
import {
  TESTDATA_BROKER_FIRMS,
  TESTDATA_CERTIFICATION_ISSUER,
  TESTDATA_EMAIL_DOMAIN,
  TESTDATA_GNR_MAX,
  TESTDATA_GNR_MIN,
  TESTDATA_HOUSING_ASSOCIATIONS,
  TESTDATA_LAST_NAMES,
  TESTDATA_SEED,
  TESTDATA_SHARED_STORAGE_NAME,
} from "./testdata.data";
import { buildTestdataPlan } from "./testdata-plan";
import type { TestdataAssignment, TestdataPlan } from "./testdata.types";

/*
 * Planen og datafila for testdataene, som regeltester (tabelltester over planen). Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 2.
 *
 * Utvikleren har egne tester for de fleste punktene i `testdata-plan.test.ts`. Denne filen tar
 * punktene i testplanen som ikke står der, og de som trenger en strengere sjekk: varianter av
 * bolig, ordre som ikke er gjort om, `TD-NNNN`, kjente kjedenavn, admin fra seed, hulltaking og TG,
 * kryperom og uinnredet loft, terreng per rom, tidsvinduet, festenummer på fritidsbolig,
 * sertifiseringens utsteder og at bare de oppdiktede ansatte har tid. Alle data er oppdiktet.
 *
 * Støtter hovedmål: færre reklamasjoner (dataene lærer ikke bort feil fag) og de ansatte
 * (testmiljøet ligner en ekte arbeidsdag, uten at noe kan forveksles med ekte personer).
 */

const DAY = 86_400_000;
const plan = buildTestdataPlan({ seed: TESTDATA_SEED, anchor: TEST_NOW });

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

/** Alle strenger utenom de interne nøklene (`key`, `contactKey`, `firmKey` osv.). */
function freeTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value instanceof Date || value === null || typeof value !== "object") return [];
  return Object.entries(value)
    .filter(([name]) => !/key$/i.test(name))
    .flatMap(([, inner]) => freeTexts(inner));
}

/** Alle `Date` i et objekt, rekursivt. */
function dates(value: unknown): Date[] {
  if (value instanceof Date) return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(dates);
}

/** Alle rene datoer (`YYYY-MM-DD`) i planen utenom sertifiseringene. */
function isoDates(value: unknown): string[] {
  return strings(value).filter((text) => /^\d{4}-\d{2}-\d{2}$/.test(text));
}

describe("testdataplanen: like data (2.1)", () => {
  it("2.1.1 samme frø og anker gir helt lik plan", () => {
    expect(buildTestdataPlan({ seed: TESTDATA_SEED, anchor: TEST_NOW })).toEqual(plan);
  });

  it("2.1.2 et anker 14 dager senere flytter bare datoene, med samme differanse", () => {
    const later = buildTestdataPlan({
      seed: TESTDATA_SEED,
      anchor: new Date(TEST_NOW.getTime() + 14 * DAY),
    });
    expect(later.orders.map((o) => o.key)).toEqual(plan.orders.map((o) => o.key));
    expect(later.employees.map((e) => e.name)).toEqual(plan.employees.map((e) => e.name));
    expect(assignmentsOf(later).map((a) => a.property.address)).toEqual(
      assignments.map((a) => a.property.address),
    );
    const before = dates(plan.orders);
    const after = dates(later.orders);
    expect(after).toHaveLength(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.getTime() - before[i]!.getTime()).toBe(14 * DAY);
    }
  });

  it.each([1, 7, 42, 2026, 987654])("2.1.3 frø %i gir en annen plan, men samme mengder", (seed) => {
    const other = buildTestdataPlan({ seed, anchor: TEST_NOW });
    expect(other).not.toEqual(plan);
    const otherAssignments = assignmentsOf(other);
    expect(other.employees.length).toBeGreaterThanOrEqual(10);
    expect(other.employees.length).toBeLessThanOrEqual(15);
    expect(other.firms.length).toBeGreaterThanOrEqual(4);
    expect(other.firms.length).toBeLessThanOrEqual(5);
    const props = new Set(otherAssignments.map((a) => a.property.key));
    expect(props.size).toBeGreaterThanOrEqual(45);
    expect(props.size).toBeLessThanOrEqual(55);
    expect(new Set(otherAssignments.map((a) => a.status))).toEqual(new Set(ASSIGNMENT_STATUSES));
    expect(other.orders.some((o) => o.converted === false)).toBe(true);
    const claims = otherAssignments.filter((a) => a.claim);
    expect(claims.length).toBeGreaterThanOrEqual(4);
    expect(claims.length).toBeLessThanOrEqual(5);
  });
});

describe("testdataplanen: mengde (2.2)", () => {
  it("2.2.4 12 ansatte, alle roller i employeeRoles unntatt admin, ingen admin (A304)", () => {
    expect(plan.employees).toHaveLength(12);
    const used = new Set(plan.employees.flatMap((e) => e.roles as readonly string[]));
    expect([...used].sort()).toEqual(employeeRoles.filter((role) => role !== "admin").sort());
    for (const employee of plan.employees) {
      expect(employee.roles as readonly string[]).not.toContain("admin");
      expect(employee.roles.length).toBeGreaterThan(0);
    }
  });

  it("2.2.5 4–5 meglerfirma, hvert med minst én megler", () => {
    expect(plan.firms.length).toBeGreaterThanOrEqual(4);
    expect(plan.firms.length).toBeLessThanOrEqual(5);
    for (const firm of plan.firms) {
      expect(plan.contacts.filter((c) => c.firmKey === firm.key).length).toBeGreaterThan(0);
    }
  });

  it("2.2.6 45–55 eiendommer med alle slag og varianter", () => {
    const byKey = new Map(assignments.map((a) => [a.property.key, a.property]));
    expect(byKey.size).toBeGreaterThanOrEqual(45);
    expect(byKey.size).toBeLessThanOrEqual(55);
    const props = [...byKey.values()];
    const has = (housing: string, ownership?: string) =>
      props.some(
        (p) =>
          p.housingType === housing && (ownership === undefined || p.ownershipForm === ownership),
      );
    expect(has("detached")).toBe(true);
    expect(has("terraced")).toBe(true);
    expect(has("semi_detached")).toBe(true);
    expect(has("apartment", "section")).toBe(true);
    expect(has("apartment", "cooperative")).toBe(true);
    expect(has("holiday_home")).toBe(true);
  });

  it("2.2.7 alle fire statuser, og minst én ordre som ikke er gjort om", () => {
    expect(new Set(assignments.map((a) => a.status))).toEqual(new Set(ASSIGNMENT_STATUSES));
    expect(plan.orders.filter((o) => o.converted === false).length).toBeGreaterThan(0);
  });

  it("2.2.8 tidsspenn: minst 3 måneder bak og 3 uker fram, aldri over 4 måneder bak eller 5 uker fram", () => {
    const anchor = TEST_NOW.getTime();
    const all = dates(plan.orders).map((d) => d.getTime());
    const isoAll = isoDates(plan.orders).map((d) => new Date(`${d}T12:00:00Z`).getTime());
    const oldest = Math.min(...all, ...isoAll);
    expect(oldest).toBeLessThanOrEqual(anchor - 89 * DAY);
    expect(oldest).toBeGreaterThanOrEqual(anchor - 123 * DAY);
    expect(Math.max(...all, ...isoAll)).toBeLessThanOrEqual(anchor + 35 * DAY);
    const inspections = assignments
      .map((a) => a.inspectionAt?.getTime())
      .filter((t): t is number => t !== undefined);
    expect(Math.max(...inspections)).toBeGreaterThanOrEqual(anchor + 21 * DAY);
  });

  it("2.2.9 4–5 reklamasjoner med alle fem utfall", () => {
    const claims = assignments.flatMap((a) => (a.claim ? [a.claim] : []));
    expect(claims.length).toBeGreaterThanOrEqual(4);
    expect(claims.length).toBeLessThanOrEqual(5);
    expect(new Set(claims.map((c) => c.outcome))).toEqual(new Set(CLAIM_OUTCOMES));
  });

  it("2.2.10 external_ref er unike, har formen TD-NNNN og TD-0001 står først", () => {
    const refs = plan.orders.map((o) => o.externalRef);
    expect(new Set(refs).size).toBe(refs.length);
    for (const ref of refs) expect(ref).toMatch(/^TD-\d{4}$/);
    expect(refs[0]).toBe("TD-0001");
    for (const order of plan.orders) expect(order.key).toBe(order.externalRef);
  });
});

describe("testdataplanen: ingen ekte-lignende data (2.3)", () => {
  it("2.3.11 alle etternavn (ansatte, meglere, parter) står i den faste listen", () => {
    const lastNames = new Set<string>(TESTDATA_LAST_NAMES);
    for (const contact of plan.contacts) expect(lastNames.has(contact.lastName)).toBe(true);
    const people = [
      ...plan.employees.map((e) => e.name),
      ...assignments.flatMap((a) => a.parties.map((p) => p.name)),
    ];
    expect(people.length).toBeGreaterThan(50);
    for (const name of people) expect(lastNames.has(name.split(" ").at(-1)!)).toBe(true);
    for (const firm of TESTDATA_BROKER_FIRMS) {
      for (const [, lastName] of firm.brokers) expect(lastNames.has(lastName)).toBe(true);
    }
  });

  it("2.3.12 alle e-poster i planen ender på @testdata.invalid", () => {
    const json = JSON.stringify(plan);
    const emails = json.match(/[^\s"'<>@]+@[^\s"'<>@]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(20);
    for (const email of emails) expect(email.endsWith(`@${TESTDATA_EMAIL_DOMAIN}`)).toBe(true);
  });

  it("2.3.14 alle gnr i 9001–9099, både på eiendom og ordre", () => {
    const inRange = (gnr: string | null) =>
      gnr !== null && Number(gnr) >= TESTDATA_GNR_MIN && Number(gnr) <= TESTDATA_GNR_MAX;
    for (const a of assignments) expect(inRange(a.property.gnr)).toBe(true);
    for (const order of plan.orders) {
      if (order.fields.gnr !== null) expect(inRange(order.fields.gnr)).toBe(true);
    }
    expect(plan.orders.some((o) => o.fields.gnr !== null)).toBe(true);
  });

  it("2.3.16 organisasjonsnummer er tomme på alle firma og borettslag", () => {
    for (const firm of plan.firms) expect(firm.orgNumber).toBeNull();
    for (const a of assignments) expect(a.property.associationOrgNumber ?? null).toBeNull();
  });

  it("2.3.17 ingen streng i planen har elleve sifre på rad", () => {
    for (const text of strings(plan)) expect(text).not.toMatch(/\d{11}/);
    // Fritekst (ikke de interne nøklene): heller ikke med mellomrom, punktum eller bindestrek
    // mellom sifrene, slik sperren i skjemaene leser det.
    for (const text of freeTexts(plan)) {
      expect(text.replace(/(?<=\d)[\s.-]+(?=\d)/g, "")).not.toMatch(/\d{11}/);
    }
  });

  // Kort liste over kjente kjeder og foretak i bransjen. Treff også som delstreng.
  const KNOWN_CHAINS = [
    "dnb",
    "eie",
    "krogsveen",
    "privatmegleren",
    "em1",
    "eiendomsmegler 1",
    "nordvik",
    "aktiv",
    "proaktiv",
    "garanti",
    "obos",
    "usbl",
    "tobb",
    "heimdal",
    "sole",
    "boa",
    "nylander",
    "partners",
    "notar",
    "exact",
  ];
  const containsChain = (name: string) => {
    const words = name.toLowerCase().split(/[^a-zæøå0-9]+/);
    return KNOWN_CHAINS.some((chain) =>
      chain.includes(" ") ? name.toLowerCase().includes(chain) : words.includes(chain),
    );
  };

  it.each([
    ...plan.firms.map((f) => f.name),
    ...TESTDATA_BROKER_FIRMS.map((f) => f.name),
    ...TESTDATA_HOUSING_ASSOCIATIONS,
  ])("2.3.18 «%s» treffer ikke en kjent kjede", (name) => {
    expect(containsChain(name)).toBe(false);
    expect(name.toLowerCase()).not.toMatch(/krogsveen|privatmegleren|dnb eiendom|obos|nordvik/);
  });

  it("2.3.19 ingen ansatt deler fullt navn eller e-postdomene med admin fra seed", () => {
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    const fromExample = (key: string) =>
      example
        .split("\n")
        .find((line) => line.startsWith(`${key}=`))
        ?.slice(key.length + 1)
        .trim();
    const adminEmails = [process.env.SEED_ADMIN_EMAIL, fromExample("SEED_ADMIN_EMAIL")]
      .filter((v): v is string => !!v)
      .map((v) => v.toLowerCase());
    const adminNames = [process.env.SEED_ADMIN_NAME, fromExample("SEED_ADMIN_NAME")]
      .filter((v): v is string => !!v)
      .map((v) => v.toLowerCase());
    const adminDomains = adminEmails.map((email) => email.split("@")[1]);
    for (const employee of plan.employees) {
      expect(adminNames).not.toContain(employee.name.toLowerCase());
      expect(adminEmails).not.toContain(employee.email.toLowerCase());
      expect(adminDomains).not.toContain(employee.email.toLowerCase().split("@")[1]);
    }
  });

  it("2.3.20 ingen gjetteord eller TG i fritekst, og ingen tekst sier at nektet hulltaking gir TG2", () => {
    for (const text of strings(plan)) {
      expect(text).not.toMatch(/\bantas\b|\btrolig\b|sannsynligvis/i);
      expect(text).not.toMatch(/\bTG\s?-?(IU|[0-3])\b/i);
      expect(text).not.toMatch(/tilstandsgrad/i);
    }
    for (const a of assignments.filter((x) => x.claim)) {
      const text = `${a.claim!.description} ${a.claim!.buildingPartText}`.toLowerCase();
      if (text.includes("hulltaking")) expect(text).not.toMatch(/tg\s?2|tilstandsgrad 2/);
    }
  });
});

describe("testdataplanen: faglige krav (2.4)", () => {
  const floors = assignments.flatMap((a) =>
    a.buildings.flatMap((b) => b.floors.map((floor) => ({ assignment: a, floor }))),
  );
  const rooms = floors.flatMap(({ assignment, floor }) =>
    floor.rooms.map((room) => ({ assignment, floor, room })),
  );

  it.each([...new Set(rooms.map(({ room }) => room.roomType))])(
    "2.4.21 romtypen %s har arealtypen fra suggestAreaType",
    (roomType) => {
      for (const { room } of rooms.filter((r) => r.room.roomType === roomType)) {
        expect(room.areaType).toBe(suggestAreaType(room.roomType));
      }
    },
  );

  it("2.4.21 garasje og utebod er BRA-e; BRA-b bare for innglasset balkong (A305)", () => {
    for (const { room } of rooms) {
      if (room.roomType === "garage" || room.roomType === "external_storage") {
        expect(room.areaType).toBe("bra_e");
      }
      if (room.areaType === "bra_b") expect(room.roomType).toBe("glazed_balcony");
    }
  });

  it("2.4.24 kryperom og uinnredet loft er not_bra", () => {
    const special = rooms.filter(
      ({ room }) => room.roomType === "crawl_space" || room.roomType === "unfinished_attic",
    );
    expect(special.length).toBeGreaterThan(0);
    for (const { room } of special) expect(room.areaType).toBe("not_bra");
  });

  it("2.4.25 «under terreng» på rommet følger suggestBelowGround for etasjen", () => {
    for (const { floor, room } of rooms) {
      expect(room.belowGround).toBe(
        suggestBelowGround({ roomType: room.roomType, floorBelowGround: floor.belowGround }),
      );
    }
  });

  it("2.4.25 etasjen er under terreng når den er kjeller, ellers ikke (kryperom er unntaket)", () => {
    for (const { floor } of floors) {
      const name = floor.name.toLowerCase();
      if (name.includes("kjeller")) expect(floor.belowGround).toBe(true);
      if (floor.belowGround) expect(name).toMatch(/kjeller|kryperom|sokkel/);
    }
  });

  it("2.4.27 metoden drawing bare på fellesbod, ellers laser", () => {
    for (const { floor } of floors) {
      if (!floor.area) continue;
      if (floor.area.method === "drawing") {
        expect(
          floor.name.includes(TESTDATA_SHARED_STORAGE_NAME) ||
            floor.rooms.every((r) => r.name.includes(TESTDATA_SHARED_STORAGE_NAME)),
        ).toBe(true);
      } else {
        expect(floor.area.method).toBe("laser");
      }
    }
  });

  it("2.4.29 fritidsbolig er selveier, og minst én har festenummer", () => {
    const holiday = assignments.filter((a) => a.property.housingType === "holiday_home");
    expect(holiday.length).toBeGreaterThan(0);
    for (const a of holiday) expect(a.property.ownershipForm).toBe("freehold");
    expect(holiday.some((a) => a.property.fnr !== null)).toBe(true);
  });

  it("2.4.30 fellesarealer bare på sameie og borettslag", () => {
    for (const a of assignments) {
      const shared = ["section", "cooperative"].includes(a.property.ownershipForm);
      if (!shared) expect(a.commonAreas).toBeNull();
    }
    expect(assignments.some((a) => a.commonAreas !== null)).toBe(true);
  });

  it("2.4.32 reklamasjoner bare på ferdige eller fakturerte, mottatt etter ferdig-dato", () => {
    for (const a of assignments.filter((x) => x.claim)) {
      expect(["completed", "invoiced"]).toContain(a.status);
      const completedDay = completedAt(a)!.toISOString().slice(0, 10);
      expect(a.claim!.receivedAt > completedDay).toBe(true);
      expect(a.claim!.registeredAt.getTime()).toBeGreaterThan(completedAt(a)!.getTime());
      if (a.claim!.closedAt) {
        expect(a.claim!.closedAt.getTime()).toBeGreaterThanOrEqual(a.claim!.registeredAt.getTime());
        expect(a.claim!.closedAt.getTime()).toBeLessThanOrEqual(TEST_NOW.getTime());
      }
    }
  });

  it("2.4.33 alt innenfor fire måneder, så gyldigheten på ett år aldri brytes", () => {
    for (const a of done) {
      expect(a.inspectionAt!.getTime()).toBeGreaterThan(TEST_NOW.getTime() - 123 * DAY);
      expect(a.inspectionAt!.getTime()).toBeLessThan(TEST_NOW.getTime());
    }
  });

  it("2.4.33 sidemann er aldri ansvarlig, og begge er ansatte i planen med riktig rolle", () => {
    const byKey = new Map(plan.employees.map((e) => [e.key, e]));
    for (const a of assignments) {
      expect(a.secondKey).not.toBe(a.responsibleKey);
      expect(byKey.get(a.responsibleKey)?.roles as readonly string[]).toContain("inspector");
      expect(byKey.get(a.secondKey)?.roles as readonly string[]).toContain("inspector");
    }
  });

  it("2.4.34 tidsregistrering bare på oppdiktede ansatte i teamet", () => {
    const keys = new Set(plan.employees.map((e) => e.key));
    for (const a of done) {
      for (const session of a.workSessions) {
        expect(keys.has(session.employeeKey)).toBe(true);
        expect(session.employeeKey.endsWith(`@${TESTDATA_EMAIL_DOMAIN}`)).toBe(true);
        expect([a.responsibleKey, a.secondKey]).toContain(session.employeeKey);
        expect(session.endedAt.getTime()).toBeGreaterThan(session.startedAt.getTime());
      }
    }
  });

  it("2.4.35 sertifiseringene har oppdiktet utsteder og nummer (A307), og nøyaktig én er utløpt", () => {
    const certified = plan.employees.filter((e) => e.certification !== null);
    expect(certified.length).toBeGreaterThan(0);
    for (const employee of certified) {
      expect(employee.certification!.issuer).toBe(TESTDATA_CERTIFICATION_ISSUER);
      expect(employee.certification!.issuer.toLowerCase()).toContain("oppdiktet");
      expect(employee.certification!.certificateNumber).not.toMatch(/\d{11}/);
    }
    const today = TEST_NOW.toISOString().slice(0, 10);
    const expired = certified.filter((e) => e.certification!.validTo < today);
    expect(expired).toHaveLength(1);
    expect(expired[0]!.roles as readonly string[]).toContain("inspector");
  });
});
