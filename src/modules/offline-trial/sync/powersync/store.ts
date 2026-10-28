/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * `TrialSyncStore` for PowerSync (oppgavekortet pkt. 8, 18 og 22). Alt skrives i den lokale
 * databasen idet det skjer; synk skjer i bakgrunnen. Ett svar per felt (upsert på
 * `(trial_form_id, field_key)`). Tekstfelt skriver både `value` og `text_state` (Yjs), ventet
 * ca. 300 ms etter siste tastetrykk, og fletter med det som ligger lagret, så tekst fra en annen
 * enhet ikke forsvinner. Bildefilen legges i IndexedDB og raden i `trial_photos`.
 */
import type { AbstractPowerSyncDatabase, Transaction } from "@powersync/web";
import { uuidv7 } from "@/shared/lib/uuid";
import type { TrialAnswers, TrialPhoto, TrialValue } from "../../answers";
import { applyTextEdit, createTextState, mergeTextStates, textOf } from "../../text-merge";
import { listTrialFields, trialForm, type TrialFieldType } from "../../trial-form";
import { rowsToAnswers } from "../answer-rows";
import { putLocalPhoto } from "../photo-store";
import type {
  TrialAnswerRow,
  TrialFormSnapshot,
  TrialFormSummary,
  TrialPhotoRow,
  TrialSyncStatus,
  TrialSyncStore,
} from "../types";

export const TEXT_WRITE_DELAY_MS = 300;

const FIELD_TYPES = new Map<string, TrialFieldType>(
  listTrialFields(trialForm).map((field) => [field.key, field.type]),
);

interface AnswerRecord {
  id: string;
  trial_form_id: string;
  field_key: string;
  value: string | null;
  text_state: string | null;
  device_id: string;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

interface PhotoRecord {
  id: string;
  trial_form_id: string;
  field_key: string;
  name: string;
  size_bytes: number;
  sha256: string | null;
  uploaded_at: string | null;
  device_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
}

function safeTextOf(state: string): string | null {
  try {
    return textOf(state);
  } catch {
    return null;
  }
}

function toAnswerRow(record: AnswerRecord): TrialAnswerRow {
  let value = record.value;
  // Teksten følger den flettede tilstanden når den finnes (sannheten for tekst).
  if (record.text_state && FIELD_TYPES.get(record.field_key) === "text") {
    const text = safeTextOf(record.text_state);
    if (text !== null) value = JSON.stringify(text);
  }
  return {
    id: record.id,
    trialFormId: record.trial_form_id,
    fieldKey: record.field_key,
    value,
    textState: record.text_state,
    deviceId: record.device_id,
    createdAt: record.created_at ?? "",
    updatedAt: record.updated_at ?? "",
    deletedAt: record.deleted_at,
  };
}

function toPhotoRow(record: PhotoRecord): TrialPhotoRow {
  return {
    id: record.id,
    trialFormId: record.trial_form_id,
    fieldKey: record.field_key,
    name: record.name,
    sizeBytes: record.size_bytes,
    sha256: record.sha256,
    uploadedAt: record.uploaded_at,
    deviceId: record.device_id,
    createdAt: record.created_at ?? "",
    updatedAt: record.updated_at ?? "",
    deletedAt: record.deleted_at,
  };
}

/** Hvor mange tegn to tekster har felles i starten og slutten (grovt mål på hvor like de er). */
function sharedEdges(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let start = 0;
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return start + end;
}

/**
 * Ny tekst-tilstand for et felt. Endringen regnes fra den tilstanden brukeren skrev ut fra:
 * enten det denne enheten skrev sist (brukeren skriver videre), eller det som ligger lagret (en
 * annen enhet har skrevet, og brukeren har sett det). Resultatet flettes med det lagrede.
 */
export function nextTextState(
  stored: string | null,
  ownLast: string | null,
  newText: string,
): string {
  let base = stored ?? createTextState("");
  if (stored && ownLast) {
    const storedText = safeTextOf(stored);
    const ownText = safeTextOf(ownLast);
    if (
      storedText !== null &&
      ownText !== null &&
      storedText !== ownText &&
      sharedEdges(ownText, newText) > sharedEdges(storedText, newText)
    ) {
      base = ownLast;
    }
  }
  const edited = applyTextEdit(base, newText);
  return stored ? mergeTextStates(stored, edited) : edited;
}

interface PendingText {
  formId: string;
  fieldKey: string;
  text: string;
  timer: ReturnType<typeof setTimeout>;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
}

export interface PowerSyncTrialStore extends TrialSyncStore {
  /** Skriver tekst som venter (ved blur, når siden skjules og ved avmelding). */
  flush(): Promise<void>;
}

export function createPowerSyncTrialStore(
  db: AbstractPowerSyncDatabase,
  deviceId: string,
  organizationId: string,
): PowerSyncTrialStore {
  // Organisasjonen bestemmer hvilken lokal database som er åpnet (database.ts); radene har ikke
  // organization_id lokalt, serveren setter den fra grant.
  void organizationId;
  const pendingText = new Map<string, PendingText>();
  /** Siste tekst-tilstand denne enheten skrev, per skjema og felt. */
  const ownTextStates = new Map<string, string>();

  async function findAnswer(tx: Transaction, formId: string, fieldKey: string) {
    return tx.getOptional<{ id: string; text_state: string | null }>(
      `SELECT id, text_state FROM trial_answers
       WHERE trial_form_id = ? AND field_key = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [formId, fieldKey],
    );
  }

  async function insertAnswer(
    tx: Transaction,
    formId: string,
    fieldKey: string,
    value: string,
    textState: string | null,
    now: string,
  ) {
    await tx.execute(
      `INSERT INTO trial_answers
         (id, trial_form_id, field_key, value, text_state, device_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv7(), formId, fieldKey, value, textState, deviceId, now, now],
    );
  }

  async function writeValue(formId: string, fieldKey: string, value: TrialValue) {
    const json = JSON.stringify(value);
    await db.writeTransaction(async (tx) => {
      const now = new Date().toISOString();
      const existing = await findAnswer(tx, formId, fieldKey);
      if (existing) {
        await tx.execute(
          `UPDATE trial_answers SET value = ?, device_id = ?, updated_at = ? WHERE id = ?`,
          [json, deviceId, now, existing.id],
        );
      } else {
        await insertAnswer(tx, formId, fieldKey, json, null, now);
      }
    });
  }

  async function writeText(formId: string, fieldKey: string, text: string) {
    const key = `${formId}:${fieldKey}`;
    await db.writeTransaction(async (tx) => {
      const now = new Date().toISOString();
      const existing = await findAnswer(tx, formId, fieldKey);
      const state = nextTextState(
        existing?.text_state ?? null,
        ownTextStates.get(key) ?? null,
        text,
      );
      const json = JSON.stringify(textOf(state));
      if (existing) {
        await tx.execute(
          `UPDATE trial_answers SET value = ?, text_state = ?, device_id = ?, updated_at = ?
           WHERE id = ?`,
          [json, state, deviceId, now, existing.id],
        );
      } else {
        await insertAnswer(tx, formId, fieldKey, json, state, now);
      }
      ownTextStates.set(key, state);
    });
  }

  async function flushOne(key: string) {
    const pending = pendingText.get(key);
    if (!pending) return;
    pendingText.delete(key);
    clearTimeout(pending.timer);
    try {
      await writeText(pending.formId, pending.fieldKey, pending.text);
      for (const waiter of pending.waiters) waiter.resolve();
    } catch (error) {
      for (const waiter of pending.waiters) waiter.reject(error);
    }
  }

  async function flush() {
    await Promise.all([...pendingText.keys()].map((key) => flushOne(key)));
  }

  function scheduleText(formId: string, fieldKey: string, text: string): Promise<void> {
    const key = `${formId}:${fieldKey}`;
    const existing = pendingText.get(key);
    if (existing) clearTimeout(existing.timer);
    return new Promise<void>((resolve, reject) => {
      const waiters = existing?.waiters ?? [];
      waiters.push({ resolve, reject });
      pendingText.set(key, {
        formId,
        fieldKey,
        text,
        waiters,
        timer: setTimeout(() => void flushOne(key), TEXT_WRITE_DELAY_MS),
      });
    });
  }

  async function readSnapshot(formId: string): Promise<TrialFormSnapshot> {
    const [answers, photos] = await Promise.all([
      db.getAll<AnswerRecord>(
        `SELECT id, trial_form_id, field_key, value, text_state, device_id,
                created_at, updated_at, deleted_at
         FROM trial_answers WHERE trial_form_id = ?`,
        [formId],
      ),
      db.getAll<PhotoRecord>(
        `SELECT id, trial_form_id, field_key, name, size_bytes, sha256, uploaded_at, device_id,
                created_at, updated_at, deleted_at
         FROM trial_photos WHERE trial_form_id = ?`,
        [formId],
      ),
    ]);
    return { answers: answers.map(toAnswerRow), photos: photos.map(toPhotoRow) };
  }

  return {
    flush,

    async listForms(): Promise<TrialFormSummary[]> {
      const rows = await db.getAll<{ id: string; name: string; created_at: string | null }>(
        `SELECT id, name, created_at FROM trial_forms
         WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
      );
      return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at ?? "" }));
    },

    async createForm(name: string): Promise<string> {
      const id = uuidv7();
      await db.writeTransaction(async (tx) => {
        let formName = name.trim();
        if (formName === "") {
          const count = await tx.get<{ n: number }>(
            "SELECT count(*) AS n FROM trial_forms WHERE deleted_at IS NULL",
          );
          formName = `Testskjema ${count.n + 1}`;
        }
        const now = new Date().toISOString();
        await tx.execute(
          "INSERT INTO trial_forms (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
          [id, formName, now, now],
        );
      });
      return id;
    },

    async getAnswers(formId: string): Promise<TrialAnswers> {
      const snapshot = await readSnapshot(formId);
      return rowsToAnswers(snapshot.answers, snapshot.photos);
    },

    async setAnswer(formId: string, fieldKey: string, value: TrialValue): Promise<void> {
      const type = FIELD_TYPES.get(fieldKey);
      if (!type || type === "photo") return;
      if (type === "text") {
        return scheduleText(formId, fieldKey, typeof value === "string" ? value : "");
      }
      // Tekst som venter skrives først, så rekkefølgen i synkkøen følger det brukeren gjorde.
      await flush();
      await writeValue(formId, fieldKey, value);
    },

    async addPhoto(formId: string, fieldKey: string, file: Blob, photo: TrialPhoto) {
      // Filen først: finnes raden, skal filen også finnes (ingenting går tapt).
      await putLocalPhoto(photo.id, file);
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO trial_photos
           (id, trial_form_id, field_key, name, size_bytes, device_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [photo.id, formId, fieldKey, photo.name, photo.sizeBytes, deviceId, now, now],
      );
    },

    subscribe(formId: string, listener: (snapshot: TrialFormSnapshot) => void): () => void {
      let active = true;
      const dispose = db.onChange(
        {
          onChange: async () => {
            const snapshot = await readSnapshot(formId);
            if (active) listener(snapshot);
          },
        },
        { tables: ["trial_answers", "trial_photos"], throttleMs: 30, triggerImmediate: true },
      );
      return () => {
        active = false;
        dispose();
        void flush();
      };
    },

    async status(): Promise<TrialSyncStatus> {
      const [crud, photos] = await Promise.all([
        db.get<{ n: number }>("SELECT count(*) AS n FROM ps_crud"),
        db.get<{ n: number }>(
          `SELECT count(*) AS n FROM trial_photos
           WHERE uploaded_at IS NULL AND device_id = ? AND deleted_at IS NULL`,
          [deviceId],
        ),
      ]);
      return {
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        pendingChanges: crud.n,
        pendingPhotos: photos.n,
      };
    },
  };
}
