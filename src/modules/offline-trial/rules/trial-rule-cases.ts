import type { TrialRuleState } from "./trial-rules";

/** En testsak for en prøveregel. `input` er teksten slik den skrives inn i skjemaet. */
export type TrialRuleCase = {
  rule_key: string;
  name: string;
  input: string;
  expect_state: TrialRuleState;
};

/** Felles fasit for Vitest, Playwright og resultatmalen for ekte iPad. */
export const trialRuleCases: readonly TrialRuleCase[] = [
  {
    rule_key: "trial_water_heater_age",
    name: "tomt felt",
    input: "",
    expect_state: "not_evaluated",
  },
  { rule_key: "trial_water_heater_age", name: "null", input: "0", expect_state: "not_triggered" },
  { rule_key: "trial_water_heater_age", name: "under", input: "6", expect_state: "not_triggered" },
  {
    rule_key: "trial_water_heater_age",
    name: "lik grensen",
    input: "7",
    expect_state: "not_triggered",
  },
  {
    rule_key: "trial_water_heater_age",
    name: "rett over (komma)",
    input: "7,5",
    expect_state: "triggered",
  },
  {
    rule_key: "trial_water_heater_age",
    name: "negativt tall",
    input: "-1",
    expect_state: "not_evaluated",
  },
  {
    rule_key: "trial_water_heater_age",
    name: "ugyldig tekst",
    input: "12,",
    expect_state: "not_evaluated",
  },
  {
    rule_key: "trial_moisture_floor_limit",
    name: "tomt felt",
    input: "",
    expect_state: "not_evaluated",
  },
  {
    rule_key: "trial_moisture_floor_limit",
    name: "null",
    input: "0",
    expect_state: "not_triggered",
  },
  {
    rule_key: "trial_moisture_floor_limit",
    name: "under (komma)",
    input: "41,9",
    expect_state: "not_triggered",
  },
  {
    rule_key: "trial_moisture_floor_limit",
    name: "lik grensen",
    input: "42",
    expect_state: "not_triggered",
  },
  {
    rule_key: "trial_moisture_floor_limit",
    name: "rett over (punktum)",
    input: "42.01",
    expect_state: "triggered",
  },
  {
    rule_key: "trial_moisture_floor_limit",
    name: "negativt tall",
    input: "-1",
    expect_state: "not_evaluated",
  },
  {
    rule_key: "trial_moisture_floor_limit",
    name: "ugyldig tekst",
    input: "1e3",
    expect_state: "not_evaluated",
  },
];
