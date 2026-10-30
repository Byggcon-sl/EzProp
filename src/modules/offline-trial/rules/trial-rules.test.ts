import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listTrialFields, trialForm } from "../trial-form";
import * as rulesModule from "./index";

// Prøve E: reglene som data (docs/funksjoner/fase1-prove-e-regler.md pkt. 1, AK 1–2).
// Testplan avsnitt 2.1. Tallene er oppdiktede prøveverdier, ikke fag.

const { trialRules } = rulesModule;
const RULES_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(RULES_DIR, "../../..");

/** Kildeteksten uten kommentarer (enkel fjerning, nok for denne filen). */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Alle .ts/.tsx-filer under en mappe, rekursivt. */
function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Kildefilene i `rules/` (uten testfiler). */
function ruleSourceFiles(): { file: string; text: string }[] {
  return readdirSync(RULES_DIR)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => ({ file: name, text: readFileSync(path.join(RULES_DIR, name), "utf8") }));
}

/** Alle eksporterte konstanter med navn som starter med `TRIAL_ONLY_`. */
function trialOnlyExports(): [string, unknown][] {
  return Object.entries(rulesModule).filter(([name]) => name.startsWith("TRIAL_ONLY_"));
}

/** Alle tall i en verdi (rekursivt). */
function numbersIn(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(numbersIn);
  return [];
}

/** Alle nøkler i et objekt (rekursivt). */
function keysIn(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(keysIn);
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysIn(inner)]);
}

const STATES = ["triggered", "not_triggered", "not_evaluated"] as const;

function allMessages(): string[] {
  return trialRules.flatMap((rule) => STATES.map((state) => rule.messages[state]));
}

function ruleByKey(key: string) {
  const rule = trialRules.find((entry) => entry.key === key);
  if (!rule) throw new Error(`Fant ikke regelen ${key}`);
  return rule;
}

describe("prøvereglene som data", () => {
  it("det finnes nøyaktig to prøveregler med faste koder", () => {
    const keys = trialRules.map((rule) => rule.key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(["trial_moisture_floor_limit", "trial_water_heater_age"]);
  });

  it("reglene leser riktig felt og har riktig type", () => {
    expect(ruleByKey("trial_water_heater_age")).toMatchObject({
      field: "water_heater_age",
      kind: "age_vs_lifespan",
    });
    expect(ruleByKey("trial_moisture_floor_limit")).toMatchObject({
      field: "moisture_floor",
      kind: "number_vs_limit",
    });
  });

  it("feltene finnes i testskjemaet som tallfelt", () => {
    const fields = listTrialFields(trialForm);
    for (const rule of trialRules) {
      const field = fields.find((entry) => entry.key === rule.field);
      expect(field, rule.field).toBeDefined();
      expect(field?.type, rule.field).toBe("number");
    }
  });

  it("prøvetallene ligger i TRIAL_ONLY-konstanten", () => {
    const constants = trialOnlyExports();
    expect(constants.length, "eksportert TRIAL_ONLY_-konstant").toBeGreaterThan(0);
    const values = constants.flatMap(([, value]) => numbersIn(value));
    expect(ruleByKey("trial_water_heater_age").limit).toBe(7);
    expect(ruleByKey("trial_moisture_floor_limit").limit).toBe(42);
    for (const rule of trialRules) {
      expect(values, `${rule.key} skal lese grensen fra TRIAL_ONLY_`).toContain(rule.limit);
    }
    // Ingen andre tall i konstanten enn de to prøvetallene
    expect([...values].sort((a, b) => a - b)).toEqual([7, 42]);
  });

  it("grensetallene står bare i regeldataene", () => {
    // Tallene i TRIAL_ONLY_LIMITS er dekket over; her sjekkes at meldingene ikke har egne tall.
    const text = withoutComments(readFileSync(path.join(RULES_DIR, "trial-rules.ts"), "utf8"));
    // Ingen meldingsstreng (tekst eller mal) har et siffer skrevet rett inn
    const literals = text.match(/"[^"]*"|`[^`]*`/g) ?? [];
    for (const literal of literals.filter((entry) => entry.includes("Prøveregel"))) {
      const fixedText = literal.replace(/\$\{[^}]*\}/g, "");
      expect(fixedText, literal).not.toMatch(/\d/);
    }
  });

  it("index eksporterer ikke testsakene", () => {
    expect("trialRuleCases" in rulesModule).toBe(false);
  });

  it("ingen appfil importerer trial-rule-cases", () => {
    const appFiles = sourceFilesUnder(SRC_DIR).filter((file) => !/\.test\.tsx?$/.test(file));
    const importing = appFiles.filter((file) =>
      /from\s+["'][^"']*trial-rule-cases["']/.test(readFileSync(file, "utf8")),
    );
    expect(importing.map((file) => path.relative(SRC_DIR, file))).toEqual([]);
  });

  it("hver regel er merket som oppdiktet prøveverdi", () => {
    for (const rule of trialRules) {
      expect(rule.source_ref, rule.key).toBe("oppdiktet prøveverdi");
    }
  });

  it("kildefilen merker tallene som oppdiktet", () => {
    const withConstant = ruleSourceFiles().filter(({ text }) =>
      /export\s+const\s+TRIAL_ONLY_/.test(text),
    );
    expect(withConstant.map(({ file }) => file)).toHaveLength(1);
    expect(withConstant[0]!.text).toContain("Oppdiktet prøveverdi, ikke fag");
  });

  it("alle meldinger starter med Prøveregel", () => {
    for (const message of allMessages()) {
      expect(message.startsWith("Prøveregel"), message).toBe(true);
    }
  });

  it("meldingene er ordrett som i kortet", () => {
    expect(ruleByKey("trial_water_heater_age").messages).toEqual({
      triggered: "Prøveregel: over prøvegrensen (7 år)",
      not_triggered: "Prøveregel: ikke over prøvegrensen (7 år)",
      not_evaluated: "Prøveregel: ikke vurdert",
    });
    expect(ruleByKey("trial_moisture_floor_limit").messages).toEqual({
      triggered: "Prøveregel: over prøvegrensen (42 %)",
      not_triggered: "Prøveregel: ikke over prøvegrensen (42 %)",
      not_evaluated: "Prøveregel: ikke vurdert",
    });
  });

  // Obligatorisk (AK 2)
  it("ingen gjetteord eller vurderingsord i meldingene", () => {
    for (const message of allMessages()) {
      expect(message, message).not.toMatch(/antas/i);
      expect(message, message).not.toMatch(/trolig/i);
      expect(message, message).not.toMatch(/avvik/i);
      expect(message, message).not.toMatch(/bør/i);
      expect(message, message).not.toMatch(/(^|[^\p{L}\p{N}])tg($|[^\p{L}\p{N}])/iu);
    }
  });

  it("ingen TG eller utfall i reglene", () => {
    const forbidden = ["tg", "suggest_tgiu", "suggest_outcome", "outcome", "show", "validate"];
    for (const rule of trialRules) {
      const keys = keysIn(rule).map((key) => key.toLowerCase());
      for (const key of forbidden) {
        expect(keys, `${rule.key} har nøkkelen ${key}`).not.toContain(key);
      }
    }
  });
});
