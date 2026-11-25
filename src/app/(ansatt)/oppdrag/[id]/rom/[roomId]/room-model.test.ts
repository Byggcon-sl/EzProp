import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TG_LONG_LABELS,
  TG_SHORT_LABELS,
  warningText,
  type CheckpointWarning,
} from "@/core/reports/logic";
import { TG_BADGE_LONG, TG_BADGE_SHORT } from "@/shared/ui/tg-badge";
import type {
  CheckpointView,
  FindOutcomesResult,
  OutcomeMatchHit,
  SuggestionView,
  TgiuDetailsView,
} from "@/core/reports/types";
import { containsNationalId } from "@/shared/validation/free-text";
import {
  EMPTY_ROOM_OUTCOME_NOTE,
  nextOutcomeRequestId,
  OUTCOME_MATCH_IDLE,
  outcomeMatchReducer,
  outcomeMatchSideEffect,
  outcomeMatchView,
  roomOutcomeNoteReducer,
  type OutcomeMatchState,
  type OutcomeMatchViewInput,
  type RoomOutcomeNote,
} from "./outcome-match-model";
import { OUTCOME_MATCH_TEXTS } from "./room-messages";
import type { OutcomeDoc } from "@/core/templates";
import { wetRoomTemplate } from "@/db/seed/templates/wet-room";
import {
  characterCountText,
  decisionStates,
  deviationCauseChoiceId,
  deviationCostChoiceId,
  domId,
  fixTargetId,
  indexDocument,
  initialCheckpointKey,
  isOpenSuggestion,
  neighbours,
  nextUndoneCheckpoint,
  outcomeName,
  outcomeTgLabel,
  outcomeTgOf,
  parseNumberInput,
  REPORT_TEXT_LIMITS,
  reportTextValidator,
  suggestionId,
  suggestionTgOf,
  T0059_FIX,
  TEXT_MESSAGES,
  TG_DIRECT_CHOICE_ID,
  tgiuFieldKey,
  visibleTgiuFields,
  warningsWithFix,
} from "./room-model";

/*
 * Rene hjelpere for skjermen for badet (design avsnitt 6–17). Bruker badmalen fra seed som
 * maldokument. Testdata er oppdiktet. Støtter hovedmål: de ansatte og færre reklamasjoner.
 */

const doc = indexDocument(wetRoomTemplate);
const ORDER = doc.checkpoints.map((c) => c.key);

function warning(overrides: Partial<CheckpointWarning>): CheckpointWarning {
  return {
    code: "tgiu_details_missing",
    deviationId: null,
    ruleKey: null,
    missing: [],
    ...overrides,
  };
}

describe("indexDocument", () => {
  it("gir de åtte punktene i malens rekkefølge", () => {
    expect(ORDER).toEqual([
      "wet_room.general",
      "wet_room.documentation",
      "wet_room.walls_ceiling",
      "wet_room.floor",
      "wet_room.membrane_drain",
      "wet_room.fixtures",
      "wet_room.ventilation",
      "wet_room.adjacent",
    ]);
  });

  it("finner feltene, valgene og etikettene per punkt", () => {
    expect(doc.elements("wet_room.membrane_drain").map((e) => e.key)).toContain(
      "wet_room.membrane_year",
    );
    expect(doc.labels.optionLabel("wet_room.build_year_source", "unknown")).toBe("Ukjent");
    expect(doc.labels.elementLabel("wet_room.membrane_year")).toBe(
      "Årstall for det vanntette sjiktet",
    );
  });

  it("valget for T-0059 finnes i malen", () => {
    expect(doc.options(T0059_FIX.elementKey).map((o) => o.key)).toContain(T0059_FIX.optionKey);
  });
});

describe("utfall", () => {
  it("navnet viser aldri flettefelt som {…}", () => {
    for (const outcome of wetRoomTemplate.outcomes) {
      const name = outcomeName(outcome);
      expect(name).not.toMatch(/[{}]/);
    }
    expect(outcomeName({ deviation_text: "Fra {årstall}." })).toBe("Fra ….");
  });

  it("TG for utfallet", () => {
    expect(outcomeTgOf("tg2")).toBe(2);
    expect(outcomeTgOf("tg3")).toBe(3);
    expect(outcomeTgOf("choose_tg2_tg3")).toBe("choose");
    expect(outcomeTgOf("hms")).toBeNull();
  });
});

describe("punktene", () => {
  const view = (key: string, done: boolean) => ({ checkpointKey: key, done });

  it("neste punkt som ikke er ferdig, rundt, og aldri det samme", () => {
    const all = ORDER.map((k) => view(k, false));
    expect(nextUndoneCheckpoint(ORDER, all, ORDER[0]!)).toBe(ORDER[1]);
    const someDone = ORDER.map((k, i) => view(k, i === 1 || i === 2));
    expect(nextUndoneCheckpoint(ORDER, someDone, ORDER[0]!)).toBe(ORDER[3]);
    expect(nextUndoneCheckpoint(ORDER, all, ORDER[7]!)).toBe(ORDER[0]);
    const allDone = ORDER.map((k) => view(k, true));
    expect(nextUndoneCheckpoint(ORDER, allDone, ORDER[3]!)).toBeNull();
  });

  it("forrige og neste går ikke rundt", () => {
    expect(neighbours(ORDER, ORDER[0]!)).toEqual({ previous: null, next: ORDER[1] });
    expect(neighbours(ORDER, ORDER[7]!)).toEqual({ previous: ORDER[6], next: null });
  });

  it("ukjent punkt i adressen gir første punkt", () => {
    expect(initialCheckpointKey(ORDER, "wet_room.floor")).toBe("wet_room.floor");
    expect(initialCheckpointKey(ORDER, "<script>")).toBe(ORDER[0]);
    expect(initialCheckpointKey(ORDER, null)).toBe(ORDER[0]);
  });
});

describe("«Rett nå» flytter fokus til riktig felt", () => {
  const context = { checkpointKey: "wet_room.adjacent", firstMeasureId: () => "m1" };

  it.each([
    [{ kind: "focus_tg_choice" } as const, TG_DIRECT_CHOICE_ID],
    [
      { kind: "scroll_to_suggestion", ruleKey: "wet_room.x", deviationId: null } as const,
      suggestionId("wet_room.x"),
    ],
    [
      { kind: "focus_field", deviationId: "d1", field: "cost" } as const,
      deviationCostChoiceId("d1"),
    ],
    [
      { kind: "focus_field", deviationId: "d1", field: "cause_criterion" } as const,
      deviationCauseChoiceId("d1"),
    ],
    [
      { kind: "focus_field", deviationId: "d1", field: "measure" } as const,
      domId("measure:m1:text"),
    ],
    [
      { kind: "focus_field", deviationId: "d1", field: "consequence_text" } as const,
      domId("deviation:d1:consequence_text"),
    ],
    [
      { kind: "focus_field", deviationId: null, field: "reason" } as const,
      domId(tgiuFieldKey("wet_room.adjacent", "reason")),
    ],
  ])("%o", (action, expected) => {
    expect(fixTargetId(action, context)).toBe(expected);
  });

  it("uten tiltak går fokus til «+ Tiltak»", () => {
    expect(
      fixTargetId(
        { kind: "focus_field", deviationId: "d1", field: "measure" },
        { checkpointKey: "x", firstMeasureId: () => null },
      ),
    ).toBe("deviation-d1-add-measure");
  });
});

describe("TGIU-feltene etter grunn", () => {
  const empty: TgiuDetailsView = {
    id: "t1",
    reason: null,
    ownerInformed: null,
    ownerInformedAt: null,
    alternativeCheckMethod: null,
    alternativeCheckResult: null,
    riskAssessment: null,
    constructionVulnerable: null,
    howToExamine: null,
    rowVersion: 1,
  };

  it("de tre faste feltene vises alltid, ingen falske felt", () => {
    expect([...visibleTgiuFields(empty, [])].sort()).toEqual([
      "how_to_examine",
      "reason",
      "risk_assessment",
    ]);
  });

  it("feltene advarselen sier mangler, vises (tilliggende konstruksjoner og eier nektet)", () => {
    const visible = visibleTgiuFields(empty, [
      warning({
        missing: ["alternative_check_method", "construction_vulnerable", "owner_informed"],
      }),
    ]);
    expect(visible).toEqual(
      new Set([
        "reason",
        "risk_assessment",
        "how_to_examine",
        "alternative_check_method",
        "alternative_check_result",
        "construction_vulnerable",
        "owner_informed",
      ]),
    );
  });

  it("felt med verdi blir stående når advarselen er borte", () => {
    const visible = visibleTgiuFields(
      { ...empty, ownerInformed: true, constructionVulnerable: "no" },
      [],
    );
    expect(visible.has("owner_informed")).toBe(true);
    expect(visible.has("construction_vulnerable")).toBe(true);
  });
});

describe("fritekst", () => {
  const check = reportTextValidator(REPORT_TEXT_LIMITS.long);

  it("elleve sifre gir feil, også med mellomrom; ti godtas", () => {
    expect(check("Eier 01019912345 sa")).toBe(TEXT_MESSAGES.nationalId);
    expect(check("Eier 010199 12345 sa")).toBe(TEXT_MESSAGES.nationalId);
    expect(check("Ring 4012345678")).toBeNull();
  });

  it.each(Object.values(REPORT_TEXT_LIMITS))("for lang tekst gir feil (grense %i)", (max) => {
    const validate = reportTextValidator(max);
    expect(validate("a".repeat(max + 1))).toBe(TEXT_MESSAGES.tooLong(max));
    expect(validate("a".repeat(max))).toBeNull();
  });

  it("teller tegn fra 80 % av grensen", () => {
    expect(characterCountText(1599, 2000)).toBeNull();
    expect(characterCountText(1640, 2000)?.replace(/\s/g, " ")).toBe("1 640 av 2 000 tegn");
  });
});

describe("tall", () => {
  it.each([
    ["14,9", 14.9],
    ["14.9", 14.9],
    ["1990", 1990],
    ["-3,5", -3.5],
    ["", null],
  ] as const)("%s gir %s", (raw, value) => {
    expect(parseNumberInput(raw)).toEqual({ ok: true, value });
  });

  it.each(["abc", "14,9,1", "1e3"])("%s avvises", (raw) => {
    expect(parseNumberInput(raw)).toEqual({ ok: false });
  });
});

describe("beslutninger til «Rett nå»", () => {
  it("tar med regel, beslutning og avvik", () => {
    const suggestion = {
      ruleKey: "wet_room.membrane_before_2000",
      checkpointKey: "wet_room.membrane_drain",
      state: "not_triggered",
      suggestion: null,
      code: null,
      reasons: [],
      sourceRef: null,
      stale: true,
      latestDecision: {
        id: "b1",
        decision: "accepted",
        chosenTg: null,
        chosenOutcomeKey: null,
        overrideReasonCode: null,
        overrideReason: null,
        deviationId: "d1",
        decidedAt: "2026-11-16T10:00:00Z",
        suggestionTg: 2,
      },
    } satisfies SuggestionView;
    expect(decisionStates([suggestion])).toMatchObject([
      { ruleKey: "wet_room.membrane_before_2000", decision: "accepted", deviationId: "d1" },
    ]);
  });

  it("forslag uten beslutning er ikke med", () => {
    expect(decisionStates([])).toEqual([]);
  });
});

describe("TG-merket", () => {
  it("har de samme tekstene som oversettelsen av koder i rapporten", () => {
    expect(TG_BADGE_SHORT).toEqual(TG_SHORT_LABELS);
    expect(TG_BADGE_LONG).toEqual(TG_LONG_LABELS);
  });
});

// --- «Å se over» med åpne forslag (A492, T-0115, FA-L23) ---------------------------------------

const CP = "cp.membrane";
const OUTCOME_KINDS: Record<string, OutcomeDoc["kind"]> = {
  "out.tg3": "tg3",
  "out.tg2": "tg2",
  "out.choose": "choose_tg2_tg3",
  "out.hms": "hms",
};
const fakeDoc = {
  outcome: (_checkpointKey: string, _questionKey: string, outcomeKey: string) =>
    OUTCOME_KINDS[outcomeKey] ? ({ kind: OUTCOME_KINDS[outcomeKey] } as OutcomeDoc) : undefined,
};

function openOutcome(ruleKey: string, outcomeKey: string): SuggestionView {
  return {
    ruleKey,
    checkpointKey: CP,
    state: "triggered",
    suggestion: {
      kind: "outcome",
      checkpoint_key: CP,
      question_key: "dq.membrane",
      outcome_key: outcomeKey,
    },
    code: null,
    reasons: [],
    sourceRef: null,
    latestDecision: null,
    stale: false,
  };
}

function checkpointWith(warnings: CheckpointWarning[]): CheckpointView {
  return {
    checkpointKey: CP,
    resultId: "r1",
    tgDirect: null,
    tg: null,
    status: "done",
    descriptionText: null,
    done: true,
    rowVersion: 1,
    deviations: [],
    tgiuDetails: null,
    warnings,
  } as unknown as CheckpointView;
}

describe("forslagets TG", () => {
  it("utfallets TG fra malen, TG0, TGIU, og null for HMS og ukjent utfall", () => {
    expect(suggestionTgOf(openOutcome("r", "out.tg3"), fakeDoc)).toBe(3);
    expect(suggestionTgOf(openOutcome("r", "out.tg2"), fakeDoc)).toBe(2);
    expect(suggestionTgOf(openOutcome("r", "out.choose"), fakeDoc)).toBe("choose");
    expect(suggestionTgOf(openOutcome("r", "out.hms"), fakeDoc)).toBeNull();
    expect(suggestionTgOf(openOutcome("r", "out.finnes.ikke"), fakeDoc)).toBeNull();
    expect(suggestionTgOf({ suggestion: { kind: "tg0", checkpoint_key: CP } }, fakeDoc)).toBe("0");
    expect(suggestionTgOf({ suggestion: { kind: "tgiu", checkpoint_key: CP } }, fakeDoc)).toBe(
      "IU",
    );
  });
});

describe("åpent forslag", () => {
  it("T-0117 utløst forslag uten gjeldende beslutning er åpent; avgjort, foreldet eller ikke utløst er ikke", () => {
    const open = openOutcome("r.open", "out.tg3");
    expect(isOpenSuggestion([open], "r.open", CP)).toBe(true);
    expect(isOpenSuggestion([open], "r.open", "cp.annet")).toBe(false);
    expect(isOpenSuggestion([{ ...open, stale: true }], "r.open", CP)).toBe(false);
    expect(isOpenSuggestion([{ ...open, state: "not_triggered" }], "r.open", CP)).toBe(false);
    expect(
      isOpenSuggestion(
        [
          {
            ...open,
            latestDecision: {
              id: "b1",
              decision: "accepted",
              chosenTg: "3",
              chosenOutcomeKey: "out.tg3",
              overrideReasonCode: null,
              overrideReason: null,
              deviationId: "d1",
              decidedAt: "2026-11-23T09:42:00Z",
              suggestionTg: 3,
            },
          },
        ],
        "r.open",
        CP,
      ),
    ).toBe(false);
  });
});

describe("«Å se over» med åpne forslag", () => {
  const open = (ruleKey: string): CheckpointWarning =>
    warning({ code: "open_suggestion_on_done_checkpoint", ruleKey });

  it("FA-L23 TG3-forslag står øverst, så «velg TG2 eller TG3» og TG2; andre advarsler etter", () => {
    const suggestions = [
      openOutcome("r.tg2", "out.tg2"),
      openOutcome("r.tg3", "out.tg3"),
      openOutcome("r.choose", "out.choose"),
    ];
    const items = warningsWithFix(
      checkpointWith([
        warning({ code: "tg3_missing_cost", deviationId: "d9" }),
        open("r.tg2"),
        open("r.choose"),
        open("r.tg3"),
      ]),
      suggestions,
      fakeDoc,
    );
    expect(items.map((i) => i.warning.ruleKey ?? i.warning.code)).toEqual([
      "r.tg3",
      "r.choose",
      "r.tg2",
      "tg3_missing_cost",
    ]);
  });

  it("A492 åpent forslag får forslagets TG i teksten, forslaget til knappene og «Gå til forslaget»", () => {
    const suggestion = openOutcome("r.tg3", "out.tg3");
    const [item] = warningsWithFix(checkpointWith([open("r.tg3")]), [suggestion], fakeDoc);
    expect(item!.context).toEqual({ suggestionTg: 3 });
    expect(warningText(item!.warning, item!.context)).toBe(
      "Punktet er ferdig, men forslaget om TG3 er ikke avgjort.",
    );
    expect(item!.openSuggestion).toBe(suggestion);
    expect(item!.fix).toEqual({
      kind: "scroll_to_suggestion",
      ruleKey: "r.tg3",
      deviationId: null,
    });
  });

  it("T-0115 foreldet forslag uten avvik får valgt TG i teksten fra beslutningen", () => {
    const suggestion: SuggestionView = {
      ruleKey: "r.tg0",
      checkpointKey: CP,
      state: "not_triggered",
      suggestion: null,
      code: null,
      reasons: [],
      sourceRef: null,
      stale: true,
      latestDecision: {
        id: "b2",
        decision: "accepted",
        chosenTg: "0",
        chosenOutcomeKey: null,
        overrideReasonCode: null,
        overrideReason: null,
        deviationId: null,
        decidedAt: "2026-11-23T09:42:00Z",
        suggestionTg: "0",
      },
    };
    const [item] = warningsWithFix(
      checkpointWith([warning({ code: "suggestion_no_longer_applies", ruleKey: "r.tg0" })]),
      [suggestion],
      fakeDoc,
    );
    expect(item!.context).toEqual({ chosenTg: "0" });
    expect(item!.openSuggestion).toBeNull();
    expect(warningText(item!.warning, item!.context)).toBe(
      "Forslaget gjelder ikke lenger. Punktet har fortsatt TG0 fra forslaget. Sjekk at graden stemmer.",
    );
  });

  it("foreldet forslag med avvik beholder teksten som før", () => {
    const [item] = warningsWithFix(
      checkpointWith([
        warning({ code: "suggestion_no_longer_applies", ruleKey: "r.x", deviationId: "d1" }),
      ]),
      [],
      fakeDoc,
    );
    expect(item!.context).toEqual({});
    expect(warningText(item!.warning, item!.context)).toBe(
      "Et forslag fra reglene gjelder ikke lenger.",
    );
  });

  it("«Å se over» blir tom når alt er avgjort", () => {
    expect(warningsWithFix(checkpointWith([]), [openOutcome("r.tg3", "out.tg3")], fakeDoc)).toEqual(
      [],
    );
  });
});

// --- Skriv det du ser (testplanen avsnitt 6, S6.1–S6.6) ----------------------------------------

/*
 * Skjermlogikken i «+ Avvik» uten nettleser. Notatene er oppdiktet og uten gjetteord. Fødselsnummeret
 * er oppdiktet (elleve sifre som ikke tilhører noen).
 */

const NOTE = "sprekk i flis ved sluket, litt løs";
const OUTCOME_REF_ID = "0190a0a0-0000-7000-8000-000000000001";

function matchHit(overrides: Partial<OutcomeMatchHit> = {}): OutcomeMatchHit {
  return {
    checkpointKey: "wet_room.floor",
    checkpointName: "Gulv",
    questionKey: "q1",
    questionText: "Er det sprekker i gulvet?",
    outcomeKey: "o1",
    outcomeKind: "tg2",
    deviationText: "Sprekker i fliser eller fuger.",
    ref: { source: "template_outcome", id: OUTCOME_REF_ID },
    ...overrides,
  };
}

function viewOf(overrides: Partial<OutcomeMatchViewInput> = {}) {
  return outcomeMatchView({
    state: OUTCOME_MATCH_IDLE,
    note: NOTE,
    online: true,
    aiOff: false,
    tooManyCandidates: false,
    textHitCount: 0,
    choosing: false,
    ...overrides,
  });
}

const RANKED: OutcomeMatchState = {
  kind: "ranked",
  requestId: "r1",
  note: NOTE,
  usageId: "u1",
  hits: [matchHit(), matchHit({ checkpointKey: "wet_room.walls", checkpointName: "Vegger" })],
};

describe("outcomeMatchView: «Finn med KI»", () => {
  it("S6.1 skjult uten nett og med KI av, sperret med tomt felt eller bare mellomrom", () => {
    expect(viewOf({ online: false }).button).toBeNull();
    expect(viewOf({ online: false }).message?.text).toBe("Uten nett: bare tekstsøk.");
    expect(viewOf({ aiOff: true }).button).toBeNull();
    expect(viewOf({ aiOff: true }).message?.text).toBe("KI er av. Bruk søket.");
    for (const note of ["", "   ", "  \n"]) {
      const view = viewOf({ note });
      expect(view.state).toBe("empty");
      expect(view.button).toEqual({ label: "Finn med KI", disabled: true, busy: false });
      expect(view.message).toBeNull();
    }
    expect(viewOf().button).toEqual({ label: "Finn med KI", disabled: false, busy: false });
  });

  it("S6.1 for mange utfall skjuler knappen til rommet byttes", () => {
    const view = viewOf({ tooManyCandidates: true });
    expect(view.button).toBeNull();
    expect(view.message?.text).toBe("For mange utfall i dette rommet for KI. Bruk søket.");
    const room = roomOutcomeNoteReducer(EMPTY_ROOM_OUTCOME_NOTE, {
      type: "side_effect",
      effect: outcomeMatchSideEffect({ status: "too_many_candidates" }),
    });
    expect(room.tooManyCandidates).toBe(true);
    expect(EMPTY_ROOM_OUTCOME_NOTE.tooManyCandidates).toBe(false);
  });

  it("S6.1 venter: «Finner …», sperret og opptatt", () => {
    const view = viewOf({ state: { kind: "pending", requestId: "r1", note: NOTE } });
    expect(view.state).toBe("pending");
    expect(view.button).toEqual({ label: "Finner …", disabled: true, busy: true });
  });

  it("S6.2 Enter med null tekstsøk-treff kjører KI bare med nett og KI på", () => {
    expect(viewOf().enterRunsAi).toBe(true);
    expect(viewOf({ textHitCount: 2 }).enterRunsAi).toBe(false);
    expect(viewOf({ online: false }).enterRunsAi).toBe(false);
    expect(viewOf({ aiOff: true }).enterRunsAi).toBe(false);
    expect(viewOf({ note: "" }).enterRunsAi).toBe(false);
    expect(viewOf({ state: { kind: "pending", requestId: "r", note: NOTE } }).enterRunsAi).toBe(
      false,
    );
  });

  it("S6.3 endret tekst etter svaret merker KI-treffene som utdatert", () => {
    const fresh = viewOf({ state: RANKED });
    expect(fresh.state).toBe("ranked");
    expect(fresh.hits).toHaveLength(2);
    expect(fresh.hitsStale).toBe(false);
    expect(fresh.message?.text).toBe("2 forslag fra KI. Ingen er valgt.");
    expect(fresh.button?.label).toBe("Finn på nytt");

    const stale = viewOf({ state: RANKED, note: `${NOTE} under vasken` });
    expect(stale.state).toBe("stale");
    expect(stale.hits).toHaveLength(2);
    expect(stale.hitsStale).toBe(true);
    expect(stale.message?.text).toBe("Teksten er endret – finn på nytt");
    expect(stale.button).toEqual({ label: "Finn på nytt", disabled: false, busy: false });
    // Bare mellomrom på slutten endrer ikke teksten som ble søkt med
    expect(viewOf({ state: RANKED, note: `${NOTE}  ` }).hitsStale).toBe(false);
  });

  it("S6.3 ingen treff er valgt på forhånd: visningen har ingen valgt-markør", () => {
    const view = viewOf({ state: RANKED });
    expect(Object.keys(view)).not.toContain("selected");
    for (const hit of view.hits) expect(Object.keys(hit)).not.toContain("selected");
  });

  it("S6.4 «Nærmeste treff (uten KI)» bare når KI ikke er tilgjengelig og tekstsøket gir null treff", () => {
    expect(viewOf().showNearest).toBe(false);
    expect(viewOf({ online: false }).showNearest).toBe(true);
    expect(viewOf({ aiOff: true }).showNearest).toBe(true);
    expect(viewOf({ online: false, textHitCount: 1 }).showNearest).toBe(false);
    expect(viewOf({ online: false, note: " " }).showNearest).toBe(false);
    // KI-treff vises ikke når nettet er borte
    expect(viewOf({ online: false, state: RANKED }).hits).toEqual([]);
  });

  it("3.6, 3.7 og 3.13: ingen utfall passer, KI svarte ikke og utdatert", () => {
    const none = viewOf({ state: { kind: "no_match", note: NOTE } });
    expect(none.message?.text).toBe("Ingen utfall passer. Bruk søket eller punktlisten.");
    expect(none.message?.text).not.toMatch(/TG|ikke avvik|ingen avvik/i);
    const error = viewOf({ state: { kind: "error", requestId: "r1", note: NOTE } });
    expect(error.message).toEqual({ text: "KI svarte ikke. Bruk søket.", tone: "watch" });
    expect(error.button?.label).toBe("Prøv igjen");
    const outdated = viewOf({ state: { kind: "outdated" } });
    expect(outdated.message?.text).toBe("Forslagene er utdatert. Trykk «Finn med KI» på nytt.");
    expect(outdated.button?.label).toBe("Finn med KI");
    expect(outdated.hits).toEqual([]);
  });

  it("3.10 for langt notat: melding, rød teller med tall, knappen sperret", () => {
    const view = viewOf({ note: "a".repeat(501) });
    expect(view.state).toBe("note_too_long");
    expect(view.fieldError).toBe("Notatet er for langt for KI (høyst 500 tegn).");
    expect(view.counter).toEqual({ text: "501 av 500 tegn", over: true });
    expect(view.button?.disabled).toBe(true);
    expect(viewOf({ note: "a".repeat(500) }).button?.disabled).toBe(false);
    expect(viewOf({ note: "a".repeat(400) }).counter).toBeNull();
    expect(viewOf({ note: "a".repeat(401) }).counter).toEqual({
      text: "401 av 500 tegn",
      over: false,
    });
  });

  it("et valg som lagres sperrer knappen", () => {
    expect(viewOf({ state: RANKED, choosing: true }).button?.disabled).toBe(true);
  });
});

describe("outcomeMatchReducer: bare siste svar vises", () => {
  const ranked = (usageId: string): FindOutcomesResult => ({
    status: "ranked",
    usageId,
    hits: [matchHit()],
  });

  it("svar på et eldre søk vises aldri (overlappende søk, A555)", () => {
    let state = outcomeMatchReducer(OUTCOME_MATCH_IDLE, {
      type: "requested",
      requestId: "r1",
      note: "fukt",
    });
    state = outcomeMatchReducer(state, { type: "requested", requestId: "r2", note: NOTE });
    const afterOld = outcomeMatchReducer(state, {
      type: "responded",
      requestId: "r1",
      result: ranked("u1"),
    });
    expect(afterOld).toBe(state);
    const afterNew = outcomeMatchReducer(state, {
      type: "responded",
      requestId: "r2",
      result: ranked("u2"),
    });
    expect(afterNew).toMatchObject({ kind: "ranked", usageId: "u2", note: NOTE });
    // Et sent svar på r1 etter r2 endrer ingenting
    expect(
      outcomeMatchReducer(afterNew, { type: "responded", requestId: "r1", result: ranked("u1") }),
    ).toBe(afterNew);
  });

  it("tidsavbrudd gir «KI svarte ikke», og «Prøv igjen» bruker samme requestId", () => {
    const pending = outcomeMatchReducer(OUTCOME_MATCH_IDLE, {
      type: "requested",
      requestId: "r1",
      note: NOTE,
    });
    const error = outcomeMatchReducer(pending, { type: "timed_out", requestId: "r1" });
    expect(error).toEqual({ kind: "error", requestId: "r1", note: NOTE });
    expect(nextOutcomeRequestId(error, NOTE, () => "ny")).toBe("r1");
    expect(nextOutcomeRequestId(error, "annen tekst", () => "ny")).toBe("ny");
    expect(nextOutcomeRequestId(OUTCOME_MATCH_IDLE, NOTE, () => "ny")).toBe("ny");
    // Tidsavbrudd for et annet søk gjør ingenting
    expect(outcomeMatchReducer(pending, { type: "timed_out", requestId: "r9" })).toBe(pending);
  });

  it("nettfeil og ai_error gir feil; tom liste og no_match gir «ingen passer»", () => {
    const pending: OutcomeMatchState = { kind: "pending", requestId: "r1", note: NOTE };
    const respond = (result: FindOutcomesResult | null) =>
      outcomeMatchReducer(pending, { type: "responded", requestId: "r1", result }).kind;
    expect(respond(null)).toBe("error");
    expect(respond({ status: "ai_error" })).toBe("error");
    expect(respond({ status: "no_match", usageId: null })).toBe("no_match");
    expect(respond({ status: "ranked", usageId: "u", hits: [] })).toBe("no_match");
    expect(respond({ status: "ai_off" })).toBe("idle");
    expect(outcomeMatchSideEffect({ status: "ai_off" })).toBe("ai_off");
    expect(outcomeMatchSideEffect({ status: "no_match", usageId: null })).toBeNull();
  });
});

describe("notatet i rommet (A566)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("S6.5 notatet står når panelet lukkes, ved «Avbryt» og Escape", () => {
    const typed = roomOutcomeNoteReducer(EMPTY_ROOM_OUTCOME_NOTE, { type: "typed", note: NOTE });
    const closed = roomOutcomeNoteReducer(typed, { type: "panel_closed" });
    expect(closed.note).toBe(NOTE);
    expect(roomOutcomeNoteReducer(closed, { type: "panel_closed" }).note).toBe(NOTE);
  });

  it("S6.5 notatet tømmes når rommet forlates og ved utlogging: det lever bare i rommets minne", () => {
    // Nytt rom og ny innlogging gir ny skjerm for rommet, som starter tomt
    expect(EMPTY_ROOM_OUTCOME_NOTE.note).toBe("");
    const room = readFileSync(join(__dirname, "room-view.tsx"), "utf8");
    expect(room).toMatch(
      /useReducer\(\s*roomOutcomeNoteReducer,\s*EMPTY_ROOM_OUTCOME_NOTE,?\s*\)/u,
    );
    // Skjermen for rommet har rom-id-en i nøkkelen, så den tas ned når rommet byttes
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).toMatch(/<RoomView\s+key=\{`[^`]*\$\{roomId\}[^`]*`\}/u);
  });

  it("S6.5 ingenting skrives til nettleserens lagring", () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
    const indexed = { open: vi.fn(), deleteDatabase: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    vi.stubGlobal("indexedDB", indexed);
    let state: RoomOutcomeNote = EMPTY_ROOM_OUTCOME_NOTE;
    state = roomOutcomeNoteReducer(state, { type: "typed", note: "Mxq-notat-ÆØ 77 7 2" });
    state = roomOutcomeNoteReducer(state, { type: "panel_closed" });
    state = roomOutcomeNoteReducer(state, {
      type: "deviation_from_note",
      deviationId: "d1",
      note: state.note,
    });
    state = roomOutcomeNoteReducer(state, { type: "offer_changed", phase: "added", original: "" });
    expect(state.offer?.note).toBe("Mxq-notat-ÆØ 77 7 2");
    viewOf({ note: "Mxq-notat-ÆØ 77 7 2" });
    for (const spy of [...Object.values(storage), ...Object.values(indexed)]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("S6.5 valgt KI-treff flytter notatet til tilbudet i avvikskortet; et annet avvik fjerner tilbudet", () => {
    const typed = roomOutcomeNoteReducer(EMPTY_ROOM_OUTCOME_NOTE, { type: "typed", note: NOTE });
    const chosen = roomOutcomeNoteReducer(typed, {
      type: "deviation_from_note",
      deviationId: "d1",
      note: ` ${NOTE} `,
    });
    expect(chosen.note).toBe("");
    expect(chosen.offer).toEqual({ deviationId: "d1", note: NOTE, phase: "offer", original: null });
    const added = roomOutcomeNoteReducer(chosen, {
      type: "offer_changed",
      phase: "added",
      original: "Sprekker i fliser eller fuger.",
    });
    expect(added.offer).toMatchObject({
      phase: "added",
      original: "Sprekker i fliser eller fuger.",
    });
    // «Angre» beholder teksten som stod før
    const restored = roomOutcomeNoteReducer(added, { type: "offer_changed", phase: "restored" });
    expect(restored.offer?.original).toBe("Sprekker i fliser eller fuger.");
    expect(roomOutcomeNoteReducer(restored, { type: "deviation_added" }).offer).toBeNull();
  });

  it("S6.6 fødselsnummer: meldingen før noe sendes, KI og notatknappene sperret, sifrene gjentas ikke", () => {
    const digits = "01019912345";
    const view = viewOf({ note: `flis løs ved sluket ${digits}` });
    expect(view.state).toBe("national_id");
    expect(view.fieldError).toBe(
      "Notatet ser ut til å ha et fødselsnummer. Ta det bort før du bruker KI.",
    );
    expect(view.fieldError).not.toMatch(/\d/);
    expect(view.button?.disabled).toBe(true);
    expect(view.enterRunsAi).toBe(false);
    expect(view.noteActionsBlocked).toBe(true);
    expect(viewOf({ note: "010199 12345" }).noteActionsBlocked).toBe(true);
    expect(viewOf().noteActionsBlocked).toBe(false);
    // Et notat med fødselsnummer gir aldri et tilbud om å legge det til avviket
    const offer = roomOutcomeNoteReducer(EMPTY_ROOM_OUTCOME_NOTE, {
      type: "deviation_from_note",
      deviationId: "d1",
      note: `flis ${digits}`,
    }).offer;
    expect(offer).toBeNull();
  });

  it("S6.6 samme sjekk som serveren (containsNationalId)", () => {
    // Serveren har ingen kontrollsiffersjekk (heller for strengt enn for slapt), så skjermen
    // sperrer de samme elleve sifrene som serveren avviser, og slipper gjennom det samme.
    for (const note of [
      "12345678901",
      "123 456 789 01",
      "tlf 12345678",
      "membran fra 1994",
      NOTE,
    ]) {
      expect(viewOf({ note }).noteActionsBlocked, note).toBe(containsNationalId(note));
    }
  });
});

describe("outcomeTgLabel", () => {
  it("TG står alltid med tekst; «Velg TG2 eller TG3» og «HMS» er nøytrale", () => {
    expect(outcomeTgLabel("tg2")).toEqual({ text: "TG2", long: "TG2 Vesentlige avvik", tg: "2" });
    expect(outcomeTgLabel("tg3")).toEqual({
      text: "TG3",
      long: "TG3 Store eller alvorlige avvik",
      tg: "3",
    });
    expect(outcomeTgLabel("choose_tg2_tg3")).toEqual({
      text: "Velg TG2 eller TG3",
      long: "Velg TG2 eller TG3",
      tg: null,
    });
    expect(outcomeTgLabel("hms")).toEqual({ text: "HMS", long: "HMS", tg: null });
    expect(OUTCOME_MATCH_TEXTS.chooseTg).toBe(outcomeTgLabel("choose_tg2_tg3").text);
  });
});
