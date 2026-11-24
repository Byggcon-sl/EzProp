import { describe, expect, it } from "vitest";
import type { DeviationTg, OverrideReasonCode, StoredRuleSuggestion } from "@/db/schema";
import { OVERRIDE_REASON_CODES } from "./codes";
import { checkOverrideReason } from "./override-reason";
import { suggestedTgChangeDecision } from "./suggested-tg-change";
import type { OutcomeTg, SuggestedTgChangeOutcome } from "./types";

/*
 * Regelen for `accepted` mot `changed` når TG byttes på et avvik fra et regelforslag (testplanen
 * for rett-forslag-og-avvik, avsnitt 1b, FA-L7–L11; A490, T-0113). Ren tabelltest.
 *
 * Hovedmål: færre reklamasjoner (hver endring av TG fra et forslag får grunn i loggen) og de
 * ansatte (bytte tilbake til forslagets TG, eller TG-valget i «velg TG2 eller TG3», krever ingen
 * grunn). Funksjonen setter aldri TG.
 */

const TG3_SUGGESTION: StoredRuleSuggestion = {
  kind: "outcome",
  checkpoint_key: "cp.membrane",
  question_key: "cp.membrane.age",
  outcome_key: "before_2000",
};
const CHOOSE_SUGGESTION: StoredRuleSuggestion = {
  ...TG3_SUGGESTION,
  outcome_key: "damage_choose",
};

type Row = [
  name: string,
  suggestion: StoredRuleSuggestion,
  questionKey: string | null,
  outcomeKey: string | null,
  outcomeTg: OutcomeTg | null,
  tg: DeviationTg | null,
  expected: SuggestedTgChangeOutcome,
];

const Q = "cp.membrane.age";

const CASES: Row[] = [
  // FA-L7
  ["FA-L7 samme utfall, TG3 som utfallet", TG3_SUGGESTION, Q, "before_2000", 3, 3, "accepted"],
  [
    "FA-L7 samme utfall, TG2 som utfallet",
    { ...TG3_SUGGESTION, outcome_key: "age_tg2" },
    Q,
    "age_tg2",
    2,
    2,
    "accepted",
  ],
  // FA-L8
  ["FA-L8 «velg» med TG2", CHOOSE_SUGGESTION, Q, "damage_choose", "choose", 2, "accepted"],
  ["FA-L8 «velg» med TG3", CHOOSE_SUGGESTION, Q, "damage_choose", "choose", 3, "accepted"],
  ["FA-L8 «velg» med tom TG", CHOOSE_SUGGESTION, Q, "damage_choose", "choose", null, "accepted"],
  // FA-L9
  ["FA-L9 TG3 → TG2", TG3_SUGGESTION, Q, "before_2000", 3, 2, "changed"],
  ["FA-L9 TG3 → tom", TG3_SUGGESTION, Q, "before_2000", 3, null, "changed"],
  // FA-L10
  ["FA-L10 annet utfall, samme TG", TG3_SUGGESTION, Q, "other_tg3", 3, 3, "changed"],
  ["FA-L10 annet utfall, «velg»", TG3_SUGGESTION, Q, "damage_choose", "choose", 3, "changed"],
  [
    "FA-L10 annet spørsmål, samme utfall",
    TG3_SUGGESTION,
    "cp.other",
    "before_2000",
    3,
    3,
    "changed",
  ],
  ["FA-L10 avvik uten utfall", TG3_SUGGESTION, null, null, null, 3, "changed"],
  ["HMS-utfall uten TG", TG3_SUGGESTION, Q, "before_2000", null, null, "changed"],
  [
    "forslag om TG0 gir aldri accepted",
    { kind: "tg0", checkpoint_key: "cp.membrane" },
    Q,
    "before_2000",
    3,
    3,
    "changed",
  ],
  [
    "forslag om TGIU gir aldri accepted",
    { kind: "tgiu", checkpoint_key: "cp.membrane" },
    Q,
    "before_2000",
    "choose",
    2,
    "changed",
  ],
];

describe("FA-L7–L10 suggestedTgChangeDecision", () => {
  it.each(CASES)("%s", (_name, suggestion, questionKey, outcomeKey, outcomeTg, tg, expected) => {
    expect(suggestedTgChangeDecision({ suggestion, questionKey, outcomeKey, outcomeTg, tg })).toBe(
      expected,
    );
  });
});

describe("FA-L11 changed krever grunn etter checkOverrideReason (A380)", () => {
  const changed = suggestedTgChangeDecision({
    suggestion: TG3_SUGGESTION,
    questionKey: Q,
    outcomeKey: "before_2000",
    outcomeTg: 3,
    tg: 2,
  });

  it.each<[string, OverrideReasonCode | null, string | null, string]>([
    ["uten kode og uten tekst", null, null, "reason_required"],
    ["uten kode, bare mellomrom", null, "  ", "reason_required"],
    ["«Annet» uten tekst", "other", null, "text_required"],
    ["«Annet» med tekst", "other", "Oppdiktet grunn.", "ok"],
    ["kode uten tekst", "measured_again", null, "ok"],
    ["bare tekst", null, "Oppdiktet grunn.", "ok"],
  ])("%s", (_name, code, text, expected) => {
    expect(changed).toBe("changed");
    expect(checkOverrideReason({ decision: changed, code, text })).toBe(expected);
  });

  it("alle grunnkodene fra A380 gir ok uten tekst, unntatt «Annet»", () => {
    for (const code of OVERRIDE_REASON_CODES) {
      expect(checkOverrideReason({ decision: changed, code, text: null }), code).toBe(
        code === "other" ? "text_required" : "ok",
      );
    }
  });

  it("accepted skal ikke ha grunn", () => {
    const accepted = suggestedTgChangeDecision({
      suggestion: TG3_SUGGESTION,
      questionKey: Q,
      outcomeKey: "before_2000",
      outcomeTg: 3,
      tg: 3,
    });
    expect(accepted).toBe("accepted");
    expect(checkOverrideReason({ decision: accepted, code: null, text: null })).toBe("ok");
    expect(checkOverrideReason({ decision: accepted, code: "measured_again", text: null })).toBe(
      "not_allowed_when_accepted",
    );
  });
});
