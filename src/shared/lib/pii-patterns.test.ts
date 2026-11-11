import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PII_PLACEHOLDER, PII_PLACEHOLDERS, redactPii } from "./pii-patterns";

// All testdata er oppdiktet.
const only = (input: string) => redactPii(input).text;

describe("pii-patterns", () => {
  it.each([
    "12345678",
    "123 45 678",
    "12 34 56 78",
    "1234 5678",
    "123-45-678",
    "12.34.56.78",
    "+4712345678",
    "+47 123 45 678",
    "0047 12345678",
  ])("V1.1 telefon: %s", (value) => {
    expect(only(`Ring ${value} i dag.`)).toBe("Ring [telefon] i dag.");
  });

  it.each(["01019912345", "010199 12345"])("V1.2 fødselsnummer: %s", (value) => {
    const out = only(`Fnr ${value}.`);
    expect(out).toBe("Fnr [fødselsnummer].");
    expect(out).not.toContain("[telefon]");
  });

  it.each(["123456789", "123 456 789", "NO 123456789 MVA"])(
    "V1.3 organisasjonsnummer: %s",
    (value) => {
      expect(only(`Firma ${value} her`)).toBe("Firma [organisasjonsnummer] her");
    },
  );

  it.each(["1234.56.78901", "1234 56 78901"])("V1.4 kontonummer: %s", (value) => {
    expect(only(`Konto ${value}.`)).toBe("Konto [kontonummer].");
  });

  it.each([
    "ola@example.com",
    "kari.nord+tak@example.no",
    "åse.ødegård@eksempel.no",
    "OLA@EXAMPLE.COM",
  ])("V1.5 e-post: %s", (value) => {
    expect(only(`Send til ${value}.`)).toBe("Send til [e-post].");
  });

  it.each([
    "gnr 12 bnr 34",
    "gnr. 12 bnr. 34",
    "g.nr 12",
    "gbnr 12/34",
    "gnr 12/34/0/5",
    "fnr 3",
    "snr 5",
  ])("V1.6 matrikkel: %s", (value) => {
    expect(only(`Eiendom ${value} i kommunen`)).toBe("Eiendom [matrikkel] i kommunen");
  });

  it.each([
    "Storgata 12",
    "Fjordveien 3B",
    "Sjøvegen 4 b",
    "Bakkeplassen 1",
    "Skogstien 7",
    "Parkallé 2",
    "8006 Bodø",
  ])("V1.7 adresse: %s", (value) => {
    expect(only(`Bor i ${value}, ved sjøen`)).toBe("Bor i [adresse], ved sjøen");
  });

  it.each([
    "1200 mm",
    "48x98",
    "TG 2",
    "2 x 4",
    "0,25",
    "1985",
    "11.11.2026",
    "2026-11-11",
    "2026-11-11T10:00:00Z",
    "3f2b8c1a-9d4e-4b7a-8c2d-1e5f6a7b8c9d",
    "12345678-1234-4234-8234-123456789012",
    "kr 4 500 000",
    "12/34",
    "8006",
    "ved bakken",
    "langs stien",
    "Storgata",
    "alle 3 rom",
  ])("V1.8 står urørt: %s", (value) => {
    const text = `Notat: ${value} sjekket.`;
    expect(redactPii(text)).toEqual({ text, count: 0 });
  });

  it("V1.9 rekkefølge: lange tall deles ikke feil", () => {
    expect(only("01019912345")).toBe("[fødselsnummer]");
    const account = only("1234.56.78901");
    expect(account).toBe("[kontonummer]");
    expect(only("123456789")).toBe("[organisasjonsnummer]");
    expect(only("123456789")).not.toContain("[telefon]");
  });

  it("V1.10 grenser: ikke inne i lengre tall, UUID eller inntil æøå", () => {
    for (const text of [
      "123456789012",
      "a1234567-89ab-4cde-8f01-23456789abcd",
      "ø12345678",
      "12345678å",
    ]) {
      expect(redactPii(text)).toEqual({ text, count: 0 });
    }
  });

  it("V1.10 kildesjekk: ingen \\b, alle mønstre har flagget u", () => {
    const source = readFileSync(join(__dirname, "pii-patterns.ts"), "utf8");
    expect(source).not.toMatch(/\\\\b|\\b/);
    const flags = [...source.matchAll(/new RegExp\([\s\S]*?,\s*"([a-z]*)",?\s*\)/g)].map(
      (m) => m[1],
    );
    expect(flags.length).toBeGreaterThanOrEqual(8);
    for (const f of flags) expect(f).toContain("u");
    expect(source).not.toMatch(/\/[gimsy]*\s*;\s*$/m);
  });

  it("V1.11 NFC: NFD og NFC gir samme resultat", () => {
    const nfc = "Bor i Sjøgata 4.".normalize("NFC");
    const nfd = "Bor i Sjøgata 4. Parkallé 2".normalize("NFD");
    expect(redactPii(nfc).text).toBe("Bor i [adresse].");
    expect(redactPii(nfd).text).toBe("Bor i [adresse]. [adresse]");
  });

  it("V1.12 kjent overvask (villet, A170): «1985 2010» blir [telefon]", () => {
    expect(only("Bygget 1985 2010")).toBe("Bygget [telefon]");
  });

  it("V1.13 adresse av i loggermodus", () => {
    const text = "Storgata 12, 8006 Bodø";
    expect(redactPii(text, { addresses: false })).toEqual({ text, count: 0 });
  });

  it("V1.14 ytelse: 50 000 tegn og ond streng under 500 ms", () => {
    const chunk = "12 34-5 678 9.0 12345 ab 1-2-3 ";
    const long = chunk.repeat(Math.ceil(50_000 / chunk.length)).slice(0, 50_000);
    const evil = "1 ".repeat(25_000);
    for (const text of [
      long,
      evil,
      "a".repeat(50_000),
      "a@".repeat(25_000),
      "gnr 1/".repeat(8_000),
    ]) {
      const start = performance.now();
      redactPii(text);
      expect(performance.now() - start).toBeLessThan(500);
    }
  });

  it("V1.15 plassholderne er nøyaktig de åtte", () => {
    expect([...PII_PLACEHOLDERS].sort()).toEqual(
      [
        "[navn]",
        "[e-post]",
        "[telefon]",
        "[adresse]",
        "[matrikkel]",
        "[fødselsnummer]",
        "[organisasjonsnummer]",
        "[kontonummer]",
      ].sort(),
    );
    expect(Object.values(PII_PLACEHOLDER)).toHaveLength(8);
  });

  it("V1.16 count er antall treff", () => {
    expect(redactPii("12345678, 87654321 og 11223344").count).toBe(3);
    const text = "Ingen treff her.";
    expect(redactPii(text)).toEqual({ text, count: 0 });
  });
});
