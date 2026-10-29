import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseTrialNumber, type TrialAnswers } from "./answers";
import { TrialRuleResult } from "./trial-rule-result";

function render(fieldKey: string, answers: TrialAnswers): string {
  return renderToStaticMarkup(createElement(TrialRuleResult, { fieldKey, answers }));
}

describe("TrialRuleResult", () => {
  it("viser én linje med regelkode, tilstand og aria-live for berederens alder", () => {
    const html = render("water_heater_age", { water_heater_age: parseTrialNumber("7,5") });
    expect(html).toContain('data-rule-key="trial_water_heater_age"');
    expect(html).toContain('data-rule-state="triggered"');
    expect(html).toContain('aria-live="polite"');
    expect(html.match(/<p /g)).toHaveLength(1);
  });

  it("viser «ikke vurdert» for ugyldig tekst og for tomt felt", () => {
    expect(render("water_heater_age", { water_heater_age: parseTrialNumber("12,") })).toContain(
      'data-rule-state="not_evaluated"',
    );
    expect(render("moisture_floor", {})).toContain('data-rule-state="not_evaluated"');
  });

  it("viser bare regelen for eget felt", () => {
    const html = render("moisture_floor", {
      water_heater_age: 9,
      moisture_floor: parseTrialNumber("42.01"),
    });
    expect(html).toContain('data-rule-key="trial_moisture_floor_limit"');
    expect(html).toContain('data-rule-state="triggered"');
    expect(html).not.toContain("trial_water_heater_age");
  });

  it("viser ingenting for felt uten regel", () => {
    expect(render("roof_condition", { water_heater_age: 9 })).toBe("");
  });
});
