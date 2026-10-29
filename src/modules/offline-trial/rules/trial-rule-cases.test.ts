import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTrialNumber } from "../answers";
import { evaluateTrialRules } from "./evaluate-trial-rules";
import { trialRuleCases, type TrialRuleCase } from "./trial-rule-cases";
import { trialRules, type TrialRuleState } from "./trial-rules";

// Prøve E: testsakene som data, felles fasit for Vitest, Playwright og resultatmalen
// (docs/funksjoner/fase1-prove-e-regler.md pkt. 2 og 7, AK 4 og 10). Testplan avsnitt 2.2 og 6.

const STATES: TrialRuleState[] = ["triggered", "not_triggered", "not_evaluated"];

function ruleFor(testCase: TrialRuleCase) {
  const rule = trialRules.find((entry) => entry.key === testCase.rule_key);
  if (!rule) throw new Error(`Fant ikke regelen ${testCase.rule_key}`);
  return rule;
}

/** Tekst → parseTrialNumber → evaluateTrialRules, som i skjemaet. */
function run(testCase: TrialRuleCase) {
  const rule = ruleFor(testCase);
  const results = evaluateTrialRules(trialRules, {
    [rule.field]: parseTrialNumber(testCase.input),
  });
  const result = results.find((entry) => entry.key === testCase.rule_key);
  if (!result) throw new Error(`Ingen svar for ${testCase.rule_key}`);
  return result;
}

describe("testsakene for prøvereglene", () => {
  // Obligatorisk. Eneste sted tabellen fra oppgavekortet skrives av: låser fasiten.
  it("testsakene er de fjorten fra oppgavekortet", () => {
    const water = "trial_water_heater_age";
    const moisture = "trial_moisture_floor_limit";
    expect(
      trialRuleCases.map((entry) => [entry.rule_key, entry.name, entry.input, entry.expect_state]),
    ).toEqual([
      [water, "tomt felt", "", "not_evaluated"],
      [water, "null", "0", "not_triggered"],
      [water, "under", "6", "not_triggered"],
      [water, "lik grensen", "7", "not_triggered"],
      [water, "rett over (komma)", "7,5", "triggered"],
      [water, "negativt tall", "-1", "not_evaluated"],
      [water, "ugyldig tekst", "12,", "not_evaluated"],
      [moisture, "tomt felt", "", "not_evaluated"],
      [moisture, "null", "0", "not_triggered"],
      [moisture, "under (komma)", "41,9", "not_triggered"],
      [moisture, "lik grensen", "42", "not_triggered"],
      [moisture, "rett over (punktum)", "42.01", "triggered"],
      [moisture, "negativt tall", "-1", "not_evaluated"],
      [moisture, "ugyldig tekst", "1e3", "not_evaluated"],
    ]);
  });

  it("inndata er tekst, aldri tall", () => {
    for (const testCase of trialRuleCases) {
      expect(typeof testCase.input, `${testCase.rule_key} ${testCase.name}`).toBe("string");
    }
  });

  it("hver regel har saker for alle tre tilstander", () => {
    for (const rule of trialRules) {
      const states = new Set(
        trialRuleCases.filter((entry) => entry.rule_key === rule.key).map((e) => e.expect_state),
      );
      for (const state of STATES) {
        expect(states.has(state), `${rule.key} ${state}`).toBe(true);
      }
    }
  });

  it("hver regel har lik grensen, negativt tall og ugyldig tekst", () => {
    for (const rule of trialRules) {
      const names = trialRuleCases
        .filter((entry) => entry.rule_key === rule.key)
        .map((entry) => entry.name);
      for (const name of ["lik grensen", "negativt tall", "ugyldig tekst"]) {
        expect(names, rule.key).toContain(name);
      }
    }
  });

  // Obligatorisk (AK 4)
  describe("testsakene går gjennom kjeden og gir forventet tilstand", () => {
    it.each(trialRuleCases.map((entry) => [entry.rule_key, entry.name, entry] as const))(
      "%s: %s",
      (_key, _name, testCase) => {
        expect(run(testCase).state).toBe(testCase.expect_state);
      },
    );
  });

  it("meldingen passer tilstanden", () => {
    for (const testCase of trialRuleCases) {
      const { state, message } = run(testCase);
      const label = `${testCase.rule_key} ${testCase.name}`;
      if (state === "triggered") expect(message, label).toMatch(/^Prøveregel: over /);
      if (state === "not_triggered") expect(message, label).toMatch(/^Prøveregel: ikke over /);
      if (state === "not_evaluated") expect(message, label).toBe("Prøveregel: ikke vurdert");
    }
  });
});

/** Forventet svar på norsk i resultatmalen for ekte iPad. */
const EXPECTED_TEXT: Record<TrialRuleState, string> = {
  triggered: "over prøvegrensen",
  not_triggered: "ikke over prøvegrensen",
  not_evaluated: "ikke vurdert",
};

describe("resultatmalen for ekte iPad", () => {
  it("resultatmalen har samme testsaker som dataene", () => {
    const template = readFileSync(
      path.resolve(process.cwd(), "docs/funksjoner/fase1-prove-e-regler-resultat.md"),
      "utf8",
    );
    const rows = template
      .split("\n")
      .filter((line) => line.trim().startsWith("|"))
      .map((line) => ({
        line,
        cells: line
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim()),
      }));

    for (const testCase of trialRuleCases) {
      const found = rows.some(
        ({ line, cells }) =>
          line.includes(testCase.rule_key) &&
          cells.includes(testCase.name) &&
          cells.includes(`«${testCase.input}»`) &&
          cells.includes(EXPECTED_TEXT[testCase.expect_state]),
      );
      expect(found, `${testCase.rule_key} ${testCase.name}`).toBe(true);
    }
  });
});
