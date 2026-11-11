import { describe, expect, it } from "vitest";
import { stripUnstorableChars, stripUnstorableText } from "./clean-text";

/*
 * Vasken for tegn databasen ikke tar (funn T-0001, testplanen rett-t0001-synkko 1a, test 1–10).
 * Støtter hovedmål: de ansatte (én innlimt tekst stopper ikke synken) og KI i bunnen.
 */

const KEEP = "Bad 🛁\n\tæøå ÆØÅ 12 m²";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

describe("stripUnstorableText", () => {
  it("1 fjerner nulltegn i tekst", () => {
    expect(stripUnstorableText("a\u0000b")).toBe("ab");
    expect(stripUnstorableText("Fukt\u0000 i kjeller")).toBe("Fukt i kjeller");
  });

  it("2 fjerner ensomme surrogater (høy og lav), også først og sist", () => {
    expect(stripUnstorableText("a\uD800b")).toBe("ab");
    expect(stripUnstorableText("a\uDC00b")).toBe("ab");
    expect(stripUnstorableText("\uD800ab")).toBe("ab");
    expect(stripUnstorableText("ab\uD800")).toBe("ab");
    expect(stripUnstorableText("\uDC00ab")).toBe("ab");
    expect(stripUnstorableText("ab\uDC00")).toBe("ab");
    // Lav foran høy er to ensomme tegn
    expect(stripUnstorableText("a\uDC00\uD800b")).toBe("ab");
    // To høye etter hverandre før en lav: den første er ensom
    expect(stripUnstorableText("\uD83D🛁")).toBe("🛁");
  });

  it("3 beholder emoji, linjeskift, tabulator, æøå og m²", () => {
    expect(stripUnstorableText(KEEP)).toBe(KEEP);
  });

  it("9 tekst med bare nulltegn blir tom tekst", () => {
    expect(stripUnstorableText("\u0000\u0000")).toBe("");
  });

  it("10 tekst uten slike tegn returneres lik", () => {
    expect(stripUnstorableText("Taket er gammelt")).toBe("Taket er gammelt");
    expect(stripUnstorableText("")).toBe("");
  });
});

describe("stripUnstorableChars", () => {
  it("4 går gjennom objekter og lister i flere nivåer", () => {
    expect(stripUnstorableChars({ a: ["x\u0000", { b: "y\u0000" }] })).toEqual({
      a: ["x", { b: "y" }],
    });
    expect(stripUnstorableChars([["a\uD800"], "b\u0000"])).toEqual([["a"], "b"]);
  });

  it("5 vasker nøkler i objekter", () => {
    expect(stripUnstorableChars({ "k\u0000": 1 })).toEqual({ k: 1 });
  });

  it("6 rører ikke tall, true/false, null og undefined", () => {
    for (const value of [0, -1.5, true, false, null, undefined]) {
      expect(stripUnstorableChars(value)).toBe(value);
    }
    const mixed = { n: 0, m: -1.5, t: true, f: false, z: null, list: [0, true, null] };
    expect(stripUnstorableChars(mixed)).toEqual(mixed);
  });

  it("7 endrer ikke inndata", () => {
    const input = { a: ["x\u0000", { b: "y\u0000", "k\u0000": 2 }], c: 1 };
    const copy = structuredClone(input);
    deepFreeze(input);
    const result = stripUnstorableChars(input);
    expect(input).toEqual(copy);
    expect(result).not.toBe(input);
  });

  it("8 to vask gir samme resultat", () => {
    const examples: unknown[] = [
      "a\u0000b",
      "a\uD800b",
      "\uDC00\uD800",
      KEEP,
      { a: ["x\u0000", { b: "y\u0000" }] },
      { "k\u0000": 1 },
      "\u0000\u0000",
      [0, true, null],
    ];
    for (const example of examples) {
      const once = stripUnstorableChars(example);
      expect(stripUnstorableChars(once)).toEqual(once);
    }
  });

  it("nøkkelen «__proto__» blir en vanlig nøkkel", () => {
    const input = JSON.parse('{"__proto__": "x\\u0000"}') as Record<string, unknown>;
    const result = stripUnstorableChars(input);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.entries(result)).toEqual([["__proto__", "x"]]);
  });
});
