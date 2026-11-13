import type { AssignmentStatus, PartyRole } from "@/core/assignments";
import type { AreaType, RoomType } from "@/core/buildings";
import type { ClaimOutcome, ClaimType } from "@/core/claims";
import type { FirmType } from "@/core/contacts";
import type {
  CommonAreasInput,
  HousingType,
  OwnershipForm,
  PropertyInput,
} from "@/core/properties";
import type { WorkPhase } from "@/core/work-sessions";
import type { EmployeeRole } from "@/db/schema";
import type {
  SampleBuilding,
  SampleFloor,
  SampleFloorArea,
  SampleParty,
  SampleRoom,
} from "./sample-assignments.data";

/*
 * Testdata som ligner en ekte arbeidshverdag (docs/funksjoner/fase2a-testdata-arbeidshverdag.md).
 * Bare data og typer: ingen database, ingen tilfeldighet og ingen klokke. Alle datoer er hele dager
 * relativt til datoankeret (dag 0 = dagen ordren `TD-0001` ble laget). Seed-steget
 * (`testdata.ts`) gjør dem om til datoer.
 *
 * Alt er oppdiktet og kan ikke forveksles med ekte personer (A301):
 * - e-post på `testdata.invalid` (RFC 2606: kan aldri motta post),
 * - telefon i formen `+47 000 NN NNN` (se `TESTDATA_PHONE_PATTERN`),
 * - gårdsnummer 9001–9099, oppdiktede gatenavn og etternavn som starter på «Test»,
 * - ekte postnummer og kommune i Nordland og Troms, slik at kart og kommune ser riktige ut.
 *
 * Fagstoffet følger kortet: arealtype etter romtypens standard (`suggestAreaType`), ALH bare på
 * loft og hems, eierform og matrikkel henger sammen, og reklamasjonene har egne ord uten TG.
 * Byggeår og badets år har ingen kolonne ennå (A300); de står her for aldersreglene som kommer.
 */

/** Fast frø for generatoren i `seeded-random.ts`. Endres ikke, ellers endres testdataene. */
export const TESTDATA_SEED = 20_261_113;

/** E-postdomenet for alle oppdiktede personer. `.invalid` kan aldri motta post (RFC 2606). */
export const TESTDATA_EMAIL_DOMAIN = "testdata.invalid";

/**
 * Telefonnummer i testdataene: `+47 000 NN NNN`. I den norske nummerplanen (Nkom) starter
 * åttesifrede nummer på 2–9; nummer som starter på 0 er femsifrede tjenestenummer, så
 * `000 NN NNN` er ikke et abonnentnummer. Mønsteret passer valideringen i
 * `src/core/contacts/schemas.ts` (sifre, mellomrom og +, under 20 tegn), og vasken før KI fanger
 * det (ti sifre, `+47` normaliseres bort til åtte). Ikke kontrollert mot nummerplanen (A301).
 */
export const TESTDATA_PHONE_PATTERN = /^\+47 000 \d{2} \d{3}$/;

/**
 * Gårdsnummer i testdataene, både på eiendom og ordre. At ingen av kommunene under har så høye
 * gårdsnummer, er ikke kontrollert mot matrikkelen (A301).
 */
export const TESTDATA_GNR_RANGE = [9001, 9099] as const;

export type TestdataMunicipality = {
  postalCode: string;
  postalPlace: string;
  municipalityNumber: string;
  municipalityName: string;
};

/** Ekte par av postnummer og kommune i Nordland (18xx) og Troms (55xx). */
export const TESTDATA_MUNICIPALITIES: readonly TestdataMunicipality[] = [
  { postalCode: "8008", postalPlace: "Bodø", municipalityNumber: "1804", municipalityName: "Bodø" },
  { postalCode: "8015", postalPlace: "Bodø", municipalityNumber: "1804", municipalityName: "Bodø" },
  {
    postalCode: "8514",
    postalPlace: "Narvik",
    municipalityNumber: "1806",
    municipalityName: "Narvik",
  },
  {
    postalCode: "8610",
    postalPlace: "Mo i Rana",
    municipalityNumber: "1833",
    municipalityName: "Rana",
  },
  {
    postalCode: "8657",
    postalPlace: "Mosjøen",
    municipalityNumber: "1824",
    municipalityName: "Vefsn",
  },
  {
    postalCode: "8200",
    postalPlace: "Fauske",
    municipalityNumber: "1841",
    municipalityName: "Fauske",
  },
  {
    postalCode: "8250",
    postalPlace: "Rognan",
    municipalityNumber: "1840",
    municipalityName: "Saltdal",
  },
  {
    postalCode: "8300",
    postalPlace: "Svolvær",
    municipalityNumber: "1865",
    municipalityName: "Vågan",
  },
  {
    postalCode: "8800",
    postalPlace: "Sandnessjøen",
    municipalityNumber: "1820",
    municipalityName: "Alstahaug",
  },
  {
    postalCode: "9008",
    postalPlace: "Tromsø",
    municipalityNumber: "5501",
    municipalityName: "Tromsø",
  },
  {
    postalCode: "9020",
    postalPlace: "Tromsdalen",
    municipalityNumber: "5501",
    municipalityName: "Tromsø",
  },
  {
    postalCode: "9405",
    postalPlace: "Harstad",
    municipalityNumber: "5503",
    municipalityName: "Harstad",
  },
  {
    postalCode: "9300",
    postalPlace: "Finnsnes",
    municipalityNumber: "5530",
    municipalityName: "Senja",
  },
  {
    postalCode: "9325",
    postalPlace: "Bardufoss",
    municipalityNumber: "5524",
    municipalityName: "Målselv",
  },
];

/** Oppdiktede etternavn. «Test» foran gjør dem lette å kjenne igjen i lister. */
export const TESTDATA_SURNAMES = [
  "Testvik",
  "Testmo",
  "Testberg",
  "Testlund",
  "Testnes",
  "Testøy",
  "Testli",
  "Testdal",
  "Testhaug",
  "Teststrand",
  "Testbakken",
  "Testrud",
  "Testheim",
  "Testvoll",
  "Testås",
  "Testmyr",
  "Testskog",
  "Testfjord",
  "Testland",
  "Testsæter",
  "Testnæss",
  "Testeng",
  "Testbø",
  "Testsund",
] as const;

/** Oppdiktede gatenavn. Brukes med ekte postnummer og kommune. */
export const TESTDATA_STREETS = [
  "Krykkjeløkka",
  "Lomvitunet",
  "Havhestgata",
  "Teistebakken",
  "Ærfugltråkket",
  "Polarmåkevegen",
  "Fjæreplyttvegen",
  "Myrsnipeveien",
  "Steinvenderstien",
  "Sjøorrebakken",
  "Havelleflaten",
  "Gråmåkelia",
  "Smålomvegen",
  "Svartbakgata",
  "Tyvjoveien",
  "Lirypestien",
  "Fjellvåkbakken",
  "Dvergspurvvegen",
] as const;

/** Fornavn på selgere og kjøpere. Ingen av dem brukes av ansatte eller meglere. */
const PARTY_FIRST_NAMES = [
  "Kari",
  "Ola",
  "Per",
  "Nina",
  "Jon",
  "Eva",
  "Lars",
  "Anne",
  "Geir",
  "Heidi",
  "Trond",
  "Kristin",
  "Rune",
  "Linda",
  "Stian",
  "Mona",
  "Arne",
  "Randi",
  "Espen",
  "Turid",
  "Kjetil",
  "Bente",
  "Svein",
  "Elin",
  "Terje",
  "Gro",
  "Frode",
  "Wenche",
  "Odd",
  "Hege",
] as const;

// ---------------------------------------------------------------------------------------------
// Hjelpere (rene funksjoner)
// ---------------------------------------------------------------------------------------------

/** Element nummer `index` (rundt), og feil hvis lista er tom. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[((index % list.length) + list.length) % list.length];
  if (value === undefined) throw new Error("testdata: tom liste");
  return value;
}

/** E-post for et oppdiktet navn: små bokstaver, æøå skrevet om, punktum mellom navnene. */
function testdataEmail(name: string): string {
  const local = name
    .toLocaleLowerCase("nb")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/\s+/g, ".")
    .replace(/[^a-z.]/g, "");
  return `${local}@${TESTDATA_EMAIL_DOMAIN}`;
}

/** Telefon etter `TESTDATA_PHONE_PATTERN`: serien (10–99) og løpenummeret (0–999). */
function testdataPhone(series: number, serial: number): string {
  return `+47 000 ${String(series).padStart(2, "0")} ${String(serial).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------------------------
// Ansatte
// ---------------------------------------------------------------------------------------------

export type TestdataCertification = {
  /** Oppdiktet utsteder (A307). */
  issuer: string;
  /** Oppdiktet sertifikatnummer (A307). */
  number: string;
  validFromDay: number;
  /** Siste gyldige dag. */
  validToDay: number;
};

export type TestdataEmployee = {
  /** Fast nøkkel i datafila. Lagres ikke; raden kjennes igjen på e-posten. */
  key: string;
  name: string;
  email: string;
  phone: string;
  roles: readonly EmployeeRole[];
  /** Navnet på selskapet slik `runSeed` lager det (`companies.legal_name`). */
  companyName: string;
  /** Navnet på kontoret slik `runSeed` lager det. */
  officeName: string;
  certification?: TestdataCertification;
};

const CERT_ISSUER = "Oppdiktet sertifiseringsorgan";

function employee(
  key: string,
  name: string,
  serial: number,
  roles: readonly EmployeeRole[],
  companyName: string,
  officeName: string,
  certification?: { validFromDay: number; validToDay: number },
): TestdataEmployee {
  const base = {
    key,
    name,
    email: testdataEmail(name),
    phone: testdataPhone(10, serial),
    roles,
    companyName,
    officeName,
  };
  if (!certification) return base;
  return {
    ...base,
    certification: {
      issuer: CERT_ISSUER,
      number: `TD-SERT-${String(serial).padStart(3, "0")}`,
      ...certification,
    },
  };
}

/**
 * Tolv oppdiktede ansatte i alle roller unntatt admin (A304). Takstmennene har gyldig
 * sertifisering for alle befaringsdagene i dataene (dag −120 til +28), unntatt `emp10`, som har
 * utløpt sertifisering og derfor aldri er ansvarlig takstmann, bare sidemann.
 */
export const TESTDATA_EMPLOYEES: readonly TestdataEmployee[] = [
  employee("emp01", "Kristian Testvik", 101, ["inspector"], "Byggcon AS", "Bodø", {
    validFromDay: -820,
    validToDay: 640,
  }),
  employee("emp02", "Silje Testmo", 102, ["inspector"], "Byggcon AS", "Bodø", {
    validFromDay: -400,
    validToDay: 330,
  }),
  employee("emp03", "Anders Testberg", 103, ["inspector"], "Byggcon AS", "Bodø", {
    validFromDay: -1100,
    validToDay: 360,
  }),
  employee("emp04", "Hanne Testlund", 104, ["office"], "Byggcon AS", "Bodø"),
  employee("emp05", "Morten Testnes", 105, ["manager"], "Byggcon AS", "Bodø"),
  employee("emp06", "Ingrid Testøy", 106, ["inspector"], "Byggcon Nord AS", "Narvik", {
    validFromDay: -600,
    validToDay: 500,
  }),
  employee("emp07", "Eirik Testli", 107, ["inspector"], "Byggcon Helgeland AS", "Mo i Rana", {
    validFromDay: -250,
    validToDay: 840,
  }),
  employee("emp08", "Marte Testdal", 108, ["office"], "Byggcon Helgeland AS", "Mo i Rana"),
  employee("emp09", "Jonas Testhaug", 109, ["inspector"], "Byggcon Helgeland AS", "Mosjøen", {
    validFromDay: -700,
    validToDay: 400,
  }),
  employee("emp10", "Tone Teststrand", 110, ["inspector"], "Byggcon Troms AS", "Tromsø", {
    validFromDay: -1460,
    validToDay: -12,
  }),
  employee("emp11", "Henrik Testbakken", 111, ["office"], "Byggcon Troms AS", "Tromsø"),
  employee(
    "emp12",
    "Ragnhild Testrud",
    112,
    ["manager", "inspector"],
    "Byggcon Troms AS",
    "Tromsø",
    { validFromDay: -950, validToDay: 450 },
  ),
];

/** Takstmenn med gyldig sertifisering: de eneste som er ansvarlige på oppdragene. */
const RESPONSIBLE_KEYS = ["emp01", "emp02", "emp03", "emp06", "emp07", "emp09", "emp12"] as const;
/** Alle takstmenn, også den med utløpt sertifisering. Brukes som sidemann. */
const SECOND_KEYS = [
  "emp01",
  "emp02",
  "emp03",
  "emp06",
  "emp07",
  "emp09",
  "emp10",
  "emp12",
] as const;

// ---------------------------------------------------------------------------------------------
// Meglerfirma og meglere
// ---------------------------------------------------------------------------------------------

export type TestdataBroker = { name: string; email: string; phone: string };

export type TestdataFirm = {
  name: string;
  firmType: FirmType;
  /** Ingen organisasjonsnummer (A301). */
  brokers: readonly TestdataBroker[];
};

function broker(name: string, serial: number): TestdataBroker {
  return { name, email: testdataEmail(name), phone: testdataPhone(20, serial) };
}

/** Fem oppdiktede meglerfirma med to meglere hver. Navnene ligner ikke kjente kjeder. */
export const TESTDATA_FIRMS: readonly TestdataFirm[] = [
  {
    name: "Lomvi Eiendomsmegling AS",
    firmType: "broker_firm",
    brokers: [broker("Lise Testheim", 101), broker("Even Testvoll", 102)],
  },
  {
    name: "Krykkje Bolig AS",
    firmType: "broker_firm",
    brokers: [broker("Nora Testås", 103), broker("Sindre Testmyr", 104)],
  },
  {
    name: "Tjeld og Teist Megling AS",
    firmType: "broker_firm",
    brokers: [broker("Camilla Testskog", 105), broker("Vegard Testfjord", 106)],
  },
  {
    name: "Havhest Eiendom AS",
    firmType: "broker_firm",
    brokers: [broker("Ida Testland", 107), broker("Håkon Testsæter", 108)],
  },
  {
    name: "Ærfugl Boligformidling AS",
    firmType: "broker_firm",
    brokers: [broker("Mari Testnæss", 109), broker("Øystein Testeng", 110)],
  },
];

const ALL_BROKERS = TESTDATA_FIRMS.flatMap((firm) =>
  firm.brokers.map((item) => ({ ...item, firmName: firm.name })),
);

// ---------------------------------------------------------------------------------------------
// Eiendommer
// ---------------------------------------------------------------------------------------------

export type TestdataPropertyKind = "detached" | "apartment" | "holiday";

export type TestdataProperty = {
  /** Fast nøkkel i datafila. Raden kjennes igjen på kommune + gnr + bnr (+ fnr/snr). */
  key: string;
  kind: TestdataPropertyKind;
  housingType: HousingType;
  ownershipForm: OwnershipForm;
  /** Gateadressen med husnummer (og bokstav), uten postnummer. */
  street: string;
  postalCode: string;
  municipalityNumber: string;
  gnr: string;
  bnr: string;
  fnr?: string;
  snr?: string;
  /** Borettslagets navn, bare for andel i borettslag. */
  cooperativeName?: string;
  /** Andelsnummer, bare for andel i borettslag. */
  shareNumber?: string;
  /** Byggeår for hovedbygningen. Ingen kolonne ennå (A300). */
  buildYear: number;
  /** Året badet ble bygget eller sist pusset opp. Ingen kolonne ennå (A300). */
  bathroomYear: number;
  /** Fellesdelene, bare for sameie og borettslag. */
  commonAreas?: CommonAreasInput;
  buildings: readonly SampleBuilding[];
};

function room(
  roomType: RoomType,
  name: string,
  areaType: AreaType,
  belowGround: boolean,
  yearRenovated?: number,
): SampleRoom {
  return yearRenovated === undefined
    ? { roomType, name, areaType, belowGround }
    : { roomType, name, areaType, belowGround, yearRenovated };
}

function floor(
  name: string,
  level: number,
  belowGround: boolean,
  area: SampleFloorArea,
  rooms: readonly SampleRoom[],
): SampleFloor {
  return { name, level, belowGround, area, rooms };
}

/** Badet. Året står på rommet bare når badet er yngre enn bygningen. */
function bathroom(buildYear: number, bathroomYear: number, name = "Bad"): SampleRoom {
  return room(
    "bathroom",
    name,
    "bra_i",
    false,
    bathroomYear > buildYear ? bathroomYear : undefined,
  );
}

function bedrooms(count: number, first = 1): SampleRoom[] {
  return Array.from({ length: count }, (_, index) =>
    room(
      "bedroom",
      count === 1 && first === 1 ? "Soverom" : `Soverom ${first + index}`,
      "bra_i",
      false,
    ),
  );
}

function outbuilding(kind: "garage" | "shed", yearBuilt: number, area: number): SampleBuilding {
  const isGarage = kind === "garage";
  return {
    name: isGarage ? "Garasje" : "Utebod",
    yearBuilt,
    floors: [
      floor("1. etasje", 1, false, { braE: area, method: "laser" }, [
        room(
          isGarage ? "garage" : "external_storage",
          isGarage ? "Garasje" : "Utebod",
          "bra_e",
          false,
        ),
      ]),
    ],
  };
}

type DetachedSpec = {
  housingType: Extract<HousingType, "detached" | "terraced" | "semi_detached">;
  /**
   * basement: kjeller, 1. og 2. etasje · single: én etasje med kryperom, ev. uinnredet loft ·
   * attic: 1. etasje og loftstue · two_storey: rekkehus i to etasjer.
   */
  layout: "basement" | "single" | "attic" | "two_storey";
  street: number;
  houseNumber: string;
  postalCode: string;
  bnr: string;
  buildYear: number;
  bathroomYear: number;
  basement?: number;
  first: number;
  second?: number;
  /** BRA-i på loftet (loftstue). */
  loft?: number;
  /** ALH på uinnredet loft (ikke BRA). */
  loftAlh?: number;
  garage?: number;
  shed?: number;
};

function detachedMain(spec: DetachedSpec): SampleBuilding {
  const { buildYear, bathroomYear } = spec;
  const floors: SampleFloor[] = [];
  if (spec.layout === "basement") {
    floors.push(
      floor("Kjeller", -1, true, { braI: spec.basement ?? 0, method: "laser" }, [
        room("basement_living_room", "Kjellerstue", "bra_i", true),
        room("laundry", "Vaskerom", "bra_i", true),
        room("technical_room", "Teknisk rom", "bra_i", true),
        room("storage", "Kjellerbod", "bra_i", true),
      ]),
      floor("1. etasje", 1, false, { braI: spec.first, method: "laser" }, [
        room("entrance", "Vindfang", "bra_i", false),
        room("living_room", "Stue", "bra_i", false),
        room("kitchen", "Kjøkken", "bra_i", false),
        bathroom(buildYear, bathroomYear),
        room("bedroom", "Soverom 1", "bra_i", false),
      ]),
      floor("2. etasje", 2, false, { braI: spec.second ?? 0, method: "laser" }, [
        room("hallway", "Gang", "bra_i", false),
        ...bedrooms(2, 2),
        room("toilet", "Toalett", "bra_i", false),
      ]),
    );
  } else if (spec.layout === "single") {
    floors.push(
      floor("1. etasje", 1, false, { braI: spec.first, method: "laser" }, [
        room("entrance", "Entré", "bra_i", false),
        room("living_room", "Stue", "bra_i", false),
        room("kitchen", "Kjøkken", "bra_i", false),
        bathroom(buildYear, bathroomYear),
        room("laundry", "Vaskerom", "bra_i", false),
        ...bedrooms(3),
        room("crawl_space", "Kryperom", "not_bra", false),
      ]),
    );
    if (spec.loftAlh !== undefined) {
      floors.push(
        floor("Loft", 2, false, { alh: spec.loftAlh, method: "laser" }, [
          room("unfinished_attic", "Loft", "not_bra", false),
        ]),
      );
    }
  } else if (spec.layout === "attic") {
    floors.push(
      floor("1. etasje", 1, false, { braI: spec.first, method: "laser" }, [
        room("entrance", "Gang", "bra_i", false),
        room("living_room", "Stue", "bra_i", false),
        room("kitchen", "Kjøkken", "bra_i", false),
        bathroom(buildYear, bathroomYear),
        room("bedroom", "Soverom 1", "bra_i", false),
      ]),
      floor("Loft", 2, false, { braI: spec.loft ?? 0, method: "laser" }, [
        room("attic_living_room", "Loftstue", "bra_i", false),
        ...bedrooms(2, 2),
      ]),
    );
  } else {
    floors.push(
      floor("1. etasje", 1, false, { braI: spec.first, method: "laser" }, [
        room("entrance", "Entré", "bra_i", false),
        room("living_kitchen", "Stue og kjøkken", "bra_i", false),
        room("toilet", "Toalett", "bra_i", false),
        room("storage", "Bod", "bra_i", false),
      ]),
      floor("2. etasje", 2, false, { braI: spec.second ?? 0, method: "laser" }, [
        room("hallway", "Gang", "bra_i", false),
        ...bedrooms(2),
        bathroom(buildYear, bathroomYear),
      ]),
    );
  }
  return { name: "Bolig", yearBuilt: buildYear, floors };
}

const DETACHED_SPECS: readonly DetachedSpec[] = [
  {
    housingType: "detached",
    layout: "basement",
    street: 0,
    houseNumber: "4",
    postalCode: "8008",
    bnr: "12",
    buildYear: 1978,
    bathroomYear: 1998,
    basement: 48,
    first: 74,
    second: 58,
    garage: 28,
  },
  {
    housingType: "detached",
    layout: "single",
    street: 1,
    houseNumber: "11",
    postalCode: "8015",
    bnr: "3",
    buildYear: 1985,
    bathroomYear: 2010,
    first: 128,
    loftAlh: 30,
    garage: 36,
  },
  {
    housingType: "detached",
    layout: "attic",
    street: 2,
    houseNumber: "7",
    postalCode: "8514",
    bnr: "21",
    buildYear: 1956,
    bathroomYear: 1994,
    first: 76,
    loft: 42,
  },
  {
    housingType: "detached",
    layout: "basement",
    street: 3,
    houseNumber: "15",
    postalCode: "8610",
    bnr: "8",
    buildYear: 1969,
    bathroomYear: 2023,
    basement: 52,
    first: 68,
    second: 54,
  },
  {
    housingType: "detached",
    layout: "single",
    street: 4,
    houseNumber: "2",
    postalCode: "8657",
    bnr: "40",
    buildYear: 2008,
    bathroomYear: 2008,
    first: 142,
    garage: 32,
  },
  {
    housingType: "detached",
    layout: "basement",
    street: 5,
    houseNumber: "23",
    postalCode: "9008",
    bnr: "17",
    buildYear: 1990,
    bathroomYear: 2004,
    basement: 60,
    first: 82,
    second: 64,
    garage: 40,
  },
  {
    housingType: "detached",
    layout: "attic",
    street: 6,
    houseNumber: "9",
    postalCode: "8200",
    bnr: "5",
    buildYear: 1938,
    bathroomYear: 1989,
    first: 64,
    loft: 38,
    shed: 8,
  },
  {
    housingType: "detached",
    layout: "single",
    street: 7,
    houseNumber: "31",
    postalCode: "9405",
    bnr: "26",
    buildYear: 1974,
    bathroomYear: 2016,
    first: 112,
    loftAlh: 24,
  },
  {
    housingType: "detached",
    layout: "basement",
    street: 8,
    houseNumber: "6",
    postalCode: "8008",
    bnr: "9",
    buildYear: 2001,
    bathroomYear: 2001,
    basement: 46,
    first: 70,
    second: 60,
  },
  {
    housingType: "detached",
    layout: "attic",
    street: 9,
    houseNumber: "14",
    postalCode: "8800",
    bnr: "2",
    buildYear: 1925,
    bathroomYear: 2021,
    first: 70,
    loft: 46,
    garage: 24,
  },
  {
    housingType: "detached",
    layout: "single",
    street: 10,
    houseNumber: "3",
    postalCode: "9020",
    bnr: "19",
    buildYear: 2019,
    bathroomYear: 2019,
    first: 148,
  },
  {
    housingType: "detached",
    layout: "basement",
    street: 11,
    houseNumber: "18",
    postalCode: "8015",
    bnr: "34",
    buildYear: 1962,
    bathroomYear: 1996,
    basement: 44,
    first: 66,
    second: 50,
  },
  {
    housingType: "detached",
    layout: "single",
    street: 12,
    houseNumber: "27",
    postalCode: "8610",
    bnr: "11",
    buildYear: 1983,
    bathroomYear: 2024,
    first: 118,
    loftAlh: 26,
    garage: 30,
  },
  {
    housingType: "detached",
    layout: "attic",
    street: 13,
    houseNumber: "5",
    postalCode: "9300",
    bnr: "7",
    buildYear: 1912,
    bathroomYear: 2012,
    first: 58,
    loft: 36,
  },
  {
    housingType: "detached",
    layout: "basement",
    street: 14,
    houseNumber: "12",
    postalCode: "8514",
    bnr: "28",
    buildYear: 1995,
    bathroomYear: 2022,
    basement: 56,
    first: 78,
    second: 62,
    garage: 34,
  },
  {
    housingType: "detached",
    layout: "single",
    street: 15,
    houseNumber: "8",
    postalCode: "9008",
    bnr: "15",
    buildYear: 2023,
    bathroomYear: 2023,
    first: 132,
  },
  {
    housingType: "terraced",
    layout: "two_storey",
    street: 16,
    houseNumber: "10 C",
    postalCode: "8008",
    bnr: "44",
    buildYear: 1988,
    bathroomYear: 2009,
    first: 52,
    second: 46,
    shed: 6,
  },
  {
    housingType: "terraced",
    layout: "two_storey",
    street: 17,
    houseNumber: "2 B",
    postalCode: "9020",
    bnr: "6",
    buildYear: 2015,
    bathroomYear: 2015,
    first: 56,
    second: 50,
    shed: 5,
  },
  {
    housingType: "semi_detached",
    layout: "basement",
    street: 0,
    houseNumber: "21 A",
    postalCode: "8657",
    bnr: "13",
    buildYear: 1972,
    bathroomYear: 1999,
    basement: 40,
    first: 58,
    second: 52,
  },
  {
    housingType: "semi_detached",
    layout: "attic",
    street: 3,
    houseNumber: "9 B",
    postalCode: "8200",
    bnr: "30",
    buildYear: 2005,
    bathroomYear: 2020,
    first: 62,
    loft: 40,
  },
];

type ApartmentSpec = {
  ownershipForm: Extract<OwnershipForm, "section" | "cooperative">;
  street: number;
  houseNumber: string;
  postalCode: string;
  gnr: number;
  bnr: string;
  snr?: string;
  cooperativeName?: string;
  shareNumber?: string;
  buildYear: number;
  bathroomYear: number;
  level: number;
  braI: number;
  /** BRA-b for innglasset balkong. */
  balcony?: number;
  /** BRA-e for boden i fellesarealet, målt fra tegning. */
  storage?: number;
  bedrooms: number;
  openKitchen: boolean;
  managingAgent: string;
};

function apartmentBuilding(spec: ApartmentSpec): SampleBuilding {
  const floors: SampleFloor[] = [];
  if (spec.storage !== undefined) {
    floors.push(
      floor("Kjeller", -1, true, { braE: spec.storage, method: "drawing" }, [
        room("external_storage", "Kjellerbod", "bra_e", true),
      ]),
    );
  }
  const area: SampleFloorArea =
    spec.balcony === undefined
      ? { braI: spec.braI, method: "laser" }
      : { braI: spec.braI, braB: spec.balcony, method: "laser" };
  floors.push(
    floor(`${spec.level}. etasje`, spec.level, false, area, [
      room("entrance", "Entré", "bra_i", false),
      ...(spec.openKitchen
        ? [room("living_kitchen", "Stue og kjøkken", "bra_i", false)]
        : [
            room("living_room", "Stue", "bra_i", false),
            room("kitchen", "Kjøkken", "bra_i", false),
          ]),
      ...bedrooms(spec.bedrooms),
      bathroom(spec.buildYear, spec.bathroomYear),
      ...(spec.balcony === undefined
        ? []
        : [room("glazed_balcony", "Innglasset balkong", "bra_b", false)]),
    ]),
  );
  return { name: "Leilighet", yearBuilt: spec.buildYear, floors };
}

const AGENT_A = "Fjellvåk Forvaltning AS";
const AGENT_B = "Snøspurv Boligforvaltning AS";

/** Sameie: samme gnr/bnr i samme bygg, ulikt seksjonsnummer, ingen andel. */
const SECTION_SPECS: readonly ApartmentSpec[] = [
  {
    ownershipForm: "section",
    street: 1,
    houseNumber: "14 A",
    postalCode: "8008",
    gnr: 9021,
    bnr: "14",
    snr: "3",
    buildYear: 2004,
    bathroomYear: 2004,
    level: 3,
    braI: 68,
    balcony: 7.5,
    storage: 4.5,
    bedrooms: 2,
    openKitchen: true,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "section",
    street: 1,
    houseNumber: "14 B",
    postalCode: "8008",
    gnr: 9021,
    bnr: "14",
    snr: "7",
    buildYear: 2004,
    bathroomYear: 2004,
    level: 1,
    braI: 54,
    storage: 4,
    bedrooms: 1,
    openKitchen: true,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "section",
    street: 1,
    houseNumber: "14 C",
    postalCode: "8008",
    gnr: 9021,
    bnr: "14",
    snr: "12",
    buildYear: 2004,
    bathroomYear: 2004,
    level: 5,
    braI: 96,
    balcony: 8,
    storage: 5,
    bedrooms: 3,
    openKitchen: false,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "section",
    street: 5,
    houseNumber: "3",
    postalCode: "9008",
    gnr: 9022,
    bnr: "5",
    snr: "2",
    buildYear: 1962,
    bathroomYear: 1997,
    level: 2,
    braI: 62,
    storage: 3.5,
    bedrooms: 2,
    openKitchen: false,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "section",
    street: 5,
    houseNumber: "3",
    postalCode: "9008",
    gnr: 9022,
    bnr: "5",
    snr: "9",
    buildYear: 1962,
    bathroomYear: 2018,
    level: 4,
    braI: 48,
    bedrooms: 1,
    openKitchen: false,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "section",
    street: 9,
    houseNumber: "20 A",
    postalCode: "8514",
    gnr: 9023,
    bnr: "31",
    snr: "4",
    buildYear: 2018,
    bathroomYear: 2018,
    level: 2,
    braI: 74,
    balcony: 6,
    storage: 4,
    bedrooms: 2,
    openKitchen: true,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "section",
    street: 9,
    houseNumber: "20 B",
    postalCode: "8514",
    gnr: 9023,
    bnr: "31",
    snr: "15",
    buildYear: 2018,
    bathroomYear: 2018,
    level: 6,
    braI: 112,
    balcony: 6,
    bedrooms: 3,
    openKitchen: true,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "section",
    street: 12,
    houseNumber: "8",
    postalCode: "8610",
    gnr: 9024,
    bnr: "8",
    snr: "1",
    buildYear: 1985,
    bathroomYear: 2022,
    level: 1,
    braI: 38,
    storage: 3,
    bedrooms: 1,
    openKitchen: true,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "section",
    street: 12,
    houseNumber: "8",
    postalCode: "8610",
    gnr: 9024,
    bnr: "8",
    snr: "6",
    buildYear: 1985,
    bathroomYear: 1993,
    level: 3,
    braI: 58,
    storage: 3,
    bedrooms: 2,
    openKitchen: false,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "section",
    street: 15,
    houseNumber: "1",
    postalCode: "9405",
    gnr: 9025,
    bnr: "22",
    snr: "5",
    buildYear: 2024,
    bathroomYear: 2024,
    level: 2,
    braI: 66,
    balcony: 7,
    storage: 4,
    bedrooms: 2,
    openKitchen: true,
    managingAgent: AGENT_A,
  },
];

/** Borettslag: lagets navn og andelsnummer, ingen seksjonsnummer. Navnene er oppdiktet. */
const COOPERATIVE_SPECS: readonly ApartmentSpec[] = [
  {
    ownershipForm: "cooperative",
    street: 2,
    houseNumber: "30",
    postalCode: "8015",
    gnr: 9026,
    bnr: "3",
    cooperativeName: "Myrsnipa borettslag",
    shareNumber: "24",
    buildYear: 1968,
    bathroomYear: 1992,
    level: 2,
    braI: 61,
    storage: 3.5,
    bedrooms: 1,
    openKitchen: false,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "cooperative",
    street: 2,
    houseNumber: "32",
    postalCode: "8015",
    gnr: 9026,
    bnr: "4",
    cooperativeName: "Myrsnipa borettslag",
    shareNumber: "41",
    buildYear: 1968,
    bathroomYear: 2014,
    level: 1,
    braI: 72,
    storage: 3.5,
    bedrooms: 2,
    openKitchen: false,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "cooperative",
    street: 6,
    houseNumber: "11",
    postalCode: "9020",
    gnr: 9027,
    bnr: "11",
    cooperativeName: "Havella borettslag",
    shareNumber: "7",
    buildYear: 1975,
    bathroomYear: 2003,
    level: 3,
    braI: 84,
    balcony: 5.5,
    storage: 4,
    bedrooms: 3,
    openKitchen: false,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "cooperative",
    street: 6,
    houseNumber: "13",
    postalCode: "9020",
    gnr: 9027,
    bnr: "12",
    cooperativeName: "Havella borettslag",
    shareNumber: "19",
    buildYear: 1975,
    bathroomYear: 2021,
    level: 2,
    braI: 55,
    storage: 3,
    bedrooms: 1,
    openKitchen: true,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "cooperative",
    street: 10,
    houseNumber: "4",
    postalCode: "8657",
    gnr: 9028,
    bnr: "7",
    cooperativeName: "Polarmåken borettslag",
    shareNumber: "3",
    buildYear: 1981,
    bathroomYear: 1981,
    level: 1,
    braI: 44,
    bedrooms: 1,
    openKitchen: true,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "cooperative",
    street: 10,
    houseNumber: "6",
    postalCode: "8657",
    gnr: 9028,
    bnr: "8",
    cooperativeName: "Polarmåken borettslag",
    shareNumber: "15",
    buildYear: 1981,
    bathroomYear: 2011,
    level: 4,
    braI: 66,
    storage: 4,
    bedrooms: 2,
    openKitchen: false,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "cooperative",
    street: 13,
    houseNumber: "2",
    postalCode: "8008",
    gnr: 9029,
    bnr: "19",
    cooperativeName: "Sjøorren borettslag",
    shareNumber: "12",
    buildYear: 1999,
    bathroomYear: 1999,
    level: 2,
    braI: 78,
    balcony: 6,
    storage: 4,
    bedrooms: 2,
    openKitchen: true,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "cooperative",
    street: 13,
    houseNumber: "4",
    postalCode: "8008",
    gnr: 9029,
    bnr: "20",
    cooperativeName: "Sjøorren borettslag",
    shareNumber: "28",
    buildYear: 1999,
    bathroomYear: 2025,
    level: 3,
    braI: 90,
    storage: 5,
    bedrooms: 3,
    openKitchen: true,
    managingAgent: AGENT_A,
  },
  {
    ownershipForm: "cooperative",
    street: 16,
    houseNumber: "17",
    postalCode: "9008",
    gnr: 9030,
    bnr: "2",
    cooperativeName: "Fjellvåken borettslag",
    shareNumber: "5",
    buildYear: 2012,
    bathroomYear: 2012,
    level: 1,
    braI: 36,
    bedrooms: 1,
    openKitchen: true,
    managingAgent: AGENT_B,
  },
  {
    ownershipForm: "cooperative",
    street: 16,
    houseNumber: "19",
    postalCode: "9008",
    gnr: 9030,
    bnr: "3",
    cooperativeName: "Fjellvåken borettslag",
    shareNumber: "33",
    buildYear: 2012,
    bathroomYear: 2012,
    level: 5,
    braI: 102,
    balcony: 8,
    storage: 5,
    bedrooms: 3,
    openKitchen: true,
    managingAgent: AGENT_B,
  },
];

type HolidaySpec = {
  street: number;
  houseNumber: string;
  postalCode: string;
  bnr: string;
  /** Festenummer for hytte på festetomt. */
  fnr?: string;
  buildYear: number;
  bathroomYear: number;
  first: number;
  /** ALH på hemsen (ikke BRA). */
  hemsAlh?: number;
  shed?: number;
  bedrooms: number;
  sauna: boolean;
};

function holidayMain(spec: HolidaySpec): SampleBuilding {
  const floors: SampleFloor[] = [
    floor("1. etasje", 1, false, { braI: spec.first, method: "laser" }, [
      room("entrance", "Gang", "bra_i", false),
      room("living_kitchen", "Stue og kjøkken", "bra_i", false),
      ...bedrooms(spec.bedrooms),
      bathroom(spec.buildYear, spec.bathroomYear),
      ...(spec.sauna ? [room("sauna", "Badstue", "bra_i", false)] : []),
    ]),
  ];
  if (spec.hemsAlh !== undefined) {
    floors.push(
      floor("Hems", 2, false, { alh: spec.hemsAlh, method: "laser" }, [
        room("unfinished_attic", "Hems", "not_bra", false),
      ]),
    );
  }
  return { name: "Hytte", yearBuilt: spec.buildYear, floors };
}

/** Fritidsboliger: selveier, tre av dem på festetomt (med festenummer). */
const HOLIDAY_SPECS: readonly HolidaySpec[] = [
  {
    street: 3,
    houseNumber: "41",
    postalCode: "8250",
    bnr: "6",
    buildYear: 1992,
    bathroomYear: 1992,
    first: 48,
    hemsAlh: 8,
    shed: 6,
    bedrooms: 2,
    sauna: false,
  },
  {
    street: 7,
    houseNumber: "12",
    postalCode: "8300",
    bnr: "2",
    fnr: "1",
    buildYear: 1978,
    bathroomYear: 1995,
    first: 36,
    bedrooms: 1,
    sauna: false,
  },
  {
    street: 11,
    houseNumber: "5",
    postalCode: "9325",
    bnr: "14",
    buildYear: 2010,
    bathroomYear: 2010,
    first: 82,
    hemsAlh: 14,
    shed: 8,
    bedrooms: 3,
    sauna: true,
  },
  {
    street: 14,
    houseNumber: "22",
    postalCode: "8250",
    bnr: "9",
    fnr: "2",
    buildYear: 1965,
    bathroomYear: 2002,
    first: 42,
    bedrooms: 2,
    sauna: false,
  },
  {
    street: 17,
    houseNumber: "3",
    postalCode: "8300",
    bnr: "27",
    buildYear: 2021,
    bathroomYear: 2021,
    first: 96,
    shed: 10,
    bedrooms: 3,
    sauna: true,
  },
  {
    street: 4,
    houseNumber: "16",
    postalCode: "9325",
    bnr: "4",
    buildYear: 1984,
    bathroomYear: 2015,
    first: 54,
    hemsAlh: 10,
    bedrooms: 2,
    sauna: false,
  },
  {
    street: 8,
    houseNumber: "9",
    postalCode: "8800",
    bnr: "18",
    fnr: "1",
    buildYear: 1999,
    bathroomYear: 1999,
    first: 64,
    shed: 7,
    bedrooms: 2,
    sauna: false,
  },
  {
    street: 12,
    houseNumber: "33",
    postalCode: "8200",
    bnr: "10",
    buildYear: 2005,
    bathroomYear: 2023,
    first: 72,
    hemsAlh: 12,
    bedrooms: 3,
    sauna: false,
  },
  {
    street: 15,
    houseNumber: "7",
    postalCode: "9300",
    bnr: "3",
    buildYear: 1958,
    bathroomYear: 2009,
    first: 31,
    shed: 5,
    bedrooms: 1,
    sauna: false,
  },
  {
    street: 2,
    houseNumber: "2",
    postalCode: "8610",
    bnr: "25",
    buildYear: 2016,
    bathroomYear: 2016,
    first: 110,
    bedrooms: 4,
    sauna: true,
  },
];

function municipalityFor(postalCode: string): TestdataMunicipality {
  const municipality = TESTDATA_MUNICIPALITIES.find((item) => item.postalCode === postalCode);
  if (!municipality) throw new Error(`testdata: ukjent postnummer ${postalCode}`);
  return municipality;
}

function key(prefix: string, index: number): string {
  return `${prefix}${String(index + 1).padStart(2, "0")}`;
}

/**
 * 50 oppdiktede eiendommer: 20 eneboliger (to rekkehus og to tomannsboliger), 10 leiligheter i
 * sameie, 10 i borettslag og 10 fritidsboliger. Gårdsnummer 9001–9040.
 */
export const TESTDATA_PROPERTIES: readonly TestdataProperty[] = [
  ...DETACHED_SPECS.map((spec, index): TestdataProperty => {
    const buildings: SampleBuilding[] = [detachedMain(spec)];
    if (spec.garage !== undefined) {
      buildings.push(outbuilding("garage", spec.buildYear + 2, spec.garage));
    }
    if (spec.shed !== undefined) {
      buildings.push(outbuilding("shed", spec.buildYear, spec.shed));
    }
    return {
      key: key("detached-", index),
      kind: "detached",
      housingType: spec.housingType,
      ownershipForm: "freehold",
      street: `${at(TESTDATA_STREETS, spec.street)} ${spec.houseNumber}`,
      postalCode: spec.postalCode,
      municipalityNumber: municipalityFor(spec.postalCode).municipalityNumber,
      gnr: String(9001 + index),
      bnr: spec.bnr,
      buildYear: spec.buildYear,
      bathroomYear: spec.bathroomYear,
      buildings,
    };
  }),
  ...[...SECTION_SPECS, ...COOPERATIVE_SPECS].map((spec, index): TestdataProperty => {
    const base = {
      key: key(spec.ownershipForm === "section" ? "section-" : "cooperative-", index % 10),
      kind: "apartment" as const,
      housingType: "apartment" as const,
      ownershipForm: spec.ownershipForm,
      street: `${at(TESTDATA_STREETS, spec.street)} ${spec.houseNumber}`,
      postalCode: spec.postalCode,
      municipalityNumber: municipalityFor(spec.postalCode).municipalityNumber,
      gnr: String(spec.gnr),
      bnr: spec.bnr,
      buildYear: spec.buildYear,
      bathroomYear: spec.bathroomYear,
      commonAreas: {
        managingAgent: spec.managingAgent,
        conditionReportStatus: index % 3 === 0 ? "unknown" : "yes",
        maintenancePlanStatus: index % 4 === 1 ? "no" : "yes",
      } satisfies CommonAreasInput,
      buildings: [apartmentBuilding(spec)],
    };
    if (spec.ownershipForm === "section") {
      return { ...base, snr: spec.snr ?? "" };
    }
    return {
      ...base,
      cooperativeName: spec.cooperativeName ?? "",
      shareNumber: spec.shareNumber ?? "",
    };
  }),
  ...HOLIDAY_SPECS.map((spec, index): TestdataProperty => {
    const buildings: SampleBuilding[] = [holidayMain(spec)];
    if (spec.shed !== undefined) buildings.push(outbuilding("shed", spec.buildYear, spec.shed));
    const base = {
      key: key("holiday-", index),
      kind: "holiday" as const,
      housingType: "holiday_home" as const,
      ownershipForm: "freehold" as const,
      street: `${at(TESTDATA_STREETS, spec.street)} ${spec.houseNumber}`,
      postalCode: spec.postalCode,
      municipalityNumber: municipalityFor(spec.postalCode).municipalityNumber,
      gnr: String(9031 + index),
      bnr: spec.bnr,
      buildYear: spec.buildYear,
      bathroomYear: spec.bathroomYear,
      buildings,
    };
    return spec.fnr === undefined ? base : { ...base, fnr: spec.fnr };
  }),
];

/**
 * Eiendommen som verdier til `propertyInputSchema` (by og kommunenavn fra
 * `TESTDATA_MUNICIPALITIES`). Byggeår, badets år og bygningene er ikke med.
 */
export function testdataPropertyInput(property: TestdataProperty): PropertyInput {
  const municipality = municipalityFor(property.postalCode);
  return {
    address: property.street,
    postalCode: property.postalCode,
    city: municipality.postalPlace,
    municipalityNumber: municipality.municipalityNumber,
    municipalityName: municipality.municipalityName,
    housingType: property.housingType,
    ownershipForm: property.ownershipForm,
    gnr: property.gnr,
    bnr: property.bnr,
    fnr: property.fnr ?? null,
    snr: property.snr ?? null,
    associationName: property.cooperativeName ?? null,
    shareNumber: property.shareNumber ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Ordre og oppdrag
// ---------------------------------------------------------------------------------------------

export type TestdataTarget = "order_only" | AssignmentStatus;

export type TestdataWorkSession = {
  employeeKey: string;
  phase: Extract<WorkPhase, "inspection" | "office">;
  startDay: number;
  /** Klokkeslett `HH:MM` i Europe/Oslo. */
  startTime: string;
  hours: number;
};

export type TestdataClaim = {
  outcome: ClaimOutcome;
  claimType: ClaimType;
  /** Parten som klaget (rollen på oppdraget; den første med rollen). */
  claimantRole: PartyRole;
  receivedDay: number;
  buildingPart: string;
  description: string;
  /** Bare ved medhold og forlik. */
  amount?: number;
};

export type TestdataOrder = {
  /** `orders.external_ref`. Fast nøkkel, endres aldri. */
  externalRef: `TD-${string}`;
  /** Eiendommen for oppdrag. Ordre som ikke er gjort om, har ingen eiendom. */
  propertyKey?: string;
  /** Bare for ordre uten eiendom: gateadressen. */
  address?: string;
  postalCode?: string;
  municipalityNumber?: string;
  gnr?: string;
  bnr?: string;
  /** Megleren som bestilte (kontakt i firmaet). Mangler ved privat bestilling. */
  brokerEmail?: string;
  orderedByText?: string;
  note?: string;
  parties: readonly SampleParty[];
  target: TestdataTarget;
  createdDay: number;
  inspectionDay?: number;
  /** Klokkeslett `HH:MM` i Europe/Oslo. */
  inspectionTime?: string;
  dueDay?: number;
  startedDay?: number;
  completedDay?: number;
  invoicedDay?: number;
  /** Egenerklæring mottatt. Står bare i data, kolonnen finnes ikke (ordren har sin egen). */
  selfDeclarationReceived: boolean;
  responsibleKey?: string;
  secondKey?: string;
  officeName?: string;
  workSessions?: readonly TestdataWorkSession[];
  claim?: TestdataClaim;
};

/** Neste oppdiktede selger eller kjøper. Unike navn og e-poster for opptil 120 personer. */
function partyPerson(index: number): { name: string; email: string; phone: string } {
  const first = at(PARTY_FIRST_NAMES, index);
  const surname = at(TESTDATA_SURNAMES, index * 7);
  const name = `${first} ${surname}`;
  return {
    name,
    email: testdataEmail(name),
    phone: testdataPhone(30 + Math.floor(index / 1000), 100 + index),
  };
}

let partyCounter = 0;

function seller(invoice: boolean): SampleParty {
  const person = partyPerson(partyCounter++);
  return {
    role: "seller",
    ...person,
    receivesReport: true,
    receivesInvoice: invoice,
    receivesMessages: true,
  };
}

function buyer(): SampleParty {
  const person = partyPerson(partyCounter++);
  return {
    role: "buyer",
    ...person,
    receivesReport: false,
    receivesInvoice: false,
    receivesMessages: false,
  };
}

function brokerParty(index: number): SampleParty {
  const item = at(ALL_BROKERS, index);
  return {
    role: "broker",
    name: item.name,
    firmName: item.firmName,
    email: item.email,
    phone: item.phone,
    receivesReport: true,
    receivesInvoice: true,
    receivesMessages: true,
  };
}

function ref(index: number): `TD-${string}` {
  return `TD-${String(index).padStart(4, "0")}`;
}

const NOTES = [
  "Ring selger en halvtime før befaringen.",
  "Nøkkel ligger i nøkkelboks ved inngangen. Megler sender koden.",
  "Hund i huset. Avtal med selger før befaringen.",
  "Selger er bortreist. Megler møter på befaringen.",
  "Luken til loftet er inne i garderobeskapet på soverommet.",
  "Parker i gata, ikke på gårdsplassen.",
] as const;

const PRIVATE_ORDER_TEXT = "Selger, bestilt på telefon";

const INSPECTION_TIMES = ["08:30", "09:00", "10:00", "11:00", "12:30", "13:30", "14:00"] as const;

/** Ordre som ikke er gjort om til oppdrag. `TD-0001` lages først og er datoankeret. */
const ORDER_ONLY: readonly TestdataOrder[] = [
  {
    address: `${at(TESTDATA_STREETS, 4)} 19`,
    postalCode: "8008",
    gnr: "9041",
    bnr: "7",
    createdDay: 0,
    broker: 0,
  },
  {
    address: `${at(TESTDATA_STREETS, 7)} 2`,
    postalCode: "9008",
    gnr: "9042",
    bnr: "16",
    createdDay: -1,
    broker: 3,
  },
  {
    address: `${at(TESTDATA_STREETS, 11)} 25`,
    postalCode: "8610",
    gnr: "9043",
    bnr: "4",
    createdDay: -2,
    broker: 6,
  },
  {
    address: `${at(TESTDATA_STREETS, 14)} 6`,
    postalCode: "8300",
    gnr: "9044",
    bnr: "11",
    createdDay: 0,
    broker: undefined,
  },
  {
    address: `${at(TESTDATA_STREETS, 17)} 13`,
    postalCode: "8514",
    gnr: "9045",
    bnr: "29",
    createdDay: -3,
    broker: 9,
  },
].map((spec, index): TestdataOrder => {
  const isPrivate = spec.broker === undefined;
  const parties: SampleParty[] = [seller(isPrivate)];
  if (spec.broker !== undefined) parties.unshift(brokerParty(spec.broker));
  const order: TestdataOrder = {
    externalRef: ref(index + 1),
    address: spec.address,
    postalCode: spec.postalCode,
    municipalityNumber: municipalityFor(spec.postalCode).municipalityNumber,
    gnr: spec.gnr,
    bnr: spec.bnr,
    parties,
    target: "order_only",
    createdDay: spec.createdDay,
    selfDeclarationReceived: index % 2 === 0,
  };
  const withNote = index === 1 ? { ...order, note: at(NOTES, 0) } : order;
  if (spec.broker === undefined) return { ...withNote, orderedByText: PRIVATE_ORDER_TEXT };
  return { ...withNote, brokerEmail: at(ALL_BROKERS, spec.broker).email };
});

/** Status for oppdraget på hver eiendom, i samme rekkefølge som `TESTDATA_PROPERTIES`. */
const TARGETS: Record<string, Exclude<TestdataTarget, "order_only">> = {
  "detached-01": "invoiced",
  "detached-02": "invoiced",
  "detached-03": "completed",
  "detached-04": "invoiced",
  "detached-05": "ordered",
  "detached-06": "invoiced",
  "detached-07": "completed",
  "detached-08": "in_progress",
  "detached-09": "invoiced",
  "detached-10": "ordered",
  "detached-11": "invoiced",
  "detached-12": "completed",
  "detached-13": "in_progress",
  "detached-14": "invoiced",
  "detached-15": "invoiced",
  "detached-16": "ordered",
  "detached-17": "completed",
  "detached-18": "invoiced",
  "detached-19": "in_progress",
  "detached-20": "ordered",
  "section-01": "invoiced",
  "section-02": "completed",
  "section-03": "ordered",
  "section-04": "invoiced",
  "section-05": "invoiced",
  "section-06": "in_progress",
  "section-07": "completed",
  "section-08": "invoiced",
  "section-09": "ordered",
  "section-10": "completed",
  "cooperative-01": "invoiced",
  "cooperative-02": "completed",
  "cooperative-03": "invoiced",
  "cooperative-04": "in_progress",
  "cooperative-05": "invoiced",
  "cooperative-06": "completed",
  "cooperative-07": "ordered",
  "cooperative-08": "invoiced",
  "cooperative-09": "completed",
  "cooperative-10": "in_progress",
  "holiday-01": "invoiced",
  "holiday-02": "completed",
  "holiday-03": "ordered",
  "holiday-04": "invoiced",
  "holiday-05": "in_progress",
  "holiday-06": "invoiced",
  "holiday-07": "completed",
  "holiday-08": "ordered",
  "holiday-09": "in_progress",
  "holiday-10": "ordered",
};

/** Befaringsdager per status, i den rekkefølgen oppdragene med statusen kommer. */
const INSPECTION_DAYS: Record<Exclude<TestdataTarget, "order_only">, readonly number[]> = {
  invoiced: [
    -105, -101, -97, -93, -89, -85, -81, -77, -73, -69, -65, -61, -57, -53, -49, -45, -42, -39, -36,
    -33,
  ],
  completed: [-31, -28, -26, -24, -21, -19, -17, -15, -13, -11, -9, -7],
  in_progress: [-9, -7, -6, -5, -4, -3, -2, -1],
  ordered: [1, 2, 3, 4, 6, 8, 9, 13, 21, 28],
};

/**
 * Reklamasjoner, med egne ord. Ingen TG, ingen gjetteord og ingen trekk fra ekte saker.
 * `afterCompleted` er antall dager etter at oppdraget ble ferdig (høyst dag −1).
 */
const CLAIMS: Record<string, Omit<TestdataClaim, "receivedDay"> & { afterCompleted: number }> = {
  "detached-01": {
    outcome: "upheld",
    claimType: "complaint",
    claimantRole: "buyer",
    afterCompleted: 60,
    buildingPart: "Drenering",
    description:
      "Kjøper fant fukt nederst på kjellerveggen mot nord etter første høst. Saltutslag på veggen var synlige på befaringsdagen, men er ikke omtalt i rapporten. Kjøper får medhold.",
    amount: 45_000,
  },
  "detached-06": {
    outcome: "rejected",
    claimType: "complaint",
    claimantRole: "buyer",
    afterCompleted: 30,
    buildingPart: "Tak",
    description:
      "Kjøper krever dekning for lekkasje ved pipebeslaget. Rapporten beskriver beslaget og anbefaler ettersyn før vinteren. Kravet er avvist.",
  },
  "section-04": {
    outcome: "settled",
    claimType: "complaint",
    claimantRole: "buyer",
    afterCompleted: 25,
    buildingPart: "Areal",
    description:
      "Kjøper målte bruksarealet til seks kvadratmeter mindre enn rapporten oppgir. Partene ble enige om et forlik.",
    amount: 15_000,
  },
  "detached-12": {
    outcome: "open",
    claimType: "complaint",
    claimantRole: "buyer",
    afterCompleted: 18,
    buildingPart: "Våtrom",
    description:
      "Kjøper melder om fukt i veggen bak dusjen og ber om en vurdering av hva rapporten sier om membranen.",
  },
  "cooperative-01": {
    outcome: "withdrawn",
    claimType: "complaint",
    claimantRole: "buyer",
    afterCompleted: 40,
    buildingPart: "Våtrom",
    description:
      "Kjøper meldte om sprekk i en flis på badegulvet. Kravet ble trukket etter at kjøper gikk gjennom rapporten på nytt.",
  },
};

/** Timer for befaring og rapportskriving: leilighet lavest, enebolig med kjeller høyest. */
function sessionHours(
  property: TestdataProperty,
  index: number,
): { inspection: number; office: number } {
  const step = (index % 2) * 0.5;
  if (property.kind === "apartment") return { inspection: 1 + step, office: 2 + step };
  if (property.kind === "holiday") return { inspection: 1.5, office: 3 + step };
  const hasBasement = property.buildings.some((building) =>
    building.floors.some((item) => item.belowGround),
  );
  return hasBasement
    ? { inspection: 2.5 + step, office: 4.5 + step }
    : { inspection: 2 + step, office: 3.5 + step };
}

function officeOf(employeeKey: string): string {
  const found = TESTDATA_EMPLOYEES.find((item) => item.key === employeeKey);
  if (!found) throw new Error(`testdata: ukjent ansatt ${employeeKey}`);
  return found.officeName;
}

const statusCounters: Record<Exclude<TestdataTarget, "order_only">, number> = {
  invoiced: 0,
  completed: 0,
  in_progress: 0,
  ordered: 0,
};

const ASSIGNMENT_ORDERS: readonly TestdataOrder[] = TESTDATA_PROPERTIES.map(
  (property, index): TestdataOrder => {
    const target = TARGETS[property.key];
    if (!target) throw new Error(`testdata: mangler status for ${property.key}`);
    const position = statusCounters[target]++;
    const inspectionDay = at(INSPECTION_DAYS[target], position);
    const inspectionTime = at(INSPECTION_TIMES, index);
    const responsibleKey = at(RESPONSIBLE_KEYS, index);
    let secondKey = at(SECOND_KEYS, index * 3 + 1);
    if (secondKey === responsibleKey) secondKey = at(SECOND_KEYS, index * 3 + 2);
    const isPrivate = property.kind === "holiday" && index % 3 === 0;
    const isDone = target === "completed" || target === "invoiced";
    const claimSpec = CLAIMS[property.key];

    const parties: SampleParty[] = [];
    if (!isPrivate) parties.push(brokerParty(index * 3));
    parties.push(seller(isPrivate));
    if (property.kind !== "apartment" && index % 4 === 1) parties.push(seller(false));
    if (target === "invoiced" || (target === "completed" && index % 2 === 0) || claimSpec) {
      parties.push(buyer());
    }

    const createdDay =
      target === "ordered" ? Math.min(-1, inspectionDay - 12) : inspectionDay - 5 - (index % 6);
    const order: TestdataOrder = {
      externalRef: ref(ORDER_ONLY.length + index + 1),
      propertyKey: property.key,
      parties,
      target,
      createdDay,
      inspectionDay,
      inspectionTime,
      dueDay: inspectionDay + 10,
      selfDeclarationReceived:
        isDone || (target === "in_progress" ? index % 4 !== 3 : index % 2 === 0),
      responsibleKey,
      secondKey,
      officeName: officeOf(responsibleKey),
      ...(isPrivate
        ? { orderedByText: PRIVATE_ORDER_TEXT }
        : { brokerEmail: at(ALL_BROKERS, index * 3).email }),
      ...(index % 5 === 2 ? { note: at(NOTES, index) } : {}),
    };
    if (target === "ordered") return order;

    const started = { ...order, startedDay: inspectionDay };
    if (!isDone) return started;

    const completedDay = inspectionDay + 3 + (position % 4);
    const hours = sessionHours(property, index);
    const workSessions: TestdataWorkSession[] = [
      {
        employeeKey: responsibleKey,
        phase: "inspection",
        startDay: inspectionDay,
        startTime: inspectionTime,
        hours: hours.inspection,
      },
      {
        employeeKey: responsibleKey,
        phase: "office",
        startDay: inspectionDay + 1,
        startTime: "08:30",
        hours: hours.office,
      },
    ];
    const done: TestdataOrder = { ...started, completedDay, workSessions };
    const withClaim: TestdataOrder = claimSpec
      ? (() => {
          const { afterCompleted, ...claim } = claimSpec;
          return {
            ...done,
            claim: { ...claim, receivedDay: Math.min(-1, completedDay + afterCompleted) },
          };
        })()
      : done;
    if (target === "completed") return withClaim;
    return { ...withClaim, invoicedDay: completedDay + 2 + (position % 5) };
  },
);

/**
 * 55 ordre: `TD-0001`–`TD-0005` er ordre som ikke er gjort om, `TD-0006`–`TD-0055` er oppdrag,
 * ett per eiendom. 10 bestilt, 8 under arbeid, 12 ferdige og 20 fakturerte, fra dag −115 til +28.
 */
export const TESTDATA_ORDERS: readonly TestdataOrder[] = [...ORDER_ONLY, ...ASSIGNMENT_ORDERS];
