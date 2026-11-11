import { describe, expect, it } from "vitest";
import { stripUnstorableChars } from "./clean-text";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

const examples: unknown[] = [
  "a\u0000b",
  "a\uD800b",
  "\uDC00a\uD800",
  "Bad 🛁\n\tæøå ÆØÅ 12 m²",
  { a: ["x\u0000", { b: "y\u0000" }] },
  { "k\u0000": 1 },
  "\u0000\u0000",
  [0, -1.5, true, false, null, "z\u0000"],
];

describe("stripUnstorableChars", () => {
  it("1 fjerner nulltegn i tekst", () => {
    expect(stripUnstorableChars("a\u0000b")).toBe("ab");
  });

  it("2 fjerner ensomme surrogater (høy og lav)", () => {
    expect(stripUnstorableChars("a\uD800b")).toBe("ab");
    expect(stripUnstorableChars("a\uDC00b")).toBe("ab");
    expect(stripUnstorableChars("\uD800ab")).toBe("ab");
    expect(stripUnstorableChars("ab\uD800")).toBe("ab");
    expect(stripUnstorableChars("\uDC00ab")).toBe("ab");
    expect(stripUnstorableChars("ab\uDC00")).toBe("ab");
    // Lav før høy er ikke et par
    expect(stripUnstorableChars("a\uDC00\uD800b")).toBe("ab");
  });

  it("3 beholder emoji, linjeskift, tabulator, æøå og m²", () => {
    const text = "Bad 🛁\n\tæøå ÆØÅ 12 m²\r\n";
    expect(stripUnstorableChars(text)).toBe(text);
  });

  it("4 går gjennom objekter og lister i flere nivåer", () => {
    expect(stripUnstorableChars({ a: ["x\u0000", { b: "y\u0000" }] })).toEqual({
      a: ["x", { b: "y" }],
    });
  });

  it("5 vasker nøkler i objekter", () => {
    expect(stripUnstorableChars({ "k\u0000": 1 })).toEqual({ k: 1 });
  });

  it("6 rører ikke tall, true/false og null", () => {
    for (const value of [0, -1.5, true, false, null, undefined]) {
      expect(stripUnstorableChars(value)).toBe(value);
    }
    expect(stripUnstorableChars({ n: 0, f: -1.5, t: true, u: false, z: null })).toEqual({
      n: 0,
      f: -1.5,
      t: true,
      u: false,
      z: null,
    });
    expect(stripUnstorableChars([0, -1.5, true, false, null])).toEqual([
      0,
      -1.5,
      true,
      false,
      null,
    ]);
  });

  it("7 endrer ikke inndata", () => {
    const input = deepFreeze({ a: ["x\u0000", { "b\u0000": "y\u0000" }], n: 1 });
    const copy = structuredClone(input);
    const result = stripUnstorableChars(input);
    expect(input).toEqual(copy);
    expect(result).not.toBe(input);
    expect(result).toEqual({ a: ["x", { b: "y" }], n: 1 });
  });

  it("8 to vask gir samme resultat", () => {
    for (const example of examples) {
      const once = stripUnstorableChars(example);
      expect(stripUnstorableChars(once)).toEqual(once);
    }
  });

  it("9 tekst med bare nulltegn blir tom tekst", () => {
    expect(stripUnstorableChars("\u0000\u0000")).toBe("");
  });

  it("10 tekst uten slike tegn returneres lik", () => {
    expect(stripUnstorableChars("Vanlig tekst om taket.")).toBe("Vanlig tekst om taket.");
  });

  it("nøkkelen __proto__ etter vask blir vanlig nøkkel, ikke ny prototype", () => {
    const input = JSON.parse('{"__proto__\\u0000": { "polluted": true }}') as object;
    const result = stripUnstorableChars(input) as Record<string, unknown>;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(["__proto__"]);
    expect("polluted" in result).toBe(false);
  });
});
