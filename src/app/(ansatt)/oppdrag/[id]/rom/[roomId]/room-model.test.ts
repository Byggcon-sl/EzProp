import { describe, expect, it } from "vitest";
import {
  TG_LONG_LABELS,
  TG_SHORT_LABELS,
  warningText,
  type CheckpointWarning,
} from "@/core/reports/logic";
import { TG_BADGE_LONG, TG_BADGE_SHORT } from "@/shared/ui/tg-badge";
import type { CheckpointView, SuggestionView, TgiuDetailsView } from "@/core/reports/types";
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
