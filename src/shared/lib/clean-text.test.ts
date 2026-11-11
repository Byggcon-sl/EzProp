import { describe, expect, it } from "vitest";
import { stripUnstorableChars } from "./clean-text";

/*
 * Vasken for tegn databasen ikke tar (docs/agenter/oppgaver/rett-t0001-synkko-testplan.md 1a,
 * test 1–10). All tekst er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (innlimt tekst med usynlige tegn stopper ikke synken) og KI i
 * bunnen (KI-forslag og loggen virker også for slik tekst).
 */

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

const EXAMPLES: unknown[] = [
  "a\u0000b",
  "a\uD800b",
  "a\uDC00b",
  "\uD800a",
  "a\uDBFF",
  "\uDC00\uD800",
  "Bad 🛁\n\tæøå ÆØÅ 12 m²",
  { a: ["x\u0000", { b: "y\u0000" }] },
  { "k\u0000": 1 },
  [0, -1.5, true, false, null],
  "\u0000\u0000",
  "Fukt i kjeller",
  "\uD800\u0000\uDC00",
];

describe("stripUnstorableChars", () => {
  it("1 fjerner nulltegn i tekst", () => {
    expect(stripUnstorableChars("a\u0000b")).toBe("ab");
    expect(stripUnstorableChars("Fukt\u0000 i kjeller")).toBe("Fukt i kjeller");
  });

  it("2 fjerner ensomme surrogater (høy og lav)", () => {
    expect(stripUnstorableChars("a\uD800b")).toBe("ab");
    expect(stripUnstorableChars("a\uDC00b")).toBe("ab");
    expect(stripUnstorableChars("\uD800ab")).toBe("ab");
    expect(stripUnstorableChars("ab\uD800")).toBe("ab");
    expect(stripUnstorableChars("\uDC00ab")).toBe("ab");
    expect(stripUnstorableChars("ab\uDC00")).toBe("ab");
    // Lav foran høy er ikke et par
    expect(stripUnstorableChars("a\uDC00\uD800b")).toBe("ab");
    // Nulltegn mellom høy og lav: ingen av dem er et par
    expect(stripUnstorableChars("a\uD800\u0000\uDC00b")).toBe("ab");
  });

  it("3 beholder emoji, linjeskift, tabulator, æøå og m²", () => {
    const text = "Bad 🛁\n\tæøå ÆØÅ 12 m²";
    expect(stripUnstorableChars(text)).toBe(text);
    expect(stripUnstorableChars("🛁\uD800🚿")).toBe("🛁🚿");
  });

  it("4 går gjennom objekter og lister i flere nivåer", () => {
    expect(stripUnstorableChars({ a: ["x\u0000", { b: "y\u0000", c: ["\uD800z"] }] })).toEqual({
      a: ["x", { b: "y", c: ["z"] }],
    });
  });

  it("5 vasker nøkler i objekter", () => {
    expect(stripUnstorableChars({ "k\u0000": 1 })).toEqual({ k: 1 });
    expect(stripUnstorableChars({ outer: { "i\uDC00n": "v" } })).toEqual({ outer: { in: "v" } });
  });

  it("6 rører ikke tall, true/false og null", () => {
    for (const value of [0, -1.5, true, false, null, undefined]) {
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

  it("7 endrer ikke inndata", () => {
    const input = deepFreeze({ "k\u0000": ["x\u0000", { b: "y\uD800" }], n: 1 });
    const copy = structuredClone(input);
    const result = stripUnstorableChars(input);
    expect(input).toEqual(copy);
    expect(result).not.toBe(input);
    expect(result).toEqual({ k: ["x", { b: "y" }], n: 1 });
  });

  it("8 to vask gir samme resultat", () => {
    for (const example of EXAMPLES) {
      const once = stripUnstorableChars(example);
      expect(stripUnstorableChars(once)).toEqual(once);
    }
  });

  it("9 tekst med bare nulltegn blir tom tekst", () => {
    expect(stripUnstorableChars("\u0000\u0000")).toBe("");
  });

  it("10 tekst uten slike tegn returneres lik", () => {
    const text = "Generell beskrivelse: fukt i kjeller.";
    expect(stripUnstorableChars(text)).toBe(text);
    expect(stripUnstorableChars("")).toBe("");
  });
});
