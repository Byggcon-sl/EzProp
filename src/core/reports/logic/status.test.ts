import { describe, expect, it } from "vitest";
import { CHECKPOINT_STATUSES } from "./codes";
import { CHECKPOINT_STATUS_LABELS, progressText } from "./labels";
import { computeCheckpointStatus, countDoneCheckpoints } from "./status";
import type { CheckpointState, CheckpointStatus } from "./types";

/*
 * Status per kontrollpunkt og «x av 8 ferdig» (testplanen B1.12). Ren test. Mykt slettede rader
 * sendes aldri inn.
 *
 * Hovedmål: de ansatte (takstmannen ser hvor langt han har kommet).
 */

function checkpoint(overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    tgDirect: null,
    done: false,
    hasContent: false,
    deviations: [],
    tgiu: null,
    tgiuRequirements: { alternativeCheck: false, ownerInformed: false },
    ruleResults: [],
    decisions: [],
    noFindingsWithReadingOverLimit: false,
    ...overrides,
  };
}

const tg2 = {
  id: "d",
  kind: "tg",
  tg: 2,
  causeCriterion: null,
  causeText: null,
  consequenceText: null,
  costType: "none",
  costAmount: null,
  measureCount: 0,
  outcomeTg: 2,
  hasMeasuresForTg: false,
} as const;

describe("B1.12 status per punkt", () => {
  it.each<[string, Partial<CheckpointState>, CheckpointStatus]>([
    ["tomt punkt er ikke startet", {}, "not_started"],
    ["svar eller beskrivelse gir i arbeid", { hasContent: true }, "in_progress"],
    ["TG direkte gir i arbeid", { tgDirect: "1" }, "in_progress"],
    ["avvik gir i arbeid", { deviations: [tg2] }, "in_progress"],
    [
      "beslutning gir i arbeid",
      {
        decisions: [
          {
            ruleKey: "r",
            decision: "rejected",
            suggestion: { kind: "tg0", checkpoint_key: "cp" },
            chosenTg: null,
            madeDeviation: false,
            deviationId: null,
          },
        ],
      },
      "in_progress",
    ],
    ["ferdig gir ferdig", { done: true, tgDirect: "1" }, "done"],
    ["ferdig uten innhold gir ferdig", { done: true }, "done"],
    ["TGIU gir tgiu", { tgDirect: "IU" }, "tgiu"],
    ["TGIU ferdig gir tgiu", { tgDirect: "IU", done: true }, "tgiu"],
    ["slettet avvik (ikke sendt inn) gir ikke startet", { deviations: [] }, "not_started"],
  ])("%s", (_name, overrides, expected) => {
    expect(computeCheckpointStatus(checkpoint(overrides))).toBe(expected);
  });

  it("«x av 8 ferdig» teller bare done", () => {
    const list = [
      checkpoint({ done: true }),
      checkpoint({ done: true, tgDirect: "IU" }),
      checkpoint({ hasContent: true }),
      checkpoint({ tgDirect: "IU" }),
      checkpoint(),
      checkpoint(),
      checkpoint(),
      checkpoint(),
    ];
    expect(countDoneCheckpoints(list)).toBe(2);
    expect(progressText(countDoneCheckpoints(list), list.length)).toBe("2 av 8 ferdig");
  });

  it("hver status har norsk tekst", () => {
    expect(CHECKPOINT_STATUSES.map((s) => CHECKPOINT_STATUS_LABELS[s])).toEqual([
      "Ikke startet",
      "I arbeid",
      "Ferdig",
      "TGIU – ikke undersøkt",
    ]);
  });
});
