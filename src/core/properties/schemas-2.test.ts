import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { HOUSING_TYPES, OWNERSHIP_FORMS, YES_NO_UNKNOWN } from "./codes";
import { CommonAreasNotApplicableError } from "./errors";
import { commonAreasInputSchema, propertyInputSchema } from "./schemas";

/*
 * Skjemaene for eiendom og fellesdeler
 * (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 2). Ren enhetstest.
 *
 * Testdata er oppdiktet: «Testveien 1», postnummer 0000, «Testby», kommunenummer 0000,
 * «Testkommune», gnr/bnr 999, fnr 0, snr 9, «Borettslaget Test», organisasjonsnummer 000000000,
 * andelsnummer 0-0, «Forvalter Test», «Sett trapperom og kjeller». «Fødselsnummer» er alltid
 * 12345678901 (oppdiktet, 11 sifre).
 *
 * Støtter hovedmål: reklamasjoner (boligtype og eierform er påkrevd og låst, matrikkelen har bare
 * sifre, aldri fødselsnummer i fritekst) og tid (feil vises ved feltet med én fast tekst).
 */

const ADDRESS = "Skriv inn adressen.";
const HOUSING_TYPE = "Velg boligtype.";
const OWNERSHIP_FORM = "Velg eierform.";
const GNR_MISSING = "Skriv inn gårdsnummer.";
const BNR_MISSING = "Skriv inn bruksnummer.";
const GNR_DIGITS = "Gårdsnummer kan bare ha sifre.";
const BNR_DIGITS = "Bruksnummer kan bare ha sifre.";
const FNR_DIGITS = "Festenummer kan bare ha sifre.";
const SNR_DIGITS = "Seksjonsnummer kan bare ha sifre.";
const POSTAL_CODE = "Postnummeret må ha fire sifre.";
const MUNICIPALITY_NUMBER = "Kommunenummeret må ha fire sifre.";
const ORG_NUMBER = "Organisasjonsnummeret må ha ni sifre.";
const SHARE_NUMBER = "Andelsnummeret kan bare ha sifre og bindestrek.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const NOT_APPLICABLE =
  "Fellesdeler gjelder bare leilighet, eierseksjon, borettslag og aksjeleilighet.";

/** Alle norske meldinger i kortet punkt 8 (og feilen fra kjernen). Hver må brukes (2.13). */
const CARD_MESSAGES = [
  ADDRESS,
  HOUSING_TYPE,
  OWNERSHIP_FORM,
  GNR_MISSING,
  BNR_MISSING,
  GNR_DIGITS,
  BNR_DIGITS,
  FNR_DIGITS,
  SNR_DIGITS,
  POSTAL_CODE,
  MUNICIPALITY_NUMBER,
  ORG_NUMBER,
  SHARE_NUMBER,
  NATIONAL_ID,
  NOT_APPLICABLE,
];
const usedMessages = new Set<string>();

const VALID_PROPERTY = {
  address: "Testveien 1",
  housingType: "apartment",
  ownershipForm: "cooperative",
  gnr: "999",
  bnr: "999",
};

const VALID_COMMON_AREAS = {};

type Parsed = { success: boolean; data?: unknown; error?: { issues: ZodIssueLike[] } };
type ZodIssueLike = { path: PropertyKey[]; message: string };

function parseWith(schema: ZodType, base: Record<string, unknown>) {
  return (overrides: Record<string, unknown>): Parsed =>
    schema.safeParse({ ...base, ...overrides }) as Parsed;
}

const parseProperty = parseWith(propertyInputSchema, VALID_PROPERTY);
const parseCommonAreas = parseWith(commonAreasInputSchema, VALID_COMMON_AREAS);

/** Meldingene for feltet når skjemaet avviser. */
function messagesFor(result: Parsed, field: string): string[] {
  if (result.success || !result.error) return [];
  return result.error.issues
    .filter((issue) => String(issue.path[0] ?? "") === field)
    .map((issue) => issue.message);
}

function expectFieldMessage(result: Parsed, field: string, message: string) {
  expect(result.success, `${field} skulle vært avvist`).toBe(false);
  expect(messagesFor(result, field)).toContain(message);
  usedMessages.add(message);
}

function expectRejected(result: Parsed, field: string) {
  expect(result.success, `${field} skulle vært avvist`).toBe(false);
  expect(messagesFor(result, field).length, `feilen står ved ${field}`).toBeGreaterThan(0);
}

function expectAccepted(result: Parsed): Record<string, unknown> {
  expect(result.success, JSON.stringify(result.success ? null : result.error?.issues)).toBe(true);
  return result.success ? (result.data as Record<string, unknown>) : {};
}

describe("2.1 adresse", () => {
  it.each(["", "   "])("tom adresse «%s» gir «Skriv inn adressen.»", (address) => {
    expectFieldMessage(parseProperty({ address }), "address", ADDRESS);
  });

  it("adresse mangler gir «Skriv inn adressen.»", () => {
    const { address: _address, ...rest } = VALID_PROPERTY;
    expectFieldMessage(propertyInputSchema.safeParse(rest) as Parsed, "address", ADDRESS);
  });

  it("200 tegn godtas, 201 avvises", () => {
    expectAccepted(parseProperty({ address: "A".repeat(200) }));
    expectRejected(parseProperty({ address: "A".repeat(201) }), "address");
  });

  it("adressen trimmes", () => {
    expect(expectAccepted(parseProperty({ address: "  Testveien 1  " })).address).toBe(
      "Testveien 1",
    );
  });
});

describe("2.2 postnummer og kommunenummer", () => {
  const CASES = [
    ["postalCode", POSTAL_CODE],
    ["municipalityNumber", MUNICIPALITY_NUMBER],
  ] as const;

  it.each(CASES)("%s er valgfritt: mangler, tom og mellomrom blir null", (field) => {
    expect(expectAccepted(parseProperty({}))[field] ?? null).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "" }))[field]).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "  " }))[field]).toBeNull();
  });

  it.each(CASES)("%s: fire sifre godtas og trimmes", (field) => {
    expect(expectAccepted(parseProperty({ [field]: "0000" }))[field]).toBe("0000");
    expect(expectAccepted(parseProperty({ [field]: " 0000 " }))[field]).toBe("0000");
  });

  it.each(CASES.flatMap(([field, message]) => ["000", "00000"].map((v) => [field, v, message])))(
    "%s «%s» gir «%s»",
    (field, value, message) => {
      expectFieldMessage(parseProperty({ [field]: value }), field, message);
    },
  );

  it.each(CASES)("%s «00a0» avvises", (field) => {
    expectRejected(parseProperty({ [field]: "00a0" }), field);
  });
});

describe("2.3 poststed og kommunenavn", () => {
  const FIELDS = [
    ["city", "Testby"],
    ["municipalityName", "Testkommune"],
  ] as const;

  it.each(FIELDS)("%s er valgfritt: tom blir null", (field) => {
    expect(expectAccepted(parseProperty({}))[field] ?? null).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "" }))[field]).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "   " }))[field]).toBeNull();
  });

  it.each(FIELDS)("%s: 100 tegn godtas, 101 avvises", (field) => {
    expectAccepted(parseProperty({ [field]: "T".repeat(100) }));
    expectRejected(parseProperty({ [field]: "T".repeat(101) }), field);
  });

  it.each(FIELDS)("%s trimmes", (field, value) => {
    expect(expectAccepted(parseProperty({ [field]: `  ${value}  ` }))[field]).toBe(value);
  });
});

describe("2.4 boligtype og eierform", () => {
  it("boligtype mangler gir «Velg boligtype.»", () => {
    const { housingType: _h, ...rest } = VALID_PROPERTY;
    expectFieldMessage(propertyInputSchema.safeParse(rest) as Parsed, "housingType", HOUSING_TYPE);
  });

  it("eierform mangler gir «Velg eierform.»", () => {
    const { ownershipForm: _o, ...rest } = VALID_PROPERTY;
    expectFieldMessage(
      propertyInputSchema.safeParse(rest) as Parsed,
      "ownershipForm",
      OWNERSHIP_FORM,
    );
  });

  it.each(["", "villa", "Enebolig", "bond"])("boligtypen «%s» gir «Velg boligtype.»", (value) => {
    expectFieldMessage(parseProperty({ housingType: value }), "housingType", HOUSING_TYPE);
  });

  it.each(["", "bond", "Selveier", "villa"])("eierformen «%s» gir «Velg eierform.»", (value) => {
    expectFieldMessage(parseProperty({ ownershipForm: value }), "ownershipForm", OWNERSHIP_FORM);
  });

  it.each([...HOUSING_TYPES])("boligtypen %s godtas", (housingType) => {
    expect(expectAccepted(parseProperty({ housingType })).housingType).toBe(housingType);
  });

  it.each([...OWNERSHIP_FORMS])("eierformen %s godtas", (ownershipForm) => {
    expect(expectAccepted(parseProperty({ ownershipForm })).ownershipForm).toBe(ownershipForm);
  });
});

describe("2.5 gårds- og bruksnummer (påkrevd)", () => {
  const CASES = [
    ["gnr", GNR_MISSING, GNR_DIGITS],
    ["bnr", BNR_MISSING, BNR_DIGITS],
  ] as const;

  it.each(CASES)("%s tomt gir «%s»", (field, missing) => {
    expectFieldMessage(parseProperty({ [field]: "" }), field, missing);
    expectFieldMessage(parseProperty({ [field]: "  " }), field, missing);
  });

  it.each(CASES)("%s mangler gir «%s»", (field, missing) => {
    const rest: Record<string, unknown> = { ...VALID_PROPERTY };
    delete rest[field];
    expectFieldMessage(propertyInputSchema.safeParse(rest) as Parsed, field, missing);
  });

  it.each(CASES)("%s: 1 og 5 sifre godtas, 6 avvises", (field) => {
    expect(expectAccepted(parseProperty({ [field]: "1" }))[field]).toBe("1");
    expect(expectAccepted(parseProperty({ [field]: "99999" }))[field]).toBe("99999");
    expect(expectAccepted(parseProperty({ [field]: " 999 " }))[field]).toBe("999");
    expectRejected(parseProperty({ [field]: "999999" }), field);
  });

  it.each(CASES)("%s «12a» gir «%s»", (field, _missing, digits) => {
    expectFieldMessage(parseProperty({ [field]: "12a" }), field, digits);
  });
});

describe("2.6 feste- og seksjonsnummer (valgfrie)", () => {
  const CASES = [
    ["fnr", FNR_DIGITS],
    ["snr", SNR_DIGITS],
  ] as const;

  it.each(CASES)("%s: mangler og tom blir null", (field) => {
    expect(expectAccepted(parseProperty({}))[field] ?? null).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "" }))[field]).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "  " }))[field]).toBeNull();
  });

  it.each(CASES)("%s: 1–5 sifre godtas, 6 avvises", (field) => {
    expect(expectAccepted(parseProperty({ [field]: "0" }))[field]).toBe("0");
    expect(expectAccepted(parseProperty({ [field]: "99999" }))[field]).toBe("99999");
    expectRejected(parseProperty({ [field]: "999999" }), field);
  });

  it.each(CASES)("%s med bokstaver gir «%s»", (field, message) => {
    expectFieldMessage(parseProperty({ [field]: "9b" }), field, message);
  });
});

describe("2.7 borettslag eller sameie", () => {
  it("valgfritt: tom blir null", () => {
    expect(expectAccepted(parseProperty({})).associationName ?? null).toBeNull();
    expect(expectAccepted(parseProperty({ associationName: "" })).associationName).toBeNull();
  });

  it("200 tegn godtas, 201 avvises", () => {
    expectAccepted(parseProperty({ associationName: "B".repeat(200) }));
    expectRejected(parseProperty({ associationName: "B".repeat(201) }), "associationName");
  });

  it("navnet trimmes", () => {
    expect(
      expectAccepted(parseProperty({ associationName: "  Borettslaget Test " })).associationName,
    ).toBe("Borettslaget Test");
  });
});

describe("2.8 organisasjonsnummer", () => {
  it("valgfritt: tom blir null", () => {
    expect(expectAccepted(parseProperty({})).associationOrgNumber ?? null).toBeNull();
    expect(
      expectAccepted(parseProperty({ associationOrgNumber: "" })).associationOrgNumber,
    ).toBeNull();
  });

  it("000000000 godtas", () => {
    expect(
      expectAccepted(parseProperty({ associationOrgNumber: "000000000" })).associationOrgNumber,
    ).toBe("000000000");
  });

  it.each(["00000000", "0000000000", "00000000a"])(
    "«%s» gir «Organisasjonsnummeret må ha ni sifre.»",
    (value) => {
      expectFieldMessage(
        parseProperty({ associationOrgNumber: value }),
        "associationOrgNumber",
        ORG_NUMBER,
      );
    },
  );
});

describe("2.9 andels- eller aksjenummer", () => {
  it("valgfritt: tom blir null", () => {
    expect(expectAccepted(parseProperty({})).shareNumber ?? null).toBeNull();
    expect(expectAccepted(parseProperty({ shareNumber: "" })).shareNumber).toBeNull();
  });

  it("«0-0» og 20 tegn godtas, 21 avvises", () => {
    expect(expectAccepted(parseProperty({ shareNumber: "0-0" })).shareNumber).toBe("0-0");
    // Aldri 11 sifre på rad, så grensen ikke blandes med fødselsnummer-sjekken
    const twenty = "0000-0000-0000-00000";
    const twentyOne = "0000-0000-0000-000000";
    expect(twenty).toHaveLength(20);
    expect(twentyOne).toHaveLength(21);
    expectAccepted(parseProperty({ shareNumber: twenty }));
    expectRejected(parseProperty({ shareNumber: twentyOne }), "shareNumber");
  });

  it.each(["A12", "0 0", "0/0"])(
    "«%s» gir «Andelsnummeret kan bare ha sifre og bindestrek.»",
    (value) => {
      expectFieldMessage(parseProperty({ shareNumber: value }), "shareNumber", SHARE_NUMBER);
    },
  );
});

describe("2.10 fellesdeler", () => {
  it("tomt skjema godtas: ingen forretningsfører, ingen notater, unknown på begge", () => {
    const data = expectAccepted(parseCommonAreas({}));
    expect(data.managingAgent ?? null).toBeNull();
    expect(data.notes ?? null).toBeNull();
    expect(data.conditionReportStatus).toBe("unknown");
    expect(data.maintenancePlanStatus).toBe("unknown");
  });

  it("tom tekst blir null, og verdiene trimmes", () => {
    expect(expectAccepted(parseCommonAreas({ managingAgent: "  " })).managingAgent).toBeNull();
    expect(expectAccepted(parseCommonAreas({ notes: "" })).notes).toBeNull();
    const data = expectAccepted(
      parseCommonAreas({ managingAgent: " Forvalter Test ", notes: " Sett trapperom og kjeller " }),
    );
    expect(data.managingAgent).toBe("Forvalter Test");
    expect(data.notes).toBe("Sett trapperom og kjeller");
  });

  it("forretningsfører: 200 tegn godtas, 201 avvises", () => {
    expectAccepted(parseCommonAreas({ managingAgent: "F".repeat(200) }));
    expectRejected(parseCommonAreas({ managingAgent: "F".repeat(201) }), "managingAgent");
  });

  it("notater: 2000 tegn godtas, 2001 avvises", () => {
    expectAccepted(parseCommonAreas({ notes: "N".repeat(2000) }));
    expectRejected(parseCommonAreas({ notes: "N".repeat(2001) }), "notes");
  });

  it.each(
    ["conditionReportStatus", "maintenancePlanStatus"].flatMap((field) =>
      [...YES_NO_UNKNOWN].map((code) => [field, code] as const),
    ),
  )("%s = %s godtas", (field, code) => {
    expect(expectAccepted(parseCommonAreas({ [field]: code }))[field]).toBe(code);
  });

  it.each(["conditionReportStatus", "maintenancePlanStatus"])(
    "%s med ukjent kode «maybe» avvises",
    (field) => {
      expectRejected(parseCommonAreas({ [field]: "maybe" }), field);
    },
  );
});

describe("2.11 fødselsnummer i fritekst", () => {
  const FIELDS = [
    ["address", parseProperty],
    ["city", parseProperty],
    ["municipalityName", parseProperty],
    ["associationName", parseProperty],
    ["managingAgent", parseCommonAreas],
    ["notes", parseCommonAreas],
  ] as const;

  it.each(
    FIELDS.flatMap(([field, parse]) =>
      ["12345678901", "Testveien 12345678901"].map((value) => [field, value, parse] as const),
    ),
  )("%s «%s» gir «Fødselsnummer skal ikke lagres her.»", (field, value, parse) => {
    expectFieldMessage(parse({ [field]: value }), field, NATIONAL_ID);
  });

  it.each(FIELDS)("%s: 10 sifre på rad godtas", (field, parse) => {
    expectAccepted(parse({ [field]: "Test 0000000000" }));
  });
});

describe("2.12 id-er og datakilde i input brukes aldri", () => {
  const FOREIGN = "0190a000-0000-7000-8000-000000000002";

  it.each(["organizationId", "id", "propertyId", "dataSource", "assignmentId"])(
    "propertyInputSchema: %s fjernes eller avvises, og er aldri med i resultatet",
    (field) => {
      const result = parseProperty({ [field]: field === "dataSource" ? "kartverket" : FOREIGN });
      if (result.success) {
        expect(Object.keys(result.data as object)).not.toContain(field);
        expect(JSON.stringify(result.data)).not.toContain(FOREIGN);
        expect(JSON.stringify(result.data)).not.toContain("kartverket");
      }
    },
  );

  it.each(["organizationId", "id", "assignmentId"])(
    "commonAreasInputSchema: %s fjernes eller avvises, og er aldri med i resultatet",
    (field) => {
      const result = parseCommonAreas({ [field]: FOREIGN });
      if (result.success) {
        expect(Object.keys(result.data as object)).not.toContain(field);
        expect(JSON.stringify(result.data)).not.toContain(FOREIGN);
      }
    },
  );
});

describe("2.13 alle norske meldinger i kortet er dekket", () => {
  it("CommonAreasNotApplicableError har kortets melding", () => {
    expect(new CommonAreasNotApplicableError().message).toBe(NOT_APPLICABLE);
    usedMessages.add(NOT_APPLICABLE);
  });

  // Står sist i filen: testene kjører i rekkefølge, så alle meldingene over er samlet nå.
  it("hver av meldingene er brukt i minst én test over", () => {
    expect([...CARD_MESSAGES].filter((message) => !usedMessages.has(message))).toEqual([]);
  });
});
