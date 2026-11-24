import { describe, expect, it } from "vitest";
import type { RuleResult } from "@/core/rules";
import {
  PUBLISH_BLOCKER_CODES as SCHEMA_BLOCKER_CODES,
  PUBLISH_CHECK_CODES as SCHEMA_CHECK_CODES,
  PUBLISH_OVERRIDE_REASON_CODES as SCHEMA_OVERRIDE_REASON_CODES,
  PUBLISH_WARNING_CODES as SCHEMA_WARNING_CODES,
} from "@/db/schema";
import {
  PUBLISH_BLOCKER_CODES,
  PUBLISH_CHECK_CODES,
  PUBLISH_CHECK_MISSING_PARTS,
  PUBLISH_OVERRIDE_REASON_CODES,
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
  PUBLISH_CHECK_MISSING_PART_LABELS,
  PUBLISH_OVERRIDE_REASON_LABELS,
  publishFindingText,
} from "./publish-check-texts";
import type {
  PublishCheckCheckpoint,
  PublishCheckFinding,
  PublishCheckInput,
  PublishCheckRoom,
  PublishCheckTarget,
} from "./publish-check-types";
import type { CheckpointState, DecisionState, DeviationState, TgiuState } from "./types";

/*
 * Sjekken før publisering som testsaker i data (docs/funksjoner/fase2a-publisering-badet-testplan.md
 * avsnitt 1, 2.1, 2.3 og 2.5; kortets P1–P6 og P8). Ren test uten database, med oppdiktede id-er.
 * Forventet liste sammenlignes eksakt, slik at et ekstra funn også gjør testen rød.
 *
 * Hovedmål: færre reklamasjoner (hver sperre har en sak per grense) og KI i bunnen (sjekken er ren
 * kode, alle funn har `source = 'rule'`, og KI kan aldri gi sperre).
 */

const BATH = "room-bath-1";
const BATH_2 = "room-bath-2";
const HALL = "room-hall";
const MEMBRANE = { checkpointId: "cp-id-membrane", checkpointKey: "cp.membrane" };
const ADJACENT = { checkpointId: "cp-id-adjacent", checkpointKey: "cp.adjacent" };
const FLOOR = { checkpointId: "cp-id-floor", checkpointKey: "cp.floor" };
const ELECTRIC = { checkpointId: "cp-id-electric", checkpointKey: "cp.electric" };
const NOT_DONE_RULE = "rule.hole_not_done";
const AGE_RULE = "rule.past_lifespan";

// --- Byggere -----------------------------------------------------------------------------------

/** Et fullstendig TG2-avvik uten advarsler. */
function dev(overrides: Partial<DeviationState> = {}): DeviationState {
  return {
    id: "dev-1",
    kind: "tg",
    tg: 2,
    causeCriterion: "symptom_of_damage",
    causeText: "Oppdiktet årsak.",
    consequenceText: "Oppdiktet konsekvens.",
    costType: "band",
    costAmount: null,
    measureCount: 1,
    outcomeTg: 2,
    hasMeasuresForTg: false,
    ...overrides,
  };
}

/** Et fullstendig TG3-avvik med kostnadsintervall. */
function tg3(overrides: Partial<DeviationState> = {}): DeviationState {
  return dev({ tg: 3, outcomeTg: 3, ...overrides });
}

/** Et fullstendig HMS-avvik. */
function hms(overrides: Partial<DeviationState> = {}): DeviationState {
  return dev({
    kind: "hms",
    tg: null,
    outcomeTg: null,
    causeCriterion: null,
    causeText: null,
    costType: "none",
    ...overrides,
  });
}

function fullTgiu(overrides: Partial<TgiuState> = {}): TgiuState {
  return {
    reason: "Ikke undersøkt fordi eier ikke ga samtykke.",
    riskAssessment: "Oppdiktet risiko.",
    howToExamine: "Hulltaking.",
    alternativeCheckMethod: "Overflatemåling.",
    alternativeCheckResult: "Ingen utslag.",
    constructionVulnerable: "yes",
    ownerInformed: true,
    ...overrides,
  };
}

/** Et ferdig punkt med TG1 og ingen advarsler. */
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

function cp(
  ids: { checkpointId: string; checkpointKey: string },
  position: number,
  stateOverrides: Partial<CheckpointState> = {},
  requiresTg = true,
): PublishCheckCheckpoint {
  return { ...ids, position, requiresTg, state: state(stateOverrides) };
}

/** Et våtrom med besvart hulltaking og tre punkter med TG1. */
function room(overrides: Partial<PublishCheckRoom> = {}): PublishCheckRoom {
  return {
    roomId: BATH,
    position: 1,
    isWetRoom: true,
    holeDrilling: "ok",
    holeReadingMissing: false,
    adjacentTgiuWithReason: false,
    holeCheckpoint: null,
    checkpoints: [cp(MEMBRANE, 1), cp(ADJACENT, 2), cp(FLOOR, 3)],
    ...overrides,
  };
}

/** Rommet med punktet `ids` byttet ut. */
function roomWith(
  ids: { checkpointId: string; checkpointKey: string },
  stateOverrides: Partial<CheckpointState>,
  options: { requiresTg?: boolean; room?: Partial<PublishCheckRoom> } = {},
): PublishCheckRoom {
  const base = room(options.room);
  return {
    ...base,
    checkpoints: base.checkpoints.map((c) =>
      c.checkpointId === ids.checkpointId
        ? cp(ids, c.position, stateOverrides, options.requiresTg ?? true)
        : c,
    ),
  };
}

/** Inndata uten mangler: befaringsdato, ett bad, ingen KI-forslag. */
function buildPublishCheckInput(overrides: Partial<PublishCheckInput> = {}): PublishCheckInput {
  return { hasInspectionDate: true, rooms: [room()], pendingAiSuggestions: [], ...overrides };
}

function target(fields: Partial<PublishCheckTarget> = {}): PublishCheckTarget {
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

/** Mål på et punkt i badet. */
function at(
  ids: { checkpointId: string; checkpointKey: string },
  fields: Partial<PublishCheckTarget> = {},
  roomId = BATH,
): PublishCheckTarget {
  return target({ roomId, ...ids, ...fields });
}

type Expected = Pick<PublishCheckFinding, "checkCode" | "severity" | "target">;

const blocker = (checkCode: Expected["checkCode"], t: PublishCheckTarget): Expected => ({
  checkCode,
  severity: "blocker",
  target: t,
});
const warning = (checkCode: Expected["checkCode"], t: PublishCheckTarget): Expected => ({
  checkCode,
  severity: "warning",
  target: t,
});

function triggered(
  ruleKey: string,
  suggestion: RuleResult["suggestion"],
  purpose: RuleResult["purpose"] = "suggest_outcome",
): RuleResult {
  return {
    rule_key: ruleKey,
    purpose,
    state: "triggered",
    suggestion,
    code: null,
    reasons: [],
    lifespan_set_key: null,
    threshold_set_key: null,
  };
}

function notTriggered(ruleKey: string): RuleResult {
  return { ...triggered(ruleKey, null), state: "not_triggered" };
}

const TGIU_SUGGESTION = triggered(
  NOT_DONE_RULE,
  { kind: "tgiu", checkpoint_key: ADJACENT.checkpointKey },
  "suggest_tgiu",
);

function decision(overrides: Partial<DecisionState> = {}): DecisionState {
  return {
    ruleKey: AGE_RULE,
    decision: "accepted",
    suggestion: {
      kind: "outcome",
      checkpoint_key: MEMBRANE.checkpointKey,
      question_key: "cp.membrane.age",
      outcome_key: "tg2",
    },
    chosenTg: "2",
    madeDeviation: true,
    deviationId: "dev-1",
    ...overrides,
  };
}

type Case = { name: string; input: PublishCheckInput; expected: Expected[] };

/** Sammenligner eksakt, og at alle funn har `source = 'rule'`. */
function expectFindings(input: PublishCheckInput, expected: Expected[]) {
  const findings = computePublishCheck(input);
  expect(findings).toEqual(expected.map((e) => ({ ...e, source: "rule" })));
  return findings;
}

const membraneDev = (deviationId: string, missing: PublishCheckTarget["missing"] = []) =>
  at(MEMBRANE, { deviationId, missing });

// --- 1.1 tg2_tg3_missing_cause_or_consequence ---------------------------------------------------

const CAUSE_CASES: Case[] = [
  {
    name: "1.1.1 TG2 med kriterium, årsak og konsekvens gir ingen sperre",
    input: buildPublishCheckInput({ rooms: [roomWith(MEMBRANE, { deviations: [dev()] })] }),
    expected: [],
  },
  {
    name: "1.1.2 TG2 uten kriterium gir sperre med missing = cause_criterion",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [dev({ causeCriterion: null })] })],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["cause_criterion"])),
    ],
  },
  {
    name: "1.1.3a TG2 med tom årsak gir sperre med missing = cause_text",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [dev({ causeText: "" })] })],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["cause_text"])),
    ],
  },
  {
    name: "1.1.3b TG2 med årsak som bare er mellomrom og linjeskift gir sperre",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [dev({ causeText: "  \n\t \n" })] })],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["cause_text"])),
    ],
  },
  {
    name: "1.1.3c TG2 uten årsakstekst (null) gir sperre",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [dev({ causeText: null })] })],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["cause_text"])),
    ],
  },
  {
    name: "1.1.4 TG2 med blank konsekvens gir sperre med missing = consequence_text",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [dev({ consequenceText: "   " })] })],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["consequence_text"])),
    ],
  },
  {
    name: "1.1.5 TG2 uten alle tre gir tre funn, ett per missing, på samme avvik",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(MEMBRANE, {
          deviations: [dev({ causeCriterion: null, causeText: null, consequenceText: "" })],
        }),
      ],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["cause_criterion"])),
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["cause_text"])),
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["consequence_text"])),
    ],
  },
  {
    name: "1.1.5b TG3 uten årsak gir også sperren",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [tg3({ causeText: " " })] })],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["cause_text"])),
    ],
  },
  {
    name: "1.1.6 TG3 komplett med kostnadsintervall gir ingen sperre",
    input: buildPublishCheckInput({ rooms: [roomWith(MEMBRANE, { deviations: [tg3()] })] }),
    expected: [],
  },
  {
    name: "1.1.7 TG3 med eget beløp 37 500 gir bare advarselen cost_amount_not_rounded",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [tg3({ costType: "approx", costAmount: 37500 })] })],
    }),
    expected: [warning("cost_amount_not_rounded", membraneDev("dev-1"))],
  },
  {
    name: "1.1.7b TG3 med rundet eget beløp 40 000 gir ingenting",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [tg3({ costType: "approx", costAmount: 40000 })] })],
    }),
    expected: [],
  },
  {
    name: "1.1.8 HMS-avvik uten konsekvens gir ingen sperre, bare advarsel",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [hms({ consequenceText: " " })] })],
    }),
    expected: [
      warning("hms_missing_consequence_or_measure", membraneDev("dev-1", ["consequence_text"])),
    ],
  },
  {
    name: "1.1.9 punkt med TG1 direkte og HMS uten tekst gir ingen sperre for årsak",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(MEMBRANE, {
          tgDirect: "1",
          deviations: [hms({ consequenceText: null, causeText: null, measureCount: 1 })],
        }),
      ],
    }),
    expected: [
      warning("hms_missing_consequence_or_measure", membraneDev("dev-1", ["consequence_text"])),
    ],
  },
  {
    name: "1.1.10 mykt slettet TG2-avvik sendes ikke inn og gir ingenting",
    // Slettede avvik filtreres av den som kaller (signals.ts); punktet har TG1 igjen.
    input: buildPublishCheckInput({ rooms: [roomWith(MEMBRANE, { deviations: [] })] }),
    expected: [],
  },
];

// --- 1.2 tg3_missing_cost ------------------------------------------------------------------------

const COST_CASES: Case[] = [
  {
    name: "1.2.1 TG3 med cost_type = none gir sperre på avviket",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [tg3({ costType: "none" })] })],
    }),
    expected: [blocker("tg3_missing_cost", membraneDev("dev-1"))],
  },
  {
    name: "1.2.2 TG2 med cost_type = none gir ingen sperre",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [dev({ costType: "none" })] })],
    }),
    expected: [],
  },
  {
    name: "1.2.3a TG3 med intervall gir ingen sperre",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [tg3({ costType: "band" })] })],
    }),
    expected: [],
  },
  {
    name: "1.2.3b TG3 med eget rundet beløp gir ingen sperre",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(MEMBRANE, { deviations: [tg3({ costType: "approx", costAmount: 100000 })] }),
      ],
    }),
    expected: [],
  },
  {
    name: "1.2.4 TG3 uten årsak og uten kostnad gir begge kodene, hver én gang",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [tg3({ costType: "none", causeText: "" })] })],
    }),
    expected: [
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-1", ["cause_text"])),
      blocker("tg3_missing_cost", membraneDev("dev-1")),
    ],
  },
];

// --- 1.3 wet_or_below_ground_missing_hole -------------------------------------------------------

const roomTarget = (missing: PublishCheckTarget["missing"], roomId = BATH) =>
  target({ roomId, missing });

const HOLE_CASES: Case[] = [
  {
    name: "1.3.1 ubesvart hulltaking uten TGIU gir sperre på rommet",
    input: buildPublishCheckInput({ rooms: [room({ holeDrilling: "unanswered" })] }),
    expected: [blocker("wet_or_below_ground_missing_hole", roomTarget(["hole_drilling"]))],
  },
  {
    name: "1.3.1b målet er punktet hulltakingen hører til når det finnes",
    input: buildPublishCheckInput({
      rooms: [room({ holeDrilling: "unanswered", holeCheckpoint: ADJACENT })],
    }),
    expected: [
      blocker("wet_or_below_ground_missing_hole", at(ADJACENT, { missing: ["hole_drilling"] })),
    ],
  },
  {
    name: "1.3.2 ubesvart, TGIU med utfylt grunn på tilliggende konstruksjoner gir ingen (A445)",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(
          ADJACENT,
          { tgDirect: "IU", tgiu: fullTgiu() },
          { room: { holeDrilling: "unanswered", adjacentTgiuWithReason: true } },
        ),
      ],
    }),
    expected: [],
  },
  {
    name: "1.3.3 ubesvart, TGIU med blank grunn gir sperre, og mandatory_without_tg på punktet",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(
          ADJACENT,
          { tgDirect: "IU", tgiu: fullTgiu({ reason: "   " }) },
          { room: { holeDrilling: "unanswered", adjacentTgiuWithReason: false } },
        ),
      ],
    }),
    expected: [
      blocker("wet_or_below_ground_missing_hole", roomTarget(["hole_drilling"])),
      blocker("mandatory_without_tg", at(ADJACENT, { missing: ["reason"] })),
      warning("tgiu_details_missing", at(ADJACENT, { missing: ["reason"] })),
    ],
  },
  {
    name: "1.3.4 «ikke utført» uten grunn gir sperre",
    input: buildPublishCheckInput({ rooms: [room({ holeDrilling: "not_done_no_reason" })] }),
    expected: [blocker("wet_or_below_ground_missing_hole", roomTarget(["hole_drilling_reason"]))],
  },
  {
    name: "1.3.5 grunnen «annet» uten tekst gir sperre",
    input: buildPublishCheckInput({ rooms: [room({ holeDrilling: "other_without_note" })] }),
    expected: [
      blocker("wet_or_below_ground_missing_hole", roomTarget(["hole_drilling_reason_note"])),
    ],
  },
  {
    name: "1.3.6 nektet, ikke tilgang, betong/mur og «annet» med tekst (tolket som ok) gir ingen",
    input: buildPublishCheckInput({ rooms: [room({ holeDrilling: "ok" })] }),
    expected: [],
  },
  {
    name: "1.3.7 nektet av eier med TG2-avvik gir advarselen tgiu_suggested_not_set, ingen sperre",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(ADJACENT, {
          tgDirect: null,
          deviations: [dev({ id: "dev-adj" })],
          ruleResults: [TGIU_SUGGESTION],
        }),
      ],
    }),
    expected: [warning("tgiu_suggested_not_set", at(ADJACENT, { ruleKey: NOT_DONE_RULE }))],
  },
  {
    name: "1.3.7b nektet av eier med TG2 direkte gir samme advarsel",
    input: buildPublishCheckInput({
      rooms: [roomWith(ADJACENT, { tgDirect: "1", ruleResults: [TGIU_SUGGESTION] })],
    }),
    expected: [warning("tgiu_suggested_not_set", at(ADJACENT, { ruleKey: NOT_DONE_RULE }))],
  },
  {
    name: "1.3.8 utført med måleverdi og enhet gir ingen",
    input: buildPublishCheckInput({
      rooms: [room({ holeDrilling: "ok", holeReadingMissing: false })],
    }),
    expected: [],
  },
  {
    name: "1.3.9 utført uten måleverdi eller enhet gir advarsel hole_reading_missing, aldri sperre (A446)",
    input: buildPublishCheckInput({
      rooms: [room({ holeDrilling: "ok", holeReadingMissing: true })],
    }),
    expected: [warning("hole_reading_missing", roomTarget([]))],
  },
  {
    name: "1.3.10 to våtrom, mangel i det andre, gir én sperre med riktig rom",
    input: buildPublishCheckInput({
      rooms: [
        room(),
        room({
          roomId: BATH_2,
          position: 2,
          holeDrilling: "unanswered",
        }),
      ],
    }),
    expected: [blocker("wet_or_below_ground_missing_hole", roomTarget(["hole_drilling"], BATH_2))],
  },
  {
    name: "1.3.11 rom som ikke er våtrom, med ubesvart hulltaking, gir ingen (P5)",
    input: buildPublishCheckInput({
      rooms: [
        room(),
        room({
          roomId: HALL,
          position: 2,
          isWetRoom: false,
          holeDrilling: "unanswered",
          holeReadingMissing: true,
        }),
      ],
    }),
    expected: [],
  },
];

// --- 1.4 mandatory_without_tg -------------------------------------------------------------------

const MANDATORY_CASES: Case[] = [
  {
    name: "1.4.1a punkt med TG0 gir ingen",
    input: buildPublishCheckInput({ rooms: [roomWith(MEMBRANE, { tgDirect: "0" })] }),
    expected: [],
  },
  {
    name: "1.4.1b punkt med avvik med valgt TG gir ingen",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: null, deviations: [dev()] })],
    }),
    expected: [],
  },
  {
    name: "1.4.2a tomt punkt som krever TG gir sperre på punktet (mål checkpointKey)",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: null, done: false, hasContent: false })],
    }),
    expected: [blocker("mandatory_without_tg", at(MEMBRANE, { missing: ["tg"] }))],
  },
  {
    name: "1.4.2b tomt punkt merket ferdig gir bare sperren, ikke checkpoint_done_without_tg (P4)",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: null, done: true })],
    }),
    expected: [blocker("mandatory_without_tg", at(MEMBRANE, { missing: ["tg"] }))],
  },
  {
    name: "1.4.3 punkt med bare HMS-avvik gir sperre",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: null, deviations: [hms()] })],
    }),
    expected: [blocker("mandatory_without_tg", at(MEMBRANE, { missing: ["tg"] }))],
  },
  {
    name: "1.4.4 punkt som ikke krever TG (el, rekkverk, HMS-punkt) gir ingen",
    input: buildPublishCheckInput({
      rooms: [
        {
          ...room(),
          checkpoints: [
            ...room().checkpoints,
            cp(ELECTRIC, 4, { tgDirect: null, done: true, hasContent: true }, false),
          ],
        },
      ],
    }),
    expected: [],
  },
  {
    name: "1.4.5a TGIU med grunn gir ingen",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: "IU", tgiu: fullTgiu() })],
    }),
    expected: [],
  },
  {
    name: "1.4.5b TGIU med tom grunn gir sperre og advarselen tgiu_details_missing (A443)",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: "IU", tgiu: fullTgiu({ reason: "" }) })],
    }),
    expected: [
      blocker("mandatory_without_tg", at(MEMBRANE, { missing: ["reason"] })),
      warning("tgiu_details_missing", at(MEMBRANE, { missing: ["reason"] })),
    ],
  },
  {
    name: "1.4.5c TGIU med blank grunn gir sperre",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: "IU", tgiu: fullTgiu({ reason: " \n " }) })],
    }),
    expected: [
      blocker("mandatory_without_tg", at(MEMBRANE, { missing: ["reason"] })),
      warning("tgiu_details_missing", at(MEMBRANE, { missing: ["reason"] })),
    ],
  },
  {
    name: "1.4.5d TGIU uten TGIU-rad i det hele tatt gir sperre",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: "IU", tgiu: null })],
    }),
    expected: [
      blocker("mandatory_without_tg", at(MEMBRANE, { missing: ["reason"] })),
      warning(
        "tgiu_details_missing",
        at(MEMBRANE, { missing: ["reason", "risk_assessment", "how_to_examine"] }),
      ),
    ],
  },
  {
    name: "1.4.6 komplett TG2-avvik og et avvik uten valgt TG gir sperre med avviket som mål (A444)",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(MEMBRANE, {
          tgDirect: null,
          deviations: [dev(), dev({ id: "dev-2", tg: null, outcomeTg: "choose" })],
        }),
      ],
    }),
    expected: [blocker("mandatory_without_tg", membraneDev("dev-2", ["tg"]))],
  },
  {
    name: "1.4.6b avvik uten TG på punkt som ikke krever TG gir likevel sperre på avviket",
    input: buildPublishCheckInput({
      rooms: [
        {
          ...room(),
          checkpoints: [
            ...room().checkpoints,
            cp(
              ELECTRIC,
              4,
              {
                tgDirect: null,
                deviations: [dev({ id: "dev-el", tg: null, outcomeTg: "choose" })],
              },
              false,
            ),
          ],
        },
      ],
    }),
    expected: [
      blocker("mandatory_without_tg", at(ELECTRIC, { deviationId: "dev-el", missing: ["tg"] })),
    ],
  },
  {
    name: "1.4.6c eneste avvik uten valgt TG gir sperre bare på avviket, ikke i tillegg på punktet",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(MEMBRANE, {
          tgDirect: null,
          deviations: [dev({ tg: null, outcomeTg: "choose" })],
        }),
      ],
    }),
    expected: [blocker("mandatory_without_tg", membraneDev("dev-1", ["tg"]))],
  },
];

// --- 1.5 inspection_date_missing ----------------------------------------------------------------

const DATE_CASES: Case[] = [
  {
    name: "1.5.1a befaringsdato mangler gir én sperre på rapportnivå",
    input: buildPublishCheckInput({ hasInspectionDate: false }),
    expected: [blocker("inspection_date_missing", target())],
  },
  {
    name: "1.5.1b befaringsdato finnes gir ingen",
    input: buildPublishCheckInput({ hasInspectionDate: true }),
    expected: [],
  },
  {
    name: "1.5.1c befaringsdato mangler, også uten rom, gir én sperre",
    input: buildPublishCheckInput({ hasInspectionDate: false, rooms: [] }),
    expected: [blocker("inspection_date_missing", target())],
  },
];

// --- 1.6 Advarsler ------------------------------------------------------------------------------

/** De ni punktadvarslene fra «Badet på PC» som føres videre som advarsler. */
const NINE_WARNING_CASES: Case[] = [
  {
    name: "tg2_tg3_missing_measure",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: null, deviations: [dev({ measureCount: 0 })] })],
    }),
    expected: [warning("tg2_tg3_missing_measure", membraneDev("dev-1", ["measure"]))],
  },
  {
    name: "cost_amount_not_rounded",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [dev({ costType: "approx", costAmount: 12345 })] })],
    }),
    expected: [warning("cost_amount_not_rounded", membraneDev("dev-1"))],
  },
  {
    name: "hms_missing_consequence_or_measure",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(MEMBRANE, {
          deviations: [hms({ consequenceText: "", measureCount: 0 })],
        }),
      ],
    }),
    expected: [
      warning(
        "hms_missing_consequence_or_measure",
        membraneDev("dev-1", ["consequence_text", "measure"]),
      ),
    ],
  },
  {
    name: "tgiu_details_missing",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { tgDirect: "IU", tgiu: fullTgiu({ riskAssessment: "" }) })],
    }),
    expected: [warning("tgiu_details_missing", at(MEMBRANE, { missing: ["risk_assessment"] }))],
  },
  {
    name: "tgiu_suggested_not_set",
    input: buildPublishCheckInput({
      rooms: [roomWith(ADJACENT, { ruleResults: [TGIU_SUGGESTION] })],
    }),
    expected: [warning("tgiu_suggested_not_set", at(ADJACENT, { ruleKey: NOT_DONE_RULE }))],
  },
  {
    name: "no_findings_with_reading_over_limit",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { noFindingsWithReadingOverLimit: true })],
    }),
    expected: [warning("no_findings_with_reading_over_limit", at(MEMBRANE))],
  },
  {
    name: "suggestion_no_longer_applies",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(MEMBRANE, {
          deviations: [dev()],
          ruleResults: [notTriggered(AGE_RULE)],
          decisions: [decision()],
        }),
      ],
    }),
    expected: [
      warning(
        "suggestion_no_longer_applies",
        at(MEMBRANE, { deviationId: "dev-1", ruleKey: AGE_RULE }),
      ),
    ],
  },
  {
    name: "texts_written_for_other_tg",
    input: buildPublishCheckInput({
      rooms: [roomWith(MEMBRANE, { deviations: [tg3({ outcomeTg: 2, hasMeasuresForTg: false })] })],
    }),
    expected: [warning("texts_written_for_other_tg", membraneDev("dev-1"))],
  },
  {
    name: "tg3_on_age_only",
    input: buildPublishCheckInput({
      rooms: [
        roomWith(MEMBRANE, {
          deviations: [
            tg3({ causeCriterion: "age_uncertain_function", outcomeTg: 2, hasMeasuresForTg: true }),
          ],
        }),
      ],
    }),
    expected: [warning("tg3_on_age_only", membraneDev("dev-1"))],
  },
];

const AI_CASES: Case[] = [
  {
    name: "1.6.2a to ventende KI-forslag gir én advarsel per forslag med mål",
    input: buildPublishCheckInput({
      pendingAiSuggestions: [
        {
          aiUsageId: "ai-2",
          roomId: BATH,
          ...MEMBRANE,
          deviationId: "dev-1",
        },
        { aiUsageId: "ai-1", roomId: BATH, ...MEMBRANE, deviationId: "dev-1" },
      ],
    }),
    expected: [
      warning("ai_suggestion_pending", membraneDev("dev-1", [])),
      warning("ai_suggestion_pending", membraneDev("dev-1", [])),
    ].map((e, i) => ({ ...e, target: { ...e.target, aiUsageId: i === 0 ? "ai-1" : "ai-2" } })),
  },
  {
    name: "1.6.2b ingen ventende KI-forslag gir ingen advarsel",
    input: buildPublishCheckInput({ pendingAiSuggestions: [] }),
    expected: [],
  },
];

const ALL_CASES: Case[] = [
  ...CAUSE_CASES,
  ...COST_CASES,
  ...HOLE_CASES,
  ...MANDATORY_CASES,
  ...DATE_CASES,
  ...NINE_WARNING_CASES.map((c) => ({ ...c, name: `1.6.1 ${c.name} føres videre som advarsel` })),
  ...AI_CASES,
];

describe("1.1 tg2_tg3_missing_cause_or_consequence (P1)", () => {
  it.each(CAUSE_CASES)("$name", ({ input, expected }) => {
    expectFindings(input, expected);
  });
});

describe("1.2 tg3_missing_cost (P1)", () => {
  it.each(COST_CASES)("$name", ({ input, expected }) => {
    expectFindings(input, expected);
  });
});

describe("1.3 wet_or_below_ground_missing_hole (P1, P5)", () => {
  it.each(HOLE_CASES)("$name", ({ input, expected }) => {
    expectFindings(input, expected);
  });
});

describe("1.4 mandatory_without_tg (P1, P4)", () => {
  it.each(MANDATORY_CASES)("$name", ({ input, expected }) => {
    expectFindings(input, expected);
  });

  it("1.4.7 checkpoint_done_without_tg og deviation_tg_not_chosen finnes aldri i utdata (P4)", () => {
    for (const c of ALL_CASES) {
      const codes: string[] = computePublishCheck(c.input).map((f) => f.checkCode);
      expect(codes, c.name).not.toContain("checkpoint_done_without_tg");
      expect(codes, c.name).not.toContain("deviation_tg_not_chosen");
    }
  });
});

describe("1.5 inspection_date_missing", () => {
  it.each(DATE_CASES)("$name", ({ input, expected }) => {
    expectFindings(input, expected);
  });
});

describe("1.6 advarsler", () => {
  it.each(NINE_WARNING_CASES)("1.6.1 $name føres videre som advarsel", ({ input, expected }) => {
    expectFindings(input, expected);
  });

  it("1.6.1 alle ni punktadvarslene er dekket av en sak", () => {
    const covered = NINE_WARNING_CASES.map((c) => c.name).sort();
    const expected = PUBLISH_WARNING_CODES.filter(
      (code) => code !== "ai_suggestion_pending" && code !== "hole_reading_missing",
    ).sort();
    expect(covered).toEqual(expected);
  });

  it.each(AI_CASES)("$name", ({ input, expected }) => {
    expectFindings(input, expected);
  });

  it("1.6.3 ingen advarselskode gir noen gang severity = blocker, og alle sperrekoder er sperrer", () => {
    const warningCodes: readonly string[] = PUBLISH_WARNING_CODES;
    const blockerCodes: readonly string[] = PUBLISH_BLOCKER_CODES;
    for (const c of ALL_CASES) {
      for (const f of computePublishCheck(c.input)) {
        if (warningCodes.includes(f.checkCode)) expect(f.severity, c.name).toBe("warning");
        if (blockerCodes.includes(f.checkCode)) expect(f.severity, c.name).toBe("blocker");
      }
    }
  });

  it("1.6.4 alle funn har source = 'rule' (KI er ikke med i sjekken)", () => {
    for (const c of ALL_CASES) {
      for (const f of computePublishCheck(c.input)) expect(f.source, c.name).toBe("rule");
    }
  });
});

// --- 1.7 Generelt -------------------------------------------------------------------------------

/** Rapport med funn i to bad og flere punkter, til sorteringstestene. */
function messyInput(): PublishCheckInput {
  return {
    hasInspectionDate: false,
    pendingAiSuggestions: [{ aiUsageId: "ai-9", roomId: BATH_2, ...FLOOR, deviationId: null }],
    rooms: [
      {
        ...room({ holeDrilling: "unanswered", holeReadingMissing: false }),
        checkpoints: [
          cp(MEMBRANE, 1, {
            tgDirect: null,
            deviations: [
              dev({ id: "dev-b", causeText: "" }),
              tg3({ id: "dev-a", costType: "none", measureCount: 0 }),
            ],
          }),
          cp(ADJACENT, 2, { tgDirect: "IU", tgiu: fullTgiu({ reason: null }) }),
          cp(FLOOR, 3, { tgDirect: null }),
        ],
      },
      {
        ...room({ roomId: BATH_2, position: 2, holeDrilling: "not_done_no_reason" }),
        checkpoints: [
          cp(MEMBRANE, 1, { deviations: [dev({ id: "dev-c", tg: null, outcomeTg: "choose" })] }),
          cp(FLOOR, 3, { tgDirect: null, deviations: [hms({ id: "dev-d" })] }),
        ],
      },
    ],
  };
}

function reversed(input: PublishCheckInput): PublishCheckInput {
  return {
    ...input,
    pendingAiSuggestions: [...input.pendingAiSuggestions].reverse(),
    rooms: [...input.rooms].reverse().map((r) => ({
      ...r,
      checkpoints: [...r.checkpoints].reverse().map((c) => ({
        ...c,
        state: { ...c.state, deviations: [...c.state.deviations].reverse() },
      })),
    })),
  };
}

/** Fast stokking (ingen tilfeldighet i testen). */
function shuffled<T>(items: readonly T[]): T[] {
  if (items.length < 2) return [...items];
  return [...items.slice(1), items[0] as T];
}

function stirred(input: PublishCheckInput): PublishCheckInput {
  return {
    ...input,
    rooms: shuffled(input.rooms).map((r) => ({
      ...r,
      checkpoints: shuffled(r.checkpoints).map((c) => ({
        ...c,
        state: { ...c.state, deviations: shuffled(c.state.deviations) },
      })),
    })),
  };
}

describe("1.7 generelt", () => {
  it("1.7.1 rekkefølgen er rapport → rom → punktets plass → kode → mål", () => {
    expectFindings(messyInput(), [
      blocker("inspection_date_missing", target()),
      blocker("wet_or_below_ground_missing_hole", roomTarget(["hole_drilling"])),
      blocker("tg2_tg3_missing_cause_or_consequence", membraneDev("dev-b", ["cause_text"])),
      blocker("tg3_missing_cost", membraneDev("dev-a")),
      warning("tg2_tg3_missing_measure", membraneDev("dev-a", ["measure"])),
      blocker("mandatory_without_tg", at(ADJACENT, { missing: ["reason"] })),
      warning("tgiu_details_missing", at(ADJACENT, { missing: ["reason"] })),
      blocker("mandatory_without_tg", at(FLOOR, { missing: ["tg"] })),
      blocker("wet_or_below_ground_missing_hole", roomTarget(["hole_drilling_reason"], BATH_2)),
      blocker(
        "mandatory_without_tg",
        at(MEMBRANE, { deviationId: "dev-c", missing: ["tg"] }, BATH_2),
      ),
      blocker("mandatory_without_tg", at(FLOOR, { missing: ["tg"] }, BATH_2)),
      warning("ai_suggestion_pending", at(FLOOR, { aiUsageId: "ai-9" }, BATH_2)),
    ]);
  });

  it("1.7.1 (P2) samme inndata i omvendt og stokket rekkefølge gir identisk utdata", () => {
    const expected = computePublishCheck(messyInput());
    expect(computePublishCheck(reversed(messyInput()))).toEqual(expected);
    expect(computePublishCheck(stirred(messyInput()))).toEqual(expected);
    expect(computePublishCheck(stirred(reversed(messyInput())))).toEqual(expected);
  });

  it("1.7.1 rom sorteres etter plass, ikke etter id", () => {
    const input = buildPublishCheckInput({
      rooms: [
        room({ roomId: "room-z", position: 1, holeDrilling: "unanswered" }),
        room({ roomId: "room-a", position: 2, holeDrilling: "unanswered" }),
      ],
    });
    expect(computePublishCheck(input).map((f) => f.target.roomId)).toEqual(["room-z", "room-a"]);
  });

  it("1.7.1 kallet endrer ikke inndata", () => {
    const input = messyInput();
    const before = JSON.stringify(input);
    computePublishCheck(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("1.7.2 (P3) rom, punkter og avvik som ikke sendes inn (slettet), gir ingen funn", () => {
    const withDeleted = messyInput();
    const withoutBath2: PublishCheckInput = {
      ...withDeleted,
      pendingAiSuggestions: [],
      rooms: withDeleted.rooms.filter((r) => r.roomId !== BATH_2),
    };
    const roomIds = computePublishCheck(withoutBath2).map((f) => f.target.roomId);
    expect(roomIds).not.toContain(BATH_2);
  });

  it("1.7.3 alle koder i utdata finnes i PUBLISH_CHECK_CODES, og alle sperrekoder i PUBLISH_BLOCKER_CODES", () => {
    const all: readonly string[] = PUBLISH_CHECK_CODES;
    const blockers: readonly string[] = PUBLISH_BLOCKER_CODES;
    for (const c of [...ALL_CASES, { name: "messy", input: messyInput(), expected: [] }]) {
      for (const f of computePublishCheck(c.input)) {
        expect(all, c.name).toContain(f.checkCode);
        if (f.severity === "blocker") expect(blockers, c.name).toContain(f.checkCode);
        for (const part of f.target.missing) {
          expect(PUBLISH_CHECK_MISSING_PARTS as readonly string[], c.name).toContain(part);
        }
      }
    }
  });

  it.each(PUBLISH_CHECK_CODES)("1.7.3 koden %s har tekst", (code) => {
    const text = publishFindingText({ checkCode: code, target: at(MEMBRANE) });
    expect(text.trim().length).toBeGreaterThan(5);
    expect(text).not.toMatch(/[{}]/);
    expect(text).not.toContain(code);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("null");
  });

  it.each(PUBLISH_CHECK_MISSING_PARTS)("1.7.3 missing-delen %s har tekst", (part) => {
    expect(PUBLISH_CHECK_MISSING_PART_LABELS[part]?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it.each(PUBLISH_OVERRIDE_REASON_CODES)("1.7.3 grunnen %s har tekst", (code) => {
    expect(PUBLISH_OVERRIDE_REASON_LABELS[code]?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it("1.7.4 teksten lages fra koden for alle funn i sakene, uten { eller }", () => {
    for (const c of [...ALL_CASES, { name: "messy", input: messyInput(), expected: [] }]) {
      for (const f of computePublishCheck(c.input)) {
        const text = publishFindingText(f);
        expect(text, c.name).not.toMatch(/[{}]/);
        expect(text.trim().length, c.name).toBeGreaterThan(0);
      }
    }
  });

  it("1.7.4 ulike missing gir ulik tekst for årsak og konsekvens og for hulltaking", () => {
    const causeTexts = (["cause_criterion", "cause_text", "consequence_text"] as const).map(
      (part) =>
        publishFindingText({
          checkCode: "tg2_tg3_missing_cause_or_consequence",
          target: membraneDev("dev-1", [part]),
        }),
    );
    expect(new Set(causeTexts).size).toBe(3);
    const holeTexts = (
      ["hole_drilling", "hole_drilling_reason", "hole_drilling_reason_note"] as const
    ).map((part) =>
      publishFindingText({
        checkCode: "wet_or_below_ground_missing_hole",
        target: roomTarget([part]),
      }),
    );
    expect(new Set(holeTexts).size).toBe(3);
  });
});

// --- 2.1 Fingeravtrykk (P6) --------------------------------------------------------------------

describe("2.1 canonicalPublishCheck (P6)", () => {
  const findings = () => computePublishCheck(messyInput());

  it("er lik for samme funn i annen rekkefølge", () => {
    const list = findings();
    expect(canonicalPublishCheck([...list].reverse())).toBe(canonicalPublishCheck(list));
    expect(canonicalPublishCheck(shuffled(list))).toBe(canonicalPublishCheck(list));
  });

  it("er lik uansett nøkkelrekkefølge i målet", () => {
    const list = findings();
    const rekeyed = list.map((f) => ({
      target: {
        missing: f.target.missing,
        aiUsageId: f.target.aiUsageId,
        ruleKey: f.target.ruleKey,
        deviationId: f.target.deviationId,
        checkpointKey: f.target.checkpointKey,
        checkpointId: f.target.checkpointId,
        roomId: f.target.roomId,
      },
      source: f.source,
      severity: f.severity,
      checkCode: f.checkCode,
    }));
    expect(canonicalPublishCheck(rekeyed)).toBe(canonicalPublishCheck(list));
  });

  it("tar ikke med overstyringer (kladder påvirker ikke fingeravtrykket)", () => {
    const list = findings();
    const withExtra = list.map((f) => ({
      ...f,
      override: { reasonCode: "other", text: "Oppdiktet begrunnelse her." },
    })) as unknown as PublishCheckFinding[];
    expect(canonicalPublishCheck(withExtra)).toBe(canonicalPublishCheck(list));
  });

  it("endres når et funn kommer til", () => {
    const list = findings();
    const added = [...list, { ...list[0]!, target: { ...list[0]!.target, roomId: "room-new" } }];
    expect(canonicalPublishCheck(added)).not.toBe(canonicalPublishCheck(list));
  });

  it("endres når et funn faller bort", () => {
    const list = findings();
    expect(canonicalPublishCheck(list.slice(1))).not.toBe(canonicalPublishCheck(list));
  });

  it("endres når målet endres", () => {
    const list = findings();
    const moved = list.map((f, i) =>
      i === 2 ? { ...f, target: { ...f.target, deviationId: "dev-other" } } : f,
    );
    expect(canonicalPublishCheck(moved)).not.toBe(canonicalPublishCheck(list));
  });

  it("endres når missing endres", () => {
    const list = findings();
    const changed = list.map((f, i) =>
      i === 1 ? { ...f, target: { ...f.target, missing: ["hole_drilling_reason" as const] } } : f,
    );
    expect(canonicalPublishCheck(changed)).not.toBe(canonicalPublishCheck(list));
  });

  it("tom liste gir en fast tekst", () => {
    expect(canonicalPublishCheck([])).toBe(canonicalPublishCheck([]));
    expect(canonicalPublishCheck([])).not.toBe(canonicalPublishCheck(findings()));
  });
});

describe("2.2 canonicalJson (P7, ren del)", () => {
  it("er lik uansett nøkkelrekkefølge, også nestet", () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } };
    const b = { a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("bevarer rekkefølgen i lister og skiller på verdier", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson({ tg: "2" })).not.toBe(canonicalJson({ tg: "3" }));
  });

  it("tar ikke med undefined, og er gyldig JSON uten mellomrom", () => {
    const text = canonicalJson({ a: 1, b: undefined, c: "x y" });
    expect(JSON.parse(text)).toEqual({ a: 1, c: "x y" });
    expect(text).toBe('{"a":1,"c":"x y"}');
  });
});

// --- Nøkkel, tellemerke, kladder (F3) ------------------------------------------------------------

describe("funnøkkel, tellemerke og kladder", () => {
  it("publishFindingKey er lik for samme kode og mål, og ulik ellers", () => {
    const [a, b] = computePublishCheck(messyInput());
    expect(publishFindingKey(a!)).toBe(
      publishFindingKey({ checkCode: a!.checkCode, target: { ...a!.target } }),
    );
    expect(publishFindingKey(a!)).not.toBe(publishFindingKey(b!));
  });

  it("alle funn i en liste har ulik nøkkel", () => {
    const list = computePublishCheck(messyInput());
    expect(new Set(list.map(publishFindingKey)).size).toBe(list.length);
  });

  it("summarizePublishCheck teller sperrer og advarsler", () => {
    const list = computePublishCheck(messyInput());
    expect(summarizePublishCheck(list)).toEqual({
      blockers: list.filter((f) => f.severity === "blocker").length,
      warnings: list.filter((f) => f.severity === "warning").length,
    });
    expect(summarizePublishCheck([])).toEqual({ blockers: 0, warnings: 0 });
  });

  it("remainingBlockers: gyldig kladd fjerner sperren; kladd uten grunn, med for kort «Annet» eller på advarsel teller ikke", () => {
    const list = computePublishCheck(messyInput());
    const blockers = list.filter((f) => f.severity === "blocker");
    const warn = list.find((f) => f.severity === "warning")!;
    const [first, second, third] = blockers;
    const remaining = remainingBlockers(list, [
      { findingKey: publishFindingKey(first!), reasonCode: "no_access_or_refused", text: null },
      { findingKey: publishFindingKey(second!), reasonCode: null, text: null },
      { findingKey: publishFindingKey(third!), reasonCode: "other", text: "kort" },
      { findingKey: publishFindingKey(warn), reasonCode: "described_elsewhere", text: null },
      { findingKey: "finnes-ikke", reasonCode: "described_elsewhere", text: null },
    ]);
    expect(remaining).toEqual(blockers.slice(1));
  });

  it("carryOverrideDrafts beholder kladder for samme kode og mål, og merker nye sperrer", () => {
    const previous = computePublishCheck(buildPublishCheckInput({ hasInspectionDate: false }));
    const next = computePublishCheck(
      buildPublishCheckInput({
        hasInspectionDate: false,
        rooms: [room({ holeDrilling: "unanswered" })],
      }),
    );
    const kept = {
      findingKey: publishFindingKey(previous[0]!),
      reasonCode: "other" as const,
      text: "Påbegynt tekst som ikke er ferdig",
    };
    const gone = { findingKey: "borte", reasonCode: "described_elsewhere" as const, text: null };
    const result = carryOverrideDrafts(previous, next, [kept, gone]);
    expect(result.drafts).toEqual([kept]);
    expect(result.added.map((f) => f.checkCode)).toEqual(["wet_or_below_ground_missing_hole"]);
  });
});

// --- 2.3 Begrunnelsen (P8) ---------------------------------------------------------------------

/** Oppdiktet fødselsnummer med gyldige kontrollsifre (ikke en ekte person). */
const FAKE_NATIONAL_ID = "01010150013";

describe("2.3 checkPublishOverrideReason (P8)", () => {
  it.each([
    { name: "uten kode", reasonCode: null, text: null, expected: "reason_required" },
    {
      name: "uten kode men med tekst",
      reasonCode: null,
      text: "Lang nok tekst her.",
      expected: "reason_required",
    },
    { name: "«Annet» uten tekst", reasonCode: "other", text: null, expected: "text_required" },
    {
      name: "«Annet» med blank tekst",
      reasonCode: "other",
      text: "   \n ",
      expected: "text_required",
    },
    { name: "«Annet» med «.»", reasonCode: "other", text: ".", expected: "text_too_short" },
    {
      name: "«Annet» med 9 tegn",
      reasonCode: "other",
      text: "123456789",
      expected: "text_too_short",
    },
    {
      name: "«Annet» med 9 tegn og mellomrom rundt",
      reasonCode: "other",
      text: "   123456789   ",
      expected: "text_too_short",
    },
    { name: "«Annet» med 10 tegn", reasonCode: "other", text: "1234567890", expected: "ok" },
    {
      name: "fast grunn uten tekst",
      reasonCode: "no_access_or_refused",
      text: null,
      expected: "ok",
    },
    {
      name: "fast grunn med tom tekst",
      reasonCode: "described_elsewhere",
      text: "",
      expected: "ok",
    },
    {
      name: "fast grunn med kort tekst",
      reasonCode: "not_applicable_to_room",
      text: "Ok.",
      expected: "ok",
    },
    { name: "1000 tegn", reasonCode: "other", text: "a".repeat(1000), expected: "ok" },
    { name: "1001 tegn", reasonCode: "other", text: "a".repeat(1001), expected: "text_too_long" },
    {
      name: "1001 tegn på fast grunn",
      reasonCode: "described_elsewhere",
      text: "a".repeat(1001),
      expected: "text_too_long",
    },
    {
      name: "fødselsnummer",
      reasonCode: "other",
      text: `Eier ${FAKE_NATIONAL_ID} nektet.`,
      expected: "national_id",
    },
    {
      name: "fødselsnummer med mellomrom",
      reasonCode: "other",
      text: "Eier 010101 50013 nektet.",
      expected: "national_id",
    },
    {
      name: "fødselsnummer på fast grunn",
      reasonCode: "no_access_or_refused",
      text: FAKE_NATIONAL_ID,
      expected: "national_id",
    },
  ] as const)("$name → $expected", ({ reasonCode, text, expected }) => {
    expect(checkPublishOverrideReason({ reasonCode, text })).toBe(expected);
  });
});

// --- 2.5 Kodene er like i logic og skjema -------------------------------------------------------

describe("2.5 kodene", () => {
  it("PUBLISH_CHECK_CODES, sperre- og advarselskodene og grunnene er like i logic/codes.ts og skjemaet", () => {
    expect([...PUBLISH_CHECK_CODES]).toEqual([...SCHEMA_CHECK_CODES]);
    expect([...PUBLISH_BLOCKER_CODES]).toEqual([...SCHEMA_BLOCKER_CODES]);
    expect([...PUBLISH_WARNING_CODES]).toEqual([...SCHEMA_WARNING_CODES]);
    expect([...PUBLISH_OVERRIDE_REASON_CODES]).toEqual([...SCHEMA_OVERRIDE_REASON_CODES]);
  });

  it("alle sju sperrekodene fra domenemodellen 4.7 står i listen", () => {
    expect([...PUBLISH_BLOCKER_CODES].sort()).toEqual(
      [
        "mandatory_without_tg",
        "tg2_tg3_missing_cause_or_consequence",
        "tg3_missing_cost",
        "wet_or_below_ground_missing_hole",
        "bra_missing",
        "electrical_missing",
        "inspection_date_missing",
      ].sort(),
    );
  });

  it("grunnene er de fire faste, i visningsrekkefølge", () => {
    expect([...PUBLISH_OVERRIDE_REASON_CODES]).toEqual([
      "no_access_or_refused",
      "not_applicable_to_room",
      "described_elsewhere",
      "other",
    ]);
  });

  it("checkpoint_done_without_tg og deviation_tg_not_chosen er ikke koder i sjekken", () => {
    expect(PUBLISH_CHECK_CODES as readonly string[]).not.toContain("checkpoint_done_without_tg");
    expect(PUBLISH_CHECK_CODES as readonly string[]).not.toContain("deviation_tg_not_chosen");
  });
});
