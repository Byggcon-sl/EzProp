import { describe, expect, it } from "vitest";
import type { OverrideReasonCode, RuleSuggestionDecision } from "@/db/schema";
import { OVERRIDE_REASON_CODES as SCHEMA_OVERRIDE_REASON_CODES } from "@/db/schema";
import { OVERRIDE_REASON_CODES } from "./codes";
import { OVERRIDE_REASON_CHECK_MESSAGES, OVERRIDE_REASON_LABELS } from "./labels";
import { checkOverrideReason } from "./override-reason";
import type { OverrideReasonCheck } from "./types";

/*
 * Begrunnelsen ved Endre og Avvis (testplanen B1.16, A380 og A398). Ren test. Zod-skjemaet på
 * serveren bruker samme funksjon og testes med tjenestene.
 *
 * Hovedmål: KI i bunnen og færre reklamasjoner (faste koder gir statistikk over hvorfor reglene
 * overstyres) og de ansatte (ett trykk i stedet for fritekst).
 */

describe("B1.16 begrunnelseskoder", () => {
  it("OVERRIDE_REASON_CODES er låst i denne rekkefølgen (regel 6)", () => {
    expect(OVERRIDE_REASON_CODES).toEqual([
      "documentation_present",
      "visible_damage",
      "measured_again",
      "age_known_otherwise",
      "other",
    ]);
    expect(OVERRIDE_REASON_CODES).toEqual(SCHEMA_OVERRIDE_REASON_CODES);
  });

  it("knappetekstene er egne ord i samme rekkefølge", () => {
    expect(OVERRIDE_REASON_CODES.map((code) => OVERRIDE_REASON_LABELS[code])).toEqual([
      "Dokumentasjon er lagt fram",
      "Synlig skade",
      "Målt på nytt",
      "Alderen er kjent på annen måte",
      "Annet",
    ]);
  });

  it.each<
    [string, RuleSuggestionDecision, OverrideReasonCode | null, string | null, OverrideReasonCheck]
  >([
    ["changed uten kode og tekst avvises", "changed", null, null, "reason_required"],
    ["rejected uten kode og tekst avvises", "rejected", null, null, "reason_required"],
    ["rejected med bare mellomrom avvises", "rejected", null, "   ", "reason_required"],
    ["other uten tekst avvises", "changed", "other", null, "text_required"],
    ["other med bare mellomrom avvises", "rejected", "other", " \n\t ", "text_required"],
    ["other med tekst godtas", "rejected", "other", "Eier viste kvittering.", "ok"],
    ["kode uten tekst godtas", "changed", "visible_damage", null, "ok"],
    ["kode med tom tekst godtas", "rejected", "measured_again", "", "ok"],
    ["tekst uten kode godtas", "rejected", null, "Målt på nytt med annet instrument.", "ok"],
    ["accepted uten kode og tekst godtas", "accepted", null, null, "ok"],
    ["accepted med tom tekst godtas", "accepted", null, "  ", "ok"],
    [
      "accepted med kode avvises (A398)",
      "accepted",
      "visible_damage",
      null,
      "not_allowed_when_accepted",
    ],
    ["accepted med tekst avvises (A398)", "accepted", null, "Grunn.", "not_allowed_when_accepted"],
  ])("%s", (_name, decision, code, text, expected) => {
    expect(checkOverrideReason({ decision, code, text })).toBe(expected);
  });

  it("hver feil har norsk melding", () => {
    expect(OVERRIDE_REASON_CHECK_MESSAGES.reason_required).toBe("Velg en grunn for å lagre.");
    expect(Object.keys(OVERRIDE_REASON_CHECK_MESSAGES).sort()).toEqual(
      ["not_allowed_when_accepted", "reason_required", "text_required"].sort(),
    );
  });
});
