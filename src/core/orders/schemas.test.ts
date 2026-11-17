import { describe, expect, it } from "vitest";
import {
  orderInputSchema,
  orderUpdateInputSchema,
  rejectReasonSchema,
  validUntilBoundsSchema,
} from "./schemas";

/*
 * Zod for ordre og avvisning (docs/funksjoner/fase2a-manuell-ordre-testplan.md 1.3–1.10, med
 * rettelsene i runde 1: ingen `note`, `source` og `requestedReportType` kan ikke settes fra
 * skjemaet, og 11 sifre på rad avvises i bestiller og grunn).
 *
 * Fast tid: NOW = 03.11.2026 kl. 11 i Oslo. Testdata er oppdiktet.
 * Støtter hovedmål: reklamasjoner (gnr/bnr bare sifre, ingen dato frem i tid, ingen
 * fødselsnummer i fritekst).
 */

const NOW = new Date("2026-11-03T10:00:00Z");
const ADDRESS = "Testveien 12, 8000 Bodø";
const PNR = "Fødselsnummer skal ikke lagres her.";

const schema = orderInputSchema(NOW);

type Issue = { path: PropertyKey[]; message: string };
type Parsed = { success: true; data: unknown } | { success: false; error: { issues: Issue[] } };

function parse(input: Record<string, unknown>): Parsed {
  return schema.safeParse({ addressText: ADDRESS, ...input }) as Parsed;
}

/** Meldingene for ett felt (første ledd i stien). */
function messagesFor(result: Parsed, field: string): string[] {
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => String(issue.path[0] ?? "") === field)
    .map((issue) => issue.message);
}

function ok(input: Record<string, unknown>): Record<string, unknown> {
  const result = parse(input);
  if (!result.success) {
    throw new Error(`ventet godkjent, fikk ${JSON.stringify(result.error.issues)}`);
  }
  return result.data as Record<string, unknown>;
}

function iso(value: unknown): string {
  return new Date(value as string | Date).toISOString();
}

describe("adresse (1.3)", () => {
  it.each([
    ["tom", ""],
    ["bare mellomrom", "   "],
  ])("%s gir «Skriv inn adressen.»", (_name, addressText) => {
    expect(messagesFor(parse({ addressText }), "addressText")).toContain("Skriv inn adressen.");
  });

  it("mangler gir «Skriv inn adressen.»", () => {
    const result = schema.safeParse({}) as Parsed;
    expect(messagesFor(result, "addressText")).toContain("Skriv inn adressen.");
  });

  it("300 tegn godtas, 301 avvises", () => {
    expect(ok({ addressText: "a".repeat(300) }).addressText).toBe("a".repeat(300));
    expect(messagesFor(parse({ addressText: "a".repeat(301) }), "addressText")).not.toEqual([]);
  });

  it("trimmes", () => {
    expect(ok({ addressText: `  ${ADDRESS}  ` }).addressText).toBe(ADDRESS);
  });

  it("11 sifre på rad i adressen avvises (A299, sperren gjelder alle fritekstfelt)", () => {
    expect(messagesFor(parse({ addressText: "Testveien 12345678901" }), "addressText")).toContain(
      PNR,
    );
  });
});

const cadastralFields = [
  ["gnr", "Gårdsnummer kan bare ha sifre."],
  ["bnr", "Bruksnummer kan bare ha sifre."],
  ["snr", "Seksjonsnummer kan bare ha sifre."],
] as const;

const badDigits = cadastralFields.flatMap(([field, message]) =>
  ["12a", "1 2", "-1"].map((value) => [field, message, value] as const),
);

describe("gnr, bnr og snr (1.4)", () => {
  it.each(cadastralFields)("%s: «12» godtas", (field) => {
    expect(ok({ [field]: "12" })[field]).toBe("12");
  });

  it.each(badDigits)("%s: «%s» for «%s»", (field, message, value) => {
    expect(messagesFor(parse({ [field]: value }), field)).toContain(message);
  });

  it.each(cadastralFields)("%s: 11 sifre avvises (høyst 10 tegn)", (field) => {
    expect(messagesFor(parse({ [field]: "12345678901" }), field)).not.toEqual([]);
  });

  it.each(cadastralFields)("%s: 10 sifre godtas", (field) => {
    expect(ok({ [field]: "1234567890" })[field]).toBe("1234567890");
  });

  it.each(cadastralFields)("%s: tom tekst blir null", (field) => {
    expect(ok({ [field]: "" })[field]).toBeNull();
  });
});

describe("lengder (1.5)", () => {
  const textFields = ["externalRef", "orderedByText", "housingAssociationName"] as const;

  it.each(textFields)("%s: 200 tegn godtas, 201 avvises", (field) => {
    expect(ok({ [field]: "b".repeat(200) })[field]).toBe("b".repeat(200));
    expect(messagesFor(parse({ [field]: "b".repeat(201) }), field)).not.toEqual([]);
  });

  it.each(textFields)("%s: bare mellomrom blir null", (field) => {
    expect(ok({ [field]: "  " })[field]).toBeNull();
  });

  it("ordren har ikke merknad (note er kuttet i runde 1)", () => {
    const result = parse({ note: "Oppdiktet merknad" });
    if (result.success) expect(result.data).not.toHaveProperty("note");
  });
});

describe("mottatt (1.6)", () => {
  it("NOW og NOW minus én dag godtas", () => {
    expect(iso(ok({ receivedAt: NOW.toISOString() }).receivedAt)).toBe(NOW.toISOString());
    const yesterday = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(iso(ok({ receivedAt: yesterday }).receivedAt)).toBe(yesterday.toISOString());
  });

  it("ett minutt frem i tid gir «Mottatt kan ikke være frem i tid.»", () => {
    const future = new Date(NOW.getTime() + 60 * 1000).toISOString();
    expect(messagesFor(parse({ receivedAt: future }), "receivedAt")).toContain(
      "Mottatt kan ikke være frem i tid.",
    );
  });

  it.each(["i går", "2026-13-01"])("ugyldig tekst «%s» avvises", (receivedAt) => {
    expect(messagesFor(parse({ receivedAt }), "receivedAt")).not.toEqual([]);
  });

  it("mangler gir standard now", () => {
    expect(iso(ok({}).receivedAt)).toBe(NOW.toISOString());
  });
});

describe("egenerklæring (1.7)", () => {
  it("mangler gir false", () => {
    expect(ok({}).sellerDeclarationReceived).toBe(false);
  });

  it.each([["on"], [true]] as const)("%s gir true (slik avkrysningen sender)", (value) => {
    expect(ok({ sellerDeclarationReceived: value }).sellerDeclarationReceived).toBe(true);
  });
});

describe("rapporttype og kilde kan ikke settes fra skjemaet (1.8)", () => {
  it("source og requestedReportType fra skjemaet blir ikke brukt (ignoreres eller avvises)", () => {
    const result = parse({ source: "email", requestedReportType: "bolig" });
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.source ?? "manual").toBe("manual");
    expect(data.requestedReportType ?? "condition_report").toBe("condition_report");
  });
});

describe("fødselsnummer i fritekst (1.10)", () => {
  it("bestiller med 11 sifre på rad gir «Fødselsnummer skal ikke lagres her.»", () => {
    expect(messagesFor(parse({ orderedByText: "Ola 12345678901" }), "orderedByText")).toContain(
      PNR,
    );
  });

  it("bestiller med 10 sifre på rad godtas", () => {
    expect(ok({ orderedByText: "Ola 1234567890" }).orderedByText).toBe("Ola 1234567890");
  });

  it("ekstern referanse med 11 sifre på rad avvises (A299)", () => {
    expect(messagesFor(parse({ externalRef: "TEST-12345678901" }), "externalRef")).toContain(PNR);
  });
});

/*
 * Avslagsgrunn med faste valg (F4, A361, testplan 7.4.2). Fritekst er påkrevd bare ved «Annet».
 * Lengdegrensen og sperren mot elleve sifre er som før (1.9 og 1.10).
 */
describe("avslagsgrunn (F4, 7.4.2)", () => {
  function reasonMessages(value: unknown): string[] {
    const result = rejectReasonSchema.safeParse(value);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  }

  it.each([
    ["uten kode", {}],
    ["tom kode", { reasonKey: "" }],
    ["ukjent kode", { reasonKey: "pris" }],
    ["kode som ikke er tekst", { reasonKey: 1 }],
  ])("%s gir «Velg en grunn.»", (_name, value) => {
    expect(reasonMessages(value)).toEqual(["Velg en grunn."]);
  });

  it.each(["", "   ", null, undefined])("«Annet» med tekst «%s» gir «Skriv grunnen.»", (text) => {
    expect(reasonMessages({ reasonKey: "other", reasonText: text })).toEqual(["Skriv grunnen."]);
  });

  it.each(["price", "timing", "chose_other", "customer_withdrew"])(
    "%s uten tekst godtas, og tom tekst blir null",
    (reasonKey) => {
      expect(rejectReasonSchema.parse({ reasonKey, reasonText: "  " })).toEqual({
        reasonKey,
        reasonText: null,
      });
    },
  );

  it("500 tegn godtas, 501 avvises", () => {
    const ok = rejectReasonSchema.safeParse({ reasonKey: "other", reasonText: "c".repeat(500) });
    expect(ok.success).toBe(true);
    expect(reasonMessages({ reasonKey: "other", reasonText: "c".repeat(501) })).toEqual([
      "Grunnen kan ha høyst 500 tegn.",
    ]);
  });

  it("teksten trimmes", () => {
    expect(
      rejectReasonSchema.parse({ reasonKey: "other", reasonText: "  Feil registrering  " }),
    ).toEqual({ reasonKey: "other", reasonText: "Feil registrering" });
  });

  it("11 sifre på rad gir «Fødselsnummer skal ikke lagres her.», 10 sifre godtas", () => {
    expect(reasonMessages({ reasonKey: "price", reasonText: "Ola 12345678901" })).toContain(PNR);
    expect(
      rejectReasonSchema.safeParse({ reasonKey: "price", reasonText: "Ola 1234567890" }).success,
    ).toBe(true);
  });

  it("ukjente felt tas bort", () => {
    expect(
      rejectReasonSchema.parse({ reasonKey: "price", organizationId: "fremmed", status: "x" }),
    ).toEqual({ reasonKey: "price", reasonText: null });
  });
});

/*
 * «Gyldig til» (ADR 0012, A328, testplan 1.4). `today` = 03.11.2026. Ved oppretting: tom gir
 * i dag + 30, ellers fra i dag til i dag + 365. Ved endring sjekkes bare formen her; grensene
 * sjekkes av `updateOrder` når datoen endres.
 */
describe("1.4 validUntil", () => {
  const PAST = "Gyldig til kan ikke være før i dag.";
  const TOO_LATE = "Gyldig til kan være høyst ett år fram.";
  const INVALID = "Gyldig til må være en dato.";

  it.each([
    ["i går", "2026-11-02", [PAST]],
    ["i dag", "2026-11-03", []],
    ["i dag + 365", "2027-11-03", []],
    ["i dag + 366", "2027-11-04", [TOO_LATE]],
    ["dato som ikke finnes", "2026-02-30", [INVALID]],
    ["måned 13", "2026-13-01", [INVALID]],
    ["norsk form", "03.11.2026", [INVALID]],
    ["tekst", "abc", [INVALID]],
    ["tall", 20261203, [INVALID]],
  ] as const)("%s (%s)", (_name, validUntil, messages) => {
    expect(messagesFor(parse({ validUntil }), "validUntil")).toEqual([...messages]);
  });

  it.each([undefined, null, "", "   "])("tom (%s) gir i dag + 30 (2026-12-03)", (validUntil) => {
    const result = parse({ validUntil });
    expect(result.success && (result.data as { validUntil: string }).validUntil).toBe("2026-12-03");
  });

  it("skuddår: 29.02.2028 finnes", () => {
    const later = orderInputSchema(new Date("2027-12-01T10:00:00Z"));
    expect(later.parse({ addressText: ADDRESS, validUntil: "2028-02-29" }).validUntil).toBe(
      "2028-02-29",
    );
    expect(later.safeParse({ addressText: ADDRESS, validUntil: "2027-02-29" }).success).toBe(false);
  });

  it("dagen regnes i norsk tid: 23:30 UTC 03.11 er 04.11 i Oslo", () => {
    const late = orderInputSchema(new Date("2026-11-03T23:30:00Z"));
    expect(late.safeParse({ addressText: ADDRESS, validUntil: "2026-11-03" }).success).toBe(false);
    expect(late.parse({ addressText: ADDRESS }).validUntil).toBe("2026-12-04");
  });

  it("ved endring: tom blir null (uendret), og gamle datoer godtas av formen", () => {
    const update = orderUpdateInputSchema(NOW);
    expect(update.parse({ addressText: ADDRESS }).validUntil).toBeNull();
    expect(update.parse({ addressText: ADDRESS, validUntil: "" }).validUntil).toBeNull();
    expect(update.parse({ addressText: ADDRESS, validUntil: "2020-01-01" }).validUntil).toBe(
      "2020-01-01",
    );
    expect(update.safeParse({ addressText: ADDRESS, validUntil: "2026-02-30" }).success).toBe(
      false,
    );
  });

  it("grensene står ett sted (validUntilBoundsSchema)", () => {
    const bounds = validUntilBoundsSchema("2026-11-03");
    expect(bounds.safeParse("2026-11-03").success).toBe(true);
    expect(bounds.safeParse("2027-11-03").success).toBe(true);
    expect(bounds.safeParse("2026-11-02").success).toBe(false);
    expect(bounds.safeParse("2027-11-04").success).toBe(false);
  });
});

// Kobling til kontaktregisteret (docs/funksjoner/fase2a-koble-kontakter-testplan.md 3.2).
describe("3.2 orderedByContactId på ordren (koble kontakter)", () => {
  const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";
  const CONTACT_ID = "0190a000-0000-7000-8000-000000000070";

  it("gyldig uuid godtas og beholdes", () => {
    expect(ok({ orderedByContactId: CONTACT_ID }).orderedByContactId).toBe(CONTACT_ID);
  });

  it.each([
    ["tom streng", { orderedByContactId: "" }],
    ["bare mellomrom", { orderedByContactId: "   " }],
    ["null", { orderedByContactId: null }],
    ["manglende felt", {}],
  ])("%s gir null", (_name, input) => {
    expect(ok(input).orderedByContactId).toBeNull();
  });

  it.each(["abc", "1"])("«%s» gir «Kontakten finnes ikke.» ved orderedByContactId", (value) => {
    expect(messagesFor(parse({ orderedByContactId: value }), "orderedByContactId")).toContain(
      CONTACT_NOT_FOUND,
    );
  });

  it("orderedByFirmId fra skjemaet tas bort (firmaet følger kontakten i kjernen)", () => {
    const data = ok({
      orderedByContactId: CONTACT_ID,
      orderedByFirmId: "0190a000-0000-7000-8000-000000000060",
    });
    expect(data).not.toHaveProperty("orderedByFirmId");
  });
});
