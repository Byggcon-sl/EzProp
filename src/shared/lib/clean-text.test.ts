import { describe, expect, it } from "vitest";
import { stripUnstorableChars } from "./clean-text";

/*
 * Vasken for tegn databasen ikke tar (funn T-0001, testplan
 * docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 1a, test 1–10). Ren funksjon.
 * Alle tekster er oppdiktet.
 * Støtter hovedmål: de ansatte (innlimt tekst med usynlige tegn stopper ikke synken) og KI i
 * bunnen (samme vask brukes før KI-loggen).
 */

const strip = stripUnstorableChars as <T>(value: T) => T;

/** Fryser et objekt og alt under det. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const SAFE_TEXT = "Bad 🛁\n\tæøå ÆØÅ 12 m²";

const EXAMPLES: unknown[] = [
  "a\u0000b",
  "a\uD800b",
  "a\uDC00b",
  "\uD800a",
  "a\uDBFF",
  "\uDC00a",
  "a\uDFFF",
  SAFE_TEXT,
  { a: ["x\u0000", { b: "y\u0000" }] },
  { "k\u0000": 1 },
  [0, -1.5, true, false, null, "z\u0000"],
  "\u0000\u0000",
  "Fukt\u0000 i kjeller",
  "Vanlig oppdiktet tekst",
];

describe("stripUnstorableChars (src/shared/lib/clean-text.ts)", () => {
  it("1 fjerner nulltegn i tekst", () => {
    expect(strip("a\u0000b")).toBe("ab");
    expect(strip("Fukt\u0000 i kjeller")).toBe("Fukt i kjeller");
    expect(strip("\u0000start og slutt\u0000")).toBe("start og slutt");
  });

  it("2 fjerner ensomme surrogater (høy og lav)", () => {
    expect(strip("a\uD800b")).toBe("ab");
    expect(strip("a\uDC00b")).toBe("ab");
    // Først og sist i teksten
    expect(strip("\uD800a")).toBe("a");
    expect(strip("a\uDBFF")).toBe("a");
    expect(strip("\uDC00a")).toBe("a");
    expect(strip("a\uDFFF")).toBe("a");
    // To lave etter hverandre og en høy uten lav etter seg
    expect(strip("a\uDC00\uDC00b")).toBe("ab");
    expect(strip("a\uD800\uD800b")).toBe("ab");
  });

  it("3 beholder emoji, linjeskift, tabulator, æøå og m²", () => {
    expect(strip(SAFE_TEXT)).toBe(SAFE_TEXT);
    // Gyldig surrogatpar ved siden av et ensomt: paret står
    expect(strip("🛁\uD800")).toBe("🛁");
  });

  it("4 går gjennom objekter og lister i flere nivåer", () => {
    expect(strip({ a: ["x\u0000", { b: "y\u0000" }] })).toEqual({ a: ["x", { b: "y" }] });
    expect(strip([["a\uD800"], [{ c: [{ d: "e\u0000" }] }]])).toEqual([
      ["a"],
      [{ c: [{ d: "e" }] }],
    ]);
  });

  it("5 vasker nøkler i objekter", () => {
    const result = strip({ "k\u0000": 1 });
    expect(result).toEqual({ k: 1 });
    expect(Object.keys(result)).toEqual(["k"]);
    expect(Object.keys(strip({ a: { "n\uD800": "v" } }).a)).toEqual(["n"]);
  });

  it("6 rører ikke tall, true/false og null", () => {
    for (const value of [0, -1.5, true, false, null]) {
      expect(strip(value)).toBe(value);
    }
    expect(strip([0, -1.5, true, false, null])).toEqual([0, -1.5, true, false, null]);
    const nested = strip({ n: 0, m: -1.5, t: true, f: false, z: null, l: [null, 3] });
    expect(nested).toEqual({ n: 0, m: -1.5, t: true, f: false, z: null, l: [null, 3] });
    expect(nested.z).toBeNull();
    expect(Object.is(nested.n, 0)).toBe(true);
  });

  it("7 endrer ikke inndata", () => {
    const input = deepFreeze({
      a: ["x\u0000", { b: "y\u0000" }],
      "k\u0000": 1,
      t: "a\uD800b",
      n: null,
    });
    const copy = structuredClone(input);
    expect(() => strip(input)).not.toThrow();
    expect(input).toEqual(copy);
    expect(input.a[0]).toBe("x\u0000");
  });

  it.each(EXAMPLES.map((example) => [JSON.stringify(example), example] as const))(
    "8 to vask gir samme resultat (%s)",
    (_name, example) => {
      expect(strip(strip(example))).toEqual(strip(example));
    },
  );

  it("9 tekst med bare nulltegn blir tom tekst", () => {
    expect(strip("\u0000\u0000")).toBe("");
    expect(strip("\u0000")).toBe("");
  });

  it("10 tekst uten slike tegn returneres lik", () => {
    const text = "Vanlig oppdiktet tekst om taket";
    expect(strip(text)).toBe(text);
    expect(strip("")).toBe("");
  });
});
