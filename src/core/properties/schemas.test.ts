import { describe, expect, it } from "vitest";
import { HOUSING_TYPES, OWNERSHIP_FORMS, YES_NO_UNKNOWN } from "./codes";
import { CommonAreasNotApplicableError } from "./errors";
import { commonAreasInputSchema, propertyInputSchema } from "./schemas";

/*
 * Skjemaene for eiendom og fellesdeler (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md
 * avsnitt 2). Ren enhetstest. Feilmeldingene er fra kortet punkt 8; meldinger for for lange
 * tekster står ikke i kortet, så der sjekkes bare at feilen står ved feltet.
 *
 * Testdata er oppdiktet: «Testveien 1», 0000, «Testby», «Testkommune», gnr/bnr 999,
 * «Borettslaget Test», 000000000, 0-0, «Forvalter Test». «Fødselsnummer» er alltid 12345678901
 * (oppdiktet, 11 sifre).
 *
 * Støtter hovedmål: reklamasjoner (bare faste koder, riktig matrikkelform, aldri fødselsnummer)
 * og tid (feil vises ved feltet med én fast tekst).
 */

const ADDRESS = "Skriv inn adressen.";
const HOUSING = "Velg boligtype.";
const OWNERSHIP = "Velg eierform.";
const GNR_REQUIRED = "Skriv inn gårdsnummer.";
const BNR_REQUIRED = "Skriv inn bruksnummer.";
const GNR_DIGITS = "Gårdsnummer kan bare ha sifre.";
const BNR_DIGITS = "Bruksnummer kan bare ha sifre.";
const FNR_DIGITS = "Festenummer kan bare ha sifre.";
const SNR_DIGITS = "Seksjonsnummer kan bare ha sifre.";
const POSTAL = "Postnummeret må ha fire sifre.";
const MUNICIPALITY = "Kommunenummeret må ha fire sifre.";
const ORG_NUMBER = "Organisasjonsnummeret må ha ni sifre.";
const SHARE = "Nummeret kan bare ha sifre og bindestrek.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const NOT_APPLICABLE =
  "Fellesdeler gjelder bare leilighet, eierseksjon, borettslag og aksjeleilighet.";

/** Alle norske meldinger i kortet punkt 7 og 8. Hver må brukes i minst én test (2.13). */
const CARD_MESSAGES = [
  ADDRESS,
  HOUSING,
  OWNERSHIP,
  GNR_REQUIRED,
  BNR_REQUIRED,
  GNR_DIGITS,
  BNR_DIGITS,
  FNR_DIGITS,
  SNR_DIGITS,
  POSTAL,
  MUNICIPALITY,
  ORG_NUMBER,
  SHARE,
  NATIONAL_ID,
  NOT_APPLICABLE,
];
const usedMessages = new Set<string>();

const NATIONAL_ID_VALUE = "12345678901";

const VALID_PROPERTY = {
  address: "Testveien 1",
  housingType: "detached",
  ownershipForm: "freehold",
  gnr: "999",
  bnr: "999",
};

const FULL_PROPERTY = {
  ...VALID_PROPERTY,
  postalCode: "0000",
  city: "Testby",
  municipalityNumber: "0000",
  municipalityName: "Testkommune",
  fnr: "0",
  snr: "9",
  associationName: "Borettslaget Test",
  associationOrgNumber: "000000000",
  shareNumber: "0-0",
};

type Schema = typeof propertyInputSchema | typeof commonAreasInputSchema;

function parse(schema: Schema, input: Record<string, unknown>) {
  return schema.safeParse(input);
}

function parseProperty(overrides: Record<string, unknown>) {
  return parse(propertyInputSchema, { ...VALID_PROPERTY, ...overrides });
}

function parseCommon(overrides: Record<string, unknown>) {
  return parse(commonAreasInputSchema, overrides);
}

type Result = ReturnType<typeof parse>;

/** Meldingene for feltet når skjemaet avviser. */
function messagesFor(result: Result, field: string): string[] {
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => String(issue.path[0] ?? "") === field)
    .map((issue) => issue.message);
}

function expectFieldMessage(result: Result, field: string, message: string) {
  expect(result.success, `${field} skulle vært avvist`).toBe(false);
  expect(messagesFor(result, field)).toContain(message);
  usedMessages.add(message);
}

function expectRejected(result: Result, field: string) {
  expect(result.success, `${field} skulle vært avvist`).toBe(false);
  expect(messagesFor(result, field).length, `feilen står ved ${field}`).toBeGreaterThan(0);
}

function expectAccepted(result: Result): Record<string, unknown> {
  expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  return result.success ? (result.data as Record<string, unknown>) : {};
}

describe("2.1 adresse", () => {
  it.each([
    ["tom", ""],
    ["bare mellomrom", "   "],
    ["mangler", undefined],
  ])("%s → «Skriv inn adressen.»", (_name, address) => {
    expectFieldMessage(parseProperty({ address }), "address", ADDRESS);
  });

  it("200 tegn godtas, 201 avvises", () => {
    expectAccepted(parseProperty({ address: "a".repeat(200) }));
    expectRejected(parseProperty({ address: "a".repeat(201) }), "address");
  });

  it("trimmes", () => {
    expect(expectAccepted(parseProperty({ address: "  Testveien 1  " })).address).toBe(
      "Testveien 1",
    );
  });

  it("200 tegn med mellomrom rundt godtas (trimmes før lengden sjekkes)", () => {
    expectAccepted(parseProperty({ address: ` ${"a".repeat(200)} ` }));
  });
});

describe("2.2 postnummer og kommunenummer", () => {
  it.each([
    ["postalCode", POSTAL],
    ["municipalityNumber", MUNICIPALITY],
  ])("%s er valgfritt: tom og mellomrom blir null, mangler går bra", (field) => {
    expect(expectAccepted(parseProperty({ [field]: "" }))[field]).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "  " }))[field]).toBeNull();
    const missing = expectAccepted(parseProperty({}))[field];
    expect(missing === null || missing === undefined).toBe(true);
  });

  it.each([
    ["postalCode", POSTAL, "000"],
    ["postalCode", POSTAL, "00000"],
    ["postalCode", POSTAL, "00a0"],
    ["municipalityNumber", MUNICIPALITY, "000"],
    ["municipalityNumber", MUNICIPALITY, "00000"],
    ["municipalityNumber", MUNICIPALITY, "00a0"],
  ])("%s «%s»: «%s» avvises", (field, message, value) => {
    const result = parseProperty({ [field]: value });
    if (value === "00a0") expectRejected(result, field);
    else expectFieldMessage(result, field, message);
  });

  it.each(["postalCode", "municipalityNumber"])("%s med fire sifre godtas og trimmes", (field) => {
    expect(expectAccepted(parseProperty({ [field]: " 0000 " }))[field]).toBe("0000");
  });
});

describe("2.3 poststed og kommunenavn", () => {
  it.each(["city", "municipalityName"])(
    "%s er valgfritt; 100 tegn godtas, 101 avvises, trimmes",
    (field) => {
      expect(expectAccepted(parseProperty({ [field]: "" }))[field]).toBeNull();
      expect(expectAccepted(parseProperty({ [field]: "   " }))[field]).toBeNull();
      expectAccepted(parseProperty({ [field]: "a".repeat(100) }));
      expectRejected(parseProperty({ [field]: "a".repeat(101) }), field);
      expect(expectAccepted(parseProperty({ [field]: "  Testby  " }))[field]).toBe("Testby");
    },
  );
});

describe("2.4 boligtype og eierform", () => {
  it.each([
    ["mangler", undefined],
    ["tom", ""],
    ["ukjent", "villa"],
    ["stor forbokstav", "Detached"],
    ["norsk navn", "Enebolig"],
    ["eierformkode", "bond"],
  ])("boligtype %s → «Velg boligtype.»", (_name, housingType) => {
    expectFieldMessage(parseProperty({ housingType }), "housingType", HOUSING);
  });

  it.each([
    ["mangler", undefined],
    ["tom", ""],
    ["ukjent", "villa"],
    ["obligasjon (A69)", "bond"],
    ["norsk navn", "Selveier"],
  ])("eierform %s → «Velg eierform.»", (_name, ownershipForm) => {
    expectFieldMessage(parseProperty({ ownershipForm }), "ownershipForm", OWNERSHIP);
  });

  it.each([...HOUSING_TYPES])("boligtypen %s godtas", (housingType) => {
    expect(expectAccepted(parseProperty({ housingType })).housingType).toBe(housingType);
  });

  it.each([...OWNERSHIP_FORMS])("eierformen %s godtas", (ownershipForm) => {
    expect(expectAccepted(parseProperty({ ownershipForm })).ownershipForm).toBe(ownershipForm);
  });
});

describe("2.5 gnr og bnr", () => {
  it.each([
    ["gnr", GNR_REQUIRED],
    ["bnr", BNR_REQUIRED],
  ])("%s tom, mellomrom eller mangler → «%s»", (field, message) => {
    expectFieldMessage(parseProperty({ [field]: "" }), field, message);
    expectFieldMessage(parseProperty({ [field]: "  " }), field, message);
    expectFieldMessage(parseProperty({ [field]: undefined }), field, message);
  });

  it.each(["gnr", "bnr"])("%s: 1 og 5 sifre godtas, 6 sifre avvises, trimmes", (field) => {
    expect(expectAccepted(parseProperty({ [field]: "1" }))[field]).toBe("1");
    expect(expectAccepted(parseProperty({ [field]: "99999" }))[field]).toBe("99999");
    expect(expectAccepted(parseProperty({ [field]: " 999 " }))[field]).toBe("999");
    expectRejected(parseProperty({ [field]: "999999" }), field);
  });

  it.each([
    ["gnr", GNR_DIGITS, "12a"],
    ["gnr", GNR_DIGITS, "-1"],
    ["gnr", GNR_DIGITS, "1 2"],
    ["bnr", BNR_DIGITS, "12a"],
    ["bnr", BNR_DIGITS, "1.5"],
  ])("%s → «%s» for «%s»", (field, message, value) => {
    expectFieldMessage(parseProperty({ [field]: value }), field, message);
  });
});

describe("2.6 fnr og snr", () => {
  it.each(["fnr", "snr"])("%s er valgfritt: mangler og tom blir null", (field) => {
    expect(expectAccepted(parseProperty({}))[field] ?? null).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "" }))[field]).toBeNull();
    expect(expectAccepted(parseProperty({ [field]: "  " }))[field]).toBeNull();
  });

  it.each(["fnr", "snr"])("%s: 1–5 sifre godtas, 6 avvises", (field) => {
    expect(expectAccepted(parseProperty({ [field]: "0" }))[field]).toBe("0");
    expect(expectAccepted(parseProperty({ [field]: "99999" }))[field]).toBe("99999");
    expectRejected(parseProperty({ [field]: "999999" }), field);
  });

  it.each([
    ["fnr", FNR_DIGITS],
    ["snr", SNR_DIGITS],
  ])("%s med bokstaver → «%s»", (field, message) => {
    expectFieldMessage(parseProperty({ [field]: "9b" }), field, message);
  });
});

describe("2.7 borettslag eller sameie", () => {
  it("valgfritt; 200 tegn godtas, 201 avvises, trimmes, tom blir null", () => {
    expect(expectAccepted(parseProperty({ associationName: "" })).associationName).toBeNull();
    expectAccepted(parseProperty({ associationName: "a".repeat(200) }));
    expectRejected(parseProperty({ associationName: "a".repeat(201) }), "associationName");
    expect(
      expectAccepted(parseProperty({ associationName: "  Borettslaget Test  " })).associationName,
    ).toBe("Borettslaget Test");
  });
});

describe("2.8 organisasjonsnummer", () => {
  it("valgfritt; tom blir null; 000000000 godtas", () => {
    expect(
      expectAccepted(parseProperty({ associationOrgNumber: "" })).associationOrgNumber,
    ).toBeNull();
    expect(
      expectAccepted(parseProperty({ associationOrgNumber: "000000000" })).associationOrgNumber,
    ).toBe("000000000");
  });

  it.each(["00000000", "0000000000", "00000000a"])(
    "«%s» → «Organisasjonsnummeret må ha ni sifre.»",
    (value) => {
      expectFieldMessage(
        parseProperty({ associationOrgNumber: value }),
        "associationOrgNumber",
        ORG_NUMBER,
      );
    },
  );
});

describe("2.9 andelsnummer", () => {
  it("valgfritt; tom blir null; 0-0 og 20 tegn godtas", () => {
    expect(expectAccepted(parseProperty({ shareNumber: "" })).shareNumber).toBeNull();
    expect(expectAccepted(parseProperty({ shareNumber: "0-0" })).shareNumber).toBe("0-0");
    expectAccepted(parseProperty({ shareNumber: "0".repeat(20) }));
    expectAccepted(parseProperty({ shareNumber: "0000000000-000000000" }));
  });

  it("21 tegn avvises", () => {
    expectRejected(parseProperty({ shareNumber: "0".repeat(21) }), "shareNumber");
  });

  it.each(["A12", "1 2", "1/2", "0 0", "0/0"])(
    "«%s» → «Nummeret kan bare ha sifre og bindestrek.»",
    (value) => {
      expectFieldMessage(parseProperty({ shareNumber: value }), "shareNumber", SHARE);
    },
  );
});

describe("2.10 fellesdeler", () => {
  it("alt tomt godtas: forretningsfører og notater blir null, ja/nei/vet ikke blir unknown", () => {
    const data = expectAccepted(parseCommon({}));
    expect(data.managingAgent ?? null).toBeNull();
    expect(data.notes ?? null).toBeNull();
    expect(data.conditionReportStatus).toBe("unknown");
    expect(data.maintenancePlanStatus).toBe("unknown");
  });

  it("tom tekst blir null", () => {
    const data = expectAccepted(parseCommon({ managingAgent: "  ", notes: "" }));
    expect(data.managingAgent).toBeNull();
    expect(data.notes).toBeNull();
  });

  it("forretningsfører: 200 tegn godtas, 201 avvises, trimmes", () => {
    expectAccepted(parseCommon({ managingAgent: "a".repeat(200) }));
    expectRejected(parseCommon({ managingAgent: "a".repeat(201) }), "managingAgent");
    expect(expectAccepted(parseCommon({ managingAgent: " Forvalter Test " })).managingAgent).toBe(
      "Forvalter Test",
    );
  });

  it("notater: 2000 tegn godtas, 2001 avvises, trimmes", () => {
    expectAccepted(parseCommon({ notes: "a".repeat(2000) }));
    expectRejected(parseCommon({ notes: "a".repeat(2001) }), "notes");
    expect(expectAccepted(parseCommon({ notes: " Sett trapperom og kjeller " })).notes).toBe(
      "Sett trapperom og kjeller",
    );
  });

  it.each(
    ["conditionReportStatus", "maintenancePlanStatus"].flatMap((field) =>
      YES_NO_UNKNOWN.map((code) => [field, code] as const),
    ),
  )("%s = %s godtas", (field, code) => {
    expect(expectAccepted(parseCommon({ [field]: code }))[field]).toBe(code);
  });

  it.each(["conditionReportStatus", "maintenancePlanStatus"])(
    "%s med ukjent kode avvises",
    (field) => {
      expectRejected(parseCommon({ [field]: "maybe" }), field);
      expectRejected(parseCommon({ [field]: "Ja" }), field);
    },
  );
});

describe("2.11 fødselsnummer i fritekst", () => {
  const PROPERTY_TEXT = ["address", "city", "municipalityName", "associationName"] as const;
  const COMMON_TEXT = ["managingAgent", "notes"] as const;

  it.each(PROPERTY_TEXT)(
    "eiendom: %s med 11 sifre på rad → «Fødselsnummer skal ikke lagres her.»",
    (field) => {
      expectFieldMessage(parseProperty({ [field]: NATIONAL_ID_VALUE }), field, NATIONAL_ID);
      expectFieldMessage(
        parseProperty({ [field]: `Testveien ${NATIONAL_ID_VALUE}` }),
        field,
        NATIONAL_ID,
      );
    },
  );

  it.each(COMMON_TEXT)(
    "fellesdeler: %s med 11 sifre på rad → «Fødselsnummer skal ikke lagres her.»",
    (field) => {
      expectFieldMessage(parseCommon({ [field]: NATIONAL_ID_VALUE }), field, NATIONAL_ID);
      expectFieldMessage(
        parseCommon({ [field]: `Testveien ${NATIONAL_ID_VALUE}` }),
        field,
        NATIONAL_ID,
      );
    },
  );

  it.each(PROPERTY_TEXT)("eiendom: %s med 10 sifre godtas", (field) => {
    expectAccepted(parseProperty({ [field]: "Test 1234567890" }));
  });

  it.each(COMMON_TEXT)("fellesdeler: %s med 10 sifre godtas", (field) => {
    expectAccepted(parseCommon({ [field]: "Test 1234567890" }));
  });
});

describe("2.12 felt som ikke hører hjemme i skjemaet", () => {
  const FOREIGN = {
    organizationId: "0190a000-0000-7000-8000-000000000002",
    id: "0190a000-0000-7000-8000-000000000003",
    propertyId: "0190a000-0000-7000-8000-000000000004",
    assignmentId: "0190a000-0000-7000-8000-000000000005",
    dataSource: "kartverket",
  };

  it("eiendom: organizationId, id, propertyId, assignmentId og dataSource er aldri med i resultatet", () => {
    const result = parseProperty(FOREIGN);
    if (!result.success) return; // strengt skjema avviser; det er også greit
    for (const key of Object.keys(FOREIGN)) {
      expect(result.data as Record<string, unknown>, key).not.toHaveProperty(key);
    }
  });

  it("fellesdeler: organizationId, id og assignmentId er aldri med i resultatet", () => {
    const result = parseCommon(FOREIGN);
    if (!result.success) return;
    for (const key of Object.keys(FOREIGN)) {
      expect(result.data as Record<string, unknown>, key).not.toHaveProperty(key);
    }
  });
});

describe("hele skjemaet", () => {
  it("alle feltene fylt ut godtas med verdiene uendret", () => {
    expect(expectAccepted(parse(propertyInputSchema, FULL_PROPERTY))).toMatchObject(FULL_PROPERTY);
  });

  it("minste gyldige eiendom: valgfrie felt blir null", () => {
    const data = expectAccepted(parse(propertyInputSchema, VALID_PROPERTY));
    for (const field of [
      "postalCode",
      "city",
      "municipalityNumber",
      "municipalityName",
      "fnr",
      "snr",
      "associationName",
      "associationOrgNumber",
      "shareNumber",
    ]) {
      expect(data[field] ?? null, field).toBeNull();
    }
  });

  it("CommonAreasNotApplicableError har kortets tekst", () => {
    const error = new CommonAreasNotApplicableError();
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(NOT_APPLICABLE);
    usedMessages.add(NOT_APPLICABLE);
  });
});

describe("2.13 alle meldingene i kortet er dekket", () => {
  it("hver norske melding i kortet punkt 7–8 er brukt i en test over", () => {
    expect(CARD_MESSAGES.filter((message) => !usedMessages.has(message))).toEqual([]);
  });
});
