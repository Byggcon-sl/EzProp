import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { EmployeeNotFoundError } from "./errors";
import * as schemas from "./schemas";
import { partyInputSchema } from "./schemas";

/*
 * Skjemaene for parter og grunnen ved bytte i teamet
 * (docs/funksjoner/fase2a-oppdrag-team-parter-testplan.md avsnitt 2). Ren enhetstest.
 *
 * Grunnen kan hete `teamChangeReasonSchema` eller noe tilsvarende (testplanen, «Avtale om
 * signaturer»); testen finner den under de vanlige navnene. Testdata er oppdiktet:
 * «Megler Test», «Testmegling AS», megler@example.com, telefon 00000000. «Fødselsnummer» er alltid
 * 12345678901 (oppdiktet, 11 sifre).
 *
 * Støtter hovedmål: reklamasjoner (rett e-post og telefon til partene, aldri fødselsnummer) og
 * tid (feil vises ved feltet med én fast tekst).
 */

const NAME = "Skriv inn navnet.";
const ROLE = "Velg en rolle.";
const EMAIL = "E-postadressen er ikke gyldig.";
const PHONE = "Telefonnummeret kan bare ha sifre, mellomrom og +.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const EMPLOYEE_NOT_FOUND = "Den ansatte finnes ikke.";

/** Alle norske meldinger i kortet punkt 5. Hver må brukes i minst én test (2.9). */
const CARD_MESSAGES = [NAME, ROLE, EMAIL, PHONE, NATIONAL_ID, EMPLOYEE_NOT_FOUND];
const usedMessages = new Set<string>();

const REASON_SCHEMA_NAMES = [
  "teamChangeReasonSchema",
  "handedOverReasonSchema",
  "teamReasonSchema",
  "changeReasonSchema",
] as const;

function reasonSchema(): ZodType {
  const found = REASON_SCHEMA_NAMES.map(
    (name) => (schemas as unknown as Record<string, unknown>)[name],
  ).find((value) => value !== undefined);
  if (!found) {
    throw new Error(
      `fant ikke skjemaet for grunnen i ./schemas (prøvde ${REASON_SCHEMA_NAMES.join(", ")})`,
    );
  }
  return found as ZodType;
}

const VALID = { role: "broker", name: "Megler Test" };

function parseParty(overrides: Record<string, unknown>) {
  return partyInputSchema.safeParse({ ...VALID, ...overrides });
}

/** Meldingene for feltet når skjemaet avviser. */
function messagesFor(result: ReturnType<typeof parseParty>, field: string): string[] {
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => String(issue.path[0] ?? "") === field)
    .map((issue) => issue.message);
}

function expectFieldMessage(overrides: Record<string, unknown>, field: string, message: string) {
  const result = parseParty(overrides);
  expect(result.success, `${field} skulle vært avvist`).toBe(false);
  expect(messagesFor(result, field)).toContain(message);
  usedMessages.add(message);
}

function expectRejected(overrides: Record<string, unknown>, field: string) {
  const result = parseParty(overrides);
  expect(result.success, `${field} skulle vært avvist`).toBe(false);
  expect(messagesFor(result, field).length, `feilen står ved ${field}`).toBeGreaterThan(0);
}

function expectAccepted(overrides: Record<string, unknown>) {
  const result = parseParty(overrides);
  expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  return result.success ? (result.data as Record<string, unknown>) : {};
}

/** 254 tegn: «megler@» + fire etiketter på 58 tegn + «example.com». Gyldig e-post. */
const DOMAIN_LABELS = `${"a".repeat(58)}.`.repeat(4);
const EMAIL_254 = `megler@${DOMAIN_LABELS}example.com`;
const EMAIL_255 = `megler1@${DOMAIN_LABELS}example.com`;

describe("2.1 navn", () => {
  it.each(["", "   "])("tomt navn «%s» gir «Skriv inn navnet.»", (name) => {
    expectFieldMessage({ name }, "name", NAME);
  });

  it("navn mangler gir «Skriv inn navnet.»", () => {
    const result = partyInputSchema.safeParse({ role: "broker" });
    expect(result.success).toBe(false);
    expect(messagesFor(result, "name")).toContain(NAME);
  });

  it("200 tegn godtas, 201 avvises", () => {
    expectAccepted({ name: "M".repeat(200) });
    expectRejected({ name: "M".repeat(201) }, "name");
  });

  it("navnet trimmes", () => {
    expect(expectAccepted({ name: "  Megler Test  " }).name).toBe("Megler Test");
  });
});

describe("2.2 rolle", () => {
  it("rolle mangler gir «Velg en rolle.»", () => {
    const result = partyInputSchema.safeParse({ name: "Megler Test" });
    expect(result.success).toBe(false);
    expect(messagesFor(result, "role")).toContain(ROLE);
    usedMessages.add(ROLE);
  });

  it.each(["client", "other", "", "Megler"])("rollen «%s» gir «Velg en rolle.»", (role) => {
    expectFieldMessage({ role }, "role", ROLE);
  });

  it.each(["broker", "seller", "buyer", "seller_representative", "invoice_recipient"])(
    "rollen %s godtas",
    (role) => {
      expect(expectAccepted({ role }).role).toBe(role);
    },
  );
});

describe("2.3 firma", () => {
  it.each([undefined, null, "", "   "])("firma %j blir null", (firmName) => {
    expect(expectAccepted({ firmName }).firmName).toBeNull();
  });

  it("200 tegn godtas, 201 avvises", () => {
    expectAccepted({ firmName: "F".repeat(200) });
    expectRejected({ firmName: "F".repeat(201) }, "firmName");
  });

  it("firma trimmes", () => {
    expect(expectAccepted({ firmName: "  Testmegling AS " }).firmName).toBe("Testmegling AS");
  });
});

describe("2.4 e-post", () => {
  it.each([undefined, null, "", "  "])("e-post %j blir null", (email) => {
    expect(expectAccepted({ email }).email).toBeNull();
  });

  it("megler@example.com godtas og trimmes", () => {
    expect(expectAccepted({ email: " megler@example.com " }).email).toBe("megler@example.com");
  });

  it.each(["ikke-epost", "megler@", "@example.com", "megler example.com"])(
    "«%s» gir «E-postadressen er ikke gyldig.»",
    (email) => {
      expectFieldMessage({ email }, "email", EMAIL);
    },
  );

  it("254 tegn godtas, 255 avvises", () => {
    expect(EMAIL_254).toHaveLength(254);
    expect(EMAIL_255).toHaveLength(255);
    expectAccepted({ email: EMAIL_254 });
    expectRejected({ email: EMAIL_255 }, "email");
  });
});

describe("2.5 telefon", () => {
  it.each([undefined, null, "", "  "])("telefon %j blir null", (phone) => {
    expect(expectAccepted({ phone }).phone).toBeNull();
  });

  it.each(["00000000", "+47 000 00 000"])("«%s» godtas", (phone) => {
    expect(expectAccepted({ phone }).phone).toBe(phone);
  });

  it.each(["00-00", "abc", "0000 000a", "(00) 000"])(
    "«%s» gir «Telefonnummeret kan bare ha sifre, mellomrom og +.»",
    (phone) => {
      expectFieldMessage({ phone }, "phone", PHONE);
    },
  );

  it("20 tegn godtas, 21 avvises", () => {
    // Aldri mer enn sju sifre på rad, så grensen ikke blandes med fødselsnummer-sjekken
    const twenty = "+47 0000 0000 000000";
    const twentyOne = "+47 0000 0000 0000000";
    expect(twenty).toHaveLength(20);
    expect(twentyOne).toHaveLength(21);
    expectAccepted({ phone: twenty });
    expectRejected({ phone: twentyOne }, "phone");
  });
});

describe("2.6 mottar-valgene", () => {
  it("mangler alle tre → false", () => {
    const data = expectAccepted({});
    expect(data).toMatchObject({
      receivesReport: false,
      receivesInvoice: false,
      receivesMessages: false,
    });
  });

  it.each(["on", true])("%j → true (slik avkrysningen sender)", (value) => {
    const data = expectAccepted({
      receivesReport: value,
      receivesInvoice: value,
      receivesMessages: value,
    });
    expect(data).toMatchObject({
      receivesReport: true,
      receivesInvoice: true,
      receivesMessages: true,
    });
  });

  it("false → false", () => {
    const data = expectAccepted({ receivesReport: false, receivesInvoice: false });
    expect(data).toMatchObject({ receivesReport: false, receivesInvoice: false });
  });
});

describe("2.7 fødselsnummer", () => {
  it.each([
    ["name", "12345678901"],
    ["name", "Megler 12345678901 Test"],
    ["firmName", "12345678901"],
    ["firmName", "Megler 12345678901 Test"],
  ])("%s «%s» gir «Fødselsnummer skal ikke lagres her.»", (field, value) => {
    expectFieldMessage({ [field]: value }, field, NATIONAL_ID);
  });

  it.each(["12345678901", "Ferie 12345678901"])(
    "grunnen «%s» gir «Fødselsnummer skal ikke lagres her.»",
    (value) => {
      const result = reasonSchema().safeParse(value);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.message)).toContain(NATIONAL_ID);
      }
      usedMessages.add(NATIONAL_ID);
    },
  );

  it("10 sifre på rad godtas i navn og firma", () => {
    expectAccepted({ name: "Megler 0000000000", firmName: "Testmegling 0000000000 AS" });
  });

  it("telefonen 00000000 er ikke berørt", () => {
    expect(expectAccepted({ phone: "00000000" }).phone).toBe("00000000");
  });
});

describe("2.8 grunn ved bytte", () => {
  it.each(["", "   "])("tom grunn «%s» blir null", (value) => {
    const result = reasonSchema().safeParse(value);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it("grunnen trimmes", () => {
    const result = reasonSchema().safeParse("  Ferie  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("Ferie");
  });

  it("300 tegn godtas, 301 avvises", () => {
    expect(reasonSchema().safeParse("G".repeat(300)).success).toBe(true);
    expect(reasonSchema().safeParse("G".repeat(301)).success).toBe(false);
  });
});

describe("2.9 alle norske meldinger i kortet er dekket", () => {
  it("EmployeeNotFoundError har meldingen «Den ansatte finnes ikke.»", () => {
    expect(new EmployeeNotFoundError().message).toBe(EMPLOYEE_NOT_FOUND);
    usedMessages.add(EMPLOYEE_NOT_FOUND);
  });

  // Står sist i filen: testene kjører i rekkefølge, så alle meldingene over er samlet nå.
  it("hver av de seks meldingene er brukt i minst én test over", () => {
    expect([...CARD_MESSAGES].filter((message) => !usedMessages.has(message))).toEqual([]);
  });
});
