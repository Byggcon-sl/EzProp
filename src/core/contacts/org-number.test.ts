import { describe, expect, it } from "vitest";
import { isValidOrgNumber } from "./org-number";

/*
 * Kontroll av organisasjonsnummer med kontrollsiffer (modulus 11), som testsaker i data.
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 1.
 *
 * Numrene er oppdiktet og starter med 000, så de kan ikke finnes i Brønnøysundregistrene.
 * Støtter hovedmål: tid og reklamasjoner (en skrivefeil i nummeret gir ikke et nytt firma ved
 * siden av det som finnes).
 */

type Case = { input: string; valid: boolean; why: string };

const CASES: Case[] = [
  { input: "000000019", valid: true, why: "gyldig (firma A, standard i fabrikken)" },
  { input: "000000027", valid: true, why: "gyldig (firma nummer to)" },
  { input: "000000108", valid: true, why: "gyldig (søk på nummer)" },
  { input: "000000051", valid: true, why: "gyldig, rest 10 gir kontrollsiffer 1" },
  { input: "000000018", valid: false, why: "feil kontrollsiffer" },
  { input: "000000060", valid: false, why: "kontrollsifferet blir 10" },
  { input: "00000001", valid: false, why: "8 sifre" },
  { input: "0000000190", valid: false, why: "10 sifre" },
  { input: "00000001A", valid: false, why: "bokstav" },
  { input: "ABCDEFGHI", valid: false, why: "bare bokstaver" },
  { input: "", valid: false, why: "tom streng" },
  { input: "000 000 019", valid: true, why: "mellomrom fjernes" },
  { input: " 000000019 ", valid: true, why: "mellomrom foran og bak fjernes" },
  { input: "000-000-019", valid: false, why: "bindestrek fjernes ikke" },
];

describe("1. isValidOrgNumber", () => {
  it.each(CASES)("$input → $valid ($why)", ({ input, valid }) => {
    expect(isValidOrgNumber(input)).toBe(valid);
  });
});

/** Egen referanseberegning etter formelen: vektene 3, 2, 7, 6, 5, 4, 3, 2 og modulus 11. */
function referenceValid(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let index = 0; index < 8; index += 1) sum += weights[index]! * Number(value[index]);
  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  if (check === 10) return false;
  return check === Number(value[8]);
}

/** Fast frø (mulberry32), så testen gir de samme numrene hver gang. */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("1.7 fasit mot formelen", () => {
  const random = seededRandom(20261105);
  const numbers = Array.from({ length: 50 }, () =>
    String(Math.floor(random() * 1e9)).padStart(9, "0"),
  );
  // Hvert fjerde nummer får riktig kontrollsiffer, så både gyldige og ugyldige prøves
  const withValid = numbers.map((value, index) => {
    if (index % 4 !== 0) return value;
    for (let digit = 0; digit <= 9; digit += 1) {
      const candidate = `${value.slice(0, 8)}${digit}`;
      if (referenceValid(candidate)) return candidate;
    }
    return value;
  });

  it("utvalget har både gyldige og ugyldige numre", () => {
    expect(withValid.some(referenceValid)).toBe(true);
    expect(withValid.some((value) => !referenceValid(value))).toBe(true);
  });

  it.each(withValid)("%s gir samme svar som referanseberegningen", (value) => {
    expect(isValidOrgNumber(value)).toBe(referenceValid(value));
  });
});
