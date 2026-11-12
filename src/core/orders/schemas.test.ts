import { describe, expect, it } from "vitest";
import { ORDER_EDITABLE_FIELDS } from "./codes";
import * as schemas from "./schemas";
import { orderInputSchema, rejectReasonSchema } from "./schemas";

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

  it("11 sifre på rad i adressen godtas (ingen fødselsnummersperre der, 1.10)", () => {
    expect(ok({ addressText: "Testveien 12345678901" }).addressText).toBe("Testveien 12345678901");
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

  it("ekstern referanse med 11 sifre på rad godtas (ingen sperre der)", () => {
    expect(ok({ externalRef: "TEST-12345678901" }).externalRef).toBe("TEST-12345678901");
  });
});

describe("avvisningsgrunn (1.9 og 1.10)", () => {
  function reasonMessages(value: string): string[] {
    const result = rejectReasonSchema.safeParse(value);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  }

  it.each(["", "   "])("«%s» gir «Skriv inn en grunn.»", (reason) => {
    expect(reasonMessages(reason)).toContain("Skriv inn en grunn.");
  });

  it("500 tegn godtas, 501 avvises", () => {
    expect(rejectReasonSchema.safeParse("c".repeat(500)).success).toBe(true);
    expect(rejectReasonSchema.safeParse("c".repeat(501)).success).toBe(false);
  });

  it("trimmes", () => {
    expect(rejectReasonSchema.parse("  Feil registrering  ")).toBe("Feil registrering");
  });

  it("11 sifre på rad gir «Fødselsnummer skal ikke lagres her.», 10 sifre godtas", () => {
    expect(reasonMessages("Ola 12345678901")).toContain(PNR);
    expect(rejectReasonSchema.safeParse("Ola 1234567890").success).toBe(true);
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

/*
 * Rette en ordre etter lagring (docs/funksjoner/fase2a-rette-ordre-testplan.md 1.4). Rettingen
 * bruker `orderInputSchema` selv, ikke en kopi, så meldingene er de samme som på «Ny ordre».
 * Integrasjonstesten 2.4.9 i update-order.test.ts viser at `updateOrder` gir de samme meldingene.
 */
describe("1.4 rettingsskjemaet er orderInputSchema", () => {
  it("modulen har ingen egen kopi av ordreskjemaet", () => {
    const exported = Object.entries(schemas)
      .filter(([, value]) => typeof value === "function" || typeof value === "object")
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual(["orderInputSchema", "rejectReasonSchema"]);
  });

  it("skjemaets felt er nøyaktig de rettbare feltene (ORDER_EDITABLE_FIELDS)", () => {
    expect(Object.keys(orderInputSchema(NOW).shape).sort()).toEqual(
      [...ORDER_EDITABLE_FIELDS].sort(),
    );
  });

  it("status, avvisningsgrunn, oppdrag, kilde, rapporttype og organisasjon tas bort", () => {
    const data = ok({
      status: "rejected",
      rejectReason: "Feil registrering",
      rejectedReason: "Feil registrering",
      assignmentId: "0190a000-0000-7000-8000-000000000080",
      source: "email",
      requestedReportType: "bolig",
      organizationId: "0190a000-0000-7000-8000-000000000090",
    });
    for (const key of [
      "status",
      "rejectReason",
      "rejectedReason",
      "assignmentId",
      "source",
      "requestedReportType",
      "organizationId",
    ]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it.each([
    ["addressText", { addressText: "" }, "Skriv inn adressen."],
    ["gnr", { gnr: "12a" }, "Gårdsnummer kan bare ha sifre."],
    ["bnr", { bnr: "3 4" }, "Bruksnummer kan bare ha sifre."],
    ["snr", { snr: "-1" }, "Seksjonsnummer kan bare ha sifre."],
    ["receivedAt", { receivedAt: "ikke en dato" }, "Mottatt må være en dato og et klokkeslett."],
  ])("%s: samme melding som «Ny ordre»", (field, input, message) => {
    expect(messagesFor(parse(input), field)).toContain(message);
  });
});
