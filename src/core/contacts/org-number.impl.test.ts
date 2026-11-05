import { describe, expect, it } from "vitest";
import { isValidOrgNumber, normalizeOrgNumber } from "./org-number";

/*
 * Kontrollen av organisasjonsnummer (modulus 11) som data.
 * Testplan: docs/funksjoner/fase2a-kontakter-firma-testplan.md avsnitt 1.
 * Numrene er oppdiktet og starter med 000, så de finnes ikke i Brønnøysund.
 * Støtter hovedmål: tid og reklamasjoner (en skrivefeil gir ikke et nytt firma).
 */

const cases = [
  { input: "000000019", valid: true, why: "gyldig, standard i fabrikken" },
  { input: "000000027", valid: true, why: "gyldig" },
  { input: "000000108", valid: true, why: "gyldig" },
  { input: "000000051", valid: true, why: "gyldig, rest 10 gir kontrollsiffer 1" },
  { input: "000000018", valid: false, why: "feil kontrollsiffer" },
  { input: "000000060", valid: false, why: "kontrollsifferet blir 10" },
  { input: "00000001", valid: false, why: "8 sifre" },
  { input: "0000000190", valid: false, why: "10 sifre" },
  { input: "00000001A", valid: false, why: "bokstav" },
  { input: "ABCDEFGHI", valid: false, why: "bare bokstaver" },
  { input: "", valid: false, why: "tom" },
  { input: "000 000 019", valid: true, why: "mellomrom fjernes" },
  { input: " 000000019 ", valid: true, why: "mellomrom foran og bak fjernes" },
  { input: "000-000-019", valid: false, why: "bindestrek fjernes ikke" },
];

/** Egen referanseberegning etter formelen, uavhengig av koden som testes. */
function reference(digits: string): boolean {
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, index) => acc + weight * Number(digits[index]), 0);
  const rest = sum % 11;
  const check = rest === 0 ? 0 : 11 - rest;
  return check !== 10 && check === Number(digits[8]);
}

/** Enkel tilfeldig tallrekke med fast frø, så testen gir samme numre hver gang. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("isValidOrgNumber", () => {
  it.each(cases)("$input → $valid ($why)", ({ input, valid }) => {
    expect(isValidOrgNumber(input)).toBe(valid);
  });

  it("stemmer med formelen for 50 tilfeldige 9-sifrede numre (fast frø)", () => {
    const random = seeded(17);
    for (let n = 0; n < 50; n += 1) {
      const digits = Array.from({ length: 9 }, () => Math.floor(random() * 10)).join("");
      expect(isValidOrgNumber(digits), digits).toBe(reference(digits));
    }
  });
});

describe("normalizeOrgNumber", () => {
  it("fjerner mellomrom og lar andre tegn stå", () => {
    expect(normalizeOrgNumber(" 000 000 019 ")).toBe("000000019");
    expect(normalizeOrgNumber("000-000-019")).toBe("000-000-019");
  });
});
