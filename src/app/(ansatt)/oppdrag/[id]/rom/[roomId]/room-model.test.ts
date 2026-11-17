import { describe, expect, it } from "vitest";
import { TG_LONG_LABELS, TG_SHORT_LABELS, type CheckpointWarning } from "@/core/reports/logic";
import { TG_BADGE_LONG, TG_BADGE_SHORT } from "@/shared/ui/tg-badge";
import type { SuggestionView, TgiuDetailsView } from "@/core/reports/types";
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
  neighbours,
  nextUndoneCheckpoint,
  outcomeName,
  outcomeTgOf,
  parseNumberInput,
  REPORT_TEXT_LIMITS,
  reportTextValidator,
  suggestionId,
  T0059_FIX,
  TEXT_MESSAGES,
  TG_DIRECT_CHOICE_ID,
  tgiuFieldKey,
  visibleTgiuFields,
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
