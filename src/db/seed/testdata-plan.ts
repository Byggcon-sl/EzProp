import { defaultReceives } from "@/core/assignments/codes";
import { suggestAreaType, suggestBelowGround, type RoomType } from "@/core/buildings/codes";
import type { MeasuringMethod } from "@/core/buildings/codes";
import type { CommonAreasInput, HousingType, OwnershipForm } from "@/core/properties";
import { createSeededRandom, type SeededRandom } from "./seeded-random";
import {
  TESTDATA_ASSIGNMENT_NOTES,
  TESTDATA_BROKER_FIRMS,
  TESTDATA_CERTIFICATION_ISSUER,
  TESTDATA_CLAIMS,
  TESTDATA_EMAIL_DOMAIN,
  TESTDATA_EMPLOYEES,
  TESTDATA_FIRST_NAMES,
  TESTDATA_GNR_MAX,
  TESTDATA_GNR_MIN,
  TESTDATA_HOUSING_ASSOCIATIONS,
  TESTDATA_LAST_NAMES,
  TESTDATA_MANAGING_AGENTS,
  TESTDATA_ORDER_PREFIX,
  TESTDATA_POSTAL_AREAS,
  TESTDATA_PRIVATE_ORDER_TEXT,
  TESTDATA_SHARED_STORAGE_NAME,
  TESTDATA_STREET_NAMES,
  type TestdataClaimTarget,
  type TestdataPostalArea,
} from "./testdata.data";
import type {
  TestdataAssignment,
  TestdataBuilding,
  TestdataClaim,
  TestdataContact,
  TestdataEmployee,
  TestdataFirm,
  TestdataFloor,
  TestdataFloorArea,
  TestdataOrder,
  TestdataParty,
  TestdataPlan,
  TestdataProperty,
  TestdataRoom,
  TestdataStatusChange,
  TestdataWorkSession,
} from "./testdata.types";

/*
 * Den rene planen for testdataene (docs/funksjoner/fase2a-testdata-arbeidshverdag.md): hvem som
 * finnes, og hvilke ordre, oppdrag, eiendommer, rom, arbeidsøkter og reklamasjoner som skal lages.
 * Ingen database, ingen systemklokke og ingen `Math.random`: samme frø og anker gir alltid samme
 * plan, og et annet anker flytter bare datoene.
 *
 * Tid: alle tidspunkter regnes fra midnatt (UTC) på ankerets dato, i hele dager og minutter, så et
 * anker som flyttes et helt antall dager flytter alle datoer like mye. Klokkeslettene ligger i
 * arbeidstiden. Det eldste (TD-0001) er 110 dager bak, den seneste befaringen 22–33 dager fram.
 *
 * Faget (fagansvarlig i kortet): arealtype og «under terreng» fra `suggestAreaType` og
 * `suggestBelowGround`; garasje og utebod BRA-e, BRA-b bare for innglasset balkong, ALH bare på
 * loft og hems, kryperom og uinnredet loft `not_bra`; bad og kjøkken i hver bolig; tegning bare på
 * fellesbod; eierform og matrikkel henger sammen; reklamasjoner bare etter ferdig.
 */

const DAY_MS = 86_400_000;

type Kind =
  | "detached"
  | "detached_basement"
  | "terraced"
  | "semi_detached"
  | "apartment_section"
  | "apartment_cooperative"
  | "holiday_home";

/** Fordelingen av de 50 eiendommene. */
const KIND_COUNTS: Record<Kind, number> = {
  detached: 7,
  detached_basement: 7,
  terraced: 4,
  semi_detached: 4,
  apartment_section: 12,
  apartment_cooperative: 9,
  holiday_home: 7,
};

/** Hvor mange ordre per status. Summen av oppdragene er antall eiendommer. */
const STATUS_COUNTS = {
  invoiced: 16,
  completed: 12,
  in_progress: 10,
  ordered: 12,
  unconverted: 4,
} as const;

type SlotStatus = keyof typeof STATUS_COUNTS;

/** Tidspunktene for én ordre, i dager og minutter fra ankerdagen. */
type Slot = {
  status: SlotStatus;
  received: number;
  inspection: number | null;
  inProgress: number | null;
  completed: number | null;
  invoiced: number | null;
};

/** Klokkeslett (UTC) som brøkdel av et døgn. */
const clock = (hours: number, minutes = 0) => (hours * 60 + minutes) / (24 * 60);

export function buildTestdataPlan({ seed, anchor }: { seed: number; anchor: Date }): TestdataPlan {
  if (Number.isNaN(anchor.getTime())) throw new Error("Ankeret må være en gyldig dato.");
  const rng = createSeededRandom(seed);
  const base = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate());
  const anchorYear = anchor.getUTCFullYear();
  const at = (days: number): Date => new Date(base + Math.round(days * DAY_MS));
  const isoDate = (days: number): string => at(Math.floor(days)).toISOString().slice(0, 10);

  const people = createPeople();
  const employees = buildEmployees(base, people);
  const { firms, contacts } = buildFirmsAndContacts(people);

  const inspectors = employees.filter((employee) => employee.roles.includes("inspector"));
  const certifiedInspectors = inspectors.filter(
    (employee) => employee.certification !== null && employee.certification.validTo >= isoDate(0),
  );
  const managers = employees.filter((employee) => employee.roles.includes("manager"));
  const officeStaff = employees.filter((employee) => employee.roles.includes("office"));

  const slots = buildSlots(rng);
  const kinds = buildKinds(rng, slots);
  const cadastre = createCadastre(rng);

  const orders: TestdataOrder[] = [];
  let kindIndex = 0;
  for (const slot of slots) {
    const receivedAt = at(slot.received);
    const officeHandlers = (office: string) => {
      const local = officeStaff.filter((employee) => employee.officeName === office);
      return local.length > 0 ? local : officeStaff.filter((e) => e.officeName === "Bodø");
    };

    if (slot.status === "unconverted") {
      const area = rng.pick(TESTDATA_POSTAL_AREAS);
      const firm = pickFirm(rng, area.officeName, 0.75);
      const broker = firm ? pickBroker(rng, contacts, firm) : null;
      const withCadastre = rng.next() < 0.5;
      const cadastral = withCadastre ? cadastre.next(area.municipalityNumber) : null;
      orders.push({
        key: "",
        externalRef: "",
        receivedAt,
        createdByKey: rng.pick(officeHandlers(area.officeName)).key,
        orderedByContactKey: broker?.key ?? null,
        fields: {
          addressText: `${streetAddress(rng)}, ${area.postalCode} ${area.postalPlace}`,
          orderedByText: firm?.name ?? TESTDATA_PRIVATE_ORDER_TEXT,
          gnr: cadastral?.gnr ?? null,
          bnr: cadastral?.bnr ?? null,
          snr: null,
          housingAssociationName: null,
          sellerDeclarationReceived: rng.next() < 0.5,
        },
        converted: false,
      });
      continue;
    }

    const kind = kinds[kindIndex++] as Kind;
    const done = slot.status === "completed" || slot.status === "invoiced";
    const responsible = rng.pick(done ? certifiedInspectors : inspectors);
    const second = rng.pick(inspectors.filter((employee) => employee.key !== responsible.key));
    const officeName = responsible.officeName;
    const area = rng.pick(TESTDATA_POSTAL_AREAS.filter((a) => a.officeName === officeName));
    const property = buildProperty(rng, kind, area, cadastre, anchorYear);
    const firm = pickFirm(rng, officeName, 0.85);
    const broker = firm ? pickBroker(rng, contacts, firm) : null;
    const inspected = slot.inspection !== null && slot.inspection < 0;

    const parties: TestdataParty[] = [];
    if (broker && firm) {
      parties.push({
        role: "broker",
        name: broker.name,
        firmName: firm.name,
        email: broker.email,
        phone: broker.phone,
        ...defaultReceives("broker"),
        contactKey: broker.key,
      });
    }
    const seller = people.next(rng);
    parties.push({
      role: "seller",
      name: seller.name,
      firmName: null,
      email: seller.email,
      phone: seller.phone,
      ...defaultReceives("seller"),
      receivesInvoice: true,
      contactKey: null,
    });

    const statusTimes: TestdataStatusChange[] = [];
    if (slot.inProgress !== null)
      statusTimes.push({ toStatus: "in_progress", at: at(slot.inProgress) });
    if (slot.completed !== null)
      statusTimes.push({ toStatus: "completed", at: at(slot.completed) });
    if (slot.invoiced !== null) statusTimes.push({ toStatus: "invoiced", at: at(slot.invoiced) });

    const assignment: TestdataAssignment = {
      status: slot.status,
      convertedAt: at(slot.received + clock(0, rng.int(2, 12) * 15)),
      statusTimes,
      inspectionAt: slot.inspection === null ? null : at(slot.inspection),
      dueDate: dueDate(rng, slot, isoDate),
      internalNote: rng.next() < 0.3 ? rng.pick(TESTDATA_ASSIGNMENT_NOTES) : null,
      officeName,
      responsibleKey: responsible.key,
      secondKey: second.key,
      parties,
      property,
      commonAreas: commonAreasFor(rng, property),
      buildings: inspected ? buildBuildings(rng, kind, property, anchorYear) : [],
      workSessions: done ? buildWorkSessions(rng, kind, slot, responsible.key, at) : [],
      claim: null,
    };
    orders.push({
      key: "",
      externalRef: "",
      receivedAt,
      createdByKey: rng.pick(officeHandlers(officeName)).key,
      orderedByContactKey: broker?.key ?? null,
      fields: {
        addressText: `${property.address}, ${property.postalCode} ${property.city}`,
        orderedByText: firm?.name ?? TESTDATA_PRIVATE_ORDER_TEXT,
        gnr: property.gnr,
        bnr: property.bnr,
        snr: property.snr,
        housingAssociationName: property.associationName,
        sellerDeclarationReceived: done || rng.next() < 0.6,
      },
      converted: { assignment },
    });
  }

  // Eldst først; TD-0001 er alltid den eldste (ankeret i databasen leses fra den)
  orders.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  orders.forEach((order, index) => {
    const ref = `${TESTDATA_ORDER_PREFIX}${String(index + 1).padStart(4, "0")}`;
    order.key = ref;
    order.externalRef = ref;
  });

  ensureBathroomAges(orders, anchorYear);
  ensureLeasedHolidayHome(orders);
  addClaims(rng, orders, managers, people, at, isoDate);

  return { anchor: new Date(anchor.getTime()), employees, firms, contacts, orders };
}

// --- Personer -------------------------------------------------------------------------------

type Person = { firstName: string; lastName: string; name: string; email: string; phone: string };

/** Lager personer med unike e-poster og telefonnummer på de oppdiktede seriene. */
function createPeople() {
  const usedEmails = new Set<string>();
  let phoneCounter = 10_000;

  function emailFor(firstName: string, lastName: string): string {
    const local = `${slug(firstName)}.${slug(lastName)}`;
    let email = `${local}@${TESTDATA_EMAIL_DOMAIN}`;
    for (let n = 2; usedEmails.has(email); n += 1) {
      email = `${local}${n}@${TESTDATA_EMAIL_DOMAIN}`;
    }
    usedEmails.add(email);
    return email;
  }

  function phone(): string {
    phoneCounter += 1;
    const digits = String(phoneCounter).padStart(5, "0");
    return `+47 000 ${digits.slice(0, 2)} ${digits.slice(2)}`;
  }

  function create(firstName: string, lastName: string): Person {
    return {
      firstName,
      lastName,
      name: `${firstName} ${lastName}`,
      email: emailFor(firstName, lastName),
      phone: phone(),
    };
  }

  return {
    create,
    next: (rng: SeededRandom) =>
      create(rng.pick(TESTDATA_FIRST_NAMES), rng.pick(TESTDATA_LAST_NAMES)),
  };
}

function slug(value: string): string {
  return value
    .toLocaleLowerCase("nb")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]/g, "");
}

function buildEmployees(base: number, people: ReturnType<typeof createPeople>): TestdataEmployee[] {
  const isoDate = (days: number) => new Date(base + days * DAY_MS).toISOString().slice(0, 10);
  return TESTDATA_EMPLOYEES.map((seed, index) => {
    const person = people.create(seed.firstName, seed.lastName);
    const validTo = seed.certificationValidToDays;
    return {
      key: person.email,
      name: person.name,
      email: person.email,
      phone: person.phone,
      companyLegalName: seed.companyLegalName,
      officeName: seed.officeName,
      roles: [...seed.roles],
      certification:
        validTo === null
          ? null
          : {
              area: "condition_report",
              issuer: TESTDATA_CERTIFICATION_ISSUER,
              certificateNumber: `TD-SERT-${String(index + 1).padStart(3, "0")}`,
              // Sertifiseringen varer tre år
              validFrom: isoDate(validTo - 3 * 365 + 1),
              validTo: isoDate(validTo),
            },
    };
  });
}

function buildFirmsAndContacts(people: ReturnType<typeof createPeople>) {
  const firms: TestdataFirm[] = [];
  const contacts: TestdataContact[] = [];
  for (const firm of TESTDATA_BROKER_FIRMS) {
    const firmKey = `${firm.name}|broker_firm`;
    firms.push({ key: firmKey, name: firm.name, firmType: "broker_firm", orgNumber: null });
    for (const [firstName, lastName] of firm.brokers) {
      const person = people.create(firstName, lastName);
      contacts.push({
        key: person.email,
        firstName,
        lastName,
        name: person.name,
        email: person.email,
        phone: person.phone,
        firmKey,
        roleHint: "broker",
      });
    }
  }
  return { firms, contacts };
}

function pickFirm(rng: SeededRandom, officeName: string, share: number) {
  if (rng.next() >= share) return null;
  const local = TESTDATA_BROKER_FIRMS.filter((firm) =>
    (firm.officeNames as readonly string[]).includes(officeName),
  );
  return rng.pick(local.length > 0 ? local : TESTDATA_BROKER_FIRMS);
}

function pickBroker(
  rng: SeededRandom,
  contacts: readonly TestdataContact[],
  firm: { name: string },
): TestdataContact {
  return rng.pick(contacts.filter((contact) => contact.firmKey === `${firm.name}|broker_firm`));
}

// --- Tid ------------------------------------------------------------------------------------

/** Klokkeslett i arbeidstiden (UTC), som brøkdel av et døgn. */
function workTime(rng: SeededRandom, fromHour: number, toHour: number): number {
  const quarters = rng.int(fromHour * 4, toHour * 4);
  return quarters / (24 * 4);
}

/**
 * Tidspunktene per ordre. Regnes bakover fra ferdig-datoen for ferdige og fakturerte, så
 * rekkefølgen alltid er mottatt → under arbeid → befaring → ferdig → fakturert, og alt ferdig
 * ligger før ankerdagen.
 */
function buildSlots(rng: SeededRandom): Slot[] {
  const slots: Slot[] = [];

  // TD-0001: den eldste, fast
  slots.push({
    status: "invoiced",
    received: -110 + clock(7, 15),
    inProgress: -102 + clock(9),
    inspection: -101 + clock(8),
    completed: -97 + clock(13, 30),
    invoiced: -92 + clock(8),
  });

  const doneSlot = (status: "invoiced" | "completed", completedDay: number): Slot => {
    const inspectionDay = completedDay - rng.int(2, 6);
    // Aldri eldre enn TD-0001 (-110); minst sju dager før befaringen fordi ferdig er fra -96
    const receivedDay = Math.max(-108, inspectionDay - rng.int(4, 12));
    const inProgressDay = Math.max(receivedDay + 1, inspectionDay - rng.int(1, 3));
    const invoicedDay = status === "invoiced" ? Math.min(completedDay + rng.int(3, 10), -1) : null;
    return {
      status,
      received: receivedDay + workTime(rng, 6, 13),
      inProgress: inProgressDay + workTime(rng, 6, 8),
      inspection: inspectionDay + workTime(rng, 7, 11),
      completed: completedDay + workTime(rng, 13, 14),
      invoiced: invoicedDay === null ? null : invoicedDay + workTime(rng, 7, 9),
    };
  };

  for (let i = 1; i < STATUS_COUNTS.invoiced; i += 1) {
    slots.push(doneSlot("invoiced", rng.int(-96, -18)));
  }
  for (let i = 0; i < STATUS_COUNTS.completed; i += 1) {
    slots.push(doneSlot("completed", rng.int(-16, -1)));
  }

  for (let i = 0; i < STATUS_COUNTS.in_progress; i += 1) {
    if (i % 2 === 0) {
      // Befart, rapporten skrives
      const inspectionDay = rng.int(-9, -1);
      const receivedDay = inspectionDay - rng.int(4, 12);
      const inProgressDay = Math.max(receivedDay + 1, inspectionDay - rng.int(1, 3));
      slots.push({
        status: "in_progress",
        received: receivedDay + workTime(rng, 6, 13),
        inProgress: inProgressDay + workTime(rng, 6, 8),
        inspection: inspectionDay + workTime(rng, 7, 11),
        completed: null,
        invoiced: null,
      });
    } else {
      // Befaring de neste dagene
      const inspectionDay = rng.int(1, 12);
      const receivedDay = Math.max(-40, Math.min(inspectionDay - rng.int(5, 15), -1));
      const received = receivedDay + workTime(rng, 6, 13);
      slots.push({
        status: "in_progress",
        received,
        // Dagen etter mottak, eller noen timer etter når ordren kom i går
        inProgress: received + (receivedDay <= -2 ? 1 : clock(4)),
        inspection: inspectionDay + workTime(rng, 7, 11),
        completed: null,
        invoiced: null,
      });
    }
  }

  for (let i = 0; i < STATUS_COUNTS.ordered; i += 1) {
    const receivedDay = rng.int(-14, -1);
    let inspection: number | null;
    if (i < 2) inspection = null;
    else if (i < 4) inspection = rng.int(22, 33) + workTime(rng, 7, 11);
    else inspection = rng.int(1, 30) + workTime(rng, 7, 11);
    slots.push({
      status: "ordered",
      received: receivedDay + workTime(rng, 6, 13),
      inProgress: null,
      inspection,
      completed: null,
      invoiced: null,
    });
  }

  for (let i = 0; i < STATUS_COUNTS.unconverted; i += 1) {
    slots.push({
      status: "unconverted",
      received: rng.int(-3, -1) + workTime(rng, 6, 13),
      inProgress: null,
      inspection: null,
      completed: null,
      invoiced: null,
    });
  }
  return slots;
}

function dueDate(rng: SeededRandom, slot: Slot, isoDate: (days: number) => string): string {
  if (slot.completed !== null) return isoDate(slot.completed + rng.int(0, 3));
  if (slot.inspection !== null) return isoDate(Math.min(slot.inspection + rng.int(3, 7), 34));
  return isoDate(Math.min(slot.received + 21, 34));
}

// --- Eiendommer -----------------------------------------------------------------------------

/**
 * Slagene i rekkefølgen oppdragene lages. De første ferdige og fakturerte får ett av hvert slag,
 * slik at reklamasjonene, tidsstatistikken og aldersreglene alltid har det de trenger.
 */
function buildKinds(rng: SeededRandom, slots: readonly Slot[]): Kind[] {
  const pool: Kind[] = [];
  for (const [kind, count] of Object.entries(KIND_COUNTS) as [Kind, number][]) {
    for (let i = 0; i < count; i += 1) pool.push(kind);
  }
  const first: Kind[] = [
    "detached_basement",
    "apartment_section",
    "terraced",
    "detached_basement",
    "apartment_cooperative",
    "holiday_home",
    "semi_detached",
    "detached",
  ];
  for (const kind of first) pool.splice(pool.indexOf(kind), 1);
  shuffle(rng, pool);
  const converted = slots.filter((slot) => slot.status !== "unconverted").length;
  if (first.length + pool.length !== converted) {
    throw new Error("Antall eiendommer stemmer ikke med antall oppdrag.");
  }
  // De første slottene etter TD-0001 er ferdige eller fakturerte (se `buildSlots`)
  return [pool.shift() as Kind, ...first, ...pool];
}

function shuffle<T>(rng: SeededRandom, list: T[]): void {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    [list[i], list[j]] = [list[j] as T, list[i] as T];
  }
}

function createCadastre(rng: SeededRandom) {
  const used = new Set<string>();
  return {
    next(municipalityNumber: string) {
      for (;;) {
        const gnr = String(rng.int(TESTDATA_GNR_MIN, TESTDATA_GNR_MAX));
        const bnr = String(rng.int(1, 400));
        const key = `${municipalityNumber}-${gnr}-${bnr}`;
        if (!used.has(key)) {
          used.add(key);
          return { gnr, bnr };
        }
      }
    },
  };
}

function streetAddress(rng: SeededRandom): string {
  const letter = rng.next() < 0.2 ? ` ${rng.pick(["A", "B", "C"])}` : "";
  return `${rng.pick(TESTDATA_STREET_NAMES)} ${rng.int(1, 60)}${letter}`;
}

const KIND_SHAPE: Record<
  Kind,
  { housingType: HousingType; ownershipForm: OwnershipForm; years: [number, number] }
> = {
  detached: { housingType: "detached", ownershipForm: "freehold", years: [1955, 2016] },
  detached_basement: { housingType: "detached", ownershipForm: "freehold", years: [1950, 2010] },
  terraced: { housingType: "terraced", ownershipForm: "freehold", years: [1975, 2014] },
  semi_detached: { housingType: "semi_detached", ownershipForm: "freehold", years: [1962, 2012] },
  apartment_section: { housingType: "apartment", ownershipForm: "section", years: [1965, 2020] },
  apartment_cooperative: {
    housingType: "apartment",
    ownershipForm: "cooperative",
    years: [1960, 2008],
  },
  holiday_home: { housingType: "holiday_home", ownershipForm: "freehold", years: [1970, 2018] },
};

function buildProperty(
  rng: SeededRandom,
  kind: Kind,
  area: TestdataPostalArea,
  cadastre: ReturnType<typeof createCadastre>,
  anchorYear: number,
): TestdataProperty {
  const shape = KIND_SHAPE[kind];
  const { gnr, bnr } = cadastre.next(area.municipalityNumber);
  const snr = kind === "apartment_section" ? String(rng.int(1, 40)) : null;
  // Noen fritidsboliger står på festet tomt (festenummer)
  const fnr = kind === "holiday_home" && rng.next() < 0.4 ? String(rng.int(1, 20)) : null;
  const cooperative = kind === "apartment_cooperative";
  const buildYear = Math.min(rng.int(shape.years[0], shape.years[1]), anchorYear - 1);
  return {
    key: [area.municipalityNumber, gnr, bnr, fnr ?? "", snr ?? ""].join("-"),
    address: streetAddress(rng),
    postalCode: area.postalCode,
    city: area.postalPlace,
    municipalityNumber: area.municipalityNumber,
    municipalityName: area.municipalityName,
    housingType: shape.housingType,
    ownershipForm: shape.ownershipForm,
    gnr,
    bnr,
    fnr,
    snr,
    associationName: cooperative ? rng.pick(TESTDATA_HOUSING_ASSOCIATIONS) : null,
    associationOrgNumber: null,
    shareNumber: cooperative ? String(rng.int(1, 120)) : null,
    buildYear,
  };
}

function commonAreasFor(rng: SeededRandom, property: TestdataProperty): CommonAreasInput | null {
  if (property.ownershipForm !== "section" && property.ownershipForm !== "cooperative") {
    return null;
  }
  const status = ["yes", "no", "unknown"] as const;
  return {
    managingAgent: rng.pick(TESTDATA_MANAGING_AGENTS),
    conditionReportStatus: rng.pick(status),
    maintenancePlanStatus: rng.pick(status),
    notes: null,
  };
}

// --- Bygninger, etasjer, rom og areal ---------------------------------------------------------

function room(roomType: RoomType, name: string, floorBelowGround: boolean): TestdataRoom {
  return {
    roomType,
    name,
    areaType: suggestAreaType(roomType),
    belowGround: suggestBelowGround({ roomType, floorBelowGround }),
    yearRenovated: null,
  };
}

function floor(
  name: string,
  level: number,
  belowGround: boolean,
  area: TestdataFloorArea | null,
  rooms: readonly [RoomType, string][],
): TestdataFloor {
  return {
    name,
    level,
    belowGround,
    area,
    rooms: rooms.map(([roomType, roomName]) => room(roomType, roomName, belowGround)),
  };
}

function areaOf(
  values: Partial<Omit<TestdataFloorArea, "method">>,
  method: MeasuringMethod = "laser",
): TestdataFloorArea {
  return {
    braI: values.braI ?? null,
    braE: values.braE ?? null,
    braB: values.braB ?? null,
    alh: values.alh ?? null,
    method,
  };
}

/** Et tall med én desimal mellom `min` og `max`. */
function tenth(rng: SeededRandom, min: number, max: number): number {
  return rng.int(Math.round(min * 10), Math.round(max * 10)) / 10;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function bedrooms(count: number, from = 1): [RoomType, string][] {
  return Array.from({ length: count }, (_, i) => ["bedroom", `Soverom ${from + i}`]);
}

function buildBuildings(
  rng: SeededRandom,
  kind: Kind,
  property: TestdataProperty,
  anchorYear: number,
): TestdataBuilding[] {
  const buildings =
    kind === "apartment_section" || kind === "apartment_cooperative"
      ? apartmentBuildings(rng)
      : kind === "holiday_home"
        ? holidayBuildings(rng)
        : houseBuildings(rng, kind);

  // Badet: noen er pusset opp etter byggeåret
  const age = anchorYear - property.buildYear;
  for (const building of buildings) {
    for (const f of building.floors) {
      for (const r of f.rooms) {
        if (r.roomType === "bathroom" && age > 15 && rng.next() < 0.6) {
          r.yearRenovated = rng.int(Math.max(property.buildYear + 8, 1990), anchorYear - 1);
        }
      }
    }
  }
  return buildings;
}

function apartmentBuildings(rng: SeededRandom): TestdataBuilding[] {
  const braI = tenth(rng, 38, 100);
  const balcony = rng.next() < 0.35;
  const braB = balcony ? tenth(rng, 4, 8) : null;
  const level = rng.int(1, 6);
  const rooms: [RoomType, string][] = [["entrance", "Entré"]];
  if (rng.next() < 0.5) rooms.push(["living_kitchen", "Stue og kjøkken"]);
  else rooms.push(["living_room", "Stue"], ["kitchen", "Kjøkken"]);
  rooms.push(...bedrooms(braI < 50 ? 1 : braI < 75 ? 2 : 3));
  rooms.push(["bathroom", "Bad"]);
  if (braI >= 60) rooms.push(["storage", "Bod"]);
  if (balcony) rooms.push(["glazed_balcony", "Innglasset balkong"]);
  return [
    {
      name: "Leilighet",
      floors: [
        floor("Kjeller", -1, true, areaOf({ braE: tenth(rng, 3, 6) }, "drawing"), [
          ["external_storage", TESTDATA_SHARED_STORAGE_NAME],
        ]),
        floor(`${level}. etasje`, level, false, areaOf({ braI, braB }), rooms),
      ],
    },
  ];
}

function holidayBuildings(rng: SeededRandom): TestdataBuilding[] {
  const target = tenth(rng, 35, 110);
  const hems = target >= 50 && rng.next() < 0.5;
  const shed = rng.next() < 0.5;
  const shedArea = shed ? tenth(rng, 4, 8) : 0;
  const hemsArea = hems ? tenth(rng, 6, 12) : 0;
  const main = round1(Math.max(30, target - shedArea - hemsArea));
  const floors: TestdataFloor[] = [
    floor("1. etasje", 1, false, areaOf({ braI: main }), [
      ["entrance", "Gang"],
      ["living_kitchen", "Stue og kjøkken"],
      ...bedrooms(main < 50 ? 1 : main < 80 ? 2 : 3),
      ["bathroom", "Bad"],
    ]),
  ];
  if (hems) {
    floors.push(
      floor("Hems", 2, false, areaOf({ braI: hemsArea, alh: tenth(rng, 3, 7) }), [
        ["attic_living_room", "Hems"],
      ]),
    );
  }
  const buildings: TestdataBuilding[] = [{ name: "Hytte", floors }];
  if (shed) {
    buildings.push({
      name: "Uthus",
      floors: [
        floor("1. etasje", 1, false, areaOf({ braE: shedArea }), [["external_storage", "Utebod"]]),
      ],
    });
  }
  return buildings;
}

function houseBuildings(rng: SeededRandom, kind: Kind): TestdataBuilding[] {
  const detached = kind === "detached" || kind === "detached_basement";
  const basement = kind === "detached_basement";
  const target = detached ? tenth(rng, 110, 240) : tenth(rng, 92, 160);
  const garage = detached && rng.next() < 0.5;
  const shed = rng.next() < 0.4;
  const garageArea = garage ? tenth(rng, 18, 36) : 0;
  const shedArea = shed ? tenth(rng, 5, 10) : 0;
  const living = target - garageArea - shedArea;
  const twoStorey = !detached || living > 140 || rng.next() < 0.5;
  const basementArea = basement ? round1(living * 0.3) : 0;
  const upper = twoStorey ? round1((living - basementArea) * 0.45) : 0;
  const ground = round1(living - basementArea - upper);

  const floors: TestdataFloor[] = [];
  if (basement) {
    floors.push(
      floor("Kjeller", -1, true, areaOf({ braI: basementArea }), [
        ["basement_living_room", "Kjellerstue"],
        ["laundry", "Vaskerom"],
        ["technical_room", "Teknisk rom"],
        ["storage", "Kjellerbod"],
      ]),
    );
  } else if (detached && rng.next() < 0.5) {
    floors.push(floor("Kryperom", -1, false, null, [["crawl_space", "Kryperom"]]));
  }
  const groundRooms: [RoomType, string][] = [
    ["entrance", "Vindfang"],
    ["living_room", "Stue"],
    ["kitchen", "Kjøkken"],
    ["bathroom", "Bad"],
  ];
  if (twoStorey) {
    groundRooms.push(...bedrooms(1));
    floors.push(floor("1. etasje", 1, false, areaOf({ braI: ground }), groundRooms));
    floors.push(
      floor("2. etasje", 2, false, areaOf({ braI: upper }), [
        ["hallway", "Gang"],
        ...bedrooms(upper < 45 ? 2 : 3, 2),
        upper >= 50 ? ["bathroom", "Bad 2"] : ["toilet", "Toalett"],
      ]),
    );
  } else {
    groundRooms.push(...bedrooms(ground < 90 ? 2 : 3), ["toilet", "Toalett"]);
    floors.push(floor("1. etasje", 1, false, areaOf({ braI: ground }), groundRooms));
    if (rng.next() < 0.5) {
      floors.push(
        floor("Loft", 2, false, areaOf({ alh: tenth(rng, 8, 20) }), [["unfinished_attic", "Loft"]]),
      );
    }
  }

  const name =
    kind === "terraced" ? "Rekkehus" : kind === "semi_detached" ? "Tomannsbolig" : "Bolig";
  const buildings: TestdataBuilding[] = [{ name, floors }];
  if (garage) {
    buildings.push({
      name: "Garasje",
      floors: [floor("1. etasje", 1, false, areaOf({ braE: garageArea }), [["garage", "Garasje"]])],
    });
  }
  if (shed) {
    buildings.push({
      name: "Uthus",
      floors: [
        floor("1. etasje", 1, false, areaOf({ braE: shedArea }), [["external_storage", "Utebod"]]),
      ],
    });
  }
  return buildings;
}

/**
 * Aldersreglene for bad (A300): minst ett bad fra før 2000, ett på 0–5 år og ett nær en
 * levetidsterskel (rundt 20 år). Settes på de første befarte boligene hvis tilfeldighetene ikke
 * ga dem.
 */
function ensureBathroomAges(orders: readonly TestdataOrder[], anchorYear: number): void {
  const inspected = orders
    .map((order) => (order.converted ? order.converted.assignment : null))
    .filter((a): a is TestdataAssignment => a !== null && a.buildings.length > 0);
  const firstBath = (a: TestdataAssignment) =>
    a.buildings
      .flatMap((b) => b.floors.flatMap((f) => f.rooms))
      .find((r) => r.roomType === "bathroom");
  const bathYear = (a: TestdataAssignment) => firstBath(a)?.yearRenovated ?? a.property.buildYear;
  const ages = () => inspected.map((a) => anchorYear - bathYear(a));

  const [old, fresh, threshold] = inspected;
  if (old && !inspected.some((a) => bathYear(a) < 2000)) {
    old.property.buildYear = Math.min(old.property.buildYear, 1984);
    const bath = firstBath(old);
    if (bath) bath.yearRenovated = null;
  }
  if (fresh && !ages().some((age) => age >= 0 && age <= 5)) {
    const bath = firstBath(fresh);
    if (bath) {
      fresh.property.buildYear = Math.min(fresh.property.buildYear, anchorYear - 2);
      bath.yearRenovated = anchorYear - 2;
    }
  }
  if (threshold && !ages().some((age) => age >= 18 && age <= 22)) {
    const bath = firstBath(threshold);
    if (bath) {
      threshold.property.buildYear = Math.min(threshold.property.buildYear, anchorYear - 19);
      bath.yearRenovated = anchorYear - 19;
    }
  }
}

/** Minst én fritidsbolig står på festet tomt (festenummer). */
function ensureLeasedHolidayHome(orders: readonly TestdataOrder[]): void {
  const holidayHomes = orders
    .map((order) => (order.converted ? order.converted.assignment.property : null))
    .filter((p): p is TestdataProperty => p !== null && p.housingType === "holiday_home");
  const first = holidayHomes[0];
  if (!first || holidayHomes.some((p) => p.fnr !== null)) return;
  // Gnr og bnr er unike i kommunen, så nøkkelen er fortsatt unik
  first.fnr = "1";
  first.key = [first.municipalityNumber, first.gnr, first.bnr, first.fnr, first.snr ?? ""].join(
    "-",
  );
}

// --- Arbeidsøkter ---------------------------------------------------------------------------

/** Minutter for befaring og rapport: leilighet lavest, enebolig med kjeller høyest. */
const SESSION_MINUTES: Record<Kind, { inspection: [number, number]; office: [number, number] }> = {
  apartment_section: { inspection: [60, 90], office: [120, 180] },
  apartment_cooperative: { inspection: [60, 90], office: [120, 180] },
  holiday_home: { inspection: [75, 120], office: [150, 210] },
  terraced: { inspection: [90, 135], office: [180, 240] },
  semi_detached: { inspection: [90, 135], office: [180, 240] },
  detached: { inspection: [105, 150], office: [195, 255] },
  detached_basement: { inspection: [150, 180], office: [255, 300] },
};

function quarterMinutes(rng: SeededRandom, [min, max]: [number, number]): number {
  return rng.int(min / 15, max / 15) * 15;
}

function buildWorkSessions(
  rng: SeededRandom,
  kind: Kind,
  slot: Slot,
  employeeKey: string,
  at: (days: number) => Date,
): TestdataWorkSession[] {
  if (slot.inspection === null) return [];
  const minutes = SESSION_MINUTES[kind];
  const inspectionMinutes = quarterMinutes(rng, minutes.inspection);
  const officeMinutes = quarterMinutes(rng, minutes.office);
  const inspectionStart = slot.inspection;
  // Rapporten skrives dagen etter befaringen, fra 07:30 UTC (før ferdig-dagen)
  const officeStart = Math.floor(slot.inspection) + 1 + clock(7, 30);
  const minute = 1 / (24 * 60);
  return [
    {
      employeeKey,
      phase: "inspection",
      startedAt: at(inspectionStart),
      endedAt: at(inspectionStart + inspectionMinutes * minute),
    },
    {
      employeeKey,
      phase: "office",
      startedAt: at(officeStart),
      endedAt: at(officeStart + officeMinutes * minute),
    },
  ];
}

// --- Reklamasjoner --------------------------------------------------------------------------

function matchesTarget(assignment: TestdataAssignment, target: TestdataClaimTarget): boolean {
  if (target === "any") return true;
  const house = ["detached", "semi_detached", "terraced"].includes(assignment.property.housingType);
  if (target === "house") return house;
  return (
    house && assignment.buildings.some((building) => building.floors.some((f) => f.belowGround))
  );
}

function addClaims(
  rng: SeededRandom,
  orders: readonly TestdataOrder[],
  managers: readonly TestdataEmployee[],
  people: ReturnType<typeof createPeople>,
  at: (days: number) => Date,
  isoDate: (days: number) => string,
): void {
  const base = at(0).getTime();
  const dayOf = (date: Date) => (date.getTime() - base) / DAY_MS;
  const candidates = orders
    .map((order) => (order.converted ? order.converted.assignment : null))
    .filter((a): a is TestdataAssignment => {
      if (a === null || (a.status !== "completed" && a.status !== "invoiced")) return false;
      const completed = a.statusTimes.find((s) => s.toStatus === "completed");
      return completed !== undefined && dayOf(completed.at) <= -20;
    });
  const used = new Set<TestdataAssignment>();

  for (const seed of TESTDATA_CLAIMS) {
    const assignment =
      candidates.find((a) => !used.has(a) && matchesTarget(a, seed.target)) ??
      candidates.find((a) => !used.has(a));
    if (!assignment) throw new Error("For få ferdige oppdrag til reklamasjonene.");
    used.add(assignment);

    const completedDay = Math.floor(
      dayOf(assignment.statusTimes.find((s) => s.toStatus === "completed")!.at),
    );
    const receivedDay = Math.min(completedDay + rng.int(7, 40), -6);
    const registered = receivedDay + clock(rng.int(8, 12));
    const closedDay = Math.min(receivedDay + rng.int(4, 20), -1);

    const buyer = people.next(rng);
    const parties = assignment.parties as TestdataParty[];
    parties.push({
      role: "buyer",
      name: buyer.name,
      firmName: null,
      email: buyer.email,
      phone: buyer.phone,
      ...defaultReceives("buyer"),
      contactKey: null,
    });

    const claim: TestdataClaim = {
      createdByKey: rng.pick(managers).key,
      claimType: seed.claimType,
      receivedAt: isoDate(receivedDay),
      registeredAt: at(registered),
      claimantPartyRole: "buyer",
      description: seed.description,
      buildingPartText: seed.buildingPartText,
      outcome: seed.outcome,
      amount: seed.amount,
      closedAt: seed.outcome === "open" ? null : at(closedDay + clock(11)),
    };
    assignment.claim = claim;
  }
}
