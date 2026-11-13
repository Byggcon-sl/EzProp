import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSeededRandom } from "./seeded-random";
import { TESTDATA_SEED } from "./testdata.data";

/*
 * Frøgeneratoren for testdataene (`pnpm db:seed:testdata`). Testplan:
 * docs/funksjoner/fase2a-testdata-arbeidshverdag-testplan.md avsnitt 1.
 *
 * Støtter hovedmål: de ansatte (testmiljøet viser de samme dataene hver gang, så det de prøver,
 * kan gjentas) og færre reklamasjoner (tester som bygger på dataene, blir ikke ustabile).
 */

function draw(seed: number, count: number): number[] {
  const random = createSeededRandom(seed);
  return Array.from({ length: count }, () => random.next());
}

describe("createSeededRandom", () => {
  it("1.1 samme frø gir samme rekkefølge (1000 tall)", () => {
    expect(draw(TESTDATA_SEED, 1000)).toEqual(draw(TESTDATA_SEED, 1000));
  });

  it("1.2 annet frø gir annen rekkefølge", () => {
    expect(draw(1, 10)).not.toEqual(draw(2, 10));
  });

  it("1.3 next() er alltid i [0, 1)", () => {
    for (const value of draw(TESTDATA_SEED, 5000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("1.3 int(1, 3) gir bare 1, 2 og 3, og alle tre minst én gang på 1000 trekk", () => {
    const random = createSeededRandom(TESTDATA_SEED);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i += 1) {
      const value = random.int(1, 3);
      expect([1, 2, 3]).toContain(value);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it("1.3 pick([]) kaster, og pick gir bare elementer fra listen", () => {
    const random = createSeededRandom(TESTDATA_SEED);
    expect(() => random.pick([])).toThrow();
    const list = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i += 1) expect(list).toContain(random.pick(list));
  });

  it("1.3 int og pick med samme frø gir samme rekkefølge", () => {
    const a = createSeededRandom(TESTDATA_SEED);
    const b = createSeededRandom(TESTDATA_SEED);
    const list = ["x", "y", "z", "w"];
    for (let i = 0; i < 200; i += 1) {
      expect(a.int(0, 100)).toBe(b.int(0, 100));
      expect(a.pick(list)).toBe(b.pick(list));
    }
  });
});

describe("ingen global tilfeldighet eller klokke i testdataene", () => {
  const FILES = ["seeded-random.ts", "testdata.ts", "testdata.data.ts"];

  /** Kildeteksten uten kommentarer, så forklaringer i kommentarer ikke slår ut. */
  function code(file: string): string {
    const text = readFileSync(join(process.cwd(), "src/db/seed", file), "utf8");
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  }

  it.each(FILES)(
    "1.4 %s bruker ikke Math.random, crypto.randomUUID, Date.now() eller new Date()",
    (file) => {
      const text = code(file);
      expect(text).not.toMatch(/Math\.random/);
      expect(text).not.toMatch(/randomUUID/);
      expect(text).not.toMatch(/Date\.now\(\)/);
      expect(text).not.toMatch(/new Date\(\s*\)/);
    },
  );
});
