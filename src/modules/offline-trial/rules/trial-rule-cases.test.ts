import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTrialNumber } from "../answers";
import { listTrialFields, trialForm } from "../trial-form";
import { evaluateTrialRules, trialRules } from "./index";
import { trialRuleCases } from "./trial-rule-cases";

// Prøve E: testsakene som data er felles fasit for Vitest, Playwright og resultatmalen
// (docs/funksjoner/fase1-prove-e-regler.md pkt. 2, AK 4 og AK 10). Testplan avsnitt 2.2 og 6.
// Kjeden er alltid: tekst → parseTrialNumber → evaluateTrialRules.

const RESULT_TEMPLATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/funksjoner/fase1-prove-e-regler-resultat.md",
);

type State = "triggered" | "not_triggered" | "not_evaluated";

function ruleFor(ruleKey: string) {
  const rule = trialRules.find((entry) => entry.key === ruleKey);
  if (!rule) throw new Error(`Testsaken peker på en regel som ikke finnes: ${ruleKey}`);
  return rule;
}

/** Hele kjeden for én testsak, slik iPaden gjør den. */
function evaluateCase(ruleKey: string, input: string) {
  const rule = ruleFor(ruleKey);
  const results = evaluateTrialRules(trialRules, { [rule.field]: parseTrialNumber(input) });
  const result = results.find((entry) => entry.key === ruleKey);
  if (!result) throw new Error(`Motoren ga ikke svar for ${ruleKey}`);
  return result;
}

/** Forventet svar på norsk i resultatmalen. */
const NORWEGIAN: Record<State, string> = {
  triggered: "over prøvegrensen",
  not_triggered: "ikke over prøvegrensen",
  not_evaluated: "ikke vurdert",
};

describe("testsakene for prøvereglene", () => {
  // Obligatorisk: låser fasiten fra oppgavekortet pkt. 2
  it("testsakene er de fjorten fra oppgavekortet", () => {
    const expected: [string, string, string, State][] = [
      ["trial_water_heater_age", "tomt felt", "", "not_evaluated"],
      ["trial_water_heater_age", "null", "0", "not_triggered"],
      ["trial_water_heater_age", "under", "6", "not_triggered"],
      ["trial_water_heater_age", "lik grensen", "7", "not_triggered"],
      ["trial_water_heater_age", "rett over (komma)", "7,5", "triggered"],
      ["trial_water_heater_age", "negativt tall", "-1", "not_evaluated"],
      ["trial_water_heater_age", "ugyldig tekst", "12,", "not_evaluated"],
      ["trial_moisture_floor_limit", "tomt felt", "", "not_evaluated"],
      ["trial_moisture_floor_limit", "null", "0", "not_triggered"],
      ["trial_moisture_floor_limit", "under (komma)", "41,9", "not_triggered"],
      ["trial_moisture_floor_limit", "lik grensen", "42", "not_triggered"],
      ["trial_moisture_floor_limit", "rett over (punktum)", "42.01", "triggered"],
      ["trial_moisture_floor_limit", "negativt tall", "-1", "not_evaluated"],
      ["trial_moisture_floor_limit", "ugyldig tekst", "1e3", "not_evaluated"],
    ];
    expect(
      trialRuleCases.map((entry) => [entry.rule_key, entry.name, entry.input, entry.expect_state]),
    ).toEqual(expected);
  });

  it("inndata er tekst, aldri tall", () => {
    for (const entry of trialRuleCases) {
      expect(typeof entry.input, `${entry.rule_key} / ${entry.name}`).toBe("string");
    }
  });

  it("hver regel har saker for alle tre tilstander", () => {
    for (const rule of trialRules) {
      const states = new Set(
        trialRuleCases.filter((entry) => entry.rule_key === rule.key).map((e) => e.expect_state),
      );
      expect([...states].sort(), rule.key).toEqual(["not_evaluated", "not_triggered", "triggered"]);
    }
  });

  it("hver regel har lik grensen, negativt tall og ugyldig tekst", () => {
    for (const rule of trialRules) {
      const names = trialRuleCases.filter((e) => e.rule_key === rule.key).map((e) => e.name);
      for (const name of ["lik grensen", "negativt tall", "ugyldig tekst"]) {
        expect(names, `${rule.key} mangler «${name}»`).toContain(name);
      }
    }
  });

  // Obligatorisk (AK 4)
  it.each(trialRuleCases.map((entry) => [entry.rule_key, entry.name, entry] as const))(
    "testsakene går gjennom kjeden og gir forventet tilstand: %s / %s",
    (_ruleKey, _name, entry) => {
      expect(evaluateCase(entry.rule_key, entry.input).state).toBe(entry.expect_state);
    },
  );

  it("meldingen passer tilstanden", () => {
    for (const entry of trialRuleCases) {
      const { state, message } = evaluateCase(entry.rule_key, entry.input);
      const label = `${entry.rule_key} / ${entry.name}`;
      if (state === "triggered") expect(message, label).toMatch(/^Prøveregel: over /);
      if (state === "not_triggered") expect(message, label).toMatch(/^Prøveregel: ikke over /);
      if (state === "not_evaluated") expect(message, label).toBe("Prøveregel: ikke vurdert");
    }
  });
});

describe("resultatmalen for ekte iPad", () => {
  /** Cellene i hver tabellrad i malen (uten skillelinjen `|---|`). */
  function tableRows(markdown: string): string[][] {
    return markdown
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|") && !/^\|[\s|:-]+\|$/.test(line))
      .map((line) =>
        line
          .slice(1, line.endsWith("|") ? -1 : undefined)
          .split("|")
          .map((cell) => cell.trim()),
      );
  }

  it("resultatmalen har samme testsaker som dataene", () => {
    const rows = tableRows(readFileSync(RESULT_TEMPLATE, "utf8"));
    const fields = listTrialFields(trialForm);
    for (const entry of trialRuleCases) {
      const label = fields.find((field) => field.key === ruleFor(entry.rule_key).field)?.label;
      expect(label, entry.rule_key).toBeDefined();
      const match = rows.filter(
        (cells) =>
          cells.includes(label!) &&
          cells.includes(entry.name) &&
          cells.includes(`«${entry.input}»`) &&
          cells.includes(NORWEGIAN[entry.expect_state]),
      );
      expect(
        match.length,
        `Fant ikke én rad for ${label} / ${entry.name} / «${entry.input}» / ${NORWEGIAN[entry.expect_state]}`,
      ).toBe(1);
    }
  });
});
