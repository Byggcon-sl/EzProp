import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TrialAnswers } from "../answers";
import { evaluateTrialRules } from "./evaluate-trial-rules";
import { trialRules, type TrialRuleState } from "./trial-rules";

// Prøve E: regelmotoren (docs/funksjoner/fase1-prove-e-regler.md pkt. 3, AK 3).
// Testplan avsnitt 2.3. Samme kode kjører i skjemaet uten nett og i serverruten.

const SRC = path.resolve(process.cwd(), "src");
const ENGINE_FILE = path.join(SRC, "modules/offline-trial/rules/evaluate-trial-rules.ts");
const VIEW_FILE = path.join(SRC, "modules/offline-trial/trial-rule-result.tsx");
const ROUTE_FILE = path.join(SRC, "app/api/prove/regler/route.ts");

function stateOf(answers: TrialAnswers, key: string): TrialRuleState | undefined {
  return evaluateTrialRules(trialRules, answers).find((entry) => entry.key === key)?.state;
}

function expectBoth(value: unknown, state: TrialRuleState) {
  for (const rule of trialRules) {
    expect(
      stateOf({ [rule.field]: value as never }, rule.key),
      `${rule.key} ${String(value)}`,
    ).toBe(state);
  }
}

/** Kildeteksten uten kommentarer. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Alle modulstier i `import … from "…"`, `import "…"`, `export … from "…"` og `import("…")`. */
function importSpecifiers(source: string): string[] {
  const text = withoutComments(source);
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;
  return [...text.matchAll(pattern)].map((match) => match[1]!);
}

/** Modulstien `evaluateTrialRules` importeres fra, gjort om til en fil-sti uten endelse og /index. */
function engineImportPath(file: string): string {
  const source = withoutComments(readFileSync(file, "utf8"));
  const match = /import\s*\{[^}]*\bevaluateTrialRules\b[^}]*\}\s*from\s*["']([^"']+)["']/.exec(
    source,
  );
  expect(match, `${path.relative(SRC, file)} importerer evaluateTrialRules`).not.toBeNull();
  const specifier = match![1]!;
  const absolute = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : path.resolve(path.dirname(file), specifier);
  const target = absolute.replace(/\.(ts|tsx)$/, "").replace(/\/index$/, "");
  // `rules/` (index som sender videre) og `rules/evaluate-trial-rules` er samme modul
  const index = path.join(target, "index.ts");
  if (
    existsSync(index) &&
    /from\s*["']\.\/evaluate-trial-rules["']/.test(readFileSync(index, "utf8"))
  ) {
    return path.join(target, "evaluate-trial-rules");
  }
  return target;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("evaluateTrialRules", () => {
  it("over betyr strengt større enn", () => {
    for (const rule of trialRules) {
      const check = (value: number) => stateOf({ [rule.field]: value }, rule.key);
      expect(check(rule.limit), rule.key).toBe("not_triggered");
      expect(check(rule.limit + 0.01), rule.key).toBe("triggered");
      expect(check(rule.limit - 0.01), rule.key).toBe("not_triggered");
    }
  });

  it("null, manglende felt og negativt tall gir ikke vurdert", () => {
    for (const rule of trialRules) {
      expect(stateOf({}, rule.key), rule.key).toBe("not_evaluated");
    }
    expectBoth(null, "not_evaluated");
    expectBoth(-1, "not_evaluated");
    expectBoth(-0.01, "not_evaluated");
  });

  it("null er en gyldig måling", () => {
    expectBoth(0, "not_triggered");
  });

  it("verdi som ikke er et endelig tall gir ikke vurdert", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "7"]) {
      expect(() =>
        evaluateTrialRules(trialRules, { water_heater_age: value as never }),
      ).not.toThrow();
      expectBoth(value, "not_evaluated");
    }
  });

  it("svarer for hver regel i rekkefølge, med kode", () => {
    const results = evaluateTrialRules(trialRules, { water_heater_age: 8, moisture_floor: 1 });
    expect(results.map((entry) => entry.key)).toEqual(trialRules.map((rule) => rule.key));
    for (const [index, result] of results.entries()) {
      expect(Object.keys(result).sort()).toEqual(["key", "message", "state"]);
      expect(result.message).toBe(trialRules[index]!.messages[result.state]);
    }
    expect(results.map((entry) => entry.state)).toEqual(["triggered", "not_triggered"]);
  });

  it("andre felt påvirker ikke svaret", () => {
    const base = { water_heater_age: 8, moisture_floor: 43 };
    expect(
      evaluateTrialRules(trialRules, { ...base, roof_tg: "TG3", floors: 99, summary: "x" }),
    ).toEqual(evaluateTrialRules(trialRules, base));
  });

  it("samme inndata gir samme svar to ganger", () => {
    const answers = Object.freeze({ water_heater_age: 7.5, moisture_floor: 42 });
    const rules = Object.freeze([...trialRules]);
    const first = evaluateTrialRules(rules, answers);
    const second = evaluateTrialRules(rules, answers);
    expect(second).toEqual(first);
    expect(answers).toEqual({ water_heater_age: 7.5, moisture_floor: 42 });
  });

  // Obligatorisk (AK 3)
  it("motoren importerer bare fra egen mappe og answers", () => {
    const specifiers = importSpecifiers(readFileSync(ENGINE_FILE, "utf8"));
    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      const insideRules = specifier.startsWith("./");
      const answers = specifier === "../answers";
      expect(insideRules || answers, specifier).toBe(true);
    }
  });

  // Obligatorisk (AK 3)
  it("motoren bruker ingen nettleser- eller server-API", () => {
    const code = withoutComments(readFileSync(ENGINE_FILE, "utf8"));
    const forbidden: [string, RegExp][] = [
      ["window", /\bwindow\b/],
      ["document", /\bdocument\b/],
      ["fetch", /\bfetch\b/],
      ["localStorage", /\blocalStorage\b/],
      ["navigator", /\bnavigator\b/],
      ["fs", /\bfs\b/],
      ["process", /\bprocess\b/],
      ["@/db", /@\/db/],
      ["require(", /\brequire\s*\(/],
      ["Date.now", /\bDate\.now\b/],
      ["Math.random", /\bMath\.random\b/],
    ];
    for (const [name, pattern] of forbidden) {
      expect(pattern.test(code), name).toBe(false);
    }
  });

  it("skjemaet og ruten bruker samme motor", () => {
    expect(engineImportPath(VIEW_FILE)).toBe(engineImportPath(ROUTE_FILE));
    const definitions = sourceFiles(SRC).filter((file) =>
      /function\s+evaluateTrialRules\b/.test(readFileSync(file, "utf8")),
    );
    expect(definitions.map((file) => path.relative(SRC, file))).toEqual([
      "modules/offline-trial/rules/evaluate-trial-rules.ts",
    ]);
  });
});
