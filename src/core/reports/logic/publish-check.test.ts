import { describe, expect, it } from "vitest";
import type { RuleResult } from "@/core/rules";
import {
  PUBLISH_OVERRIDE_REASON_MAX_CHARS as SCHEMA_MAX_CHARS,
  PUBLISH_BLOCKER_CODES as SCHEMA_BLOCKER_CODES,
  PUBLISH_CHECK_CODES as SCHEMA_CHECK_CODES,
  PUBLISH_OVERRIDE_REASON_CODES as SCHEMA_REASON_CODES,
} from "@/db/schema";
import {
  PUBLISH_BLOCKER_CODES,
  PUBLISH_CHECK_CODES,
  PUBLISH_CHECK_MISSING_PARTS,
  PUBLISH_OVERRIDE_REASON_CODES,
  PUBLISH_OVERRIDE_REASON_MAX_CHARS,
  PUBLISH_WARNING_CODES,
} from "./codes";
import {
  canonicalJson,
  canonicalPublishCheck,
  carryOverrideDrafts,
  checkPublishOverrideReason,
  computePublishCheck,
  publishFindingKey,
  remainingBlockers,
  summarizePublishCheck,
} from "./publish-check";
import {
  PUBLISH_OVERRIDE_REASON_CHECK_MESSAGES,
  PUBLISH_OVERRIDE_REASON_LABELS,
  publishFindingText,
} from "./publish-check-texts";
import type {
  PublishCheckCheckpoint,
  PublishCheckFinding,
  PublishCheckInput,
  PublishCheckRoom,
  PublishCheckTarget,
  PublishOverrideDraft,
} from "./publish-check-types";
import type { CheckpointState, DeviationState, TgiuState } from "./types";

/*
 * Sjekken før publisering (testplanen avsnitt 1 og 2, P1–P8). Testsakene er data: hver sak har
 * inndata og hele den forventede listen, som sammenlignes eksakt, slik at et ekstra funn også gjør
 * testen rød. Ren test med oppdiktede data, uten database.
 *
 * Hovedmål: færre reklamasjoner (sperrene for våtrom) og de ansatte (samme sjekk på iPad og
 * server). KI er ikke med i sjekken.
 */

const ROOM = "room-1";
const ROOM_2 = "room-2";
const CP = "cp-id-1";
const CP_KEY = "cp.membrane";
const HOLE_CP = "cp-id-hole";
const HOLE_KEY = "cp.adjacent";
const DEV = "dev-1";
const DEV_2 = "dev-2";

// --- Byggere -------------------------------------------------------------------------------

function deviation(overrides: Partial<DeviationState> = {}): DeviationState {
  return {
    id: DEV,
    kind: "tg",
    tg: 2,
    causeCriterion: "symptom_of_damage",
    causeText: "Årsak.",
    consequenceText: "Konsekvens.",
    costType: "band",
    costAmount: null,
    measureCount: 1,
    outcomeTg: 2,
    hasMeasuresForTg: true,
    ...overrides,
  };
}

function tgiu(overrides: Partial<TgiuState> = {}): TgiuState {
  return {
    reason: "Ikke undersøkt fordi eier ikke ga samtykke.",
    riskAssessment: "Risiko.",
    howToExamine: "Hulltaking.",
    alternativeCheckMethod: null,
    alternativeCheckResult: null,
    constructionVulnerable: null,
    ownerInformed: null,
    ...overrides,
  };
}

function state(overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    tgDirect: "1",
    done: true,
    hasContent: true,
    deviations: [],
    tgiu: null,
    tgiuRequirements: { alternativeCheck: false, ownerInformed: false },
    ruleResults: [],
    decisions: [],
    noFindingsWithReadingOverLimit: false,
    ...overrides,
  };
}

function checkpoint(
  overrides: Partial<CheckpointState> = {},
  extra: Partial<PublishCheckCheckpoint> = {},
): PublishCheckCheckpoint {
  return {
    checkpointId: CP,
    checkpointKey: CP_KEY,
    position: 1,
    requiresTg: true,
    state: state(overrides),
    ...extra,
  };
}

function room(overrides: Partial<PublishCheckRoom> = {}): PublishCheckRoom {
  return {
    roomId: ROOM,
    position: 1,
    isWetRoom: true,
    holeDrilling: "ok",
    holeReadingMissing: false,
    adjacentTgiuWithReason: false,
    holeCheckpoint: { checkpointId: HOLE_CP, checkpointKey: HOLE_KEY },
    checkpoints: [checkpoint()],
    ...overrides,
  };
}

function input(overrides: Partial<PublishCheckInput> = {}): PublishCheckInput {
  return { hasInspectionDate: true, rooms: [room()], pendingAiSuggestions: [], ...overrides };
}

/** Et rom med ett punkt med denne tilstanden. */
function withCheckpoint(
  overrides: Partial<CheckpointState>,
  extra: Partial<PublishCheckCheckpoint> = {},
): PublishCheckInput {
  return input({ rooms: [room({ checkpoints: [checkpoint(overrides, extra)] })] });
}

function triggeredTgiu(ruleKey: string): RuleResult {
  return {
    rule_key: ruleKey,
    purpose: "suggest_tgiu",
    state: "triggered",
    suggestion: { kind: "tgiu", checkpoint_key: CP_KEY },
    code: null,
    reasons: [],
    lifespan_set_key: null,
    threshold_set_key: null,
  };
}

type Expected = Pick<PublishCheckFinding, "checkCode" | "severity"> & {
  target: Partial<PublishCheckTarget>;
};

function t(fields: Partial<PublishCheckTarget>): PublishCheckTarget {
  return {
    roomId: null,
    checkpointId: null,
    checkpointKey: null,
    deviationId: null,
    ruleKey: null,
    aiUsageId: null,
    missing: [],
    ...fields,
  };
}

const onCp = { roomId: ROOM, checkpointId: CP, checkpointKey: CP_KEY };
const onHole = { roomId: ROOM, checkpointId: HOLE_CP, checkpointKey: HOLE_KEY };

function blocker(checkCode: Expected["checkCode"], target: Partial<PublishCheckTarget>): Expected {
  return { checkCode, severity: "blocker", target };
}
function warn(checkCode: Expected["checkCode"], target: Partial<PublishCheckTarget>): Expected {
  return { checkCode, severity: "warning", target };
}

function expectFindings(actual: PublishCheckFinding[], expected: Expected[]): void {
  expect(actual).toEqual(
    expected.map((e) => ({
      checkCode: e.checkCode,
      severity: e.severity,
      source: "rule",
      target: t(e.target),
    })),
  );
}

// --- P1: én sak per kode og grense ---------------------------------------------------------

type Case = { name: string; input: PublishCheckInput; expected: Expected[] };

const CAUSE_CASES: Case[] = [
  { name: "TG2 komplett", input: withCheckpoint({ deviations: [deviation()] }), expected: [] },
  {
    name: "TG2 uten kriterium",
    input: withCheckpoint({ deviations: [deviation({ causeCriterion: null })] }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", {
        ...onCp,
        deviationId: DEV,
        missing: ["cause_criterion"],
      }),
    ],
  },
  {
    name: "TG2 med årsak som bare er mellomrom og linjeskift",
    input: withCheckpoint({ deviations: [deviation({ causeText: "  \n\t " })] }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", {
        ...onCp,
        deviationId: DEV,
        missing: ["cause_text"],
      }),
    ],
  },
  {
    name: "TG2 med tom årsak",
    input: withCheckpoint({ deviations: [deviation({ causeText: null })] }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", {
        ...onCp,
        deviationId: DEV,
        missing: ["cause_text"],
      }),
    ],
  },
  {
    name: "TG2 med blank konsekvens",
    input: withCheckpoint({ deviations: [deviation({ consequenceText: " " })] }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", {
        ...onCp,
        deviationId: DEV,
        missing: ["consequence_text"],
      }),
    ],
  },
  {
    name: "TG2 uten alle tre gir tre funn",
    input: withCheckpoint({
      deviations: [deviation({ causeCriterion: null, causeText: "", consequenceText: null })],
    }),
    expected: (["cause_criterion", "cause_text", "consequence_text"] as const).map((part) =>
      blocker("tg2_tg3_missing_cause_or_consequence", {
        ...onCp,
        deviationId: DEV,
        missing: [part],
      }),
    ),
  },
  {
    name: "TG3 komplett med intervall",
    input: withCheckpoint({ deviations: [deviation({ tg: 3, outcomeTg: 3 })] }),
    expected: [],
  },
  {
    name: "TG3 med eget beløp som ikke er rundet",
    input: withCheckpoint({
      deviations: [deviation({ tg: 3, outcomeTg: 3, costType: "approx", costAmount: 37500 })],
    }),
    expected: [warn("cost_amount_not_rounded", { ...onCp, deviationId: DEV })],
  },
  {
    name: "HMS-avvik uten konsekvens",
    input: withCheckpoint({
      deviations: [
        deviation({ id: DEV_2, kind: "hms", tg: null, consequenceText: null, outcomeTg: null }),
      ],
    }),
    expected: [
      warn("hms_missing_consequence_or_measure", {
        ...onCp,
        deviationId: DEV_2,
        missing: ["consequence_text"],
      }),
    ],
  },
  {
    // Mykt slettede avvik sendes aldri inn (signals.ts). Uten avviket står bare TG1 igjen.
    name: "mykt slettet avvik med mangler",
    input: withCheckpoint({ deviations: [] }),
    expected: [],
  },
];

const COST_CASES: Case[] = [
  {
    name: "TG3 uten kostnad",
    input: withCheckpoint({ deviations: [deviation({ tg: 3, outcomeTg: 3, costType: "none" })] }),
    expected: [blocker("tg3_missing_cost", { ...onCp, deviationId: DEV })],
  },
  {
    name: "TG2 uten kostnad",
    input: withCheckpoint({ deviations: [deviation({ costType: "none" })] }),
    expected: [],
  },
  {
    name: "TG3 med eget rundet beløp",
    input: withCheckpoint({
      deviations: [deviation({ tg: 3, outcomeTg: 3, costType: "approx", costAmount: 40000 })],
    }),
    expected: [],
  },
  {
    name: "TG3 uten årsak og uten kostnad gir begge",
    input: withCheckpoint({
      deviations: [deviation({ tg: 3, outcomeTg: 3, costType: "none", causeText: null })],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", {
        ...onCp,
        deviationId: DEV,
        missing: ["cause_text"],
      }),
      blocker("tg3_missing_cost", { ...onCp, deviationId: DEV }),
    ],
  },
];

const HOLE_CASES: Case[] = [
  {
    name: "ubesvart uten TGIU",
    input: input({ rooms: [room({ holeDrilling: "unanswered" })] }),
    expected: [
      blocker("wet_or_below_ground_missing_hole", { ...onHole, missing: ["hole_drilling"] }),
    ],
  },
  {
    name: "ubesvart, TGIU med grunn på tilliggende (A445)",
    input: input({ rooms: [room({ holeDrilling: "unanswered", adjacentTgiuWithReason: true })] }),
    expected: [],
  },
  {
    name: "ubesvart, TGIU med blank grunn på tilliggende",
    input: input({
      rooms: [
        room({
          holeDrilling: "unanswered",
          adjacentTgiuWithReason: false,
          checkpoints: [
            checkpoint(
              { tgDirect: "IU", tgiu: tgiu({ reason: "  " }) },
              { checkpointId: HOLE_CP, checkpointKey: HOLE_KEY },
            ),
          ],
        }),
      ],
    }),
    expected: [
      blocker("mandatory_without_tg", { ...onHole, missing: ["reason"] }),
      blocker("wet_or_below_ground_missing_hole", { ...onHole, missing: ["hole_drilling"] }),
      warn("tgiu_details_missing", { ...onHole, missing: ["reason"] }),
    ],
  },
  {
    name: "ikke utført uten grunn",
    input: input({ rooms: [room({ holeDrilling: "not_done_no_reason" })] }),
    expected: [
      blocker("wet_or_below_ground_missing_hole", { ...onHole, missing: ["hole_drilling_reason"] }),
    ],
  },
  {
    name: "«Annet» uten tekst",
    input: input({ rooms: [room({ holeDrilling: "other_without_note" })] }),
    expected: [
      blocker("wet_or_below_ground_missing_hole", {
        ...onHole,
        missing: ["hole_drilling_reason_note"],
      }),
    ],
  },
  {
    name: "«Annet» med tekst, nektet, ikke tilgang, betong (tolket som ok)",
    input: input({ rooms: [room({ holeDrilling: "ok" })] }),
    expected: [],
  },
  {
    name: "nektet med TG2-avvik gir advarsel om TGIU, ingen sperre",
    input: withCheckpoint({
      tgDirect: null,
      deviations: [deviation()],
      ruleResults: [triggeredTgiu("rule.hole_not_done")],
    }),
    expected: [warn("tgiu_suggested_not_set", { ...onCp, ruleKey: "rule.hole_not_done" })],
  },
  {
    name: "hull tatt uten måleverdi eller enhet (A446)",
    input: input({ rooms: [room({ holeReadingMissing: true })] }),
    expected: [warn("hole_reading_missing", onHole)],
  },
  {
    name: "to våtrom, mangel i det andre",
    input: input({
      rooms: [
        room(),
        room({ roomId: ROOM_2, position: 2, holeDrilling: "unanswered", holeCheckpoint: null }),
      ],
    }),
    expected: [
      blocker("wet_or_below_ground_missing_hole", { roomId: ROOM_2, missing: ["hole_drilling"] }),
    ],
  },
  {
    name: "rom som ikke er våtrom (P5)",
    input: input({
      rooms: [room({ isWetRoom: false, holeDrilling: "unanswered", holeReadingMissing: true })],
    }),
    expected: [],
  },
];

const MANDATORY_CASES: Case[] = [
  { name: "TG0", input: withCheckpoint({ tgDirect: "0" }), expected: [] },
  { name: "TG1", input: withCheckpoint({ tgDirect: "1" }), expected: [] },
  {
    name: "avvik med valgt TG",
    input: withCheckpoint({ tgDirect: null, deviations: [deviation()] }),
    expected: [],
  },
  {
    name: "tomt punkt",
    input: withCheckpoint({ tgDirect: null, done: false, hasContent: false }),
    expected: [blocker("mandatory_without_tg", { ...onCp, missing: ["tg"] })],
  },
  {
    name: "tomt punkt merket ferdig (ingen checkpoint_done_without_tg)",
    input: withCheckpoint({ tgDirect: null, done: true }),
    expected: [blocker("mandatory_without_tg", { ...onCp, missing: ["tg"] })],
  },
  {
    name: "bare HMS-avvik",
    input: withCheckpoint({
      tgDirect: null,
      deviations: [deviation({ kind: "hms", tg: null, outcomeTg: null })],
    }),
    expected: [blocker("mandatory_without_tg", { ...onCp, missing: ["tg"] })],
  },
  {
    name: "requiresTg = false uten TG",
    input: withCheckpoint({ tgDirect: null }, { requiresTg: false }),
    expected: [],
  },
  {
    name: "TGIU med grunn",
    input: withCheckpoint({ tgDirect: "IU", tgiu: tgiu() }),
    expected: [],
  },
  {
    name: "TGIU med tom grunn (A443)",
    input: withCheckpoint({ tgDirect: "IU", tgiu: tgiu({ reason: null }) }),
    expected: [
      blocker("mandatory_without_tg", { ...onCp, missing: ["reason"] }),
      warn("tgiu_details_missing", { ...onCp, missing: ["reason"] }),
    ],
  },
  {
    name: "TGIU uten opplysninger i det hele tatt",
    input: withCheckpoint({ tgDirect: "IU", tgiu: null }),
    expected: [
      blocker("mandatory_without_tg", { ...onCp, missing: ["reason"] }),
      warn("tgiu_details_missing", {
        ...onCp,
        missing: ["reason", "risk_assessment", "how_to_examine"],
      }),
    ],
  },
  {
    name: "komplett TG2-avvik og et avvik uten valgt TG (A444)",
    input: withCheckpoint({
      tgDirect: null,
      deviations: [deviation(), deviation({ id: DEV_2, tg: null, outcomeTg: "choose" })],
    }),
    expected: [blocker("mandatory_without_tg", { ...onCp, deviationId: DEV_2, missing: ["tg"] })],
  },
  {
    name: "bare avvik uten valgt TG gir én sperre, på avviket",
    input: withCheckpoint({
      tgDirect: null,
      deviations: [deviation({ tg: null, outcomeTg: "choose" })],
    }),
    expected: [blocker("mandatory_without_tg", { ...onCp, deviationId: DEV, missing: ["tg"] })],
  },
  {
    name: "avvik uten valgt TG på punkt med requiresTg = false",
    input: withCheckpoint(
      { tgDirect: null, deviations: [deviation({ tg: null, outcomeTg: "choose" })] },
      { requiresTg: false },
    ),
    expected: [blocker("mandatory_without_tg", { ...onCp, deviationId: DEV, missing: ["tg"] })],
  },
];

const DATE_CASES: Case[] = [
  {
    name: "befaringsdato mangler",
    input: input({ hasInspectionDate: false }),
    expected: [blocker("inspection_date_missing", {})],
  },
  { name: "befaringsdato finnes", input: input(), expected: [] },
];

const AI_CASES: Case[] = [
  {
    name: "to ventende KI-forslag gir to advarsler",
    input: input({
      pendingAiSuggestions: [
        {
          aiUsageId: "ai-2",
          roomId: ROOM,
          checkpointId: CP,
          checkpointKey: CP_KEY,
          deviationId: DEV,
        },
        {
          aiUsageId: "ai-1",
          roomId: null,
          checkpointId: null,
          checkpointKey: null,
          deviationId: null,
        },
      ],
    }),
    expected: [
      warn("ai_suggestion_pending", { aiUsageId: "ai-1" }),
      warn("ai_suggestion_pending", { ...onCp, deviationId: DEV, aiUsageId: "ai-2" }),
    ],
  },
  { name: "ingen ventende KI-forslag", input: input(), expected: [] },
];

describe("P1 testsakene", () => {
  describe.each([
    ["årsak og konsekvens", CAUSE_CASES],
    ["kostnad", COST_CASES],
    ["hulltaking", HOLE_CASES],
    ["punkt uten TG", MANDATORY_CASES],
    ["befaringsdato", DATE_CASES],
    ["KI-forslag", AI_CASES],
  ] as const)("%s", (_group, cases) => {
    it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
      expectFindings(computePublishCheck(c.input), c.expected);
    });
  });

  const ALL = [
    ...CAUSE_CASES,
    ...COST_CASES,
    ...HOLE_CASES,
    ...MANDATORY_CASES,
    ...DATE_CASES,
    ...AI_CASES,
  ];

  it("P4: sperren og de gamle advarslene står aldri på samme mål", () => {
    for (const c of ALL) {
      for (const f of computePublishCheck(c.input)) {
        expect(f.checkCode, c.name).not.toBe("deviation_tg_not_chosen");
        expect(f.checkCode, c.name).not.toBe("checkpoint_done_without_tg");
      }
    }
  });

  it("advarselskoder blir aldri sperre, og alle funn har source = rule", () => {
    const blockers = new Set<string>(PUBLISH_BLOCKER_CODES);
    for (const c of ALL) {
      for (const f of computePublishCheck(c.input)) {
        expect(f.severity, c.name).toBe(blockers.has(f.checkCode) ? "blocker" : "warning");
        expect(f.source).toBe("rule");
        expect(PUBLISH_CHECK_CODES).toContain(f.checkCode);
        for (const part of f.target.missing) expect(PUBLISH_CHECK_MISSING_PARTS).toContain(part);
      }
    }
  });
});

describe("advarslene fra «Badet på PC» føres videre", () => {
  it.each([
    [
      "tg2_tg3_missing_measure",
      state({ deviations: [deviation({ measureCount: 0 })] }),
      { deviationId: DEV, missing: ["measure"] },
    ],
    ["no_findings_with_reading_over_limit", state({ noFindingsWithReadingOverLimit: true }), {}],
    [
      "texts_written_for_other_tg",
      state({ deviations: [deviation({ tg: 3, outcomeTg: 2, hasMeasuresForTg: false })] }),
      { deviationId: DEV },
    ],
    [
      "tg3_on_age_only",
      state({
        deviations: [deviation({ tg: 3, outcomeTg: 2, causeCriterion: "age_uncertain_function" })],
      }),
      { deviationId: DEV },
    ],
  ] as const)("%s", (code, cpState, target) => {
    const findings = computePublishCheck(
      input({ rooms: [room({ checkpoints: [{ ...checkpoint(), state: cpState }] })] }),
    );
    expect(findings).toContainEqual({
      checkCode: code,
      severity: "warning",
      source: "rule",
      target: t({ ...onCp, ...(target as Partial<PublishCheckTarget>) }),
    });
  });
});

// --- P2: fast sortering ---------------------------------------------------------------------

describe("P2 fast sortering", () => {
  const cpA = checkpoint(
    { tgDirect: null, deviations: [deviation({ tg: 3, costType: "none", causeText: null })] },
    { checkpointId: "cp-a", checkpointKey: "cp.a", position: 1 },
  );
  const cpB = checkpoint(
    {
      tgDirect: null,
      deviations: [
        deviation({ id: "dev-b2", tg: null, outcomeTg: "choose" }),
        deviation({ id: "dev-b1", tg: null, outcomeTg: "choose" }),
      ],
    },
    { checkpointId: "cp-b", checkpointKey: "cp.b", position: 2 },
  );
  const roomA = room({
    roomId: "room-a",
    position: 1,
    holeDrilling: "unanswered",
    holeCheckpoint: null,
    checkpoints: [cpA, cpB],
  });
  const roomB = room({
    roomId: "room-b",
    position: 2,
    holeDrilling: "not_done_no_reason",
    holeCheckpoint: { checkpointId: "cp-b", checkpointKey: "cp.b" },
    checkpoints: [cpB, cpA],
  });
  const base = input({
    hasInspectionDate: false,
    rooms: [roomA, roomB],
    pendingAiSuggestions: [
      {
        aiUsageId: "ai-x",
        roomId: "room-a",
        checkpointId: "cp-a",
        checkpointKey: "cp.a",
        deviationId: null,
      },
    ],
  });

  it("rapporten, så rom, funn på rommet, punktene, koden og målet", () => {
    const findings = computePublishCheck(base);
    expect(
      findings.map((f) => [
        f.checkCode,
        f.target.roomId,
        f.target.checkpointId,
        f.target.deviationId,
        f.target.missing.join(","),
      ]),
    ).toEqual([
      ["inspection_date_missing", null, null, null, ""],
      ["wet_or_below_ground_missing_hole", "room-a", null, null, "hole_drilling"],
      ["tg2_tg3_missing_cause_or_consequence", "room-a", "cp-a", DEV, "cause_text"],
      ["tg3_missing_cost", "room-a", "cp-a", DEV, ""],
      ["ai_suggestion_pending", "room-a", "cp-a", null, ""],
      ["mandatory_without_tg", "room-a", "cp-b", "dev-b1", "tg"],
      ["mandatory_without_tg", "room-a", "cp-b", "dev-b2", "tg"],
      ["tg2_tg3_missing_cause_or_consequence", "room-b", "cp-a", DEV, "cause_text"],
      ["tg3_missing_cost", "room-b", "cp-a", DEV, ""],
      ["mandatory_without_tg", "room-b", "cp-b", "dev-b1", "tg"],
      ["mandatory_without_tg", "room-b", "cp-b", "dev-b2", "tg"],
      ["wet_or_below_ground_missing_hole", "room-b", "cp-b", null, "hole_drilling_reason"],
    ]);
  });

  it("samme svar i omvendt og stokket rekkefølge", () => {
    const expected = computePublishCheck(base);
    const reversed = input({
      ...base,
      rooms: [...base.rooms].reverse().map((r) => ({
        ...r,
        checkpoints: [...r.checkpoints].reverse().map((cp) => ({
          ...cp,
          state: { ...cp.state, deviations: [...cp.state.deviations].reverse() },
        })),
      })),
    });
    expect(computePublishCheck(reversed)).toEqual(expected);
    const shuffled = input({ ...base, rooms: [base.rooms[1]!, base.rooms[0]!] });
    expect(computePublishCheck(shuffled)).toEqual(expected);
  });

  it("målet er aldri en id fra checkpoint_results", () => {
    for (const f of computePublishCheck(base)) {
      expect(Object.keys(f.target).sort()).toEqual([
        "aiUsageId",
        "checkpointId",
        "checkpointKey",
        "deviationId",
        "missing",
        "roomId",
        "ruleKey",
      ]);
    }
  });
});

describe("P3 slettede rader", () => {
  it("ingen rom og ingen forslag gir bare rapportfunn", () => {
    expectFindings(computePublishCheck(input({ rooms: [] })), []);
  });
});

// --- Oppsummering, nøkkel og kanonisk form (P6, P7) ----------------------------------------

describe("summarizePublishCheck", () => {
  it("teller sperrer og advarsler", () => {
    const findings = computePublishCheck(
      input({ hasInspectionDate: false, rooms: [room({ holeReadingMissing: true })] }),
    );
    expect(summarizePublishCheck(findings)).toEqual({ blockers: 1, warnings: 1 });
    expect(summarizePublishCheck([])).toEqual({ blockers: 0, warnings: 0 });
  });
});

describe("P7 canonicalJson", () => {
  it("lik uansett nøkkelrekkefølge, uten mellomrom og uten undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: undefined } })).toBe(
      '{"a":{"d":[3,{"x":2,"y":1}]},"b":1}',
    );
    expect(canonicalJson({ a: { c: 1, b: 2 } })).toBe(canonicalJson({ a: { b: 2, c: 1 } }));
    expect(canonicalJson([undefined, null, "æ"])).toBe('[null,null,"æ"]');
  });

  it("endres når en verdi endres", () => {
    expect(canonicalJson({ tg: 2 })).not.toBe(canonicalJson({ tg: 3 }));
  });
});

describe("P6 canonicalPublishCheck og publishFindingKey", () => {
  const findings = computePublishCheck(
    input({ hasInspectionDate: false, rooms: [room({ holeDrilling: "unanswered" })] }),
  );

  it("lik for samme funn i annen rekkefølge og med annen kilde", () => {
    const reordered = [...findings].reverse().map((f) => ({ ...f, source: "ai" as const }));
    expect(canonicalPublishCheck(reordered)).toBe(canonicalPublishCheck(findings));
  });

  it("ulik når et funn faller bort eller målet endres", () => {
    expect(canonicalPublishCheck(findings.slice(1))).not.toBe(canonicalPublishCheck(findings));
    const moved = findings.map((f) => ({ ...f, target: { ...f.target, roomId: "room-x" } }));
    expect(canonicalPublishCheck(moved)).not.toBe(canonicalPublishCheck(findings));
  });

  it("nøkkelen er kode og mål, lik uansett nøkkelrekkefølge i målet", () => {
    const [first] = findings;
    const shuffled = Object.fromEntries(
      Object.entries(first!.target).reverse(),
    ) as PublishCheckTarget;
    expect(publishFindingKey({ checkCode: first!.checkCode, target: shuffled })).toBe(
      publishFindingKey(first!),
    );
    expect(publishFindingKey(findings[0]!)).not.toBe(publishFindingKey(findings[1]!));
  });
});

// --- P8: begrunnelsen ------------------------------------------------------------------------

describe("P8 checkPublishOverrideReason", () => {
  // Oppdiktet nummer med elleve sifre (ikke et ekte fødselsnummer).
  const fakeId = "01019912345";

  it.each([
    ["uten grunn", null, null, "reason_required"],
    ["ukjent grunn", "unknown", null, "reason_required"],
    ["«Annet» uten tekst", "other", null, "text_required"],
    ["«Annet» med blank tekst", "other", "   ", "text_required"],
    ["«Annet» med «.»", "other", ".", "text_too_short"],
    ["«Annet» med 9 tegn", "other", "123456789", "text_too_short"],
    ["«Annet» med 9 tegn og mellomrom rundt", "other", "  abcdefghi  ", "text_too_short"],
    ["«Annet» med 10 tegn", "other", "abcdefghij", "ok"],
    ["fast grunn uten tekst", "no_access_or_refused", null, "ok"],
    ["fast grunn med blank tekst", "described_elsewhere", "  ", "ok"],
    ["fast grunn med kort tekst", "not_applicable_to_room", "Kjeller.", "ok"],
    ["1000 tegn", "other", "a".repeat(PUBLISH_OVERRIDE_REASON_MAX_CHARS), "ok"],
    ["1001 tegn", "other", "a".repeat(PUBLISH_OVERRIDE_REASON_MAX_CHARS + 1), "text_too_long"],
    ["fødselsnummer", "other", `Eier har nummer ${fakeId}.`, "national_id"],
    ["fødselsnummer med mellomrom", "described_elsewhere", "010199 12345", "national_id"],
  ] as const)("%s", (_name, reasonCode, text, expected) => {
    expect(
      checkPublishOverrideReason({
        reasonCode: reasonCode as Parameters<typeof checkPublishOverrideReason>[0]["reasonCode"],
        text,
      }),
    ).toBe(expected);
  });

  it("hver kontroll unntatt ok har norsk melding", () => {
    expect(Object.keys(PUBLISH_OVERRIDE_REASON_CHECK_MESSAGES).sort()).toEqual([
      "national_id",
      "reason_required",
      "text_required",
      "text_too_long",
      "text_too_short",
    ]);
  });
});

// --- Kladdene ved krysse bort (F3) -----------------------------------------------------------

describe("remainingBlockers og carryOverrideDrafts", () => {
  const before = computePublishCheck(
    input({
      hasInspectionDate: false,
      rooms: [room({ holeDrilling: "unanswered", holeReadingMissing: true })],
    }),
  );
  const dateBlocker = before.find((f) => f.checkCode === "inspection_date_missing")!;
  const holeBlocker = before.find((f) => f.checkCode === "wet_or_below_ground_missing_hole")!;
  const readingWarning = before.find((f) => f.checkCode === "hole_reading_missing")!;
  const draft = (f: PublishCheckFinding, over: Partial<PublishOverrideDraft> = {}) => ({
    findingKey: publishFindingKey(f),
    reasonCode: "no_access_or_refused" as const,
    text: null,
    ...over,
  });

  it("gyldig kladd fjerner sperren; ugyldig kladd og advarsler teller ikke", () => {
    expect(remainingBlockers(before, [])).toEqual([dateBlocker, holeBlocker]);
    expect(remainingBlockers(before, [draft(holeBlocker)])).toEqual([dateBlocker]);
    expect(
      remainingBlockers(before, [draft(holeBlocker, { reasonCode: "other", text: "kort" })]),
    ).toEqual([dateBlocker, holeBlocker]);
    expect(remainingBlockers(before, [draft(readingWarning)])).toEqual([dateBlocker, holeBlocker]);
  });

  it("beholder kladd for samme kode og mål, og merker nye sperrer", () => {
    const after = computePublishCheck(
      input({
        hasInspectionDate: false,
        rooms: [room({ holeDrilling: "not_done_no_reason", holeReadingMissing: true })],
      }),
    );
    const newHole = after.find((f) => f.checkCode === "wet_or_below_ground_missing_hole")!;
    const result = carryOverrideDrafts(before, after, [
      draft(dateBlocker, { text: "Dato ligger i bestillingen." }),
      draft(holeBlocker),
      draft(readingWarning),
    ]);
    expect(result.drafts).toEqual([draft(dateBlocker, { text: "Dato ligger i bestillingen." })]);
    expect(result.added).toEqual([newHole]);
  });
});

// --- Tekstene -------------------------------------------------------------------------------

describe("publishFindingText", () => {
  const f = (checkCode: PublishCheckFinding["checkCode"], target: Partial<PublishCheckTarget>) => ({
    checkCode,
    target: t(target),
  });

  it.each([
    [
      f("tg2_tg3_missing_cause_or_consequence", { deviationId: DEV, missing: ["cause_criterion"] }),
      { deviationNumber: 1, deviationTg: 2 as const },
      "Avvik 1 (TG2) mangler årsakskriterium.",
    ],
    [
      f("tg2_tg3_missing_cause_or_consequence", { deviationId: DEV, missing: ["cause_text"] }),
      { deviationNumber: 1, deviationTg: 2 as const },
      "Avvik 1 (TG2) mangler årsak.",
    ],
    [
      f("tg2_tg3_missing_cause_or_consequence", {
        deviationId: DEV,
        missing: ["consequence_text"],
      }),
      { deviationNumber: 1, deviationTg: 2 as const },
      "Avvik 1 (TG2) mangler konsekvens.",
    ],
    [
      f("tg3_missing_cost", { deviationId: DEV }),
      { deviationNumber: 1 },
      "Avvik 1 (TG3) mangler kostnad.",
    ],
    [
      f("wet_or_below_ground_missing_hole", { missing: ["hole_drilling"] }),
      {},
      "Hulltaking er ikke besvart.",
    ],
    [
      f("wet_or_below_ground_missing_hole", { missing: ["hole_drilling_reason"] }),
      {},
      "Hulltaking er ikke utført, og grunnen mangler.",
    ],
    [
      f("wet_or_below_ground_missing_hole", { missing: ["hole_drilling_reason_note"] }),
      {},
      "Hulltaking: «Annet» mangler forklaring.",
    ],
    [f("mandatory_without_tg", { missing: ["tg"] }), {}, "Punktet mangler TG."],
    [
      f("mandatory_without_tg", { missing: ["reason"] }),
      {},
      "TGIU mangler grunn: hva er ikke undersøkt, og hvorfor.",
    ],
    [
      f("mandatory_without_tg", { deviationId: DEV_2, missing: ["tg"] }),
      { deviationNumber: 2 },
      "Avvik 2 mangler TG. Velg TG2 eller TG3.",
    ],
    [
      f("inspection_date_missing", {}),
      {},
      "Oppdraget mangler befaringsdato. Uten den får rapporten ingen «gyldig til»-dato.",
    ],
    [f("hole_reading_missing", {}), {}, "Hulltaking er utført, men måleverdi eller enhet mangler."],
    [
      f("ai_suggestion_pending", { aiUsageId: "ai-1" }),
      {},
      "Forslag fra KI som ikke er behandlet. Det kommer ikke med i rapporten.",
    ],
    [
      f("tg2_tg3_missing_measure", { deviationId: DEV, missing: ["measure"] }),
      {},
      "Avviket mangler tiltak.",
    ],
  ] as const)("%#: %s", (finding, context, expected) => {
    expect(publishFindingText(finding, context)).toBe(expected);
  });

  it("hver kode har tekst uten flettetegn og uten gjetteord", () => {
    for (const code of PUBLISH_CHECK_CODES) {
      const text = publishFindingText(f(code, {}));
      expect(text.length, code).toBeGreaterThan(5);
      expect(text, code).not.toMatch(/[{}]|antas|trolig|undefined|null/u);
    }
  });

  it("hver grunn har etikett", () => {
    expect(Object.keys(PUBLISH_OVERRIDE_REASON_LABELS)).toEqual([...PUBLISH_OVERRIDE_REASON_CODES]);
  });
});

// --- Kodene er like i logic og skjemaet -----------------------------------------------------

describe("kodene i logic og skjemaet", () => {
  it("lik grense for begrunnelsen", () => {
    expect(PUBLISH_OVERRIDE_REASON_MAX_CHARS).toBe(SCHEMA_MAX_CHARS);
  });

  it("like lister i samme rekkefølge", () => {
    expect([...PUBLISH_BLOCKER_CODES]).toEqual([...SCHEMA_BLOCKER_CODES]);
    expect([...PUBLISH_CHECK_CODES]).toEqual([...SCHEMA_CHECK_CODES]);
    expect([...PUBLISH_OVERRIDE_REASON_CODES]).toEqual([...SCHEMA_REASON_CODES]);
    expect(PUBLISH_CHECK_CODES).toEqual([...PUBLISH_BLOCKER_CODES, ...PUBLISH_WARNING_CODES]);
  });
});
