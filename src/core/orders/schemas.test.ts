import { describe, expect, it } from "vitest";
import { orderInputSchema, rejectReasonSchema } from "./index";

/*
 * Validering av ordreskjemaet og avvisningsgrunnen (testplan
 * docs/funksjoner/fase2a-manuell-ordre-testplan.md avsnitt 1, med runde 1 og 2). Rene
 * enhetstester, ingen database. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (gnr/bnr/snr bare sifre, ingen fødselsnummer i fritekst) og
 * tid (feilen står ved feltet med en tekst som sier hva som må rettes).
 */

const NOW = new Date("2026-11-03T10:00:00Z");
const schema = orderInputSchema(NOW);

const VALID = { addressText: "Testveien 12, 8000 Bodø" };

function parse(input: Record<string, unknown>) {
  return schema.safeParse({ ...VALID, ...input });
}

/** Meldingene for ett felt (første ledd i stien), tom liste når feltet er gyldig. */
function messagesFor(input: Record<string, unknown>, field: string): string[] {
  const result = parse(input);
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => String(issue.path[0]) === field)
    .map((issue) => issue.message);
}

describe("orderInputSchema: adresse (1.3)", () => {
  it.each([
    ["tom", ""],
    ["bare mellomrom", "   "],
  ])("%s adresse gir «Skriv inn adressen.»", (_label, addressText) => {
    expect(messagesFor({ addressText }, "addressText")).toContain("Skriv inn adressen.");
  });

  it("manglende adresse avvises", () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it("300 tegn godtas, 301 avvises", () => {
    expect(parse({ addressText: "a".repeat(300) }).success).toBe(true);
    expect(messagesFor({ addressText: "a".repeat(301) }, "addressText")).toHaveLength(1);
  });

  it("adressen trimmes", () => {
    const result = parse({ addressText: "  Testveien 12, 8000 Bodø  " });
    expect(result.success && result.data.addressText).toBe("Testveien 12, 8000 Bodø");
  });

  it("adressen har ikke sperren mot elleve sifre (gateadresser kan ha lange tall)", () => {
    expect(parse({ addressText: "Testveien 12345678901" }).success).toBe(true);
  });
});

describe("orderInputSchema: gnr, bnr og snr (1.4)", () => {
  const fields = [
    ["gnr", "Gårdsnummer kan bare ha sifre."],
    ["bnr", "Bruksnummer kan bare ha sifre."],
    ["snr", "Seksjonsnummer kan bare ha sifre."],
  ] as const;

  it.each(fields)("%s: «12» godtas", (field) => {
    const result = parse({ [field]: "12" });
    expect(result.success && result.data[field]).toBe("12");
  });

  it.each(
    fields.flatMap(([field, message]) =>
      ["12a", "1 2", "-1", "12345678901"].map((value) => ({ field, message, value })),
    ),
  )("$field: «$value» avvises med «$message»", ({ field, message, value }) => {
    expect(messagesFor({ [field]: value }, field)).toEqual([message]);
  });

  it.each(fields)("%s: tom streng og manglende felt blir null", (field) => {
    const empty = parse({ [field]: "" });
    expect(empty.success && empty.data[field]).toBeNull();
    const missing = parse({});
    expect(missing.success && missing.data[field]).toBeNull();
  });
});

describe("orderInputSchema: lengder (1.5)", () => {
  it.each(["externalRef", "orderedByText", "housingAssociationName"])(
    "%s: 200 tegn godtas, 201 avvises",
    (field) => {
      expect(parse({ [field]: "a".repeat(200) }).success).toBe(true);
      expect(messagesFor({ [field]: "a".repeat(201) }, field)).toHaveLength(1);
    },
  );

  it("valgfrie tekstfelt trimmes, og tom tekst blir null", () => {
    const result = parse({
      externalRef: "  TEST-ORD-0001 ",
      orderedByText: " Megler Testesen, Testmegleren AS ",
      housingAssociationName: "   ",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.externalRef).toBe("TEST-ORD-0001");
    expect(result.data.orderedByText).toBe("Megler Testesen, Testmegleren AS");
    expect(result.data.housingAssociationName).toBeNull();
  });

  it("note finnes ikke i skjemaet (runde 1: kuttet)", () => {
    const result = parse({ note: "x".repeat(10) });
    expect(result.success).toBe(true);
    expect(result.success && "note" in result.data).toBe(false);
  });
});

describe("orderInputSchema: mottatt (1.6)", () => {
  it("NOW og NOW − 1 dag godtas", () => {
    const now = parse({ receivedAt: NOW.toISOString() });
    expect(now.success && now.data.receivedAt.getTime()).toBe(NOW.getTime());
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    const earlier = parse({ receivedAt: yesterday });
    expect(earlier.success && earlier.data.receivedAt.getTime()).toBe(yesterday.getTime());
  });

  it("NOW + 1 minutt gir «Mottatt kan ikke være frem i tid.»", () => {
    const later = new Date(NOW.getTime() + 60 * 1000);
    expect(messagesFor({ receivedAt: later.toISOString() }, "receivedAt")).toEqual([
      "Mottatt kan ikke være frem i tid.",
    ]);
    expect(messagesFor({ receivedAt: later }, "receivedAt")).toEqual([
      "Mottatt kan ikke være frem i tid.",
    ]);
  });

  it.each(["i går", "2026-13-01"])("ugyldig tekst «%s» avvises", (receivedAt) => {
    expect(messagesFor({ receivedAt }, "receivedAt").length).toBeGreaterThan(0);
  });

  it("mangler mottatt → now", () => {
    const result = parse({});
    expect(result.success && result.data.receivedAt.getTime()).toBe(NOW.getTime());
  });

  it("«frem i tid» regnes mot now som sendes inn, ikke klokken på maskinen", () => {
    const later = new Date(NOW.getTime() + 60 * 1000);
    const result = orderInputSchema(new Date(NOW.getTime() + 2 * 60 * 1000)).safeParse({
      ...VALID,
      receivedAt: later.toISOString(),
    });
    expect(result.success).toBe(true);
  });
});

describe("orderInputSchema: egenerklæring (1.7)", () => {
  it("mangler → false", () => {
    const result = parse({});
    expect(result.success && result.data.sellerDeclarationReceived).toBe(false);
  });

  it.each([["on"], [true]])("%s → true (slik avkrysningen sender)", (value) => {
    const result = parse({ sellerDeclarationReceived: value });
    expect(result.success && result.data.sellerDeclarationReceived).toBe(true);
  });
});

describe("orderInputSchema: source og rapporttype kan ikke settes fra skjemaet (1.8)", () => {
  it("source og requestedReportType i skjemaet tas bort (kjernen setter manual og condition_report)", () => {
    const result = parse({ source: "email", requestedReportType: "bolig" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect("source" in result.data).toBe(false);
    expect("requestedReportType" in result.data).toBe(false);
  });

  it("organizationId i skjemaet tas bort", () => {
    const result = parse({ organizationId: "0190a000-0000-7000-8000-000000000002" });
    expect(result.success && "organizationId" in result.data).toBe(false);
  });
});

describe("rejectReasonSchema (1.9)", () => {
  it.each(["", "   "])("tom grunn «%s» gir «Skriv inn en grunn.»", (reason) => {
    const result = rejectReasonSchema.safeParse(reason);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain("Skriv inn en grunn.");
  });

  it("500 tegn godtas, 501 avvises", () => {
    expect(rejectReasonSchema.safeParse("a".repeat(500)).success).toBe(true);
    expect(rejectReasonSchema.safeParse("a".repeat(501)).success).toBe(false);
  });

  it("grunnen trimmes", () => {
    expect(rejectReasonSchema.parse("  Feil registrering  ")).toBe("Feil registrering");
  });
});

describe("ingen fødselsnummer i fritekst (1.10)", () => {
  const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";

  it("orderedByText med elleve sifre på rad avvises", () => {
    expect(messagesFor({ orderedByText: "Ola 12345678901" }, "orderedByText")).toEqual([
      NATIONAL_ID,
    ]);
  });

  it("orderedByText med ti sifre godtas", () => {
    expect(parse({ orderedByText: "Megler Testesen 1234567890" }).success).toBe(true);
  });

  it("avvisningsgrunn med elleve sifre på rad avvises, ti godtas", () => {
    const result = rejectReasonSchema.safeParse("Ola 12345678901");
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual([NATIONAL_ID]);
    expect(rejectReasonSchema.safeParse("Ring 1234567890").success).toBe(true);
  });

  it("externalRef har ikke sperren (meglerreferanser kan ha lange tall)", () => {
    expect(parse({ externalRef: "12345678901234" }).success).toBe(true);
  });
});
