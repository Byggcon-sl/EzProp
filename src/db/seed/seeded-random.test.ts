import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSeededRandom } from "./seeded-random";

/*
 * Frøgeneratoren for testdataene. Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 1.
 *
 * Støtter hovedmål: de ansatte (testmiljøet får samme arbeidsdag hver gang) og færre
 * reklamasjoner (testene over testdataene blir stabile, ikke tilfeldig røde).
 */

function draws(seed: number, n: number): number[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: n }, () => random.next());
}

describe("createSeededRandom (1)", () => {
  it("1.1 samme frø gir samme rekkefølge (1000 trekk)", () => {
    const first = draws(42, 1000);
    expect(draws(42, 1000)).toEqual(first);
    for (const value of first) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("1.2 annet frø gir annen rekkefølge (de første 20 trekkene)", () => {
    expect(draws(43, 20)).not.toEqual(draws(42, 20));
  });

  it("1.3 int(min, max) holder seg innenfor og treffer begge ender (10 000 trekk)", () => {
    const random = createSeededRandom(7);
    const seen = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const value = random.int(3, 9);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(9);
      seen.add(value);
    }
    expect(seen.has(3)).toBe(true);
    expect(seen.has(9)).toBe(true);
    expect(seen.size).toBe(7);
  });

  it("1.3 int(min, max) med min lik max gir alltid den verdien", () => {
    const random = createSeededRandom(1);
    for (let i = 0; i < 100; i++) expect(random.int(5, 5)).toBe(5);
  });

  it("1.4 pick på tom liste kaster, gir ikke undefined", () => {
    const random = createSeededRandom(1);
    expect(() => random.pick([])).toThrow();
  });

  it("1.4 pick gir bare elementer fra listen", () => {
    const random = createSeededRandom(1);
    const list = ["a", "b", "c"] as const;
    for (let i = 0; i < 200; i++) expect(list).toContain(random.pick(list));
  });

  it.each(["seeded-random.ts", "testdata.ts", "testdata-plan.ts", "testdata.data.ts"])(
    "1.5 %s bruker ikke Math.random eller Date.now",
    (file) => {
      const source = readFileSync(join(process.cwd(), "src/db/seed", file), "utf8");
      expect(source).not.toMatch(/Math\.random\s*\(/);
      expect(source).not.toMatch(/Date\.now\s*\(/);
    },
  );
});
