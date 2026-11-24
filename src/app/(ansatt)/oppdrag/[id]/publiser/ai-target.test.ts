import { describe, expect, it } from "vitest";
import type { CheckpointView, RoomReportView } from "@/core/reports/types";
import { aiFieldTarget } from "./ai-target";

/*
 * Feltet et KI-forslag gjelder (F4): teksten som står der nå, navnet, og endringen «Bruk» lagrer
 * med nåverdien som `base`. Ukjent eller slettet mål gir `null`, så «Bruk» aldri skriver feil sted.
 * Testdata er oppdiktet.
 * Støtter hovedmål: KI i bunnen (forslaget behandles der mangelen vises) og færre reklamasjoner.
 */

type Started = Extract<RoomReportView, { state: "started" }>;

const DEV = "0190a000-0000-7000-8000-0000000000d1";
const MEASURE = "0190a000-0000-7000-8000-0000000000d2";
const RESULT = "0190a000-0000-7000-8000-0000000000c1";
const TGIU = "0190a000-0000-7000-8000-0000000000c2";
const ANSWER = "0190a000-0000-7000-8000-0000000000b1";

const checkpoint = {
  checkpointKey: "wet_room.membrane_drain",
  resultId: RESULT,
  tgDirect: null,
  tg: "3",
  status: "in_progress",
  descriptionText: "Oppdiktet beskrivelse",
  done: false,
  rowVersion: 1,
  deviations: [
    {
      id: DEV,
      questionKey: null,
      outcomeKey: null,
      kind: "tg",
      tg: 3,
      deviationText: null,
      causeText: "Oppdiktet årsak",
      consequenceText: null,
      cost: { type: "none", bandKey: null, amount: null },
      costText: null,
      measurementValue: null,
      measurementUnit: null,
      textSource: "template",
      suggestedByRuleKey: null,
      sortOrder: 0,
      rowVersion: 1,
      measures: [
        {
          id: MEASURE,
          text: "Oppdiktet tiltak",
          textSource: "template",
          sortOrder: 0,
          rowVersion: 1,
        },
      ],
    },
  ],
  tgiuDetails: {
    id: TGIU,
    reason: null,
    ownerInformed: null,
    ownerInformedAt: null,
    alternativeCheckMethod: null,
    alternativeCheckResult: null,
    riskAssessment: "Oppdiktet risiko",
    constructionVulnerable: null,
    howToExamine: null,
    rowVersion: 1,
  },
  warnings: [],
} as unknown as CheckpointView;

const room = {
  state: "started",
  checkpoints: [checkpoint],
  answers: [
    {
      id: ANSWER,
      elementKey: "wet_room.general_note",
      value: { text: "Oppdiktet notat", number: null, optionKeys: null },
      aiUsageId: null,
      rowVersion: 1,
    },
  ],
  document: { elements: [{ key: "wet_room.general_note", label: "Merknad" }] },
} as unknown as Started;

describe("aiFieldTarget", () => {
  it("avvikstekst: nåverdien som base", () => {
    const target = aiFieldTarget(room, { type: "deviation", id: DEV, fieldKey: "cause_text" });
    expect(target?.currentText).toBe("Oppdiktet årsak");
    expect(target?.label).toBe("Årsak");
    expect(target?.change("Ny tekst")).toEqual({
      table: "deviations",
      id: DEV,
      field: "cause_text",
      value: "Ny tekst",
      base: "Oppdiktet årsak",
    });
  });

  it("tomt felt gir tom tekst og null som base", () => {
    const target = aiFieldTarget(room, {
      type: "deviation",
      id: DEV,
      fieldKey: "consequence_text",
    });
    expect(target?.currentText).toBe("");
    expect(target?.change("x")).toMatchObject({ base: null });
  });

  it("tiltak, beskrivelse, TGIU og svar", () => {
    expect(
      aiFieldTarget(room, { type: "deviation_measure", id: MEASURE, fieldKey: "text" })?.change(
        "T",
      ),
    ).toEqual({
      table: "deviation_measures",
      id: MEASURE,
      field: "text",
      value: "T",
      base: "Oppdiktet tiltak",
    });
    expect(
      aiFieldTarget(room, {
        type: "checkpoint_result",
        id: RESULT,
        fieldKey: "description_text",
      })?.change("B"),
    ).toEqual({
      table: "checkpoint_results",
      checkpointKey: "wet_room.membrane_drain",
      field: "description_text",
      value: "B",
      base: "Oppdiktet beskrivelse",
    });
    expect(
      aiFieldTarget(room, { type: "tgiu_detail", id: TGIU, fieldKey: "risk_assessment" })?.change(
        "R",
      ),
    ).toEqual({
      table: "tgiu_details",
      checkpointKey: "wet_room.membrane_drain",
      field: "risk_assessment",
      value: "R",
      base: "Oppdiktet risiko",
    });
    const answer = aiFieldTarget(room, {
      type: "field_answer",
      id: ANSWER,
      fieldKey: "wet_room.general_note",
    });
    expect(answer?.label).toBe("Merknad");
    expect(answer?.change("Svar")).toEqual({
      table: "field_answers",
      id: ANSWER,
      elementKey: "wet_room.general_note",
      field: "value",
      value: { text: "Svar", number: null, optionKeys: null },
      base: { text: "Oppdiktet notat", number: null, optionKeys: null },
    });
  });

  it("ukjent mål, ukjent felt eller feil feltkode gir null", () => {
    expect(
      aiFieldTarget(room, { type: "deviation", id: MEASURE, fieldKey: "cause_text" }),
    ).toBeNull();
    expect(aiFieldTarget(room, { type: "deviation", id: DEV, fieldKey: "cost_text" })).toBeNull();
    expect(
      aiFieldTarget(room, { type: "field_answer", id: ANSWER, fieldKey: "wet_room.other" }),
    ).toBeNull();
    expect(aiFieldTarget(room, { type: "ukjent", id: DEV, fieldKey: "text" })).toBeNull();
  });
});
