import { describe, expect, it } from "vitest";
import { listTrialFields, trialForm, type TrialFieldType } from "./trial-form";

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/;

/** De 40 faste nøklene fra tabellen «Feltene (40)» i docs/funksjoner/fase1-testskjema.md. */
const KEYS_FROM_TASK_CARD = [
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

const fields = listTrialFields(trialForm);

describe("trialForm", () => {
  it("har nøyaktig 40 felt med unike nøkler", () => {
    const keys = fields.map((f) => f.key);
    expect(keys).toHaveLength(40);
    expect(new Set(keys).size).toBe(40);
  });

  it("har fordelingen tekst 7, TG 7, valg 8, tall 9, tabell 1, bilde 8", () => {
    const counts: Record<string, number> = {};
    for (const field of fields) counts[field.type] = (counts[field.type] ?? 0) + 1;
    expect(counts).toEqual({ text: 7, tg: 7, choice: 8, number: 9, table: 1, photo: 8 });
  });

  it("alle seks felttypene finnes", () => {
    const types = new Set(fields.map((f) => f.type));
    const expected: TrialFieldType[] = ["text", "tg", "choice", "number", "table", "photo"];
    for (const type of expected) expect(types.has(type)).toBe(true);
    expect(types.size).toBe(6);
  });

  it("har seks grupper med norsk overskrift", () => {
    expect(trialForm.groups.map((g) => g.title)).toEqual([
      "Om boligen",
      "Utvendig",
      "Bad",
      "Kjøkken",
      "Teknisk",
      "Oppsummering",
    ]);
  });

  it("alle valgfelt har minst to valg med kode og norsk etikett", () => {
    const choiceFields = fields.filter((f) => f.type === "choice");
    expect(choiceFields).toHaveLength(8);
    for (const field of choiceFields) {
      const options = field.options ?? [];
      expect(options.length, field.key).toBeGreaterThanOrEqual(2);
      for (const option of options) {
        expect(option.key, field.key).toMatch(SNAKE_CASE);
        expect(option.label.trim(), field.key).not.toBe("");
      }
    }
  });

  it("tabellen drill_measurements har kolonnene location, value, note", () => {
    const table = fields.find((f) => f.key === "drill_measurements");
    expect(table?.type).toBe("table");
    const columns = table?.columns ?? [];
    expect(columns.map((c) => c.key)).toEqual(["location", "value", "note"]);
    expect(columns.map((c) => c.label)).toEqual(["Sted", "Verdi", "Kommentar"]);
    expect(columns.find((c) => c.key === "value")?.type).toBe("number");
  });

  it("nøklene er engelske snake_case", () => {
    for (const group of trialForm.groups) expect(group.key).toMatch(SNAKE_CASE);
    for (const field of fields) {
      expect(field.key).toMatch(SNAKE_CASE);
      for (const option of field.options ?? []) expect(option.key).toMatch(SNAKE_CASE);
      for (const column of field.columns ?? []) expect(column.key).toMatch(SNAKE_CASE);
    }
  });

  it("nøklene stemmer med oppgavekortet", () => {
    expect(fields.map((f) => f.key)).toEqual(KEYS_FROM_TASK_CARD);
  });
});
