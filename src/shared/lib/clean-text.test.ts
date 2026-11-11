import { describe, expect, it } from "vitest";
import { stripUnstorableChars } from "./clean-text";

/*
 * Vasken for tegn databasen ikke tar (funn T-0001, docs/agenter/oppgaver/rett-t0001-giftig-endring.md
 * Omfang 1, testplan avsnitt 1a). Ren funksjon. All tekst er oppdiktet.
 * Støtter hovedmål: de ansatte (en innlimt tekst med usynlige tegn stopper ikke lenger synken) og
 * KI i bunnen (samme vask før KI-loggen).
 */

const NUL = "\u0000";
const HIGH = "\uD800";
const LOW = "\uDC00";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const EXAMPLES: unknown[] = [
  `a${NUL}b`,
  `a${HIGH}b`,
  `a${LOW}b`,
  `${HIGH}start`,
  `slutt${LOW}`,
  "Bad 🛁\n\tæøå ÆØÅ 12 m²",
  { a: [`x${NUL}`, { b: `y${NUL}` }] },
  { [`k${NUL}`]: 1 },
  [0, -1.5, true, false, null],
  { n: 0, f: -1.5, t: true, u: false, z: null },
  `${NUL}${NUL}`,
  "Fukt i kjeller",
];

describe("stripUnstorableChars (src/shared/lib/clean-text.ts)", () => {
  it("1 fjerner nulltegn i tekst", () => {
    expect(stripUnstorableChars(`a${NUL}b`)).toBe("ab");
    expect(stripUnstorableChars(`Fukt${NUL} i kjeller`)).toBe("Fukt i kjeller");
  });

  it("2 fjerner ensomme surrogater (høy og lav)", () => {
    expect(stripUnstorableChars(`a${HIGH}b`)).toBe("ab");
    expect(stripUnstorableChars(`a${LOW}b`)).toBe("ab");
    // Først og sist i teksten
    expect(stripUnstorableChars(`${HIGH}ab`)).toBe("ab");
    expect(stripUnstorableChars(`ab${HIGH}`)).toBe("ab");
    expect(stripUnstorableChars(`${LOW}ab`)).toBe("ab");
    expect(stripUnstorableChars(`ab${LOW}`)).toBe("ab");
    // Lav før høy er ikke et par
    expect(stripUnstorableChars(`a${LOW}${HIGH}b`)).toBe("ab");
  });

  it("3 beholder emoji, linjeskift, tabulator, æøå og m²", () => {
    const text = "Bad 🛁\n\tæøå ÆØÅ 12 m²";
    expect(stripUnstorableChars(text)).toBe(text);
    // Emoji er et gyldig surrogatpar og skal ikke deles
    expect(stripUnstorableChars("🛁")).toBe("🛁");
    expect(stripUnstorableChars("a\r\nb")).toBe("a\r\nb");
  });

  it("4 går gjennom objekter og lister i flere nivåer", () => {
    expect(stripUnstorableChars({ a: [`x${NUL}`, { b: `y${NUL}` }] })).toEqual({
      a: ["x", { b: "y" }],
    });
    expect(
      stripUnstorableChars([[{ cells: { location: `Kjeller${HIGH}`, note: `n${NUL}` } }]]),
    ).toEqual([[{ cells: { location: "Kjeller", note: "n" } }]]);
  });

  it("5 vasker nøkler i objekter", () => {
    expect(stripUnstorableChars({ [`k${NUL}`]: 1 })).toEqual({ k: 1 });
    expect(Object.keys(stripUnstorableChars({ [`k${HIGH}`]: "v" }) as object)).toEqual(["k"]);
  });

  it("6 rører ikke tall, true/false og null", () => {
    for (const value of [0, -1.5, true, false, null]) {
      expect(stripUnstorableChars(value)).toBe(value);
    }
    expect(stripUnstorableChars([0, -1.5, true, false, null])).toEqual([
      0,
      -1.5,
      true,
      false,
      null,
    ]);
    expect(stripUnstorableChars({ n: 0, f: -1.5, t: true, u: false, z: null })).toEqual({
      n: 0,
      f: -1.5,
      t: true,
      u: false,
      z: null,
    });
  });

  it("7 endrer ikke inndata", () => {
    const input = deepFreeze({ a: [`x${NUL}`, { b: `y${NUL}`, [`k${NUL}`]: 2 }], t: `z${HIGH}` });
    const copy = structuredClone(input);
    const result = stripUnstorableChars(input);
    expect(input).toEqual(copy);
    expect(result).not.toBe(input);
    expect(result).toEqual({ a: ["x", { b: "y", k: 2 }], t: "z" });
  });

  it.each(EXAMPLES.map((example) => [JSON.stringify(example), example]))(
    "8 to vask gir samme resultat (%s)",
    (_name, example) => {
      const once = stripUnstorableChars(example);
      expect(stripUnstorableChars(once)).toEqual(once);
    },
  );

  it("9 tekst med bare nulltegn blir tom tekst", () => {
    expect(stripUnstorableChars(`${NUL}${NUL}`)).toBe("");
  });

  it("10 tekst uten slike tegn returneres lik", () => {
    for (const text of ["Fukt i kjeller", "", "Tak – beskrivelse: «tett»", "1985"]) {
      expect(stripUnstorableChars(text)).toBe(text);
    }
  });
});
