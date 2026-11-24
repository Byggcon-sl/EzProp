import { describe, expect, it } from "vitest";
import { CAUSE_CRITERIA, COST_TYPES, PUBLISH_CHECK_CODES } from "@/db/schema";
import { COST_BANDS } from "@/core/reports/logic/cost-bands";
import { expectNoInternalCodes, INTERNAL_CODE_PATTERNS } from "./pdf-inspect";

/*
 * Selvtest for `expectNoInternalCodes` (testplanen for PDF av badet, avtalen om signaturer):
 * hvert mønster fanger et eksempel, og vanlig norsk tekst slipper gjennom. Uten selvtesten kan en
 * for snill mønsterliste gjøre testen grønn mens koder slipper ut i kundens PDF.
 *
 * Hovedmål: færre reklamasjoner (ingen interne koder i rapporten).
 */

const NBSP = " ";

describe("expectNoInternalCodes", () => {
  it.each([
    ["uuid", "Se 0193a000-0000-7000-8000-000000000001 her"],
    ["punktkode", "Punkt wet_room.adjacent"],
    ["kode med punktum", "regel wet_room.membrane_before_2000"],
    ["tg med små bokstaver", "Tilstand tg2"],
    ["flettefelt", "Fra {årstall}"],
    ["årsakskriterium", "cause_criterion"],
    ["tekstkilde", "text_source"],
    ["kostnadstype", "cost_type"],
    ["eget beløp", "approx"],
    ["intervall", "from_20000_to_100000"],
    ["sjekkode", "mandatory_without_tg"],
    ["objekt", "[object Object]"],
    ["undefined", "Verdi undefined"],
    ["null", "Verdi null"],
    ["NaN", "NaN kr"],
  ])("fanger %s", (_name, text) => {
    expect(() => expectNoInternalCodes(text)).toThrow(/Intern kode/);
  });

  it.each([...PUBLISH_CHECK_CODES])("fanger funnkoden %s", (code) => {
    expect(() => expectNoInternalCodes(`Merknad: ${code}`)).toThrow(/Intern kode/);
  });

  it.each(CAUSE_CRITERIA.filter((c) => c.includes("_")))("fanger årsakskriteriet %s", (code) => {
    expect(() => expectNoInternalCodes(code)).toThrow(/Intern kode/);
  });

  it.each(COST_BANDS.map((b) => b.key))("fanger intervallkoden %s", (code) => {
    expect(() => expectNoInternalCodes(code)).toThrow(/Intern kode/);
  });

  it("kostnadstypene er med i listen", () => {
    expect(COST_TYPES).toEqual(["band", "approx", "none"]);
  });

  it.each([
    "TG2",
    "TG 3",
    "TGIU",
    `20${NBSP}000–100${NBSP}000 kr`,
    `ca. 40${NBSP}000 kr`,
    "Våtrom",
    "Bad i 2. etasje",
    "[årstall mangler]",
    "Side 3 av 12",
    "Juridisk selskap mangler på oppdraget",
    "Org.nr. 999 000 111",
    "Hulltaking er ikke utført, og grunnen mangler.",
    "12,4 vekt-%",
    "Fall mot sluk, retning 1: 12,5 mm/m",
  ])("vanlig tekst «%s» slipper gjennom", (text) => {
    expect(() => expectNoInternalCodes(text)).not.toThrow();
  });

  it("mønstrene har ikke g-flagget (exec med lastIndex gir ellers tilfeldige svar)", () => {
    for (const pattern of INTERNAL_CODE_PATTERNS) expect(pattern.flags).not.toContain("g");
  });
});
