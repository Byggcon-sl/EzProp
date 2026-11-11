import { describe, expect, it } from "vitest";
import { stripUnstorableChars } from "./clean-text";

/*
 * Vasken for tegn databasen ikke tar (funn T-0001, docs/agenter/oppgaver/rett-t0001-synkko.md
 * Omfang 1, testplan avsnitt 1a). Ren funksjon: ingen database. Teksten er oppdiktet.
 * Støtter hovedmål: de ansatte (innlimt tekst med usynlige tegn gir ikke lenger tapt arbeid) og
 * KI i bunnen (samme vask foran `ai_usage_log`).
 */

const NUL = "\u0000";
const HIGH = "\uD800";
const LOW = "\uDC00";

/** Fryser verdien i alle nivå, så en endring av inndata kaster i strict mode. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const EXAMPLES: unknown[] = [
  "a\u0000b",
  `a${HIGH}b`,
  `${LOW}a${HIGH}`,
  "Bad 🛁\n\tæøå ÆØÅ 12 m²",
  { a: [`x${NUL}`, { b: `y${NUL}` }] },
  { [`k${NUL}`]: 1 },
  [0, -1.5, true, false, null],
  `${NUL}${NUL}`,
  "Taket er tett.",
];

describe("stripUnstorableChars (src/shared/lib/clean-text.ts)", () => {
  it("fjerner nulltegn i tekst", () => {
    expect(stripUnstorableChars("a\u0000b")).toBe("ab");
    expect(stripUnstorableChars("Fukt\u0000 i kjeller")).toBe("Fukt i kjeller");
  });

  it("fjerner ensomme surrogater (høy og lav)", () => {
    expect(stripUnstorableChars(`a${HIGH}b`)).toBe("ab");
    expect(stripUnstorableChars(`a${LOW}b`)).toBe("ab");
    expect(stripUnstorableChars(`${HIGH}ab`)).toBe("ab");
    expect(stripUnstorableChars(`ab${HIGH}`)).toBe("ab");
    expect(stripUnstorableChars(`${LOW}ab`)).toBe("ab");
    expect(stripUnstorableChars(`ab${LOW}`)).toBe("ab");
    // Lav før høy er ikke et par: begge fjernes
    expect(stripUnstorableChars(`a${LOW}${HIGH}b`)).toBe("ab");
  });

  it("beholder emoji, linjeskift, tabulator, æøå og m²", () => {
    const text = "Bad 🛁\n\tæøå ÆØÅ 12 m²";
    expect(stripUnstorableChars(text)).toBe(text);
    // Gyldig surrogatpar ved siden av et ensomt: paret står
    expect(stripUnstorableChars(`🛁${HIGH}`)).toBe("🛁");
  });

  it("går gjennom objekter og lister i flere nivåer", () => {
    expect(stripUnstorableChars({ a: [`x${NUL}`, { b: `y${NUL}` }] })).toEqual({
      a: ["x", { b: "y" }],
    });
    expect(stripUnstorableChars([{ id: "r1", cells: { note: `Merk${HIGH}`, value: 12 } }])).toEqual(
      [{ id: "r1", cells: { note: "Merk", value: 12 } }],
    );
  });

  it("vasker nøkler i objekter", () => {
    expect(stripUnstorableChars({ [`k${NUL}`]: 1 })).toEqual({ k: 1 });
    expect(stripUnstorableChars({ [`k${HIGH}`]: { [`n${NUL}`]: "v" } })).toEqual({
      k: { n: "v" },
    });
  });

  it("rører ikke tall, true/false og null", () => {
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
    expect(stripUnstorableChars({ a: 0, b: -1.5, c: true, d: false, e: null })).toEqual({
      a: 0,
      b: -1.5,
      c: true,
      d: false,
      e: null,
    });
  });

  it("endrer ikke inndata", () => {
    for (const example of EXAMPLES) {
      const copy = structuredClone(example);
      const frozen = deepFreeze(structuredClone(example));
      expect(() => stripUnstorableChars(frozen)).not.toThrow();
      expect(frozen).toEqual(copy);
    }
    // Ikke frosset: samme objekt etterpå, og en ny verdi tilbake
    const input = { a: [`x${NUL}`] };
    const result = stripUnstorableChars(input);
    expect(input).toEqual({ a: [`x${NUL}`] });
    expect(result).not.toBe(input);
  });

  it("to vask gir samme resultat", () => {
    for (const example of EXAMPLES) {
      const once = stripUnstorableChars(example);
      expect(stripUnstorableChars(once)).toEqual(once);
    }
  });

  it("tekst med bare nulltegn blir tom tekst", () => {
    expect(stripUnstorableChars(`${NUL}${NUL}`)).toBe("");
    expect(stripUnstorableChars(`${LOW}${HIGH}`)).toBe("");
  });

  it("tekst uten slike tegn returneres lik", () => {
    for (const text of ["", "Taket er tett.", "Bad 🛁\n\tæøå ÆØÅ 12 m²", "a\u0001b"]) {
      expect(stripUnstorableChars(text)).toBe(text);
    }
  });
});
