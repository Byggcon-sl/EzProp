import { describe, expect, it } from "vitest";
import { trialForm } from "./trial-form";

// Testskjemaet for prøven uten nett (docs/funksjoner/fase1-testskjema.md).
// Nøklene er faste koder (regel 6): kandidatene i oppgave 4 sammenlignes på samme nøkler.

const fields = trialForm.groups.flatMap((group) => group.fields);
const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

/** Nøklene fra tabellen i oppgavekortet, i samme rekkefølge. */
const EXPECTED_KEYS = [
  "building_year",
  "building_type",
  "floors",
  "usable_area",
  "general_description",
  "cover_photo",
  "roof_tg",
  "roof_description",
  "roof_covering",
  "roof_covering_age",
  "roof_photo",
  "walls_tg",
  "walls_description",
  "walls_photo",
  "bathroom_tg",
  "bathroom_description",
  "bathroom_age",
  "floor_slope",
  "membrane_visible",
  "moisture_floor",
  "moisture_wall",
  "bathroom_photo",
  "drain_photo",
  "drill_measurements",
  "kitchen_tg",
  "kitchen_description",
  "kitchen_ventilation",
  "leak_stopper",
  "kitchen_photo",
  "water_heater_tg",
  "water_heater_age",
  "water_heater_location",
  "water_heater_photo",
  "electrical_tg",
  "electrical_description",
  "fuse_box_photo",
  "compliance_declaration",
  "summary",
  "rooms_inspected",
  "recommendation_tg",
];

describe("trialForm", () => {
  it("har nøyaktig 40 felt med unike nøkler", () => {
    expect(fields).toHaveLength(40);
    expect(new Set(fields.map((field) => field.key)).size).toBe(40);
  });

  it("har fordelingen tekst 7, TG 7, valg 9, tall 9, tabell 1, bilde 7", () => {
    const count = (type: string) => fields.filter((field) => field.type === type).length;
    expect({
      text: count("text"),
      tg: count("tg"),
      choice: count("choice"),
      number: count("number"),
      table: count("table"),
      photo: count("photo"),
    }).toEqual({ text: 7, tg: 7, choice: 9, number: 9, table: 1, photo: 7 });
  });

  it("alle seks felttypene finnes", () => {
    const types = new Set<string>(fields.map((field) => field.type));
    expect([...types].sort()).toEqual(["choice", "number", "photo", "table", "text", "tg"]);
  });

  it("har seks grupper med norsk overskrift", () => {
    expect(trialForm.groups.map((group) => group.title)).toEqual([
      "Om boligen",
      "Utvendig",
      "Bad",
      "Kjøkken",
      "Teknisk",
      "Oppsummering",
    ]);
  });

  it("alle valgfelt har minst to valg med kode og norsk etikett", () => {
    const choiceFields = fields.filter((field) => field.type === "choice");
    expect(choiceFields.length).toBeGreaterThan(0);
    for (const field of choiceFields) {
      const options = field.options ?? [];
      expect(options.length, field.key).toBeGreaterThanOrEqual(2);
      expect(new Set(options.map((o) => o.key)).size, field.key).toBe(options.length);
      for (const option of options) {
        expect(option.key, field.key).toMatch(SNAKE_CASE);
        expect(option.label.trim(), field.key).not.toBe("");
      }
    }
  });

  it("tabellen drill_measurements har kolonnene location, value, note", () => {
    const table = fields.find((field) => field.key === "drill_measurements");
    expect(table?.type).toBe("table");
    const columns = table?.columns ?? [];
    expect(columns.map((c) => c.key)).toEqual(["location", "value", "note"]);
    expect(columns.map((c) => c.label)).toEqual(["Sted", "Verdi", "Kommentar"]);
    expect(columns.find((c) => c.key === "value")?.type).toBe("number");
  });

  it("nøklene er engelske snake_case", () => {
    const keys = [
      ...fields.map((field) => field.key),
      ...fields.flatMap((field) => (field.options ?? []).map((o) => o.key)),
      ...fields.flatMap((field) => (field.columns ?? []).map((c) => c.key)),
    ];
    for (const key of keys) expect(key).toMatch(SNAKE_CASE);
  });

  it("nøklene stemmer med oppgavekortet", () => {
    expect(fields.map((field) => field.key)).toEqual(EXPECTED_KEYS);
  });

  it("alle felt har norsk etikett, og etikettene er unike", () => {
    // e2e finner feltene på etiketten, så to like etiketter ville gitt feil felt.
    for (const field of fields) expect(field.label.trim(), field.key).not.toBe("");
    expect(new Set(fields.map((field) => field.label)).size).toBe(40);
  });
});
