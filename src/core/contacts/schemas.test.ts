import { describe, expect, it } from "vitest";
import { FIRM_TYPES } from "./codes";
import { contactInputSchema, firmInputSchema } from "./schemas";

/*
 * Skjemaene for firma og kontakt, som testsaker i data. Testplan:
 * docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 3.
 *
 * Grensene prøves med n (godtas) og n+1 (avvises), ett `it.each` per grense. Testdata er
 * oppdiktet: «Megler Test», «Testmegling AS», megler@example.com, telefon 00000000.
 * «Fødselsnummer» er alltid 12345678901 (oppdiktet).
 *
 * Støtter hovedmål: reklamasjoner (ugyldig organisasjonsnummer og fødselsnummer stoppes før
 * lagring) og tid (feilen står ved feltet med en norsk tekst).
 */

const FIRM_NOT_FOUND = "Firmaet finnes ikke.";
const CARD_MESSAGES = [
  "Skriv inn navnet.",
  "Skriv inn fornavnet.",
  "Organisasjonsnummeret må ha 9 sifre.",
  "Organisasjonsnummeret er ikke gyldig.",
  "E-postadressen er ikke gyldig.",
  "Telefonnummeret kan bare ha sifre, mellomrom og +.",
  "Fødselsnummer skal ikke lagres her.",
  FIRM_NOT_FOUND,
];

const NATIONAL_ID = "12345678901";

/** Meldingene testene har sett, til sjekken i 3.11. */
const seen = new Set<string>();

type Schema = typeof firmInputSchema | typeof contactInputSchema;

/** Meldingene ved feltet når skjemaet avviser, ellers tom liste. */
function messagesAt(schema: Schema, input: Record<string, unknown>, field: string): string[] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  const messages = result.error.issues
    .filter((issue) => String(issue.path[0] ?? "") === field)
    .map((issue) => issue.message);
  for (const message of messages) seen.add(message);
  return messages;
}

function firm(overrides: Record<string, unknown> = {}) {
  return { name: "Testmegling AS", ...overrides };
}

function contact(overrides: Record<string, unknown> = {}) {
  return { firstName: "Megler", lastName: "Test", ...overrides };
}

function parseFirm(input: Record<string, unknown>) {
  return firmInputSchema.parse(input);
}

function parseContact(input: Record<string, unknown>) {
  return contactInputSchema.parse(input);
}

/** En gyldig e-postadresse med nøyaktig `length` tegn (lokal del «megler», korte domeneledd). */
function emailOfLength(length: number): string {
  const start = "megler@";
  const end = "example.com";
  let middle = "";
  while (start.length + middle.length + end.length < length) {
    const left = length - start.length - middle.length - end.length;
    // Ett ledd er høyst 50 tegn pluss punktum, og siste ledd får minst ett tegn
    const take = Math.min(50, left - 1);
    middle += take > 0 ? `${"a".repeat(take)}.` : "";
    if (take <= 0) break;
  }
  const value = `${start}${middle}${end}`;
  if (value.length !== length) throw new Error(`fikk ikke e-post med ${length} tegn`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// 3.1 Grenser
// ---------------------------------------------------------------------------------------------

describe("3.1 grenser (n godtas, n+1 avvises)", () => {
  it.each([
    [200, true],
    [201, false],
  ])("200 (firmanavn): %i tegn → godtas %s", (length, ok) => {
    const input = firm({ name: "a".repeat(length) });
    expect(firmInputSchema.safeParse(input).success).toBe(ok);
    if (!ok) expect(messagesAt(firmInputSchema, input, "name").length).toBeGreaterThan(0);
  });

  it.each([
    ["firstName", 100, true],
    ["firstName", 101, false],
    ["lastName", 100, true],
    ["lastName", 101, false],
  ])("100 (fornavn og etternavn): %s med %i tegn → godtas %s", (field, length, ok) => {
    const input = contact({ [field]: "a".repeat(length) });
    expect(contactInputSchema.safeParse(input).success).toBe(ok);
    if (!ok) expect(messagesAt(contactInputSchema, input, field).length).toBeGreaterThan(0);
  });

  it.each([
    [254, true],
    [255, false],
  ])("254 (e-post): %i tegn → godtas %s", (length, ok) => {
    const input = contact({ email: emailOfLength(length) });
    expect(contactInputSchema.safeParse(input).success).toBe(ok);
    if (!ok) expect(messagesAt(contactInputSchema, input, "email").length).toBeGreaterThan(0);
  });

  it.each([
    [20, true],
    [21, false],
  ])("20 (telefon): %i tegn → godtas %s", (length, ok) => {
    // Mellomrom inni (aldri først eller sist), så det aldri blir 11 sifre på rad
    const phone = Array.from({ length }, (_, index) => (index % 5 === 2 ? " " : "0")).join("");
    expect(phone).toHaveLength(length);
    const input = contact({ phone });
    expect(contactInputSchema.safeParse(input).success).toBe(ok);
    if (!ok) expect(messagesAt(contactInputSchema, input, "phone").length).toBeGreaterThan(0);
  });

  it.each([
    ["firma", 1000, true],
    ["firma", 1001, false],
    ["kontakt", 1000, true],
    ["kontakt", 1001, false],
  ] as const)("1000 (notat): %s med %i tegn → godtas %s", (kind, length, ok) => {
    const schema = kind === "firma" ? firmInputSchema : contactInputSchema;
    const input =
      kind === "firma"
        ? firm({ notes: "a".repeat(length) })
        : contact({ notes: "a".repeat(length) });
    expect(schema.safeParse(input).success).toBe(ok);
    if (!ok) expect(messagesAt(schema, input, "notes").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.2 – 3.6
// ---------------------------------------------------------------------------------------------

describe("3.2 påkrevd", () => {
  it.each(["", "   "])("firmanavn %j → «Skriv inn navnet.»", (name) => {
    expect(messagesAt(firmInputSchema, firm({ name }), "name")).toContain("Skriv inn navnet.");
  });

  it("firmanavn som mangler → «Skriv inn navnet.»", () => {
    expect(messagesAt(firmInputSchema, {}, "name")).toContain("Skriv inn navnet.");
  });

  it.each(["", "   "])("fornavn %j → «Skriv inn fornavnet.»", (firstName) => {
    expect(messagesAt(contactInputSchema, contact({ firstName }), "firstName")).toContain(
      "Skriv inn fornavnet.",
    );
  });
});

describe("3.3 organisasjonsnummer", () => {
  it.each([undefined, null, "", "   "])("%j → null", (orgNumber) => {
    expect(parseFirm(firm({ orgNumber })).orgNumber).toBeNull();
  });

  it.each(["00000001", "0000000190"])("%s → «må ha 9 sifre»", (orgNumber) => {
    expect(messagesAt(firmInputSchema, firm({ orgNumber }), "orgNumber")).toEqual([
      "Organisasjonsnummeret må ha 9 sifre.",
    ]);
  });

  it("000000018 → «ikke gyldig»", () => {
    expect(messagesAt(firmInputSchema, firm({ orgNumber: "000000018" }), "orgNumber")).toEqual([
      "Organisasjonsnummeret er ikke gyldig.",
    ]);
  });

  it("000 000 019 lagres som 000000019", () => {
    expect(parseFirm(firm({ orgNumber: "000 000 019" })).orgNumber).toBe("000000019");
  });
});

describe("3.4 firmatype", () => {
  it("mangler → broker_firm", () => {
    expect(parseFirm(firm()).firmType).toBe("broker_firm");
  });

  it.each([...FIRM_TYPES])("%s godtas", (firmType) => {
    expect(parseFirm(firm({ firmType })).firmType).toBe(firmType);
  });

  it("bank avvises", () => {
    expect(
      messagesAt(firmInputSchema, firm({ firmType: "bank" }), "firmType").length,
    ).toBeGreaterThan(0);
  });
});

describe("3.5 e-post", () => {
  it("megler@example.com godtas", () => {
    expect(parseContact(contact({ email: "megler@example.com" })).email).toBe("megler@example.com");
  });

  it("ikke-epost → «E-postadressen er ikke gyldig.»", () => {
    expect(messagesAt(contactInputSchema, contact({ email: "ikke-epost" }), "email")).toContain(
      "E-postadressen er ikke gyldig.",
    );
  });
});

describe("3.6 telefon", () => {
  it.each(["00000000", "+47 000 00 000"])("%s godtas", (phone) => {
    expect(parseContact(contact({ phone })).phone).toBe(phone);
  });

  it.each(["00-00", "abc"])("%s → telefonmeldingen", (phone) => {
    expect(messagesAt(contactInputSchema, contact({ phone }), "phone")).toContain(
      "Telefonnummeret kan bare ha sifre, mellomrom og +.",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 3.7 Fødselsnummer
// ---------------------------------------------------------------------------------------------

type PersonField = {
  name: string;
  schema: Schema;
  build: (value: string) => Record<string, unknown>;
  field: string;
};

const PERSON_FIELDS: PersonField[] = [
  { name: "firmanavn", schema: firmInputSchema, build: (v) => firm({ name: v }), field: "name" },
  {
    name: "fornavn",
    schema: contactInputSchema,
    build: (v) => contact({ firstName: v }),
    field: "firstName",
  },
  {
    name: "etternavn",
    schema: contactInputSchema,
    build: (v) => contact({ lastName: v }),
    field: "lastName",
  },
  {
    name: "notat på firma",
    schema: firmInputSchema,
    build: (v) => firm({ notes: v }),
    field: "notes",
  },
  {
    name: "notat på kontakt",
    schema: contactInputSchema,
    build: (v) => contact({ notes: v }),
    field: "notes",
  },
];

describe("3.7 fødselsnummer", () => {
  it.each(PERSON_FIELDS)("$name: 11 sifre avvises", ({ schema, build, field }) => {
    expect(messagesAt(schema, build(NATIONAL_ID), field)).toContain(
      "Fødselsnummer skal ikke lagres her.",
    );
    expect(messagesAt(schema, build(`Notat ${NATIONAL_ID} her`), field)).toContain(
      "Fødselsnummer skal ikke lagres her.",
    );
  });

  it.each(PERSON_FIELDS)("$name: 10 sifre godtas", ({ schema, build }) => {
    expect(schema.safeParse(build("1234567890")).success).toBe(true);
  });

  it.each(PERSON_FIELDS)(
    "$name: 11 sifre med mellomrom etter fødselsdatoen avvises",
    ({ schema, build, field }) => {
      expect(messagesAt(schema, build("Notat 123456 78901 her"), field)).toContain(
        "Fødselsnummer skal ikke lagres her.",
      );
    },
  );

  it("telefon: 11 sifre avvises, vanlige telefonnumre godtas", () => {
    for (const phone of [NATIONAL_ID, "123456 78901"]) {
      expect(messagesAt(contactInputSchema, contact({ phone }), "phone")).toContain(
        "Fødselsnummer skal ikke lagres her.",
      );
    }
    for (const phone of ["00000000", "+47 00000000", "0047 00000000", "000 00 000"]) {
      expect(parseContact(contact({ phone })).phone).toBe(phone);
    }
  });

  it("organisasjonsnummeret utløser aldri meldingen", () => {
    expect(parseFirm(firm({ orgNumber: "000000019" })).orgNumber).toBe("000000019");
    expect(messagesAt(firmInputSchema, firm({ orgNumber: "000000019" }), "orgNumber")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.8 – 3.10
// ---------------------------------------------------------------------------------------------

describe("3.8 trimming og tomme felt", () => {
  it("firma: verdiene trimmes, tomt notat blir null", () => {
    const values = parseFirm({
      name: "  Testmegling AS  ",
      orgNumber: " 000000019 ",
      notes: "   ",
    });
    expect(values).toMatchObject({ name: "Testmegling AS", orgNumber: "000000019", notes: null });
  });

  it("kontakt: verdiene trimmes, tom streng blir null i etternavn, e-post, telefon, firmId og notat", () => {
    expect(
      parseContact({
        firstName: "  Megler ",
        lastName: "",
        email: "",
        phone: "",
        firmId: "",
        notes: "",
      }),
    ).toEqual({
      firstName: "Megler",
      lastName: null,
      email: null,
      phone: null,
      firmId: null,
      notes: null,
    });
    expect(
      parseContact({
        firstName: "Megler",
        lastName: "  Test ",
        email: " megler@example.com ",
        phone: " 00000000 ",
        notes: "  Vil ha rapport før kl. 12  ",
      }),
    ).toMatchObject({
      lastName: "Test",
      email: "megler@example.com",
      phone: "00000000",
      notes: "Vil ha rapport før kl. 12",
    });
  });
});

describe("3.9 firmId", () => {
  it("ikke-uuid gir valideringsfeil ved firmId (aldri databasefeil)", () => {
    expect(messagesAt(contactInputSchema, contact({ firmId: "ikke-en-id" }), "firmId")).toEqual([
      FIRM_NOT_FOUND,
    ]);
  });

  it("uuid godtas av skjemaet (finnes den ikke, stopper tjenesten den)", () => {
    const id = "0190a000-0000-7000-8000-000000000001";
    expect(parseContact(contact({ firmId: id })).firmId).toBe(id);
  });
});

describe("3.10 source og organizationId i input ignoreres", () => {
  it("kontakt", () => {
    const values = parseContact(
      contact({ source: "order", organizationId: "0190a000-0000-7000-8000-000000000002" }),
    ) as Record<string, unknown>;
    expect(values).not.toHaveProperty("source");
    expect(values).not.toHaveProperty("organizationId");
  });

  it("firma", () => {
    const values = parseFirm(
      firm({ organizationId: "0190a000-0000-7000-8000-000000000002", source: "order" }),
    ) as Record<string, unknown>;
    expect(values).not.toHaveProperty("organizationId");
    expect(values).not.toHaveProperty("source");
  });
});

describe("3.11 alle norske meldinger i kortet er brukt", () => {
  it("hver melding fra kortet punkt 5 er sett i minst én test over", () => {
    const missing = CARD_MESSAGES.filter((message) => !seen.has(message));
    expect(missing).toEqual([]);
  });
});
