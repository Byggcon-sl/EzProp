import { describe, expect, it } from "vitest";
import { isUuid } from "@/shared/lib/uuid";
import type { TrialAnswers, TrialTableRow, TrialValue } from "../answers";
import { answerToRow, rowsToAnswers } from "./answer-rows";
import type { TrialAnswerRow, TrialPhotoRow } from "./types";

// Rader i den lokale databasen <-> svarene skjermen viser (docs/funksjoner/fase1-kandidat-powersync.md pkt. 7).
// Testplan avsnitt 2.3. Nøkler alltid på field_key, bilder alltid fra trial_photos.

const FORM_ID = "0190a1b2-c3d4-7e5f-8a6b-000000000001";
const DELETED = "2026-10-28T13:00:00.000Z";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `0190a1b2-c3d4-7e5f-8a6b-${String(counter).padStart(12, "0")}`;
}

function answerRow(fieldKey: string, value: string | null, extra: Partial<TrialAnswerRow> = {}) {
  return {
    id: nextId(),
    trialFormId: FORM_ID,
    fieldKey,
    value,
    textState: null,
    deviceId: "enhet-1",
    createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T12:00:00.000Z",
    deletedAt: null,
    ...extra,
  } satisfies TrialAnswerRow;
}

function photoRow(fieldKey: string, extra: Partial<TrialPhotoRow> = {}) {
  return {
    id: nextId(),
    trialFormId: FORM_ID,
    fieldKey,
    name: "test-image.png",
    sizeBytes: 120,
    sha256: null,
    uploadedAt: null,
    deviceId: "enhet-1",
    createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T12:00:00.000Z",
    deletedAt: null,
    ...extra,
  } satisfies TrialPhotoRow;
}

/** Slik raden ligger lokalt etter at `answerToRow` er skrevet. */
function asStoredRow(formId: string, fieldKey: string, value: TrialValue): TrialAnswerRow {
  const input = answerToRow(formId, fieldKey, value, "enhet-1");
  return {
    ...input,
    createdAt: "2026-10-28T12:00:00.000Z",
    updatedAt: "2026-10-28T12:00:00.000Z",
    deletedAt: null,
  };
}

describe("answerToRow", () => {
  it("answerToRow gir rad med field_key, value som JSON-streng og device_id", () => {
    const result = answerToRow(FORM_ID, "floors", 7, "enhet-1");
    expect(result.trialFormId).toBe(FORM_ID);
    expect(result.fieldKey).toBe("floors");
    expect(result.value).toBe("7");
    expect(result.deviceId).toBe("enhet-1");
    expect(isUuid(result.id)).toBe(true);
    expect(result).not.toHaveProperty("organizationId");
    expect(result).not.toHaveProperty("organization_id");
    // Ny id per kall: kalleren trenger aldri lage den
    expect(answerToRow(FORM_ID, "floors", 7, "enhet-1").id).not.toBe(result.id);
  });

  it("answerToRow lagrer 0 og null forskjellig", () => {
    expect(answerToRow(FORM_ID, "floors", 0, "enhet-1").value).toBe("0");
    expect(answerToRow(FORM_ID, "floors", null, "enhet-1").value).toBe("null");
  });
});

describe("rowsToAnswers", () => {
  it("rowsToAnswers nøkler på field_key og leser value fra JSON", () => {
    const answers = rowsToAnswers([answerRow("floors", "7"), answerRow("roof_tg", '"TG2"')], []);
    expect(answers).toEqual({ floors: 7, roof_tg: "TG2" });
  });

  it("rowsToAnswers skiller 0 og null", () => {
    const answers = rowsToAnswers(
      [answerRow("floors", "0"), answerRow("building_year", "null")],
      [],
    );
    expect(answers.floors).toBe(0);
    expect(answers.building_year).toBeNull();
  });

  it("rowsToAnswers hopper over rader med deleted_at", () => {
    const answers = rowsToAnswers(
      [answerRow("floors", "7", { deletedAt: DELETED }), answerRow("roof_tg", '"TG2"')],
      [],
    );
    expect(answers).not.toHaveProperty("floors");
    expect(answers.roof_tg).toBe("TG2");
  });

  it("rowsToAnswers tar siste rad når samme field_key kommer to ganger", () => {
    const older = answerRow("floors", "3", { updatedAt: "2026-10-28T12:00:00.000Z" });
    const newer = answerRow("floors", "8", { updatedAt: "2026-10-28T12:05:00.000Z" });
    expect(rowsToAnswers([older, newer], []).floors).toBe(8);
    expect(rowsToAnswers([newer, older], []).floors).toBe(8);
  });

  it("bildefelt bygges av trial_photos, aldri av trial_answers.value", () => {
    const photo = photoRow("cover_photo", { name: "forside.png", sizeBytes: 345 });
    const fromValue = JSON.stringify([
      { id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b", name: "fra-value.png", sizeBytes: 1 },
    ]);

    const empty = rowsToAnswers([answerRow("cover_photo", "[]")], [photo]);
    expect(empty.cover_photo).toEqual([{ id: photo.id, name: "forside.png", sizeBytes: 345 }]);

    // Et bilde som bare står i value (f.eks. fra en annen enhet) skal aldri vises
    const ignored = rowsToAnswers([answerRow("cover_photo", fromValue)], [photo]);
    expect(ignored.cover_photo).toEqual([{ id: photo.id, name: "forside.png", sizeBytes: 345 }]);
  });

  it("bilderekkefølgen er stabil: created_at, så id", () => {
    const first = photoRow("roof_photo", {
      id: "0190a1b2-c3d4-7e5f-8a6b-00000000a001",
      createdAt: "2026-10-28T12:00:00.000Z",
    });
    const tieLow = photoRow("roof_photo", {
      id: "0190a1b2-c3d4-7e5f-8a6b-00000000b001",
      createdAt: "2026-10-28T12:01:00.000Z",
    });
    const tieHigh = photoRow("roof_photo", {
      id: "0190a1b2-c3d4-7e5f-8a6b-00000000b002",
      createdAt: "2026-10-28T12:01:00.000Z",
    });
    const expected = [first.id, tieLow.id, tieHigh.id];
    for (const order of [
      [tieHigh, first, tieLow],
      [tieLow, tieHigh, first],
      [first, tieHigh, tieLow],
    ]) {
      const photos = rowsToAnswers([], order).roof_photo as { id: string }[];
      expect(photos.map((photo) => photo.id)).toEqual(expected);
    }
  });

  it("myk slettet bilde er ikke med", () => {
    const kept = photoRow("cover_photo");
    const deleted = photoRow("cover_photo", { deletedAt: DELETED });
    const photos = rowsToAnswers([], [kept, deleted]).cover_photo as { id: string }[];
    expect(photos.map((photo) => photo.id)).toEqual([kept.id]);
  });

  it("value tåler JSON-rundtur for alle seks typene", () => {
    const table: TrialTableRow[] = [
      {
        id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2c",
        cells: { location: "Oppdiktet sted", value: 12.5, note: null },
      },
    ];
    const original: TrialAnswers = {
      roof_description: "Oppdiktet tekst med æøå",
      roof_tg: "TG3",
      leak_stopper: "no",
      floors: 0,
      drill_measurements: table,
    };
    const rows = Object.entries(original).map(([key, value]) =>
      asStoredRow(FORM_ID, key, value as TrialValue),
    );
    const photoAnswer = asStoredRow(FORM_ID, "cover_photo", []);

    const answers = rowsToAnswers([...rows, photoAnswer], []);
    const { cover_photo: coverPhoto, ...rest } = answers;
    expect(rest).toEqual(original);
    // Tomt bildefelt: bygges av trial_photos (ingen rader), så det er tomt eller ikke med
    expect(coverPhoto ?? []).toEqual([]);
  });

  it("ugyldig JSON i value gir null, ikke krasj", () => {
    const answers = rowsToAnswers(
      [
        answerRow("roof_tg", "{ikke json"),
        answerRow("floors", "7"),
        answerRow("leak_stopper", '"yes"'),
      ],
      [],
    );
    expect(answers.roof_tg).toBeNull();
    expect(answers.floors).toBe(7);
    expect(answers.leak_stopper).toBe("yes");
  });
});
