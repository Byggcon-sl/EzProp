import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TrialAnswers } from "../answers";
import { evaluateTrialRules, trialRules } from "./index";

// Prøve E: regelmotoren (docs/funksjoner/fase1-prove-e-regler.md pkt. 3, AK 3). Testplan 2.3.
// Samme motor kjører i skjemaet uten nett og i serverruten, så den må være ren og felles.

const RULES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(RULES_DIR, "../../..");
const MODULE_DIR = path.resolve(RULES_DIR, "..");
const ROUTE_FILE = path.join(SRC_DIR, "app/api/prove/regler/route.ts");

function stateOf(answers: TrialAnswers, key: string) {
  return evaluateTrialRules(trialRules, answers).find((entry) => entry.key === key)?.state;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Kildefiler (ikke tester) i `src/`. */
function sourceFiles(dir: string): string[] {
  return walk(dir).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
}

/** Fjerner blokk- og linjekommentarer (enkel versjon, godt nok for egne kildefiler). */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Alle modulstier i `import … from "…"`, `export … from "…"` og `import("…")`. */
function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  for (const match of text.matchAll(/\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g)) {
    specifiers.push(match[1]!);
  }
  for (const match of text.matchAll(/\bimport\s*["']([^"']+)["']/g)) specifiers.push(match[1]!);
  for (const match of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

/** Filen som definerer motoren. Skal være nøyaktig én i `rules/`. */
function engineFile(): string {
  const files = sourceFiles(RULES_DIR).filter((file) =>
    /function\s+evaluateTrialRules\b/.test(readFileSync(file, "utf8")),
  );
  expect(files.map((file) => path.relative(SRC_DIR, file))).toHaveLength(1);
  return files[0]!;
}

/** Hvor `evaluateTrialRules` importeres fra i en fil, løst til en absolutt sti (uten filendelse). */
function evaluateImportTargets(file: string): string[] {
  const text = withoutComments(readFileSync(file, "utf8"));
  const targets: string[] = [];
  for (const match of text.matchAll(
    /\bimport\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    const names = match[1]!.split(",").map((name) => name.trim().split(/\s+as\s+/)[0]);
    if (!names.includes("evaluateTrialRules")) continue;
    const specifier = match[2]!;
    const resolved = specifier.startsWith("@/")
      ? path.join(SRC_DIR, specifier.slice(2))
      : path.resolve(path.dirname(file), specifier);
    targets.push(resolved.replace(/\.tsx?$/, "").replace(/\/index$/, ""));
  }
  return targets;
}

/** Peker stien på regelmappen (index) eller på selve motorfilen? */
function isRulesModule(target: string): boolean {
  return target === RULES_DIR || target === engineFile().replace(/\.tsx?$/, "");
}

describe("evaluateTrialRules", () => {
  it("over betyr strengt større enn", () => {
    for (const rule of trialRules) {
      expect(stateOf({ [rule.field]: rule.limit }, rule.key), `${rule.key} lik`).toBe(
        "not_triggered",
      );
      expect(stateOf({ [rule.field]: rule.limit + 0.01 }, rule.key), `${rule.key} over`).toBe(
        "triggered",
      );
      expect(stateOf({ [rule.field]: rule.limit - 0.01 }, rule.key), `${rule.key} under`).toBe(
        "not_triggered",
      );
    }
  });

  it("null, manglende felt og negativt tall gir ikke vurdert", () => {
    for (const rule of trialRules) {
      for (const answers of [
        {},
        { [rule.field]: null },
        { [rule.field]: -1 },
        { [rule.field]: -0.01 },
      ] as TrialAnswers[]) {
        expect(stateOf(answers, rule.key), `${rule.key} ${JSON.stringify(answers)}`).toBe(
          "not_evaluated",
        );
      }
    }
  });

  it("null er en gyldig måling", () => {
    for (const rule of trialRules) {
      expect(stateOf({ [rule.field]: 0 }, rule.key), rule.key).toBe("not_triggered");
    }
  });

  it("verdi som ikke er et endelig tall gir ikke vurdert", () => {
    for (const rule of trialRules) {
      for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "7"]) {
        const answers: TrialAnswers = { [rule.field]: value };
        expect(() => evaluateTrialRules(trialRules, answers)).not.toThrow();
        expect(stateOf(answers, rule.key), `${rule.key} ${String(value)}`).toBe("not_evaluated");
      }
    }
  });

  it("svarer for hver regel i rekkefølge, med kode", () => {
    const results = evaluateTrialRules(trialRules, { water_heater_age: 8, moisture_floor: 10 });
    expect(results.map((entry) => entry.key)).toEqual(trialRules.map((rule) => rule.key));
    for (const entry of results) {
      expect(Object.keys(entry).sort()).toEqual(["key", "message", "state"]);
      expect(typeof entry.message).toBe("string");
    }
    expect(results).toEqual([
      {
        key: "trial_water_heater_age",
        state: "triggered",
        message: "Prøveregel: over prøvegrensen (7 år)",
      },
      {
        key: "trial_moisture_floor_limit",
        state: "not_triggered",
        message: "Prøveregel: ikke over prøvegrensen (42 %)",
      },
    ]);
  });

  it("andre felt påvirker ikke svaret", () => {
    const base: TrialAnswers = { water_heater_age: 7.5, moisture_floor: 41.9 };
    const withOthers: TrialAnswers = {
      ...base,
      roof_tg: "TG3",
      floors: 99,
      summary: "Oppdiktet tekst",
      moisture_wall: 999,
    };
    expect(evaluateTrialRules(trialRules, withOthers)).toEqual(
      evaluateTrialRules(trialRules, base),
    );
  });

  it("samme inndata gir samme svar to ganger", () => {
    const answers = Object.freeze({ water_heater_age: 7.5, moisture_floor: 42 }) as TrialAnswers;
    const copy = { ...answers };
    const first = evaluateTrialRules(trialRules, answers);
    const second = evaluateTrialRules(trialRules, answers);
    expect(second).toEqual(first);
    expect(answers).toEqual(copy);
    // Reglene endres heller ikke
    expect(trialRules.map((rule) => rule.limit)).toEqual([7, 42]);
  });

  // Obligatorisk (AK 3)
  it("motoren importerer bare fra egen mappe og answers", () => {
    const file = engineFile();
    const specifiers = importSpecifiers(withoutComments(readFileSync(file, "utf8")));
    for (const specifier of specifiers) {
      const allowed =
        /^\.\/[\w.-]+$/.test(specifier) ||
        specifier === "../answers" ||
        specifier === "../answers.ts";
      expect(allowed, `ulovlig import i motoren: ${specifier}`).toBe(true);
    }
    // Det motoren importerer fra egen mappe, må heller ikke hente noe utenfra
    for (const source of sourceFiles(RULES_DIR)) {
      for (const specifier of importSpecifiers(withoutComments(readFileSync(source, "utf8")))) {
        const allowed = /^\.\/[\w.-]+$/.test(specifier) || /^\.\.\/answers(\.ts)?$/.test(specifier);
        expect(allowed, `${path.basename(source)}: ulovlig import ${specifier}`).toBe(true);
      }
    }
  });

  // Obligatorisk (AK 3)
  it("motoren bruker ingen nettleser- eller server-API", () => {
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
    for (const source of sourceFiles(RULES_DIR)) {
      const text = withoutComments(readFileSync(source, "utf8"));
      for (const [name, pattern] of forbidden) {
        expect(pattern.test(text), `${path.basename(source)} bruker ${name}`).toBe(false);
      }
    }
  });

  it("skjemaet og ruten bruker samme motor", () => {
    // Ruten (pkt. 4)
    expect(existsSync(ROUTE_FILE), "ruten src/app/api/prove/regler/route.ts").toBe(true);
    const routeTargets = evaluateImportTargets(ROUTE_FILE);
    expect(routeTargets, "ruten importerer evaluateTrialRules").toHaveLength(1);
    expect(isRulesModule(routeTargets[0]!), `ruten importerer fra ${routeTargets[0]}`).toBe(true);

    // Visningen (pkt. 5): komponenten med data-rule-key, eller skjemaet som setter den inn
    const viewFiles = sourceFiles(MODULE_DIR).filter(
      (file) => file.endsWith(".tsx") && !file.startsWith(RULES_DIR),
    );
    const component = viewFiles.filter((file) =>
      readFileSync(file, "utf8").includes("data-rule-key"),
    );
    expect(
      component.map((file) => path.relative(SRC_DIR, file)),
      "én visningskomponent med data-rule-key",
    ).toHaveLength(1);
    const viewTargets = viewFiles.flatMap(evaluateImportTargets);
    expect(viewTargets.length, "skjemaet importerer evaluateTrialRules").toBeGreaterThan(0);
    for (const target of viewTargets) {
      expect(isRulesModule(target), `skjemaet importerer fra ${target}`).toBe(true);
    }

    // Ingen kopi av motoren noe annet sted i src/
    const definitions = sourceFiles(SRC_DIR).filter((file) =>
      /function\s+evaluateTrialRules\b|\bevaluateTrialRules\s*=/.test(
        withoutComments(readFileSync(file, "utf8")),
      ),
    );
    expect(definitions.map((file) => path.relative(SRC_DIR, file))).toEqual([
      path.relative(SRC_DIR, engineFile()),
    ]);
  });
});
