import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ChosenTg, RuleSuggestionDecision, TgDirect } from "@/db/schema";
import { isEffectiveDecision, latestDecisionPerRule } from "./effective-decision";
import type { DecisionState } from "./types";

/*
 * Gjeldende beslutning (testplanen for rett-forslag-og-avvik, avsnitt 1a, FA-L1–L6; A491, A495).
 * Ren tabelltest med oppdiktede data.
 *
 * Hovedmål: færre reklamasjoner (et TG3-forslag der avviket er fjernet, står åpent igjen og faller
 * ikke stille ut) og de ansatte (forslaget viser riktig tilstand). Funksjonen setter aldri TG.
 */

const SUGGESTION = {
  kind: "outcome",
  checkpoint_key: "cp.membrane",
  question_key: "cp.membrane.age",
  outcome_key: "tg3",
} as const;

function decision(overrides: Partial<DecisionState> = {}): DecisionState {
  return {
    ruleKey: "rule.membrane",
    decision: "accepted",
    suggestion: SUGGESTION,
    chosenTg: "3",
    madeDeviation: true,
    deviationId: "dev-1",
    ...overrides,
  };
}

type Row = [
  name: string,
  decision: RuleSuggestionDecision,
  madeDeviation: boolean,
  deviationId: string | null,
  chosenTg: ChosenTg | null,
  tgDirect: TgDirect | null,
  expected: boolean,
];

const CASES: Row[] = [
  // FA-L1
  ["FA-L1 godtatt med levende avvik", "accepted", true, "dev-1", "3", null, true],
  ["FA-L1 endret med levende avvik", "changed", true, "dev-1", "2", null, true],
  ["FA-L1 godtatt «velg» uten valgt TG, avviket står", "accepted", true, "dev-1", null, null, true],
  // FA-L2
  ["FA-L2 godtatt, avviket er slettet", "accepted", true, null, "3", null, false],
  ["FA-L2 endret, avviket er slettet", "changed", true, null, "2", null, false],
  ["FA-L2 slettet avvik, TG direkte hjelper ikke", "accepted", true, null, "3", "1", false],
  // FA-L3
  ["FA-L3 avvist uten TG direkte", "rejected", false, null, null, null, true],
  ["FA-L3 avvist med TG direkte", "rejected", false, null, null, "IU", true],
  ["FA-L3 avvist der avviket er borte", "rejected", true, null, null, null, true],
  // FA-L4
  ["FA-L4 godtatt TG0 og TG0 står", "accepted", false, null, "0", "0", true],
  ["FA-L4 godtatt TG0 og TG1 står", "accepted", false, null, "0", "1", false],
  ["FA-L4 godtatt TG0 uten TG direkte", "accepted", false, null, "0", null, false],
  ["FA-L4 endret til TG1 og TG1 står", "changed", false, null, "1", "1", true],
  ["FA-L4 endret til TG1 og TGIU står", "changed", false, null, "1", "IU", false],
  ["FA-L4 godtatt TGIU og TGIU står", "accepted", false, null, "IU", "IU", true],
  ["FA-L4 godtatt TGIU og TG0 står", "accepted", false, null, "IU", "0", false],
  ["FA-L4 godtatt TGIU uten TG direkte", "accepted", false, null, "IU", null, false],
  // Alt annet
  ["uten avvik og uten valgt TG", "accepted", false, null, null, null, false],
  ["uten avvik med valgt TG3", "changed", false, null, "3", null, false],
];

describe("FA-L1–L4 isEffectiveDecision", () => {
  it.each(CASES)(
    "%s",
    (_name, decisionValue, madeDeviation, deviationId, chosenTg, tgDirect, expected) => {
      expect(
        isEffectiveDecision(
          decision({ decision: decisionValue, madeDeviation, deviationId, chosenTg }),
          { tgDirect },
        ),
      ).toBe(expected);
    },
  );
});

describe("FA-L5 siste rad vinner", () => {
  it("accepted → changed → accepted gir siste accepted", () => {
    const rows = [
      decision({ deviationId: "dev-1" }),
      decision({ decision: "changed", chosenTg: "2", deviationId: "dev-1" }),
      decision({ deviationId: "dev-2" }),
    ];
    expect(latestDecisionPerRule(rows)).toEqual([rows[2]]);
  });

  it("eldre gjeldende rad gjenoppstår ikke når siste rad ikke er gjeldende", () => {
    const rows = [
      decision({ decision: "rejected", chosenTg: null, madeDeviation: false, deviationId: null }),
      decision({ deviationId: null }),
    ];
    const latest = latestDecisionPerRule(rows);
    expect(latest).toEqual([rows[1]]);
    expect(latest.filter((d) => isEffectiveDecision(d, { tgDirect: null }))).toEqual([]);
  });

  it("én rad per regel og punkt, i rekkefølgen regelen dukket opp", () => {
    const otherPoint = { ...SUGGESTION, checkpoint_key: "cp.floor" };
    const rows = [
      decision({ ruleKey: "rule.a" }),
      decision({ ruleKey: "rule.b" }),
      decision({ ruleKey: "rule.a", suggestion: otherPoint }),
      decision({ ruleKey: "rule.a", decision: "changed", chosenTg: "2" }),
    ];
    expect(latestDecisionPerRule(rows)).toEqual([rows[3], rows[1], rows[2]]);
  });

  it("tom liste gir tom liste", () => {
    expect(latestDecisionPerRule([])).toEqual([]);
  });
});

describe("FA-L6 rent blad (kan kjøre på iPaden)", () => {
  it.each(["effective-decision.ts", "suggested-tg-change.ts"])(
    "%s importerer ikke @/db, @/core/ai eller nettleser-API",
    (file) => {
      const source = readFileSync(join(__dirname, file), "utf8");
      for (const match of source.matchAll(/from\s+"([^"]+)"/gu)) {
        expect(match[1], file).toMatch(/^\.\//u);
      }
      expect(source).not.toMatch(/@\/db|@\/core\/ai/u);
      expect(source).not.toMatch(
        /\b(window|document|localStorage|indexedDB|navigator|fetch)\b(?!\s*:)/u,
      );
    },
  );
});
