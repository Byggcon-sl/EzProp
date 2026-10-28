/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kontrakten mellom skjermene i testskjemaet og synkløsningen (bare typer, ingen kode).
 * Skjermene bruker bare `TrialSyncStore`; PowerSync-utgaven ligger i `sync/powersync/`, og
 * ElectricSQL og egenbygd skal kunne byttes inn uten at skjermene skrives om. Ellers blir
 * kriteriet «Arbeid» skjevt mellom kandidatene (docs/funksjoner/fase1-kandidat-powersync.md).
 *
 * Radene speiler kolonnene i PostgreSQL (src/db/schema/offline-trial.ts) slik de ligger i den
 * lokale databasen: tidsstempler som ISO-tekst, `value` som JSON-tekst. Nøkler alltid på
 * `field_key`, aldri på `id`.
 */
import type { TrialAnswers, TrialPhoto, TrialValue } from "../answers";

/** Et testskjema i listen. `createdAt` er ISO 8601 (tekst i den lokale databasen). */
export interface TrialFormSummary {
  id: string;
  name: string;
  createdAt: string;
}

/** En rad i `trial_answers` slik den ligger lokalt. `value` er `TrialValue` som JSON-tekst. */
export interface TrialAnswerRow {
  id: string;
  trialFormId: string;
  fieldKey: string;
  value: string | null;
  /** Base64-kodet Yjs-tilstand, bare tekstfelt. Sannheten for tekst. */
  textState: string | null;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** En rad i `trial_photos` slik den ligger lokalt. `storage_path` synkes aldri til enheten. */
export interface TrialPhotoRow {
  id: string;
  trialFormId: string;
  fieldKey: string;
  name: string;
  sizeBytes: number;
  sha256: string | null;
  /** Settes bare av serveren. Null = filen venter på opplasting fra denne eller en annen enhet. */
  uploadedAt: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Alt skjermen trenger for ett skjema. Bildefeltene bygges av `photos`, aldri av `answers`. */
export interface TrialFormSnapshot {
  answers: TrialAnswerRow[];
  photos: TrialPhotoRow[];
}

/** Grunnlaget for måleindikatoren («Uten nett» / «Venter: N endringer, M bilder» / «Alt er lagret på serveren»). */
export interface TrialSyncStatus {
  online: boolean;
  /** Endringer i synkkøen som serveren ikke har bekreftet. */
  pendingChanges: number;
  /** Bilder på denne enheten uten `uploadedAt`. */
  pendingPhotos: number;
}

/**
 * Synklageret skjermene bygger mot. Én implementasjon per kandidat.
 * `subscribe` leverer både svar og bilder (snapshot), så bildefeltet oppdateres når en annen enhet
 * tar bilder i samme felt. Alle metoder virker uten nett; synk skjer i bakgrunnen.
 */
export interface TrialSyncStore {
  listForms(): Promise<TrialFormSummary[]>;
  /** Lager et nytt skjema lokalt. Returnerer id laget på enheten (uuidv7). */
  createForm(name: string): Promise<string>;
  getAnswers(formId: string): Promise<TrialAnswers>;
  /** Upsert av én `trial_answers`-rad på `(trial_form_id, field_key)`. Bildefelt skrives aldri her. */
  setAnswer(formId: string, fieldKey: string, value: TrialValue): Promise<void>;
  /** Lagrer filen lokalt (IndexedDB) og skriver `trial_photos`-raden. Opplasting skjer i bakgrunnen. */
  addPhoto(formId: string, fieldKey: string, file: Blob, photo: TrialPhoto): Promise<void>;
  /** Kalles med en ny snapshot hver gang lokale rader for skjemaet endres. Returnerer avmelding. */
  subscribe(formId: string, listener: (snapshot: TrialFormSnapshot) => void): () => void;
  status(): Promise<TrialSyncStatus>;
}

// Rene funksjoner som utvikler bygger (signaturer; implementasjonen ligger i filene som er nevnt).

/** Base64-kodet Yjs-oppdatering. Tåler JSON-rundtur og ligger i en tekstkolonne både i SQLite og PostgreSQL. */
export type TextState = string;

/** `text-merge.ts`: ingen React, ingen database. Kjører likt på iPad og server. */
export interface TextMerge {
  createTextState(text: string): TextState;
  /** Regner ut innsetting og sletting fra forrige tekst og legger dem på tilstanden. */
  applyTextEdit(state: TextState, newText: string): TextState;
  /** Kommutativ og idempotent: `merge(a, b)` = `merge(b, a)`, `merge(a, a)` = `a`. */
  mergeTextStates(a: TextState, b: TextState): TextState;
  textOf(state: TextState): string;
}

/**
 * `foreign-change.ts`: feltnøklene (bare `tg`, `choice`, `number`) der verdien ble endret av en
 * annen enhet. Tom `previousRows` gir aldri varsel; uendret verdi gir ikke varsel.
 */
export type DetectForeignChanges = (
  previousRows: readonly TrialAnswerRow[],
  nextRows: readonly TrialAnswerRow[],
  deviceId: string,
) => Set<string>;

/** Det klienten skriver for ett svar. Serveren eier resten av kolonnene. */
export type TrialAnswerRowInput = Pick<
  TrialAnswerRow,
  "id" | "trialFormId" | "fieldKey" | "value" | "textState" | "deviceId"
>;

/** `answer-rows.ts`: rene funksjoner mellom rader og `TrialAnswers`. */
export interface AnswerRows {
  answerToRow(
    formId: string,
    fieldKey: string,
    value: TrialValue,
    deviceId: string,
  ): TrialAnswerRowInput;
  /** Hopper over rader med `deletedAt`. Bilder i stabil rekkefølge (`createdAt`, så `id`). */
  rowsToAnswers(
    answerRows: readonly TrialAnswerRow[],
    photoRows: readonly TrialPhotoRow[],
  ): TrialAnswers;
}

/** Svaret fra `PUT /api/prove/bilder/[id]` slik klienten ser det. `undefined` = ikke noe svar. */
export interface PhotoUploadResponse {
  status: number;
  body?: { sha256?: string };
}

/**
 * `sync/photo-upload.ts`: den lokale filen slettes bare når serveren svarte 200 og `sha256` er lik
 * fingeravtrykket regnet lokalt. Alt annet gir «behold».
 */
export type ShouldReleaseLocalPhoto = (
  localSha256: string,
  response: PhotoUploadResponse | undefined,
) => boolean;

/** `sync/device.ts`: fast id per nettleser-installasjon (uuidv7 i `localStorage`, nøkkel `trial_device_id`). */
export type GetTrialDeviceId = () => string;
