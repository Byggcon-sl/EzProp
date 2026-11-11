import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PII_PLACEHOLDERS, redactPii } from "./pii-patterns";

/*
 * Mønstrene for persondata (docs/funksjoner/fase2a-vask-for-ki-testplan.md avsnitt 1, kortet
 * Omfang 1, A169, A170, A177). Rene tester, ingen database. Alle verdier er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen og de ansatte (persondata i fritekst sendes aldri til KI og
 * havner aldri i loggen, regel 14).
 */

const PHONE = "[telefon]";
const NATIONAL_ID = "[fødselsnummer]";
const ORG_NUMBER = "[organisasjonsnummer]";
const ACCOUNT = "[kontonummer]";
const EMAIL = "[e-post]";
const CADASTRAL = "[matrikkel]";
const ADDRESS = "[adresse]";

/** Verdien midt i en setning blir nøyaktig én plassholder; resten av setningen står. */
function expectWhole(value: string, placeholder: string) {
  const result = redactPii(`Se ${value} her.`);
  expect(result.text).toBe(`Se ${placeholder} her.`);
  expect(result.count).toBe(1);
}

/** Verdien er borte (ingen sifre igjen), plassholderen står og ordene rundt er urørt. */
function expectGone(value: string, placeholder: string) {
  const result = redactPii(`Se ${value} her.`);
  expect(result.text.startsWith("Se ")).toBe(true);
  expect(result.text.endsWith(" her.")).toBe(true);
  expect(result.text).toContain(placeholder);
  expect(result.text).not.toMatch(/\d/u);
  expect(result.count).toBeGreaterThanOrEqual(1);
}

describe("V1.1 telefon", () => {
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
  ])("V1.1 %s → [telefon]", (value) => {
    expectWhole(value, PHONE);
  });
});

describe("V1.2 fødselsnummer", () => {
  it.each(["01019912345", "010199 12345"])("V1.2 %s → [fødselsnummer]", (value) => {
    expectWhole(value, NATIONAL_ID);
    expect(redactPii(`Se ${value} her.`).text).not.toContain(PHONE);
  });
});

describe("V1.3 organisasjonsnummer", () => {
  it.each(["123456789", "123 456 789", "NO 123456789 MVA"])(
    "V1.3 %s → [organisasjonsnummer]",
    (value) => {
      expectWhole(value, ORG_NUMBER);
    },
  );
});

describe("V1.4 kontonummer (A177)", () => {
  it.each(["1234.56.78901", "1234 56 78901"])("V1.4 %s → [kontonummer]", (value) => {
    expectWhole(value, ACCOUNT);
  });
});

describe("V1.5 e-post", () => {
  it.each([
    "ola@example.com",
    "ola.test+tak@example.no",
    "åse.ødegård@example.no",
    "OLA.TEST@EXAMPLE.COM",
  ])("V1.5 %s → [e-post]", (value) => {
    expectWhole(value, EMAIL);
  });
});

describe("V1.6 matrikkel", () => {
  it.each([
    "gnr 12 bnr 34",
    "gnr. 12 bnr. 34",
    "g.nr 12",
    "gbnr 12/34",
    "gnr 12/34/0/5",
    "fnr 3",
    "snr 5",
  ])("V1.6 %s → [matrikkel]", (value) => {
    expectGone(value, CADASTRAL);
    // Matrikkelordet tas med, så det ikke står «gnr [matrikkel]» igjen
    expect(redactPii(`Se ${value} her.`).text).not.toMatch(/(?:gnr|bnr|fnr|snr|g\.nr|gbnr)/iu);
  });
});

describe("V1.7 adresse", () => {
  it.each([
    "Storgata 12",
    "Fjordveien 3B",
    "Sjøvegen 4 b",
    "Bakkeplassen 1",
    "Skogstien 7",
    "Parkallé 2",
    "8006 Bodø",
  ])("V1.7 %s → [adresse]", (value) => {
    expectWhole(value, ADDRESS);
  });
});

describe("V1.8 står urørt", () => {
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
    "018f2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b",
    "12345678-1234-7123-8123-123456789012",
    "kr 4 500 000",
    "12/34",
    "8006",
    "ved bakken",
    "langs stien",
    "Storgata",
  ])("V1.8 «%s» står urørt, count 0", (value) => {
    const text = `Målt ${value} i dag.`;
    const result = redactPii(text);
    expect(result.text).toBe(text);
    expect(result.count).toBe(0);
  });
});

describe("V1.9 rekkefølge: lange tall før korte", () => {
  it("V1.9 elleve sifre gir [fødselsnummer], ikke [telefon] pluss rest", () => {
    const result = redactPii("Nummer 01019912345.");
    expect(result.text).toBe(`Nummer ${NATIONAL_ID}.`);
    expect(result.count).toBe(1);
  });

  it("V1.9 kontonummer gir ikke [organisasjonsnummer] eller [telefon]", () => {
    const result = redactPii("Konto 1234 56 78901.");
    expect(result.text).toBe(`Konto ${ACCOUNT}.`);
    expect(result.text).not.toContain(ORG_NUMBER);
    expect(result.text).not.toContain(PHONE);
  });

  it("V1.9 ni sifre gir ikke [telefon] + siffer", () => {
    const result = redactPii("Org 123456789.");
    expect(result.text).toBe(`Org ${ORG_NUMBER}.`);
    expect(result.text).not.toContain(PHONE);
  });
});

describe("V1.10 grenser", () => {
  it.each([
    "123456789012",
    "1234567890123",
    "a1234567-89ab-7cde-8f01-23456789abcd",
    "æ12345678",
    "12345678ø",
    "å123456789",
  ])("V1.10 «%s»: tall inne i et lengre tall, en kode eller inntil æøå treffes ikke", (value) => {
    const text = `Kode ${value} her.`;
    const result = redactPii(text);
    expect(result.text).toBe(text);
    expect(result.count).toBe(0);
  });

  it("V1.10 kildesjekk: ingen \\b i filen, og alle mønstre har flagget u", () => {
    const source = readFileSync(join(__dirname, "pii-patterns.ts"), "utf8");
    // Ingen ordgrense fra regex (verken i regex-literal eller som "\\b" i en streng)
    expect(source).not.toMatch(/\\\\?b(?![a-z])/u);

    const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:\\])\/\/.*$/gmu, "$1");
    // new RegExp(...): siste argument er flaggene og må ha u
    const calls = [...code.matchAll(/new RegExp\(/gu)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      let depth = 0;
      let end = call.index! + "new RegExp".length;
      for (; end < code.length; end += 1) {
        if (code[end] === "(") depth += 1;
        if (code[end] === ")") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const args = code.slice(call.index!, end + 1);
      const flags = /,\s*["'`]([a-z]*)["'`]\s*,?\s*\)$/u.exec(args);
      expect(flags, `mangler flagg: ${args.slice(0, 80)}`).not.toBeNull();
      expect(flags![1], `uten u: ${args.slice(0, 80)}`).toContain("u");
    }
    // Regex-literaler (utenom strenger) må også ha u
    const withoutStrings = code
      .replace(/`(?:\\[\s\S]|[^`\\])*`/gu, '""')
      .replace(/"(?:\\.|[^"\\\n])*"/gu, '""')
      .replace(/'(?:\\.|[^'\\\n])*'/gu, '""');
    for (const literal of withoutStrings.matchAll(
      /(?<=[=(,:]\s*)\/(?![/*])((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/([a-z]*)/gu,
    )) {
      expect(literal[2], `regex uten u: ${literal[0].slice(0, 80)}`).toContain("u");
    }
  });
});

describe("V1.11 NFC", () => {
  it("V1.11 «Sjøgata 4» i NFD og NFC gir samme resultat", () => {
    const nfc = "Bor i Sjøgata 4 nå.".normalize("NFC");
    const nfd = "Bor i Sjøgata 4 nå.".normalize("NFD");
    expect(nfd).not.toBe(nfc);
    const a = redactPii(nfc);
    const b = redactPii(nfd);
    expect(b.text).toBe(a.text);
    expect(b.count).toBe(a.count);
    expect(a.text).toContain(ADDRESS);
  });

  it("V1.11 e-post med æøå i NFD vaskes som i NFC", () => {
    const nfd = "Send til åse.ødegård@example.no.".normalize("NFD");
    expect(redactPii(nfd).text).toBe(`Send til ${EMAIL}.`);
  });
});

describe("V1.12 kjent overvask (A170, villet)", () => {
  it("V1.12 villet overvask: to årstall etter hverandre «1985 2010» blir [telefon]", () => {
    const result = redactPii("Bygget 1985 2010 ombygd.");
    expect(result.text).toBe(`Bygget ${PHONE} ombygd.`);
    expect(result.count).toBe(1);
  });
});

describe("V1.13 adresse av i loggermodus", () => {
  it("V1.13 addresses: false lar «Storgata 12» og «8006 Bodø» stå, men tallmønstrene virker", () => {
    const text = "Storgata 12, 8006 Bodø, tlf 12345678.";
    const result = redactPii(text, { addresses: false });
    expect(result.text).toBe(`Storgata 12, 8006 Bodø, tlf ${PHONE}.`);
    expect(result.count).toBe(1);
  });

  it("V1.13 standard (uten valg) vasker adresser", () => {
    expect(redactPii("Storgata 12").text).toBe(ADDRESS);
  });
});

describe("V1.14 ytelse", () => {
  function timeOf(text: string): number {
    const start = performance.now();
    redactPii(text);
    return performance.now() - start;
  }

  it("V1.14 50 000 tegn med sifre, mellomrom og bindestreker vaskes under 500 ms", () => {
    const chunk = "12 34-5 678 9 0-1 2345 67 8-9 Storgata 1 gnr 1 bnr 2 a@b.no 0,25 ";
    const text = chunk.repeat(Math.ceil(50_000 / chunk.length)).slice(0, 50_000);
    expect(text.length).toBe(50_000);
    expect(timeOf(text)).toBeLessThan(500);
  });

  it.each([
    { name: "1 gjentatt", text: "1 ".repeat(25_000) },
    { name: "sifre uten mellomrom", text: "1".repeat(50_000) },
    { name: "sifre og bindestrek", text: "1-".repeat(25_000) },
    { name: "bokstaver uten @", text: "a.".repeat(25_000) },
    { name: "langt ord uten endelse", text: "a".repeat(49_990) + "veien 1" },
  ])("V1.14 ond streng ($name) vaskes under 500 ms", ({ text }) => {
    expect(timeOf(text)).toBeLessThan(500);
  });
});

describe("V1.15 plassholderne", () => {
  it("V1.15 er nøyaktig de åtte", () => {
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
  });

  it("V1.15 en plassholder vaskes ikke på nytt (vask to ganger gir samme tekst)", () => {
    const once = redactPii("Ring 12345678 eller skriv til ola@example.com, gnr 12 bnr 34.");
    const twice = redactPii(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.count).toBe(0);
  });
});

describe("V1.16 count", () => {
  it("V1.16 tre telefoner gir 3", () => {
    const result = redactPii("Ring 12345678, 87654321 eller 11223344.");
    expect(result.text).toBe(`Ring ${PHONE}, ${PHONE} eller ${PHONE}.`);
    expect(result.count).toBe(3);
  });

  it("V1.16 tekst uten treff gir 0 og samme streng", () => {
    const text = "Taket er gammelt og har noen sprekker.";
    expect(redactPii(text)).toEqual({ text, count: 0 });
  });

  it("V1.16 tom tekst gir tom tekst og 0", () => {
    expect(redactPii("")).toEqual({ text: "", count: 0 });
  });
});
