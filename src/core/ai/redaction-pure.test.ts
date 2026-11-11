import { describe, expect, it } from "vitest";
import { PURE_REDACTION_CASES } from "./redaction-cases-pure";
import { emptyKnownValues, redactText } from "./redaction";

/*
 * Vask før KI, ren variant av testsettet med fasit (testplan V3.11): `redactText` med kjente
 * verdier gitt direkte, uten database. Alt er oppdiktet.
 *
 * Støtter hovedmål: KI i bunnen (persondata sendes aldri til KI) og færre reklamasjoner
 * (faginnholdet står).
 */
describe("redactText: testsett med fasit, uten database", () => {
  it.each(PURE_REDACTION_CASES.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
    const { text } = redactText(testCase.input, testCase.knownValues ?? emptyKnownValues());
    for (const value of testCase.mustRemove) expect(text).not.toContain(value);
    for (const value of testCase.mustKeep) expect(text).toContain(value);
  });
});
