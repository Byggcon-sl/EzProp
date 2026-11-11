/*
 * Testsett med fasit for vasken før KI (docs/funksjoner/fase2a-vask-for-ki.md, akseptkriteriene
 * «Testsett med fasit»; testplanen V3.11). Brukes bare av testene (`redaction.test.ts`).
 *
 * Alle notater, navn, adresser, telefonnumre og matrikkelnumre er oppdiktet. Ingen tekst fra
 * NS 3600, IVIT eller SmartTakst.
 *
 * Hver sak har teksten, de kjente verdiene for oppdraget (lagt inn som rader i testdatabasen av
 * testen, med kolonnene i kortets punkt 2), det som må vaskes bort (`mustRemove`, krav: 0 bom) og
 * det som må stå (`mustKeep`). Testen skriver ut hvor mange ord som ble vasket unødig.
 *
 * Støtter hovedmål: KI i bunnen og de ansatte (persondata i notater sendes aldri til KI).
 */

type PersonValues = {
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  deleted?: boolean;
};
type FirmValues = { name: string; orgNumber?: string | null; deleted?: boolean };

/** De kjente verdiene for ett oppdiktet oppdrag, med kolonnene i kortets punkt 2. */
export type RedactionCaseKnownValues = {
  parties?: {
    name: string;
    firmName?: string | null;
    email?: string | null;
    phone?: string | null;
    deleted?: boolean;
  }[];
  partyContacts?: (PersonValues & { firm?: FirmValues })[];
  partyFirms?: FirmValues[];
  order?: {
    addressText?: string;
    orderedByText?: string | null;
    orderedByContact?: PersonValues;
    orderedByFirm?: FirmValues;
    gnr?: string | null;
    bnr?: string | null;
    snr?: string | null;
    housingAssociationName?: string | null;
  };
  team?: { name: string; deleted?: boolean }[];
  property?: {
    address?: string;
    postalCode?: string | null;
    city?: string | null;
    municipalityName?: string | null;
    municipalityNumber?: string | null;
    gnr?: string;
    bnr?: string;
    fnr?: string | null;
    snr?: string | null;
    shareNumber?: string | null;
    associationName?: string | null;
    associationOrgNumber?: string | null;
    cadastralDeleted?: boolean;
  };
  managingAgent?: string | null;
  commonAreasDeleted?: boolean;
};

export type RedactionCase = {
  name: string;
  input: string;
  knownValues?: RedactionCaseKnownValues;
  mustRemove: string[];
  mustKeep: string[];
};

/** Det oppdiktede oppdraget de fleste sakene bruker. */
export const STANDARD_KNOWN_VALUES: RedactionCaseKnownValues = {
  parties: [
    { name: "Åse Testesen", email: "ase.testesen@example.no", phone: "12345678" },
    { name: "Bjørn Prøvesen", firmName: "Prøvemegling AS", phone: "87654321" },
    { name: "Anne-Lise Hansen" },
  ],
  partyFirms: [{ name: "Bygg og Tak AS", orgNumber: "000111222" }],
  order: {
    addressText: "Prøvetunet 7, 8099 Testvik",
    orderedByText: "Kari Bestillersen, Testmegling AS",
    gnr: "12",
    bnr: "34",
    snr: "5",
    housingAssociationName: "Borettslaget Testtunet",
  },
  team: [{ name: "Tor Takstesen" }],
  property: {
    address: "Prøvetunet 7",
    postalCode: "8099",
    city: "Testvik",
    municipalityName: "Testvik",
    municipalityNumber: "1899",
    gnr: "12",
    bnr: "34",
    fnr: "0",
    snr: "5",
    shareNumber: "17",
    associationName: "Borettslaget Testtunet",
    associationOrgNumber: "000222333",
  },
  managingAgent: "Forvaltning Nordtest AS",
};

const S = STANDARD_KNOWN_VALUES;

export const REDACTION_CASES: readonly RedactionCase[] = [
  {
    name: "selger med fullt navn",
    input: "Selger Åse Testesen opplyste at taket ble lagt om.",
    knownValues: S,
    mustRemove: ["Åse Testesen", "Åse", "Testesen"],
    mustKeep: ["Selger", "taket ble lagt om"],
  },
  {
    name: "fornavn alene",
    input: "Åse sa at det har vært lekkasje ved sluket.",
    knownValues: S,
    mustRemove: ["Åse"],
    mustKeep: ["lekkasje ved sluket"],
  },
  {
    name: "etternavn alene",
    input: "Testesen viste meg kjelleren.",
    knownValues: S,
    mustRemove: ["Testesen"],
    mustKeep: ["viste meg kjelleren"],
  },
  {
    name: "store bokstaver",
    input: "ÅSE TESTESEN VAR TIL STEDE.",
    knownValues: S,
    mustRemove: ["Åse", "Testesen"],
    mustKeep: ["TIL STEDE"],
  },
  {
    name: "genitiv",
    input: "Testesens bad har fliser fra 1995.",
    knownValues: S,
    mustRemove: ["Testesens", "Testesen"],
    mustKeep: ["bad har fliser fra 1995"],
  },
  {
    name: "fornavn og telefon gruppert",
    input: "Ring Åse på 123 45 678 for nøkkel.",
    knownValues: S,
    mustRemove: ["Åse", "123 45 678", "12345678"],
    mustKeep: ["for nøkkel"],
  },
  {
    name: "e-post til part",
    input: "Kontakt ase.testesen@example.no om tilgang til loftet.",
    knownValues: S,
    mustRemove: ["ase.testesen@example.no"],
    mustKeep: ["om tilgang til loftet"],
  },
  {
    name: "megler med firmanavn",
    input: "Megler Bjørn Prøvesen fra Prøvemegling AS var med på befaringen.",
    knownValues: S,
    mustRemove: ["Bjørn", "Prøvesen", "Prøvemegling AS"],
    mustKeep: ["var med på befaringen"],
  },
  {
    name: "navn med bindestrek",
    input: "Anne-Lise viste rommet.",
    knownValues: S,
    mustRemove: ["Anne-Lise", "Anne", "Lise"],
    mustKeep: ["viste rommet"],
  },
  {
    name: "andre del av navn med bindestrek",
    input: "Lise åpnet luken til loftet.",
    knownValues: S,
    mustRemove: ["Lise"],
    mustKeep: ["luken til loftet"],
  },
  {
    name: "genitiv av navn med bindestrek",
    input: "Anne-Lises bod er fuktig.",
    knownValues: S,
    mustRemove: ["Anne-Lises", "Anne", "Lise"],
    mustKeep: ["bod er fuktig"],
  },
  {
    name: "takstmannen på oppdraget",
    input: "Takstmann Tor Takstesen målte 18 % fukt i svillen.",
    knownValues: S,
    mustRemove: ["Tor Takstesen", "Takstesen"],
    mustKeep: ["18 % fukt i svillen"],
  },
  {
    name: "firmanavn som frase, fagordene står",
    input: "Bygg og Tak AS skiftet taket i 2015. Tak og bygg er i god stand.",
    knownValues: S,
    mustRemove: ["Bygg og Tak AS"],
    mustKeep: ["skiftet taket i 2015", "Tak og bygg er i god stand"],
  },
  {
    name: "hel adresse med postnummer og poststed",
    input: "Boligen ligger i Prøvetunet 7, 8099 Testvik.",
    knownValues: S,
    mustRemove: ["Prøvetunet 7", "Prøvetunet", "8099 Testvik", "Testvik"],
    mustKeep: ["Boligen ligger i"],
  },
  {
    name: "gatenavn alene",
    input: "Garasjen mot Prøvetunet har sprekker i pussen.",
    knownValues: S,
    mustRemove: ["Prøvetunet"],
    mustKeep: ["Garasjen mot", "har sprekker i pussen"],
  },
  {
    name: "postnummer alene står",
    input: "Kabelen er merket 8099 på skapet.",
    knownValues: S,
    mustRemove: [],
    mustKeep: ["Kabelen er merket 8099 på skapet."],
  },
  {
    name: "matrikkel med ord og kommune",
    input: "Eiendommen er gnr 12 bnr 34 i Testvik kommune.",
    knownValues: S,
    mustRemove: ["gnr 12", "bnr 34", "Testvik"],
    mustKeep: ["Eiendommen er"],
  },
  {
    name: "matrikkel som skråstrek og andelsnummer",
    input: "Matrikkel 12/34/0/5, andelsnummer 17.",
    knownValues: S,
    mustRemove: ["12/34/0/5", "andelsnummer 17"],
    mustKeep: [],
  },
  {
    name: "matrikkel med kommunenummer",
    input: "Se 1899-12/34 i grunnboken.",
    knownValues: S,
    mustRemove: ["1899-12/34", "12/34"],
    mustKeep: ["i grunnboken"],
  },
  {
    name: "mål med samme tall som matrikkelen står",
    input: "Bjelken er 12 cm høy og 34 cm bred, fall 34 grader, avstand 123 mm.",
    knownValues: S,
    mustRemove: [],
    mustKeep: ["12 cm høy", "34 cm bred", "34 grader", "123 mm"],
  },
  {
    name: "borettslaget som frase",
    input: "Borettslaget Testtunet har ansvar for taket.",
    knownValues: S,
    mustRemove: ["Borettslaget Testtunet"],
    mustKeep: ["har ansvar for taket"],
  },
  {
    name: "forretningsfører",
    input: "Forvaltning Nordtest AS sender vedlikeholdsplanen.",
    knownValues: S,
    mustRemove: ["Forvaltning Nordtest AS"],
    mustKeep: ["sender vedlikeholdsplanen"],
  },
  {
    name: "bestilleren som fritekst",
    input: "Bestilt av Kari Bestillersen, Testmegling AS i går.",
    knownValues: S,
    mustRemove: ["Kari Bestillersen, Testmegling AS"],
    mustKeep: ["Bestilt av", "i går"],
  },
  {
    name: "organisasjonsnummer til borettslaget",
    input: "Org.nr. 000222333 står på styrepapirene.",
    knownValues: S,
    mustRemove: ["000222333"],
    mustKeep: ["står på styrepapirene"],
  },
  {
    name: "fødselsnummer uten kjente verdier",
    input: "Fødselsnummer 01019912345 skal ikke stå i notatet.",
    mustRemove: ["01019912345"],
    mustKeep: ["skal ikke stå i notatet"],
  },
  {
    name: "kontonummer",
    input: "Betal depositum til 1234.56.78901 før oppstart.",
    mustRemove: ["1234.56.78901"],
    mustKeep: ["før oppstart"],
  },
  {
    name: "telefon med landkode",
    input: "Ring +47 876 54 321 etter kl 16.",
    knownValues: S,
    mustRemove: ["+47 876 54 321", "876 54 321"],
    mustKeep: ["etter kl 16"],
  },
  {
    name: "gateadresse fra mønsteret",
    input: "Badet i Sjøgata 4 b har membran fra 2005.",
    mustRemove: ["Sjøgata 4 b"],
    mustKeep: ["Badet i", "har membran fra 2005"],
  },
  {
    name: "faguttrykk og mål står",
    input: "Taket har TG 2, 48x98 sperrer med c/c 600 og 2 x 4 lekter.",
    knownValues: S,
    mustRemove: [],
    mustKeep: ["Taket har TG 2, 48x98 sperrer med c/c 600 og 2 x 4 lekter."],
  },
  {
    name: "dato, tid og desimaltall står",
    input: "Befaring 11.11.2026 kl. 10:00, fukt 0,25 og byggeår 1985.",
    knownValues: S,
    mustRemove: [],
    mustKeep: ["11.11.2026", "10:00", "0,25", "1985"],
  },
  {
    name: "æøå først og sist i ordet",
    input: "Åse Ødegård har hytte på Bjørnø.",
    knownValues: {
      parties: [{ name: "Åse Ødegård" }],
      property: { address: "Strandtunet 3", city: "Bjørnø" },
    },
    mustRemove: ["Åse Ødegård", "Ødegård", "Bjørnø"],
    mustKeep: ["har hytte på"],
  },
  {
    name: "kort navn som frase",
    input: "Bo Li var med på befaringen.",
    knownValues: { parties: [{ name: "Bo Li" }] },
    mustRemove: ["Bo Li"],
    mustKeep: ["var med på befaringen"],
  },
  {
    name: "genitiv med apostrof",
    input: "Hansen's bod har råte i gulvet.",
    knownValues: S,
    mustRemove: ["Hansen"],
    mustKeep: ["bod har råte i gulvet"],
  },
  {
    name: "etternavn i løpende tekst",
    input: "Vinduene ble skiftet av Hansen i 2010.",
    knownValues: S,
    mustRemove: ["Hansen"],
    mustKeep: ["Vinduene ble skiftet av", "i 2010"],
  },
  {
    name: "ingen persondata",
    input: "Drenering mangler langs nordveggen, og terrenget faller mot muren.",
    knownValues: S,
    mustRemove: [],
    mustKeep: ["Drenering mangler langs nordveggen, og terrenget faller mot muren."],
  },
  {
    name: "firmanavn og e-post",
    input: "Kontakt Prøvemegling AS på post@example.com om nøklene.",
    knownValues: S,
    mustRemove: ["Prøvemegling AS", "post@example.com"],
    mustKeep: ["om nøklene"],
  },
  {
    name: "telefon i par",
    input: "Bjørn ringte fra 87 65 43 21 i formiddag.",
    knownValues: S,
    mustRemove: ["Bjørn", "87 65 43 21"],
    mustKeep: ["i formiddag"],
  },
  {
    name: "seksjonsnummer",
    input: "Seksjon snr 5 i sameiet har egen bod.",
    knownValues: S,
    mustRemove: ["snr 5"],
    mustKeep: ["i sameiet har egen bod"],
  },
  {
    name: "ord som starter som et navn står",
    input: "Torvtaket på uthuset er i god stand.",
    knownValues: S,
    mustRemove: [],
    mustKeep: ["Torvtaket på uthuset er i god stand."],
  },
  {
    name: "kontakt bak en part",
    input: "Selgers representant Petter Kontaktesen ba om rapporten.",
    knownValues: {
      partyContacts: [{ firstName: "Petter", lastName: "Kontaktesen", email: "petter@example.no" }],
    },
    mustRemove: ["Petter", "Kontaktesen"],
    mustKeep: ["ba om rapporten"],
  },
  // Saker som før sto i et eget sett uten database
  {
    name: "firmanavn med regex-tegn, uten selskapsform og del av bestillerteksten",
    input:
      "Bestilt av Fiktiv Megling & Co A/S. Megler fra Fiktiv Megling & Co ringte, og Ola Diktesen ba om rapport.",
    knownValues: {
      partyFirms: [{ name: "Fiktiv Megling & Co A/S" }],
      order: { orderedByText: "Ola Diktesen, Fiktiv Megling & Co A/S" },
    },
    mustRemove: ["Fiktiv Megling & Co A/S", "Fiktiv Megling & Co", "Ola Diktesen"],
    mustKeep: ["Bestilt av", "Megler fra", "ba om rapport"],
  },
  {
    name: "kjent adresse med bokstav, også med mellomrom foran bokstaven",
    input: "Befaring på Prøvegata 7B. Naboen i Prøvegata 7 b har samme takløsning.",
    knownValues: { property: { address: "Prøvegata 7B" } },
    mustRemove: ["Prøvegata 7B", "Prøvegata 7 b", "Prøvegata"],
    mustKeep: ["Befaring på", "Naboen i", "har samme takløsning"],
  },
  {
    name: "kommunenavn alene",
    input: "Diktekommune krever ferdigattest for tilbygget.",
    knownValues: { property: { address: "Strandtunet 3", municipalityName: "Diktekommune" } },
    mustRemove: ["Diktekommune"],
    mustKeep: ["krever ferdigattest for tilbygget"],
  },
  // Funn fra gjennomgangen av «Vask før KI»
  {
    name: "telefon inntil skråstrek, komma og bindestrek",
    input:
      "Tlf 22334455/55443322, ring 66778899,99887766 eller mob-44556677. 33445566-ring etter 16.",
    mustRemove: ["22334455", "55443322", "66778899", "99887766", "44556677", "33445566"],
    mustKeep: ["Tlf", "eller mob-", "ring etter 16"],
  },
  {
    name: "fødselsnummer og kontonummer med bindestrek",
    input: "Eier oppga 010199-12345 og konto 1234-56-78901, ikke nødvendig.",
    mustRemove: ["010199-12345", "010199", "12345", "1234-56-78901", "78901"],
    mustKeep: ["Eier oppga", "og konto", "ikke nødvendig"],
  },
  {
    name: "e-post som inneholder et kjent navn",
    input: "Send til åse.testesen@eksempel.no i dag.",
    knownValues: { parties: [{ name: "Åse Testesen" }] },
    mustRemove: ["åse.testesen@eksempel.no", "eksempel.no", "[navn]"],
    mustKeep: ["Send til [e-post] i dag."],
  },
  {
    name: "adresse uten komma og med bolignummer",
    input: "Leiligheten i Elvebredden 12 har egen bod. Selger flytter til Fjellia 3 i Testvik.",
    knownValues: {
      order: { addressText: "Fjellia 3 8099 Testvik" },
      property: { address: "Elvebredden 12 H0101" },
    },
    mustRemove: ["Elvebredden 12", "Elvebredden", "Fjellia 3", "Fjellia", "Testvik"],
    mustKeep: ["Leiligheten i", "har egen bod", "Selger flytter til"],
  },
  {
    name: "usynlige tegn og fullbredde-sifre skjuler ikke persondata",
    input:
      "Ring Å\u00ADse på 1234\u200B5678 eller \uFF18\uFF17\uFF16\uFF15\uFF14\uFF13\uFF12\uFF11.",
    knownValues: S,
    mustRemove: [
      "Å\u00ADse",
      "Åse",
      "1234\u200B5678",
      "12345678",
      "\uFF18\uFF17\uFF16\uFF15\uFF14\uFF13\uFF12\uFF11",
      "87654321",
    ],
    mustKeep: ["Ring", "eller"],
  },
  {
    name: "gateadresse forkortet og i store bokstaver",
    input: "Badet i Storgt. 12 og boden i Elvevn. 3 er fuktige, likeså kjelleren i STORGATA 4.",
    mustRemove: ["Storgt. 12", "Storgt", "Elvevn. 3", "Elvevn", "STORGATA 4"],
    mustKeep: ["Badet i", "og boden i", "er fuktige, likeså kjelleren i"],
  },
];
