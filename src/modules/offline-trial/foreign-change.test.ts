import { describe, expect, it } from "vitest";
import { detectForeignChanges } from "./foreign-change";
import type { TrialAnswerRow } from "./sync/types";
import { listTrialFields, trialForm } from "./trial-form";

// «Siste endring vinner» med minste mulige varsel (docs/funksjoner/fase1-kandidat-powersync.md pkt. 19).
// Testplan avsnitt 2.2. Bare tg, choice og number gir «Endret av en annen».

const FORM_ID = "0190a1b2-c3d4-7e5f-8a6b-000000000001";
const ME = "min";
const OTHER = "annen-enhet";

let counter = 0;
function row(
  fieldKey: string,
  value: unknown,
  deviceId: string,
  extra: Partial<TrialAnswerRow> = {},
) {
  counter += 1;
  const stamp = new Date(Date.UTC(2026, 9, 28, 12, 0, counter)).toISOString();
  return {
    id: `0190a1b2-c3d4-7e5f-8a6b-${String(counter).padStart(12, "0")}`,
    trialFormId: FORM_ID,
    fieldKey,
    value: JSON.stringify(value),
    textState: null,
    deviceId,
    createdAt: stamp,
    updatedAt: stamp,
    deletedAt: null,
    ...extra,
  } satisfies TrialAnswerRow;
}

/** Samme rad (samme id) med ny verdi og enhet, slik synk leverer den. */
function changed(previous: TrialAnswerRow, value: unknown, deviceId: string): TrialAnswerRow {
  return {
    ...previous,
    value: JSON.stringify(value),
    deviceId,
    updatedAt: new Date(Date.parse(previous.updatedAt) + 60_000).toISOString(),
  };
}

const typeOf = new Map(listTrialFields(trialForm).map((field) => [field.key, field.type]));

describe("detectForeignChanges", () => {
  it("feltene testen bruker har typene testplanen forutsetter", () => {
    expect(typeOf.get("roof_tg")).toBe("tg");
    expect(typeOf.get("leak_stopper")).toBe("choice");
    expect(typeOf.get("moisture_floor")).toBe("number");
    expect(typeOf.get("floors")).toBe("number");
    expect(typeOf.get("roof_description")).toBe("text");
    expect(typeOf.get("drill_measurements")).toBe("table");
    expect(typeOf.get("cover_photo")).toBe("photo");
  });

  it("endring fra en annen enhet gir feltnøkkelen", () => {
    const mine = row("roof_tg", "TG2", ME);
    const result = detectForeignChanges([mine], [changed(mine, "TG3", OTHER)], ME);
    expect(result).toEqual(new Set(["roof_tg"]));
  });

  it("egen endring gir ikke varsel", () => {
    const mine = row("roof_tg", "TG2", ME);
    const result = detectForeignChanges([mine], [changed(mine, "TG3", ME)], ME);
    expect(result).toEqual(new Set());
  });

  it("tom previousRows gir aldri varsel", () => {
    const fields = listTrialFields(trialForm);
    expect(fields).toHaveLength(40);
    const next = fields.map((field) => row(field.key, field.type === "number" ? 7 : "TG3", OTHER));
    expect(detectForeignChanges([], next, ME)).toEqual(new Set());
  });

  it("uendret verdi fra annen enhet gir ikke varsel", () => {
    const mine = row("roof_tg", "TG2", ME);
    const result = detectForeignChanges([mine], [changed(mine, "TG2", OTHER)], ME);
    expect(result).toEqual(new Set());
  });

  it("ny rad fra annen enhet i et felt denne enheten aldri har satt gir varsel", () => {
    const previous = [row("roof_tg", "TG2", ME), row("building_year", 1985, ME)];
    const next = [...previous, row("floors", 7, OTHER)];
    expect(detectForeignChanges(previous, next, ME)).toEqual(new Set(["floors"]));
  });

  it("bare tg, choice og number gir varsel", () => {
    const previous = [
      row("roof_description", "Oppdiktet tekst", ME),
      row("drill_measurements", [], ME),
      row("cover_photo", [], ME),
      row("roof_tg", "TG1", ME),
      row("leak_stopper", "yes", ME),
      row("moisture_floor", 10, ME),
    ];
    const [description, table, photo, tg, choice, number] = previous as [
      TrialAnswerRow,
      TrialAnswerRow,
      TrialAnswerRow,
      TrialAnswerRow,
      TrialAnswerRow,
      TrialAnswerRow,
    ];

    const notWarned = detectForeignChanges(
      previous,
      [
        changed(description, "Annen oppdiktet tekst", OTHER),
        changed(
          table,
          [{ id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c", cells: { value: 3 } }],
          OTHER,
        ),
        changed(
          photo,
          [{ id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b", name: "a.png", sizeBytes: 1 }],
          OTHER,
        ),
        tg,
        choice,
        number,
      ],
      ME,
    );
    expect(notWarned).toEqual(new Set());

    const warned = detectForeignChanges(
      previous,
      [
        description,
        table,
        photo,
        changed(tg, "TG3", OTHER),
        changed(choice, "no", OTHER),
        changed(number, 12, OTHER),
      ],
      ME,
    );
    expect(warned).toEqual(new Set(["roof_tg", "leak_stopper", "moisture_floor"]));
  });

  it("ukjent feltnøkkel gir ikke varsel", () => {
    const previous = [row("roof_tg", "TG2", ME), row("unknown_key", "a", ME)];
    const unknown = previous[1] as TrialAnswerRow;
    const next = [
      previous[0] as TrialAnswerRow,
      changed(unknown, "b", OTHER),
      row("annen_ukjent", 1, OTHER),
    ];
    expect(detectForeignChanges(previous, next, ME)).toEqual(new Set());
  });

  it("myk slettet rad gir ikke varsel", () => {
    const mine = row("roof_tg", "TG2", ME);
    const deleted = { ...changed(mine, "TG3", OTHER), deletedAt: "2026-10-28T13:00:00.000Z" };
    expect(detectForeignChanges([mine], [deleted], ME)).toEqual(new Set());

    const previous = [row("building_year", 1985, ME)];
    const newDeleted = row("floors", 7, OTHER, { deletedAt: "2026-10-28T13:00:00.000Z" });
    expect(detectForeignChanges(previous, [...previous, newDeleted], ME)).toEqual(new Set());
  });
});
