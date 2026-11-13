import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSIGNMENT_STATUSES, PARTY_ROLES, partyInputSchema } from "@/core/assignments";
import {
  AREA_TYPES,
  MEASURING_METHODS,
  ROOM_TYPE_KEYS,
  buildingInputSchema,
  floorAreaInputSchema,
  floorInputSchema,
  roomInputSchema,
  suggestAreaType,
} from "@/core/buildings";
import { CLAIM_OUTCOMES, CLAIM_OUTCOMES_WITH_AMOUNT } from "@/core/claims";
import { contactInputSchema, firmInputSchema } from "@/core/contacts";
import {
  HOUSING_TYPES,
  OWNERSHIP_FORMS,
  commonAreasInputSchema,
  propertyInputSchema,
} from "@/core/properties";
import { employeeRoles } from "@/db/schema";
import * as testdata from "./testdata.data";
import {
  TESTDATA_EMAIL_DOMAIN,
  TESTDATA_EMPLOYEES,
  TESTDATA_FIRMS,
  TESTDATA_GNR_RANGE,
  TESTDATA_MUNICIPALITIES,
  TESTDATA_ORDERS,
  TESTDATA_PHONE_PATTERN,
  TESTDATA_PROPERTIES,
  TESTDATA_SURNAMES,
  testdataPropertyInput,
  type TestdataOrder,
  type TestdataProperty,
} from "./testdata.data";

/*
 * Datafilen for `pnpm db:seed:testdata`. Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 3. Ren test, ingen database.
 * «Regeltestene» her er tabelltester over datafilen, ikke regelmotoren (ingen TG settes).
 *
 * Støtter hovedmål: de ansatte (dataene ligner en arbeidsdag og kan ikke forveksles med ekte
 * personer), KI i bunnen (ekte-lignende, men oppdiktede verdier som vasken kan prøves på) og færre
 * reklamasjoner (dataene lærer ikke bort feil fag: arealtype, eierform og reklamasjoner).
 */

// ---------------------------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------------------------

/** Alle strenger i en verdi (rekursivt), med stien dit, så feilmeldingen viser hvor. */
function stringsIn(value: unknown, path = "data"): { path: string; value: string }[] {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value))
    return value.flatMap((item, index) => stringsIn(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => stringsIn(item, `${path}.${key}`));
  }
  return [];
}

/** Alle verdier (ikke funksjoner og ikke RegExp) som datafilen eksporterer. */
const EXPORTED_DATA = Object.fromEntries(
  Object.entries(testdata).filter(
    ([, value]) => typeof value !== "function" && !(value instanceof RegExp),
  ),
);
const ALL_STRINGS = stringsIn(EXPORTED_DATA);

/** Alle verdier for en nøkkel (rekursivt) i dataene. */
function valuesForKey(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => valuesForKey(item, key));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, item]) =>
      k === key ? [item, ...valuesForKey(item, key)] : valuesForKey(item, key),
    );
  }
  return [];
}

type Loose = Record<string, unknown>;
type Floor = TestdataProperty["buildings"][number]["floors"][number];
type Room = Floor["rooms"][number];

function floorsOf(property: TestdataProperty): Floor[] {
  return property.buildings.flatMap((building) => [...building.floors]);
}
function roomsOf(property: TestdataProperty): Room[] {
  return floorsOf(property).flatMap((floor) => [...floor.rooms]);
}
function num(value: unknown): number {
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
}
function areaOf(floor: Floor): { braI: number; braE: number; braB: number; alh: number } {
  const area = floor.area as Loose;
  return { braI: num(area.braI), braE: num(area.braE), braB: num(area.braB), alh: num(area.alh) };
}
function totalBra(property: TestdataProperty): number {
  return floorsOf(property).reduce((sum, floor) => {
    const area = areaOf(floor);
    return sum + area.braI + area.braE + area.braB;
  }, 0);
}

const PROPERTY_CASES = TESTDATA_PROPERTIES.map((property) => [property.key, property] as const);
const PROPERTY_BY_KEY = new Map(TESTDATA_PROPERTIES.map((property) => [property.key, property]));
const ASSIGNMENT_ORDERS = TESTDATA_ORDERS.filter((order) => order.target !== "order_only");
const ORDER_ONLY = TESTDATA_ORDERS.filter((order) => order.target === "order_only");
const DONE = ASSIGNMENT_ORDERS.filter(
  (order) => order.target === "completed" || order.target === "invoiced",
);
const ORDER_CASES = ASSIGNMENT_ORDERS.map((order) => [order.externalRef, order] as const);
const EMPLOYEE_BY_KEY = new Map(TESTDATA_EMPLOYEES.map((employee) => [employee.key, employee]));

/** Fire måneder bakover fra ankeret, i dager (gyldighet ett år brytes aldri). */
const FOUR_MONTHS_DAYS = 123;

/** Kjente kjeder og lag som navnene ikke skal ligne (testplan 3.1.7). */
const KNOWN_CHAINS = [
  "DNB",
  "Eiendomsmegler 1",
  "EiendomsMegler 1",
  "Privatmegleren",
  "Krogsveen",
  "Nordvik",
  "Obos",
  "Usbl",
  "Boligbyggelaget",
  "Heimdal",
  "Aktiv",
  "Proaktiv",
  "Sem & Johnsen",
  "Garanti",
  "Exact",
  "Schala",
  "Nordlandsbanken",
  "Sparebank",
];

/** Gjetteord og TG-ord som aldri skal stå i testdataene (regel 7, «Ingen nye regler»). */
const FORBIDDEN_WORDS = [
  /\bantas\b/i,
  /\btrolig\b/i,
  /\bsannsynligvis\b/i,
  /\bTG\s?[0-3]\b/i,
  /tilstandsgrad/i,
];

/** Særlige kategorier og fødselsnummer (testplan 3.1.10). */
const SPECIAL_CATEGORY_WORDS = [
  "sykdom",
  "diagnose",
  "gravid",
  "religion",
  "straffe",
  "fødselsnummer",
];

function readEnvExample(key: string): string {
  const line = readFileSync(join(process.cwd(), ".env.example"), "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} mangler i .env.example`);
  return line
    .slice(key.length + 1)
    .replace(/^"|"$/g, "")
    .trim();
}

// ---------------------------------------------------------------------------------------------
// 3.1 Ingen ekte-lignende data (A301)
// ---------------------------------------------------------------------------------------------

describe("3.1 ingen ekte-lignende data", () => {
  it("datafilen har strenger å sjekke (vakt mot en tom eksport)", () => {
    expect(ALL_STRINGS.length).toBeGreaterThan(500);
    expect(TESTDATA_EMAIL_DOMAIN).toBe("testdata.invalid");
  });

  it("3.1.1 hver e-post i datafilen ender på @testdata.invalid", () => {
    const json = JSON.stringify(EXPORTED_DATA);
    const emails = json.match(/[^\s"@<>()]+@[^\s"<>()]+/g) ?? [];
    expect(emails.length).toBeGreaterThan(20);
    for (const email of emails) expect(email).toMatch(/@testdata\.invalid$/);
    // Ingen @ andre steder enn i e-poster
    for (const { path, value } of ALL_STRINGS) {
      if (value.includes("@")) expect(value, path).toMatch(/^[a-z0-9.\-_]+@testdata\.invalid$/);
    }
  });

  it("3.1.2 hvert telefonnummer følger TESTDATA_PHONE_PATTERN og går gjennom telefonvalideringen", () => {
    const phones = valuesForKey(EXPORTED_DATA, "phone").filter((value) => value !== undefined);
    expect(phones.length).toBeGreaterThan(20);
    for (const phone of phones) {
      expect(typeof phone).toBe("string");
      expect(phone as string).toMatch(TESTDATA_PHONE_PATTERN);
      const parsed = contactInputSchema.safeParse({ firstName: "Test", phone });
      expect(parsed.success, String(phone)).toBe(true);
    }
    expect(TESTDATA_PHONE_PATTERN.test("+47 000 12 345")).toBe(true);
    expect(TESTDATA_PHONE_PATTERN.test("+47 900 12 345")).toBe(false);
  });

  it("3.1.2 ingen streng ligner et vanlig norsk mobil- eller fasttelefonnummer", () => {
    for (const { path, value } of ALL_STRINGS) {
      // Åtte sifre som starter på 2–9, med eller uten mellomrom og +47
      expect(value, path).not.toMatch(/(^|[^\d])(\+47\s?)?[2-9]\d{2}\s?\d{2}\s?\d{3}([^\d]|$)/);
    }
  });

  it("3.1.3 alle gnr i eiendommer og ordre er 9001–9099", () => {
    const [min, max] = TESTDATA_GNR_RANGE;
    expect([min, max]).toEqual([9001, 9099]);
    const gnrs = [
      ...TESTDATA_PROPERTIES.map((property) => property.gnr),
      ...TESTDATA_ORDERS.flatMap((order) => (order.gnr === undefined ? [] : [order.gnr])),
    ];
    expect(gnrs.length).toBeGreaterThanOrEqual(TESTDATA_PROPERTIES.length);
    for (const gnr of gnrs) {
      expect(gnr).toMatch(/^\d+$/);
      expect(Number(gnr)).toBeGreaterThanOrEqual(min);
      expect(Number(gnr)).toBeLessThanOrEqual(max);
    }
    // Alle gnr-felt hvor som helst i dataene
    for (const gnr of valuesForKey(EXPORTED_DATA, "gnr")) {
      expect(Number(gnr)).toBeGreaterThanOrEqual(min);
      expect(Number(gnr)).toBeLessThanOrEqual(max);
    }
  });

  it("3.1.4 ingen streng har elleve sifre på rad (også uten mellomrom) eller ni sifre på rad", () => {
    for (const { path, value } of ALL_STRINGS) {
      expect(value, path).not.toMatch(/\d{11}/);
      expect(value.replace(/\s+/g, ""), path).not.toMatch(/\d{11}/);
      expect(value, path).not.toMatch(/\d{9}/);
    }
  });

  it("3.1.5 organisasjonsnummer er tomt eller fraværende på alle firma", () => {
    for (const firm of TESTDATA_FIRMS) {
      const orgNumber = (firm as unknown as Loose).orgNumber;
      expect(orgNumber === undefined || orgNumber === null || orgNumber === "", firm.name).toBe(
        true,
      );
    }
    for (const value of valuesForKey(EXPORTED_DATA, "orgNumber")) {
      expect(value === undefined || value === null || value === "").toBe(true);
    }
    for (const value of valuesForKey(EXPORTED_DATA, "associationOrgNumber")) {
      expect(value === undefined || value === null || value === "").toBe(true);
    }
  });

  it("3.1.6 postnummer og kommune er par fra listen, i Nordland (18) eller Troms (55)", () => {
    for (const municipality of TESTDATA_MUNICIPALITIES) {
      expect(municipality.municipalityNumber).toMatch(/^(18|55)\d{2}$/);
      expect(municipality.postalCode).toMatch(/^\d{4}$/);
    }
    const pairs = new Set(
      TESTDATA_MUNICIPALITIES.map((item) => `${item.postalCode}|${item.municipalityNumber}`),
    );
    for (const property of TESTDATA_PROPERTIES) {
      expect(pairs.has(`${property.postalCode}|${property.municipalityNumber}`), property.key).toBe(
        true,
      );
      const input = testdataPropertyInput(property);
      const municipality = TESTDATA_MUNICIPALITIES.find(
        (item) => item.postalCode === property.postalCode,
      );
      expect(input.city).toBe(municipality?.postalPlace);
      expect(input.municipalityName).toBe(municipality?.municipalityName);
    }
    for (const order of ORDER_ONLY) {
      expect(pairs.has(`${order.postalCode}|${order.municipalityNumber}`), order.externalRef).toBe(
        true,
      );
    }
  });

  it("3.1.7 ingen firma-, forvalter- eller borettslagsnavn ligner en kjent kjede", () => {
    const names = [
      ...TESTDATA_FIRMS.map((firm) => firm.name),
      ...TESTDATA_PROPERTIES.flatMap((property) =>
        property.cooperativeName ? [property.cooperativeName] : [],
      ),
      ...valuesForKey(EXPORTED_DATA, "managingAgent").filter(
        (value): value is string => typeof value === "string",
      ),
      ...valuesForKey(EXPORTED_DATA, "firmName").filter(
        (value): value is string => typeof value === "string",
      ),
    ];
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      for (const chain of KNOWN_CHAINS) {
        expect(name.toLocaleLowerCase("nb"), `${name} ~ ${chain}`).not.toContain(
          chain.toLocaleLowerCase("nb"),
        );
      }
    }
  });

  it("3.1.8 ingen ansatt har samme navn som seed-admin eller e-postdomenet hans", () => {
    const adminName = readEnvExample("SEED_ADMIN_NAME");
    const adminDomain = readEnvExample("SEED_ADMIN_EMAIL").split("@")[1];
    expect(adminDomain).toBeTruthy();
    for (const employee of TESTDATA_EMPLOYEES) {
      expect(employee.name).not.toBe(adminName);
      expect(employee.email.split("@")[1]).not.toBe(adminDomain);
    }
    for (const { path, value } of ALL_STRINGS) {
      expect(value.toLowerCase(), path).not.toContain(`@${adminDomain}`);
    }
  });

  it("3.1.9 ingen gjetteord og ingen TG i dataene", () => {
    for (const { path, value } of ALL_STRINGS) {
      for (const word of FORBIDDEN_WORDS) expect(value, path).not.toMatch(word);
    }
  });

  it("3.1.9 ingen tekst framstiller nektet hulltaking som grunnlag for TG", () => {
    for (const { path, value } of ALL_STRINGS) {
      if (/hulltak/i.test(value)) {
        expect(value, path).not.toMatch(/nekt/i);
      }
    }
  });

  it("3.1.10 ingen særlige kategorier eller fødselsnummer i fritekst", () => {
    for (const { path, value } of ALL_STRINGS) {
      for (const word of SPECIAL_CATEGORY_WORDS) {
        expect(value.toLocaleLowerCase("nb"), path).not.toContain(word);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3.2 Innhold og roller
// ---------------------------------------------------------------------------------------------

describe("3.2 innhold og roller", () => {
  it("3.2.1 10–15 ansatte med unike e-poster, alle roller unntatt admin, ingen admin", () => {
    expect(TESTDATA_EMPLOYEES.length).toBeGreaterThanOrEqual(10);
    expect(TESTDATA_EMPLOYEES.length).toBeLessThanOrEqual(15);
    const emails = TESTDATA_EMPLOYEES.map((employee) => employee.email.toLowerCase());
    expect(new Set(emails).size).toBe(emails.length);
    const roles = new Set(TESTDATA_EMPLOYEES.flatMap((employee) => [...employee.roles]));
    // Leser konstanten: en ny rolle gjør testen rød til dataene har den
    expect([...roles].sort()).toEqual(employeeRoles.filter((role) => role !== "admin").sort());
    for (const employee of TESTDATA_EMPLOYEES) {
      expect(employee.roles, employee.key).not.toContain("admin");
      expect(employee.roles.length, employee.key).toBeGreaterThan(0);
    }
  });

  it("3.2.1 ansatte hører til selskapene og kontorene som runSeed lager", () => {
    const seed = readFileSync(join(process.cwd(), "src/db/seed/run.ts"), "utf8");
    for (const employee of TESTDATA_EMPLOYEES) {
      expect(seed, employee.companyName).toContain(`"${employee.companyName}"`);
      expect(seed, employee.officeName).toContain(`"${employee.officeName}"`);
    }
    // Spredt på flere selskaper og kontorer
    expect(
      new Set(TESTDATA_EMPLOYEES.map((employee) => employee.companyName)).size,
    ).toBeGreaterThan(2);
    expect(new Set(TESTDATA_EMPLOYEES.map((employee) => employee.officeName)).size).toBeGreaterThan(
      2,
    );
  });

  it("3.2.2 etternavnene til de ansatte kommer fra den faste listen", () => {
    const surnames = new Set<string>(TESTDATA_SURNAMES);
    for (const employee of TESTDATA_EMPLOYEES) {
      const surname = employee.name.trim().split(/\s+/).at(-1) ?? "";
      expect(surnames.has(surname), employee.name).toBe(true);
    }
  });

  it("3.2.2 meglere, selgere og kjøpere har også etternavn fra den faste listen", () => {
    const surnames = new Set<string>(TESTDATA_SURNAMES);
    const people = [
      ...TESTDATA_FIRMS.flatMap((firm) => firm.brokers.map((broker) => broker.name)),
      ...TESTDATA_ORDERS.flatMap((order) => order.parties.map((party) => party.name)),
    ];
    expect(people.length).toBeGreaterThan(50);
    for (const name of people) {
      const surname = name.trim().split(/\s+/).at(-1) ?? "";
      expect(surnames.has(surname), name).toBe(true);
    }
  });

  it("3.2.3 4–5 meglerfirma, hvert med minst én megler", () => {
    expect(TESTDATA_FIRMS.length).toBeGreaterThanOrEqual(4);
    expect(TESTDATA_FIRMS.length).toBeLessThanOrEqual(5);
    expect(new Set(TESTDATA_FIRMS.map((firm) => firm.name)).size).toBe(TESTDATA_FIRMS.length);
    for (const firm of TESTDATA_FIRMS) {
      expect(firm.firmType, firm.name).toBe("broker_firm");
      expect(firm.brokers.length, firm.name).toBeGreaterThan(0);
    }
  });

  it("3.2.4 45–55 eiendommer av alle tre slagene, med rekkehus og tomannsbolig", () => {
    expect(TESTDATA_PROPERTIES.length).toBeGreaterThanOrEqual(45);
    expect(TESTDATA_PROPERTIES.length).toBeLessThanOrEqual(55);
    expect(new Set(TESTDATA_PROPERTIES.map((property) => property.key)).size).toBe(
      TESTDATA_PROPERTIES.length,
    );
    const housing = TESTDATA_PROPERTIES.map((property) => property.housingType);
    expect(housing).toContain("detached");
    expect(housing).toContain("terraced");
    expect(housing).toContain("semi_detached");
    expect(housing).toContain("holiday_home");
    const apartments = TESTDATA_PROPERTIES.filter(
      (property) => property.housingType === "apartment",
    );
    expect(apartments.map((property) => property.ownershipForm)).toContain("section");
    expect(apartments.map((property) => property.ownershipForm)).toContain("cooperative");
  });

  it("3.2.4 matrikkelnøkkelen (kommune + gnr + bnr + fnr + snr) er unik", () => {
    const keys = TESTDATA_PROPERTIES.map((property) =>
      [
        property.municipalityNumber,
        property.gnr,
        property.bnr,
        property.fnr ?? "",
        property.snr ?? "",
        property.shareNumber ?? "",
      ].join("/"),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("3.2.5 minst ett oppdrag i hver status og minst to ordre som ikke er gjort om", () => {
    const targets = new Set(ASSIGNMENT_ORDERS.map((order) => order.target));
    for (const status of ASSIGNMENT_STATUSES) expect(targets.has(status), status).toBe(true);
    expect(ORDER_ONLY.length).toBeGreaterThanOrEqual(2);
    for (const order of ORDER_ONLY) expect(order.propertyKey).toBeUndefined();
  });

  it("3.2.5 TD-nøklene er unike, i formen TD-NNNN, og TD-0001 er den første", () => {
    const refs = TESTDATA_ORDERS.map((order) => order.externalRef);
    expect(new Set(refs).size).toBe(refs.length);
    for (const ref of refs) expect(ref).toMatch(/^TD-\d{4}$/);
    expect(refs[0]).toBe("TD-0001");
    // Hver eiendom har nøyaktig ett oppdrag
    const propertyKeys = ASSIGNMENT_ORDERS.map((order) => order.propertyKey);
    expect(new Set(propertyKeys).size).toBe(propertyKeys.length);
    for (const key of propertyKeys) expect(PROPERTY_BY_KEY.has(key ?? "")).toBe(true);
  });

  it("3.2.6 befaringer fra minst 90 dager før til minst 21 dager etter ankeret, ingen eldre enn 4 måneder", () => {
    const days = ASSIGNMENT_ORDERS.map((order) => order.inspectionDay ?? Number.NaN);
    for (const day of days) expect(Number.isFinite(day)).toBe(true);
    expect(Math.min(...days)).toBeLessThanOrEqual(-90);
    expect(Math.max(...days)).toBeGreaterThanOrEqual(21);
    const allDays = TESTDATA_ORDERS.flatMap((order) => [
      order.createdDay,
      ...(order.inspectionDay === undefined ? [] : [order.inspectionDay]),
      ...(order.completedDay === undefined ? [] : [order.completedDay]),
      ...(order.invoicedDay === undefined ? [] : [order.invoicedDay]),
      ...(order.claim ? [order.claim.receivedDay] : []),
      ...(order.workSessions ?? []).map((session) => session.startDay),
    ]);
    expect(Math.min(...allDays)).toBeGreaterThanOrEqual(-FOUR_MONTHS_DAYS);
  });

  it("3.2.6 TD-0001 lages på ankerdagen (dag 0), og ingen ordre er laget fram i tid", () => {
    expect(TESTDATA_ORDERS[0]?.createdDay).toBe(0);
    for (const order of TESTDATA_ORDERS) {
      expect(order.createdDay, order.externalRef).toBeLessThanOrEqual(0);
    }
  });

  it("3.2.7 4–5 reklamasjoner med utfallene åpen, avvist, medhold, forlik og trukket", () => {
    const claims = TESTDATA_ORDERS.flatMap((order) => (order.claim ? [order.claim] : []));
    expect(claims.length).toBeGreaterThanOrEqual(4);
    expect(claims.length).toBeLessThanOrEqual(5);
    expect(new Set(claims.map((claim) => claim.outcome))).toEqual(new Set(CLAIM_OUTCOMES));
  });

  it("3.2.8 byggeår 1900–2025 på hver eiendom, ett bad fra før 2000 og ett bad på 0–5 år", () => {
    for (const property of TESTDATA_PROPERTIES) {
      expect(property.buildYear, property.key).toBeGreaterThanOrEqual(1900);
      expect(property.buildYear, property.key).toBeLessThanOrEqual(2025);
      expect(property.bathroomYear, property.key).toBeGreaterThanOrEqual(property.buildYear);
      expect(property.bathroomYear, property.key).toBeLessThanOrEqual(2026);
    }
    expect(TESTDATA_PROPERTIES.some((property) => property.bathroomYear < 2000)).toBe(true);
    expect(TESTDATA_PROPERTIES.some((property) => property.bathroomYear >= 2021)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3 Faglige krav (regeltester over eiendommene)
// ---------------------------------------------------------------------------------------------

describe("3.3 faglige krav per eiendom", () => {
  it.each(PROPERTY_CASES)("3.3.1 arealtypen følger suggestAreaType (%s)", (_key, property) => {
    for (const room of roomsOf(property)) {
      expect(room.areaType, `${room.roomType} ${room.name}`).toBe(suggestAreaType(room.roomType));
      if (room.roomType === "garage" || room.roomType === "external_storage") {
        expect(room.areaType).toBe("bra_e");
      }
      if (room.areaType === "bra_b") expect(room.roomType).toBe("glazed_balcony");
    }
  });

  it.each(PROPERTY_CASES)(
    "3.3.2 BRA-e og BRA-b i etasjen har rom med samme arealtype, og omvendt (%s)",
    (_key, property) => {
      for (const floor of floorsOf(property)) {
        const area = areaOf(floor);
        const types = new Set(floor.rooms.map((room) => room.areaType));
        expect(area.braE > 0, `${floor.name} BRA-e`).toBe(types.has("bra_e"));
        expect(area.braB > 0, `${floor.name} BRA-b`).toBe(types.has("bra_b"));
        if (types.has("bra_i")) expect(area.braI, `${floor.name} BRA-i`).toBeGreaterThan(0);
      }
    },
  );

  it.each(PROPERTY_CASES)(
    "3.3.3 ALH bare på loft og hems, og aldri talt som BRA (%s)",
    (_key, property) => {
      for (const floor of floorsOf(property)) {
        const area = areaOf(floor);
        if (area.alh > 0) {
          expect(floor.name, floor.name).toMatch(/loft|hems/i);
          expect(area.braI + area.braE + area.braB, floor.name).toBe(0);
          for (const room of floor.rooms) expect(room.areaType, room.name).toBe("not_bra");
        }
      }
    },
  );

  it.each(PROPERTY_CASES)(
    "3.3.4 not_bra på kryperom og uinnredet loft, ellers ikke (%s)",
    (_key, property) => {
      for (const room of roomsOf(property)) {
        const notBraType = room.roomType === "crawl_space" || room.roomType === "unfinished_attic";
        expect(room.areaType === "not_bra", `${room.roomType} ${room.name}`).toBe(notBraType);
      }
    },
  );

  it.each(PROPERTY_CASES)(
    "3.3.5 «under terreng» stemmer med etasjen, kryperom unntatt (%s)",
    (_key, property) => {
      for (const floor of floorsOf(property)) {
        if (floor.level < 0) expect(floor.belowGround, floor.name).toBe(true);
        if (floor.level > 0) expect(floor.belowGround, floor.name).toBe(false);
        for (const room of floor.rooms) {
          if (room.roomType === "crawl_space") continue;
          expect(room.belowGround, `${floor.name} ${room.name}`).toBe(floor.belowGround);
        }
      }
    },
  );

  it.each(PROPERTY_CASES)(
    "3.3.6 minst ett bad og ett kjøkken eller stue/kjøkken (%s)",
    (_key, property) => {
      const types = roomsOf(property).map((room) => room.roomType);
      expect(types.some((type) => type === "bathroom" || type === "bathroom_laundry")).toBe(true);
      expect(types.some((type) => type === "kitchen" || type === "living_kitchen")).toBe(true);
    },
  );

  it.each(PROPERTY_CASES)(
    "3.3.7 metoden er drawing bare på fellesbod, ellers laser (%s)",
    (_key, property) => {
      for (const floor of floorsOf(property)) {
        const method = (floor.area as Loose).method;
        const sharedStorage =
          property.housingType === "apartment" &&
          floor.rooms.length > 0 &&
          floor.rooms.every((room) => room.roomType === "external_storage");
        expect(method, floor.name).toBe(sharedStorage ? "drawing" : "laser");
      }
    },
  );

  it.each(PROPERTY_CASES)("3.3.8 størrelsen passer slaget (%s)", (_key, property) => {
    const bra = totalBra(property);
    const [min, max] =
      property.kind === "apartment"
        ? [35, 120]
        : property.kind === "holiday"
          ? [30, 120]
          : [90, 250];
    expect(bra).toBeGreaterThanOrEqual(min);
    expect(bra).toBeLessThanOrEqual(max);
  });

  it.each(PROPERTY_CASES)("3.3.9 eierform og matrikkel henger sammen (%s)", (_key, property) => {
    switch (property.kind) {
      case "apartment":
        expect(property.housingType).toBe("apartment");
        if (property.ownershipForm === "section") {
          expect(property.snr).toMatch(/^\d+$/);
          expect(property.shareNumber ?? null).toBeNull();
          expect(property.cooperativeName ?? null).toBeNull();
        } else {
          expect(property.ownershipForm).toBe("cooperative");
          expect(property.cooperativeName?.trim()).toBeTruthy();
          expect(property.shareNumber).toMatch(/^[0-9-]+$/);
          expect(property.snr ?? null).toBeNull();
        }
        expect(property.fnr ?? null).toBeNull();
        break;
      case "detached":
        expect(["detached", "terraced", "semi_detached"]).toContain(property.housingType);
        expect(property.ownershipForm).toBe("freehold");
        expect(property.snr ?? null).toBeNull();
        expect(property.shareNumber ?? null).toBeNull();
        expect(property.cooperativeName ?? null).toBeNull();
        break;
      case "holiday":
        expect(property.housingType).toBe("holiday_home");
        expect(property.ownershipForm).toBe("freehold");
        expect(property.snr ?? null).toBeNull();
        expect(property.shareNumber ?? null).toBeNull();
        break;
      default:
        throw new Error(`ukjent slag ${String(property.kind)}`);
    }
  });

  it("3.3.9 minst én fritidsbolig har festenummer", () => {
    expect(
      TESTDATA_PROPERTIES.some((property) => property.kind === "holiday" && property.fnr),
    ).toBe(true);
  });

  it("3.3.9 seksjoner i samme bygg deler gnr/bnr; borettslag i samme lag deler navn", () => {
    const sections = TESTDATA_PROPERTIES.filter((property) => property.ownershipForm === "section");
    const byBuilding = new Map<string, number>();
    for (const property of sections) {
      const key = `${property.municipalityNumber}/${property.gnr}/${property.bnr}`;
      byBuilding.set(key, (byBuilding.get(key) ?? 0) + 1);
    }
    expect([...byBuilding.values()].some((count) => count > 1)).toBe(true);
  });

  it.each(PROPERTY_CASES)(
    "3.3.10 fellesarealer bare på sameie og borettslag (%s)",
    (_key, property) => {
      const shared =
        property.ownershipForm === "section" || property.ownershipForm === "cooperative";
      if (shared) {
        expect(property.commonAreas).toBeDefined();
      } else {
        expect(property.commonAreas).toBeUndefined();
      }
    },
  );

  it.each(PROPERTY_CASES)(
    "3.3.11 eiendom, bygning, etasje, areal og rom går gjennom skjemaene (%s)",
    (_key, property) => {
      const parsed = propertyInputSchema.safeParse(testdataPropertyInput(property));
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      expect(HOUSING_TYPES).toContain(property.housingType);
      expect(OWNERSHIP_FORMS).toContain(property.ownershipForm);
      if (property.commonAreas) {
        expect(commonAreasInputSchema.safeParse(property.commonAreas).success).toBe(true);
      }
      for (const building of property.buildings) {
        expect(buildingInputSchema.safeParse({ name: building.name }).success, building.name).toBe(
          true,
        );
        for (const floor of building.floors) {
          expect(
            floorInputSchema.safeParse({
              name: floor.name,
              level: floor.level,
              belowGround: floor.belowGround,
            }).success,
            floor.name,
          ).toBe(true);
          const area = floorAreaInputSchema.safeParse(floor.area);
          expect(area.success, `${floor.name}: ${JSON.stringify(area.error?.issues)}`).toBe(true);
          expect(MEASURING_METHODS).toContain((floor.area as Loose).method);
          for (const room of floor.rooms) {
            const parsedRoom = roomInputSchema.safeParse(room);
            expect(parsedRoom.success, room.name).toBe(true);
            expect(ROOM_TYPE_KEYS).toContain(room.roomType);
            expect(AREA_TYPES).toContain(room.areaType);
          }
        }
      }
    },
  );

  it("3.3.11 firma, meglere og parter går gjennom skjemaene, med koder fra listene", () => {
    for (const firm of TESTDATA_FIRMS) {
      const parsed = firmInputSchema.safeParse({ name: firm.name, firmType: firm.firmType });
      expect(parsed.success, firm.name).toBe(true);
      for (const broker of firm.brokers) {
        const [firstName, ...rest] = broker.name.split(" ");
        const contact = contactInputSchema.safeParse({
          firstName,
          lastName: rest.join(" "),
          email: broker.email,
          phone: broker.phone,
        });
        expect(contact.success, broker.name).toBe(true);
      }
    }
    for (const order of TESTDATA_ORDERS) {
      for (const party of order.parties) {
        expect(PARTY_ROLES).toContain(party.role);
        const parsed = partyInputSchema.safeParse(party);
        expect(parsed.success, `${order.externalRef} ${party.role}`).toBe(true);
      }
    }
  });

  it("3.3.12 reklamasjoner bare på ferdige og fakturerte; beløp bare ved medhold og forlik; bygningsdelene spres", () => {
    const withClaims = TESTDATA_ORDERS.filter((order) => order.claim);
    const amountOutcomes: readonly string[] = CLAIM_OUTCOMES_WITH_AMOUNT;
    for (const order of withClaims) {
      const claim = order.claim!;
      expect(["completed", "invoiced"], order.externalRef).toContain(order.target);
      expect(order.completedDay).toBeDefined();
      // Mottatt etter at oppdraget ble ferdig, og ikke fram i tid
      expect(claim.receivedDay, order.externalRef).toBeGreaterThan(order.completedDay!);
      expect(claim.receivedDay, order.externalRef).toBeLessThanOrEqual(0);
      if (amountOutcomes.includes(claim.outcome)) {
        expect(claim.amount, order.externalRef).toBeGreaterThan(0);
      } else {
        expect(claim.amount, order.externalRef).toBeUndefined();
      }
      expect(claim.description.trim().length).toBeGreaterThan(20);
      // Den som klager, finnes som part på oppdraget
      expect(order.parties.map((party) => party.role)).toContain(claim.claimantRole);
    }
    const parts = withClaims.map((order) => order.claim!.buildingPart.toLocaleLowerCase("nb"));
    for (const part of ["våtrom", "tak", "drenering", "areal"]) {
      expect(parts, part).toContain(part);
    }
  });

  it.each(ORDER_CASES)("3.3.13 tid og team (%s)", (_ref, order) => {
    expect(order.responsibleKey).toBeDefined();
    expect(order.secondKey).toBeDefined();
    expect(order.officeName).toBeTruthy();
    expect(order.secondKey).not.toBe(order.responsibleKey);
    expect(order.parties.length).toBeGreaterThan(0);
    const responsible = EMPLOYEE_BY_KEY.get(order.responsibleKey!);
    const second = EMPLOYEE_BY_KEY.get(order.secondKey!);
    expect(responsible?.roles).toContain("inspector");
    expect(second?.roles).toContain("inspector");
    expect(order.inspectionDay).toBeDefined();
    expect(order.createdDay).toBeLessThanOrEqual(order.inspectionDay!);
    expect(order.dueDay ?? Number.POSITIVE_INFINITY).toBeGreaterThanOrEqual(order.inspectionDay!);

    if (order.target === "ordered") {
      expect(order.startedDay).toBeUndefined();
      expect(order.completedDay).toBeUndefined();
      expect(order.workSessions ?? []).toEqual([]);
    }
    if (order.target === "in_progress") {
      expect(order.inspectionDay!).toBeLessThanOrEqual(0);
      expect(order.completedDay).toBeUndefined();
    }
    if (order.target === "completed" || order.target === "invoiced") {
      expect(order.inspectionDay!).toBeLessThan(0);
      expect(order.completedDay).toBeDefined();
      expect(order.inspectionDay!).toBeLessThan(order.completedDay!);
      expect(order.completedDay!).toBeLessThanOrEqual(0);
      expect(order.selfDeclarationReceived).toBe(true);
      // Ansvarlig har gyldig sertifisering på befaringsdagen
      const certification = responsible?.certification;
      expect(certification, order.responsibleKey).toBeDefined();
      expect(certification!.validFromDay).toBeLessThanOrEqual(order.inspectionDay!);
      expect(certification!.validToDay).toBeGreaterThanOrEqual(order.inspectionDay!);
    }
    if (order.target === "invoiced") {
      expect(order.invoicedDay).toBeDefined();
      expect(order.invoicedDay!).toBeGreaterThanOrEqual(order.completedDay!);
      expect(order.invoicedDay!).toBeLessThanOrEqual(0);
    } else {
      expect(order.invoicedDay).toBeUndefined();
    }
  });

  it("3.3.13 nøyaktig én takstmann har utløpt sertifisering, og han er aldri ansvarlig", () => {
    const inspectors = TESTDATA_EMPLOYEES.filter((employee) =>
      employee.roles.includes("inspector"),
    );
    const expired = inspectors.filter(
      (employee) => employee.certification && employee.certification.validToDay < 0,
    );
    expect(expired).toHaveLength(1);
    const expiredKey = expired[0]!.key;
    for (const order of ASSIGNMENT_ORDERS) expect(order.responsibleKey).not.toBe(expiredKey);
    for (const employee of inspectors) {
      if (employee.key === expiredKey) continue;
      expect(employee.certification, employee.key).toBeDefined();
      expect(employee.certification!.validFromDay).toBeLessThanOrEqual(0);
      expect(employee.certification!.validToDay).toBeGreaterThanOrEqual(0);
    }
    // Sertifiseringene har oppdiktet utsteder og nummer (A307)
    for (const employee of inspectors) {
      expect(employee.certification!.issuer).toMatch(/oppdiktet/i);
    }
  });

  it("3.3.13 ordre som ikke er gjort om, har ingen team, befaring eller oppdragsstatus", () => {
    for (const order of ORDER_ONLY) {
      expect(order.responsibleKey).toBeUndefined();
      expect(order.inspectionDay).toBeUndefined();
      expect(order.workSessions ?? []).toEqual([]);
      expect(order.claim).toBeUndefined();
      expect(order.address?.trim()).toBeTruthy();
    }
  });

  it("3.3.14 tidsregistrering: befaring 1–3 t, rapportskriving 2–5 t; leilighet lavere enn enebolig med kjeller", () => {
    const totals = { apartment: [] as number[], basement: [] as number[] };
    for (const order of DONE) {
      const sessions = order.workSessions ?? [];
      expect(sessions.length, order.externalRef).toBeGreaterThan(0);
      for (const session of sessions) {
        if (session.phase === "inspection") {
          expect(session.hours).toBeGreaterThanOrEqual(1);
          expect(session.hours).toBeLessThanOrEqual(3);
        } else {
          expect(session.phase).toBe("office");
          expect(session.hours).toBeGreaterThanOrEqual(2);
          expect(session.hours).toBeLessThanOrEqual(5);
        }
        // Bare oppdiktede ansatte, og i teamet på oppdraget
        expect([order.responsibleKey, order.secondKey]).toContain(session.employeeKey);
        expect(session.startDay).toBeGreaterThanOrEqual(order.inspectionDay!);
        expect(session.startDay).toBeLessThanOrEqual(order.completedDay!);
      }
      const property = PROPERTY_BY_KEY.get(order.propertyKey ?? "")!;
      const hours = sessions.reduce((sum, session) => sum + session.hours, 0);
      if (property.kind === "apartment") totals.apartment.push(hours);
      const hasBasement = floorsOf(property).some((floor) => floor.belowGround);
      if (property.kind === "detached" && hasBasement) totals.basement.push(hours);
    }
    const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
    expect(totals.apartment.length).toBeGreaterThan(0);
    expect(totals.basement.length).toBeGreaterThan(0);
    expect(mean(totals.apartment)).toBeLessThan(mean(totals.basement));
  });

  it("3.3.14 ingen økter på bestilte eller under arbeid (tidsstatistikken teller bare ferdige)", () => {
    for (const order of TESTDATA_ORDERS) {
      if (order.target === "completed" || order.target === "invoiced") continue;
      expect(order.workSessions ?? [], order.externalRef).toEqual([]);
    }
  });
});

describe("typene i testene (vakt)", () => {
  it("ordrene har kjent form", () => {
    const sample: TestdataOrder | undefined = TESTDATA_ORDERS[0];
    expect(sample?.externalRef).toBe("TD-0001");
  });
});
