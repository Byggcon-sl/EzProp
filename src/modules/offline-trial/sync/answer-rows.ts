/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Rene funksjoner mellom rader i den lokale databasen og `TrialAnswers` (oppgavekortet pkt. 7).
 * Ingen React, ingen database. Nøkler alltid på `field_key`, aldri på `id`.
 */
import { uuidv7 } from "@/shared/lib/uuid";
import type { TrialAnswers, TrialPhoto, TrialValue } from "../answers";
import { listTrialFields, trialForm } from "../trial-form";
import type { TrialAnswerRow, TrialAnswerRowInput, TrialPhotoRow } from "./types";

const PHOTO_FIELD_KEYS = new Set(
  listTrialFields(trialForm)
    .filter((field) => field.type === "photo")
    .map((field) => field.key),
);

/** Raden klienten skriver for ett svar. `value` som JSON-tekst; `text_state` settes av lageret. */
export function answerToRow(
  formId: string,
  fieldKey: string,
  value: TrialValue,
  deviceId: string,
): TrialAnswerRowInput {
  return {
    id: uuidv7(),
    trialFormId: formId,
    fieldKey,
    value: JSON.stringify(value),
    textState: null,
    deviceId,
  };
}

/** Tidspunkt som tall. Tåler både ISO med «T» og PostgreSQL-tekst med mellomrom. */
function timeOf(value: string): number {
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseValue(value: string): TrialValue {
  try {
    return JSON.parse(value) as TrialValue;
  } catch {
    return null;
  }
}

/** Siste rad per `field_key` (høyest `updated_at`), uten myk slettede. */
export function latestAnswerRows(rows: readonly TrialAnswerRow[]): Map<string, TrialAnswerRow> {
  const latest = new Map<string, TrialAnswerRow>();
  for (const row of rows) {
    if (row.deletedAt) continue;
    const current = latest.get(row.fieldKey);
    if (!current || timeOf(row.updatedAt) >= timeOf(current.updatedAt)) {
      latest.set(row.fieldKey, row);
    }
  }
  return latest;
}

function comparePhotos(a: TrialPhotoRow, b: TrialPhotoRow): number {
  const byTime = timeOf(a.createdAt) - timeOf(b.createdAt);
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Svarene for ett skjema. Hopper over myk slettede rader. Bildefelt bygges bare av
 * `trial_photos` (stabil rekkefølge: `created_at`, så `id`), aldri av `trial_answers.value`.
 */
export function rowsToAnswers(
  answerRows: readonly TrialAnswerRow[],
  photoRows: readonly TrialPhotoRow[],
): TrialAnswers {
  const answers: TrialAnswers = {};
  for (const [fieldKey, row] of latestAnswerRows(answerRows)) {
    if (PHOTO_FIELD_KEYS.has(fieldKey)) continue;
    if (row.value === null) continue;
    answers[fieldKey] = parseValue(row.value);
  }

  const photosByField = new Map<string, TrialPhotoRow[]>();
  for (const row of photoRows) {
    if (row.deletedAt) continue;
    const list = photosByField.get(row.fieldKey) ?? [];
    list.push(row);
    photosByField.set(row.fieldKey, list);
  }
  for (const [fieldKey, rows] of photosByField) {
    answers[fieldKey] = [...rows]
      .sort(comparePhotos)
      .map((row): TrialPhoto => ({ id: row.id, name: row.name, sizeBytes: row.sizeBytes }));
  }
  return answers;
}
