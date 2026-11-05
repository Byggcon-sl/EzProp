import { describe, expect, it } from "vitest";
import { contactInputSchema, firmInputSchema } from "./schemas";

/*
 * Skjemaene for firma og kontakt som data (grenser, meldinger, trimming).
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 3.
 * Testdata er oppdiktet. «Fødselsnummeret» 12345678901 er oppdiktet.
 * Støtter hovedmål: reklamasjoner (feil stoppes ved feltet, ingen fødselsnummer lagres).
 */

const FIRM = { name: "Testmegling AS", orgNumber: "000000019", firmType: "broker_firm" };
const CONTACT = { firstName: "Megler", lastName: "Test" };
const UUID = "0190f5b2-7c4e-7a3b-9d2e-1f2a3b4c5d6e";

function firmMessages(input: Record<string, unknown>): string[] {
  const result = firmInputSchema.safeParse({ ...FIRM, ...input });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

function contactMessages(input: Record<string, unknown>): string[] {
  const result = contactInputSchema.safeParse({ ...CONTACT, ...input });
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

const letters = (n: number) => "a".repeat(n);

describe("grenser (n godtas, n+1 avvises)", () => {
  it("200: firmanavn", () => {
    expect(firmMessages({ name: letters(200) })).toEqual([]);
    expect(firmMessages({ name: letters(201) })).toEqual(["Navnet kan ha høyst 200 tegn."]);
  });

  it.each([
    ["firstName", "Fornavnet kan ha høyst 100 tegn."],
    ["lastName", "Etternavnet kan ha høyst 100 tegn."],
  ])("100: %s", (field, message) => {
    expect(contactMessages({ [field]: letters(100) })).toEqual([]);
    expect(contactMessages({ [field]: letters(101) })).toEqual([message]);
  });

  it("254: e-post", () => {
    const at254 = `${letters(242)}@example.com`;
    expect(at254).toHaveLength(254);
    expect(contactMessages({ email: at254 })).toEqual([]);
    expect(contactMessages({ email: `a${at254}` })).toEqual(["E-postadressen er ikke gyldig."]);
  });

  it("20: telefon", () => {
    expect(contactMessages({ phone: "0".repeat(20) })).toEqual([]);
    expect(contactMessages({ phone: "0".repeat(21) })).toEqual([
      "Telefonnummeret kan ha høyst 20 tegn.",
    ]);
  });

  it.each([
    ["firma", firmMessages],
    ["kontakt", contactMessages],
  ] as const)("1000: notat på %s", (_name, messages) => {
    expect(messages({ notes: letters(1000) })).toEqual([]);
    expect(messages({ notes: letters(1001) })).toEqual(["Notatet kan ha høyst 1000 tegn."]);
  });
});

describe("påkrevde felt", () => {
  it.each(["", "   "])("firmanavn %j gir «Skriv inn navnet.»", (name) => {
    expect(firmMessages({ name })).toEqual(["Skriv inn navnet."]);
  });

  it.each(["", "   "])("fornavn %j gir «Skriv inn fornavnet.»", (firstName) => {
    expect(contactMessages({ firstName })).toEqual(["Skriv inn fornavnet."]);
  });
});

describe("organisasjonsnummer", () => {
  it("tomt blir null", () => {
    expect(firmInputSchema.parse({ ...FIRM, orgNumber: "" }).orgNumber).toBeNull();
    expect(firmInputSchema.parse({ ...FIRM, orgNumber: undefined }).orgNumber).toBeNull();
  });

  it.each(["00000001", "0000000190", "000-000-019"])("%s må ha 9 sifre", (orgNumber) => {
    expect(firmMessages({ orgNumber })).toEqual(["Organisasjonsnummeret må ha 9 sifre."]);
  });

  it("feil kontrollsiffer er ikke gyldig", () => {
    expect(firmMessages({ orgNumber: "000000018" })).toEqual([
      "Organisasjonsnummeret er ikke gyldig.",
    ]);
  });

  it("lagres uten mellomrom", () => {
    expect(firmInputSchema.parse({ ...FIRM, orgNumber: " 000 000 019 " }).orgNumber).toBe(
      "000000019",
    );
  });
});

describe("firmatype", () => {
  it("mangler eller tom gir broker_firm", () => {
    expect(firmInputSchema.parse({ name: "Testmegling AS" }).firmType).toBe("broker_firm");
    expect(firmInputSchema.parse({ ...FIRM, firmType: "" }).firmType).toBe("broker_firm");
  });

  it.each(["broker_firm", "insurer", "housing_association", "other"])("%s godtas", (firmType) => {
    expect(firmInputSchema.parse({ ...FIRM, firmType }).firmType).toBe(firmType);
  });

  it("ukjent kode avvises", () => {
    expect(firmMessages({ firmType: "bank" })).toEqual(["Velg en type."]);
  });
});

describe("e-post og telefon", () => {
  it("gyldig e-post godtas, ugyldig avvises", () => {
    expect(contactMessages({ email: "megler@example.com" })).toEqual([]);
    expect(contactMessages({ email: "ikke-epost" })).toEqual(["E-postadressen er ikke gyldig."]);
  });

  it.each(["00000000", "+47 000 00 000"])("telefon %s godtas", (phone) => {
    expect(contactMessages({ phone })).toEqual([]);
  });

  it.each(["00-00", "abc"])("telefon %s avvises", (phone) => {
    expect(contactMessages({ phone })).toEqual([
      "Telefonnummeret kan bare ha sifre, mellomrom og +.",
    ]);
  });
});

describe("fødselsnummer", () => {
  const fields = [
    ["firmanavn", firmMessages, "name"],
    ["firmanotat", firmMessages, "notes"],
    ["fornavn", contactMessages, "firstName"],
    ["etternavn", contactMessages, "lastName"],
    ["kontaktnotat", contactMessages, "notes"],
  ] as const;

  it.each(fields)("%s med 11 sifre avvises", (_name, messages, field) => {
    expect(messages({ [field]: "12345678901" })).toEqual(["Fødselsnummer skal ikke lagres her."]);
    expect(messages({ [field]: "Notat 12345678901 her" })).toEqual([
      "Fødselsnummer skal ikke lagres her.",
    ]);
  });

  it.each(fields)("%s med 10 sifre godtas", (_name, messages, field) => {
    expect(messages({ [field]: "1234567890" })).toEqual([]);
  });

  it("telefon og organisasjonsnummer utløser aldri meldingen", () => {
    expect(contactMessages({ phone: "00000000" })).toEqual([]);
    expect(firmMessages({ orgNumber: "000000019" })).toEqual([]);
  });
});

describe("trimming og tomme felt", () => {
  it("verdiene trimmes", () => {
    expect(
      contactInputSchema.parse({
        firstName: "  Megler ",
        lastName: " Test ",
        email: " megler@example.com ",
        phone: " 00000000 ",
        notes: " Vil ha rapport før kl. 12 ",
      }),
    ).toEqual({
      firstName: "Megler",
      lastName: "Test",
      email: "megler@example.com",
      phone: "00000000",
      firmId: null,
      notes: "Vil ha rapport før kl. 12",
    });
    expect(firmInputSchema.parse({ name: " Testmegling AS ", notes: "  " })).toMatchObject({
      name: "Testmegling AS",
      notes: null,
    });
  });

  it("tom streng i valgfrie felt blir null", () => {
    expect(
      contactInputSchema.parse({
        firstName: "Megler",
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
  });
});

describe("firmId, source og organizationId", () => {
  it("firmId må være en uuid", () => {
    expect(contactInputSchema.parse({ ...CONTACT, firmId: UUID }).firmId).toBe(UUID);
    expect(contactMessages({ firmId: "ikke-en-id" })).toEqual(["Firmaet finnes ikke."]);
  });

  it("source og organizationId tas ikke med", () => {
    const contact = contactInputSchema.parse({
      ...CONTACT,
      source: "order",
      organizationId: UUID,
    });
    expect(contact).not.toHaveProperty("source");
    expect(contact).not.toHaveProperty("organizationId");
    const firm = firmInputSchema.parse({ ...FIRM, organizationId: UUID });
    expect(firm).not.toHaveProperty("organizationId");
  });
});
