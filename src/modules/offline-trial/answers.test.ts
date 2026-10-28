import { describe, expect, it } from "vitest";
import { countAnswered, parseTrialNumber, type TrialAnswers } from "./answers";
import { trialForm } from "./trial-form";

// Telleren «N av 40 felt utfylt» bygger på countAnswered. Teller den feil,
// gir prøve A et falskt resultat (docs/funksjoner/fase1-testskjema-testplan.md avsnitt 10).

const photo = {
  id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b",
  name: "test-image.png",
  sizeBytes: 120,
};
const row = {
  id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
  cells: { location: "Oppdiktet sted", value: 12.5, note: null },
};

describe("countAnswered", () => {
  it("countAnswered gir 0 for tomme svar", () => {
    expect(countAnswered(trialForm, {})).toBe(0);
  });

  it("tom tekst og tekst med bare mellomrom teller ikke", () => {
    expect(countAnswered(trialForm, { summary: "" })).toBe(0);
    expect(countAnswered(trialForm, { summary: "   " })).toBe(0);
    expect(countAnswered(trialForm, { summary: "a" })).toBe(1);
  });

  it("TG og valg teller når de er satt", () => {
    expect(countAnswered(trialForm, { roof_tg: "TG2" })).toBe(1);
    expect(countAnswered(trialForm, { building_type: "detached" })).toBe(1);
    expect(countAnswered(trialForm, { roof_tg: "TG2", building_type: "detached" })).toBe(2);
  });

  it("tallet 0 teller som utfylt, null teller ikke", () => {
    expect(countAnswered(trialForm, { floors: 0 })).toBe(1);
    expect(countAnswered(trialForm, { floors: null })).toBe(0);
  });

  it("tom tabell teller ikke, én rad teller", () => {
    expect(countAnswered(trialForm, { drill_measurements: [] })).toBe(0);
    expect(countAnswered(trialForm, { drill_measurements: [row] })).toBe(1);
  });

  it("tomt bildefelt teller ikke, ett bilde teller", () => {
    expect(countAnswered(trialForm, { cover_photo: [] })).toBe(0);
    expect(countAnswered(trialForm, { cover_photo: [photo] })).toBe(1);
  });

  it("svar for nøkler som ikke finnes i skjemaet teller ikke", () => {
    expect(countAnswered(trialForm, { unknown_key: "x" })).toBe(0);
    expect(countAnswered(trialForm, { unknown_key: "x", summary: "a" })).toBe(1);
  });

  it("alle 40 utfylt gir 40", () => {
    const answers: TrialAnswers = {};
    for (const field of trialForm.groups.flatMap((group) => group.fields)) {
      switch (field.type) {
        case "text":
          answers[field.key] = "Oppdiktet tekst";
          break;
        case "tg":
          answers[field.key] = "TG1";
          break;
        case "choice":
          answers[field.key] = field.options?.[0]?.key ?? "";
          break;
        case "number":
          answers[field.key] = 12.5;
          break;
        case "table":
          answers[field.key] = [row];
          break;
        case "photo":
          answers[field.key] = [photo];
          break;
      }
    }
    expect(countAnswered(trialForm, answers)).toBe(40);
  });

  it("svarene kan lagres som JSON uten å miste noe", () => {
    // Kandidatene i oppgave 4 lagrer og synker denne formen: ingen filobjekter eller objekt-URL-er.
    const answers: TrialAnswers = {
      summary: "Oppdiktet tekst",
      roof_tg: "TG3",
      floors: 0,
      drill_measurements: [row],
      cover_photo: [photo],
    };
    const roundTrip = JSON.parse(JSON.stringify(answers)) as TrialAnswers;
    expect(roundTrip).toEqual(answers);
    expect(countAnswered(trialForm, roundTrip)).toBe(5);
  });
});

describe("parseTrialNumber", () => {
  it("parseTrialNumber godtar komma og punktum, avviser tekst", () => {
    expect(parseTrialNumber("12,5")).toBe(12.5);
    expect(parseTrialNumber("12.5")).toBe(12.5);
    expect(parseTrialNumber("0")).toBe(0);
    expect(parseTrialNumber(" 7 ")).toBe(7);
    expect(parseTrialNumber("abc")).toBeNull();
    expect(parseTrialNumber("")).toBeNull();
    expect(parseTrialNumber("   ")).toBeNull();
  });
});
