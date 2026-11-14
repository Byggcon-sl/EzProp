import type { ClaimOutcome, ClaimType } from "@/core/claims";
import type { TestdataCompanyName, TestdataOfficeName, TestdataRole } from "./testdata.types";

/*
 * Faste, oppdiktede lister for testdataene (docs/funksjoner/fase2a-testdata-arbeidshverdag.md,
 * «Oppdiktede verdier (A301)»). Alle navn, gater, firma og borettslag er laget for testmiljøet og
 * skal være lette å kjenne igjen. Bare postnummer, poststed og kommune er ekte, slik at kart og
 * kommune ser riktige ut. Ingen tekst her er hentet fra standarder, andre systemer eller
 * researchen i `docs/kartlegging/`.
 *
 * Fritekst har aldri elleve sifre på rad, ingen gjetteord, ingen TG og ingen helseopplysninger.
 */

/** Det faste frøet `pnpm db:seed:testdata` bruker. Endres det, blir planen en annen. */
export const TESTDATA_SEED = 20261113;

/** RFC 2606: `.invalid` kan aldri motta post. */
export const TESTDATA_EMAIL_DOMAIN = "testdata.invalid";

/**
 * Telefon i formen `+47 000 NN NNN`. I den norske nummerplanen (Nkom) starter åttesifrede
 * abonnentnummer på 2–9; nummer som starter på 0 er femsifrede tjenestenummer, så `000 NN NNN` er
 * ikke et abonnentnummer. Mønsteret passer telefonvalideringen i `src/core/contacts/schemas.ts`
 * (sifre, mellomrom og +, under 20 tegn), og vasken fanger det (10 sifre; `+47` normaliseres bort
 * til 8 sifre, over grensen på 5). Ikke kontrollert mot nummerplanen ennå (A301, til kontroll).
 */
export const TESTDATA_PHONE_PATTERN = /^\+47 000 \d{2} \d{3}$/;

/**
 * Gårdsnummer for testdataene, både i matrikkelen og på ordren. At ingen av kommunene i listen har
 * så høye gårdsnummer, er ikke kontrollert mot matrikkelen ennå (A301, til kontroll).
 */
export const TESTDATA_GNR_MIN = 9001;
export const TESTDATA_GNR_MAX = 9099;

/** Prefikset på `orders.external_ref` for testdataene. */
export const TESTDATA_ORDER_PREFIX = "TD-";

/** Navnet på boden i fellesarealet i blokk; det eneste arealet som er tatt fra tegning. */
export const TESTDATA_SHARED_STORAGE_NAME = "Fellesbod";

/**
 * Oppdiktede etternavn for alle personer (ansatte, meglere, selgere og kjøpere). De er laget slik
 * at de ikke er vanlige norske etternavn og er lette å kjenne igjen som testdata.
 */
export const TESTDATA_LAST_NAMES = [
  "Testvik",
  "Testmo",
  "Testeng",
  "Testlid",
  "Testhaug",
  "Testnes",
  "Testrud",
  "Testøy",
  "Testdal",
  "Prøvdal",
  "Prøvås",
  "Prøvenes",
  "Prøvelid",
  "Prøvmo",
  "Prøveland",
  "Fiktivsen",
  "Fiktiveng",
  "Fiktivnes",
  "Fiktivmo",
  "Diktvik",
  "Diktmo",
  "Diktdal",
  "Diktnes",
  "Eksempelsen",
  "Eksempelnes",
  "Eksempelmo",
  "Eksempeldal",
] as const;

export const TESTDATA_FIRST_NAMES = [
  "Kari",
  "Ola",
  "Ingrid",
  "Lars",
  "Silje",
  "Magnus",
  "Hanne",
  "Eirik",
  "Marit",
  "Jonas",
  "Tone",
  "Henrik",
  "Line",
  "Sindre",
  "Anette",
  "Trond",
  "Camilla",
  "Vegard",
  "Hilde",
  "Andreas",
  "Nina",
  "Øystein",
  "Kristin",
  "Jørgen",
  "Ragnhild",
  "Martin",
  "Ida",
  "Tor",
  "Siri",
  "Espen",
] as const;

/** Oppdiktede gatenavn. */
export const TESTDATA_STREET_NAMES = [
  "Testvegen",
  "Testbakken",
  "Testlia",
  "Prøvegata",
  "Prøvestien",
  "Prøveveien",
  "Fiktivveien",
  "Fiktivtunet",
  "Diktarvegen",
  "Diktarlia",
  "Eksempelgata",
  "Eksempelbakken",
  "Oppdiktvegen",
  "Tenkteveien",
] as const;

export type TestdataPostalArea = {
  postalCode: string;
  postalPlace: string;
  municipalityNumber: string;
  municipalityName: string;
  /** Kontoret som tar oppdrag her. */
  officeName: TestdataOfficeName;
};

/**
 * Ekte postnummer, poststed, kommunenummer og kommune i Nordland (18xx) og Troms (55xx), rundt
 * kontorene. Bare parene her brukes.
 */
export const TESTDATA_POSTAL_AREAS: readonly TestdataPostalArea[] = [
  {
    postalCode: "8003",
    postalPlace: "Bodø",
    municipalityNumber: "1804",
    municipalityName: "Bodø",
    officeName: "Bodø",
  },
  {
    postalCode: "8006",
    postalPlace: "Bodø",
    municipalityNumber: "1804",
    municipalityName: "Bodø",
    officeName: "Bodø",
  },
  {
    postalCode: "8008",
    postalPlace: "Bodø",
    municipalityNumber: "1804",
    municipalityName: "Bodø",
    officeName: "Bodø",
  },
  {
    postalCode: "8010",
    postalPlace: "Bodø",
    municipalityNumber: "1804",
    municipalityName: "Bodø",
    officeName: "Bodø",
  },
  {
    postalCode: "8050",
    postalPlace: "Tverlandet",
    municipalityNumber: "1804",
    municipalityName: "Bodø",
    officeName: "Bodø",
  },
  {
    postalCode: "8200",
    postalPlace: "Fauske",
    municipalityNumber: "1841",
    municipalityName: "Fauske",
    officeName: "Bodø",
  },
  {
    postalCode: "8613",
    postalPlace: "Mo i Rana",
    municipalityNumber: "1833",
    municipalityName: "Rana",
    officeName: "Mo i Rana",
  },
  {
    postalCode: "8618",
    postalPlace: "Mo i Rana",
    municipalityNumber: "1833",
    municipalityName: "Rana",
    officeName: "Mo i Rana",
  },
  {
    postalCode: "8656",
    postalPlace: "Mosjøen",
    municipalityNumber: "1824",
    municipalityName: "Vefsn",
    officeName: "Mosjøen",
  },
  {
    postalCode: "8657",
    postalPlace: "Mosjøen",
    municipalityNumber: "1824",
    municipalityName: "Vefsn",
    officeName: "Mosjøen",
  },
  {
    postalCode: "8514",
    postalPlace: "Narvik",
    municipalityNumber: "1806",
    municipalityName: "Narvik",
    officeName: "Narvik",
  },
  {
    postalCode: "8517",
    postalPlace: "Narvik",
    municipalityNumber: "1806",
    municipalityName: "Narvik",
    officeName: "Narvik",
  },
  {
    postalCode: "9008",
    postalPlace: "Tromsø",
    municipalityNumber: "5501",
    municipalityName: "Tromsø",
    officeName: "Tromsø",
  },
  {
    postalCode: "9011",
    postalPlace: "Tromsø",
    municipalityNumber: "5501",
    municipalityName: "Tromsø",
    officeName: "Tromsø",
  },
  {
    postalCode: "9020",
    postalPlace: "Tromsdalen",
    municipalityNumber: "5501",
    municipalityName: "Tromsø",
    officeName: "Tromsø",
  },
];

export type TestdataBrokerFirm = {
  name: string;
  /** Kontorene firmaet bestiller hos. */
  officeNames: readonly TestdataOfficeName[];
  /** Meglerne: fornavn og etternavn. */
  brokers: readonly (readonly [firstName: string, lastName: string])[];
};

/** Oppdiktede meglerfirma. Navnene ligner ikke ekte kjeder. Organisasjonsnummer står tomt. */
export const TESTDATA_BROKER_FIRMS: readonly TestdataBrokerFirm[] = [
  {
    name: "Testmegleren AS",
    officeNames: ["Bodø"],
    brokers: [
      ["Kari", "Prøveland"],
      ["Lars", "Testrud"],
    ],
  },
  {
    name: "Prøvemegling AS",
    officeNames: ["Bodø", "Mo i Rana", "Mosjøen"],
    brokers: [
      ["Camilla", "Testlid"],
      ["Sindre", "Diktvik"],
    ],
  },
  {
    name: "Fiktivmegleren AS",
    officeNames: ["Mo i Rana", "Mosjøen", "Narvik"],
    brokers: [
      ["Tone", "Fiktiveng"],
      ["Magnus", "Eksempeldal"],
    ],
  },
  {
    name: "Diktar Eiendomsformidling AS",
    officeNames: ["Narvik", "Tromsø"],
    brokers: [
      ["Kristin", "Testøy"],
      ["Øystein", "Prøvmo"],
    ],
  },
  {
    name: "Eksempelmegling AS",
    officeNames: ["Tromsø", "Bodø"],
    brokers: [
      ["Ida", "Diktdal"],
      ["Espen", "Testnes"],
    ],
  },
];

/** Oppdiktede borettslag. */
export const TESTDATA_HOUSING_ASSOCIATIONS = [
  "Testtunet borettslag",
  "Prøvelia borettslag",
  "Fiktivgården borettslag",
  "Eksempelparken borettslag",
  "Diktarhagen borettslag",
] as const;

/** Oppdiktede forretningsførere for sameier og borettslag. */
export const TESTDATA_MANAGING_AGENTS = [
  "Testforvaltning AS",
  "Diktar Forvaltning AS",
  "Prøveforvaltning AS",
] as const;

/** Bestilling uten megler. */
export const TESTDATA_PRIVATE_ORDER_TEXT = "Privat bestilling fra selger";

/** Korte interne notater i arbeidskøen. */
export const TESTDATA_ASSIGNMENT_NOTES = [
  "Nøkler hentes hos megler.",
  "Ring selger dagen før befaringen.",
  "Selger er bortreist, megler møter.",
  "Bruk inngangen på baksiden.",
  "Ny befaringstid avtalt med selger.",
  "Tegninger er sendt på e-post.",
] as const;

/** Oppdiktet utsteder for sertifiseringene (A307). */
export const TESTDATA_CERTIFICATION_ISSUER = "Testsertifisering Nord (oppdiktet)";

export type TestdataEmployeeSeed = {
  firstName: string;
  lastName: string;
  companyLegalName: TestdataCompanyName;
  officeName: TestdataOfficeName;
  roles: readonly TestdataRole[];
  /**
   * Sertifiseringen: siste gyldige dag regnet i dager fra ankeret. Negativt tall betyr utløpt.
   * `null` for ansatte uten sertifisering.
   */
  certificationValidToDays: number | null;
};

/**
 * De tolv oppdiktede ansatte (A304: ingen admin). Takstmennene har sertifisering; én har utløpt
 * (for å prøve bortfallet av `report.publish`).
 */
export const TESTDATA_EMPLOYEES: readonly TestdataEmployeeSeed[] = [
  {
    firstName: "Ragnhild",
    lastName: "Testvik",
    companyLegalName: "Byggcon AS",
    officeName: "Bodø",
    roles: ["manager"],
    certificationValidToDays: null,
  },
  {
    firstName: "Hanne",
    lastName: "Prøvdal",
    companyLegalName: "Byggcon AS",
    officeName: "Bodø",
    roles: ["office"],
    certificationValidToDays: null,
  },
  {
    firstName: "Jonas",
    lastName: "Fiktivsen",
    companyLegalName: "Byggcon AS",
    officeName: "Bodø",
    roles: ["office"],
    certificationValidToDays: null,
  },
  {
    firstName: "Trond",
    lastName: "Diktmo",
    companyLegalName: "Byggcon AS",
    officeName: "Bodø",
    roles: ["inspector", "manager"],
    certificationValidToDays: 640,
  },
  {
    firstName: "Silje",
    lastName: "Eksempelnes",
    companyLegalName: "Byggcon AS",
    officeName: "Bodø",
    roles: ["inspector"],
    certificationValidToDays: 410,
  },
  {
    firstName: "Eirik",
    lastName: "Testeng",
    companyLegalName: "Byggcon AS",
    officeName: "Bodø",
    roles: ["inspector"],
    certificationValidToDays: -20,
  },
  {
    firstName: "Marit",
    lastName: "Prøvelid",
    companyLegalName: "Byggcon Helgeland AS",
    officeName: "Mo i Rana",
    roles: ["inspector"],
    certificationValidToDays: 820,
  },
  {
    firstName: "Vegard",
    lastName: "Fiktivmo",
    companyLegalName: "Byggcon Helgeland AS",
    officeName: "Mosjøen",
    roles: ["inspector"],
    certificationValidToDays: 530,
  },
  {
    firstName: "Andreas",
    lastName: "Diktnes",
    companyLegalName: "Byggcon Nord AS",
    officeName: "Narvik",
    roles: ["inspector"],
    certificationValidToDays: 300,
  },
  {
    firstName: "Ingrid",
    lastName: "Testhaug",
    companyLegalName: "Byggcon Troms AS",
    officeName: "Tromsø",
    roles: ["inspector"],
    certificationValidToDays: 950,
  },
  {
    firstName: "Henrik",
    lastName: "Eksempelmo",
    companyLegalName: "Byggcon Troms AS",
    officeName: "Tromsø",
    roles: ["inspector"],
    certificationValidToDays: 720,
  },
  {
    firstName: "Line",
    lastName: "Prøvås",
    companyLegalName: "Byggcon Troms AS",
    officeName: "Tromsø",
    roles: ["office"],
    certificationValidToDays: null,
  },
];

/** Hvilke eiendommer en reklamasjon helst legges på. */
export type TestdataClaimTarget = "any" | "house" | "house_with_basement";

export type TestdataClaimSeed = {
  claimType: ClaimType;
  outcome: ClaimOutcome;
  buildingPartText: string;
  description: string;
  /** Beløp i kroner, bare ved medhold og forlik. */
  amount: number | null;
  target: TestdataClaimTarget;
};

/** Fem reklamasjoner, én per utfall, spredd på bygningsdeler. Egne ord, ingen TG. */
export const TESTDATA_CLAIMS: readonly TestdataClaimSeed[] = [
  {
    claimType: "complaint",
    outcome: "open",
    buildingPartText: "Våtrom",
    description:
      "Kjøper melder om fukt i gulvet i gangen utenfor badet, oppdaget kort tid etter overtakelse. Kjøper mener forholdet burde vært beskrevet i rapporten.",
    amount: null,
    target: "any",
  },
  {
    claimType: "complaint",
    outcome: "rejected",
    buildingPartText: "Tak",
    description:
      "Kjøper melder om lekkasje ved pipebeslaget etter kraftig regn. Taket ble vurdert fra bakken og fra loftet, og rapporten beskriver hvilke deler som ikke var tilgjengelige.",
    amount: null,
    target: "house",
  },
  {
    claimType: "complaint",
    outcome: "upheld",
    buildingPartText: "Drenering",
    description:
      "Kjøper melder om vann i kjelleren i snøsmeltingen. Fuktmerker nederst på kjellerveggen var synlige på bildene fra befaringen, men er ikke omtalt i rapporten.",
    amount: 45_000,
    target: "house_with_basement",
  },
  {
    claimType: "insurance_claim",
    outcome: "settled",
    buildingPartText: "Areal",
    description:
      "Kjøper har målt boligen selv og kommer fram til lavere bruksareal enn rapporten. Forskjellen gjelder ett rom som er regnet med i arealet.",
    amount: 15_000,
    target: "any",
  },
  {
    claimType: "complaint",
    outcome: "withdrawn",
    buildingPartText: "Våtrom",
    description:
      "Kjøper meldte om sprekk i en flis på badegulvet. Kravet ble trukket etter at kjøper fikk se bildene og beskrivelsen fra befaringen.",
    amount: null,
    target: "any",
  },
];
