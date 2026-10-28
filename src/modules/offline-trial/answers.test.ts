import { describe, expect, it } from "vitest";
import {
  countAnswered,
  parseTrialNumber,
  type TrialAnswers,
  type TrialPhoto,
  type TrialTableRow,
  type TrialValue,
} from "./answers";
import { listTrialFields, trialForm, type TrialField } from "./trial-form";

// Oppdiktede verdier, ingen kundeopplysninger.
const ROW: TrialTableRow = {
  id: "0190c2a0-0000-7000-8000-000000000001",
  cells: { location: "Ved sluk", value: 12.5, note: null },
};
const PHOTO: TrialPhoto = {
  id: "0190c2a0-0000-7000-8000-000000000002",
  name: "test-image.png",
  sizeBytes: 120,
};

function sampleValue(field: TrialField): TrialValue {
  switch (field.type) {
    case "text":
      return "Oppdiktet tekst";
    case "tg":
      return "TG1";
    case "choice":
      return field.options?.[0]?.key ?? "";
    case "number":
      return 12.5;
    case "table":
      return [ROW];
    case "photo":
      return [PHOTO];
  }
}

describe("countAnswered", () => {
  it("countAnswered gir 0 for tomme svar", () => {
    expect(countAnswered(trialForm, {})).toBe(0);
  });

  it("tom tekst og tekst med bare mellomrom teller ikke", () => {
    expect(countAnswered(trialForm, { general_description: "" })).toBe(0);
    expect(countAnswered(trialForm, { general_description: "   " })).toBe(0);
    expect(countAnswered(trialForm, { general_description: "a" })).toBe(1);
  });

  it("TG og valg teller når de er satt", () => {
    expect(countAnswered(trialForm, { roof_tg: "TG2" })).toBe(1);
    expect(countAnswered(trialForm, { building_type: "detached" })).toBe(1);
  });

  it("tallet 0 teller som utfylt, null teller ikke", () => {
    expect(countAnswered(trialForm, { floors: 0 })).toBe(1);
    expect(countAnswered(trialForm, { floors: null })).toBe(0);
  });

  it("tom tabell teller ikke, én rad teller", () => {
    expect(countAnswered(trialForm, { drill_measurements: [] })).toBe(0);
    expect(countAnswered(trialForm, { drill_measurements: [ROW] })).toBe(1);
  });

  it("tomt bildefelt teller ikke, ett bilde teller", () => {
    expect(countAnswered(trialForm, { cover_photo: [] })).toBe(0);
    expect(countAnswered(trialForm, { cover_photo: [PHOTO] })).toBe(1);
  });

  it("svar for nøkler som ikke finnes i skjemaet teller ikke", () => {
    expect(countAnswered(trialForm, { unknown_key: "x" })).toBe(0);
  });

  it("alle 40 utfylt gir 40", () => {
    const answers: TrialAnswers = {};
    for (const field of listTrialFields(trialForm)) answers[field.key] = sampleValue(field);
    expect(countAnswered(trialForm, answers)).toBe(40);
  });
});

describe("parseTrialNumber", () => {
  it("parseTrialNumber godtar komma og punktum, avviser tekst", () => {
    expect(parseTrialNumber("12,5")).toBe(12.5);
    expect(parseTrialNumber("12.5")).toBe(12.5);
    expect(parseTrialNumber("0")).toBe(0);
    expect(parseTrialNumber("abc")).toBeNull();
    expect(parseTrialNumber("")).toBeNull();
    expect(parseTrialNumber(" 7 ")).toBe(7);
  });
});
