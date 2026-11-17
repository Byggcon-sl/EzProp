import { describe, expect, it } from "vitest";
import { containsNationalId, ELEVEN_DIGITS, NATIONAL_ID_MESSAGE } from "./free-text";

/** Felles sperre mot fødselsnummer i fritekst (docs/funksjoner/fase2a-badet-pc.md Omfang 10). */
describe("containsNationalId", () => {
  it.each(["01019912345", "Nr 01019912345 her", "010199 12345", "010199-12345", "01.01.99.12345"])(
    "stopper «%s»",
    (value) => {
      expect(containsNationalId(value)).toBe(true);
    },
  );

  it.each([
    null,
    undefined,
    "",
    "Telefon 0123456789",
    "Målt 1990 og 2015",
    "40 000 kr",
    "14,9 vekt-%",
  ])("godtar %s", (value) => {
    expect(containsNationalId(value)).toBe(false);
  });

  it("mønsteret og meldingen står ett sted", () => {
    expect(ELEVEN_DIGITS.test("12345678901")).toBe(true);
    expect(NATIONAL_ID_MESSAGE).toBe("Fødselsnummer skal ikke lagres her.");
  });
});
