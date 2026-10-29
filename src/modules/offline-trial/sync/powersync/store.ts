/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * `TrialSyncStore` for PowerSync (oppgavekortet pkt. 8, 18 og 22). Alt skrives i den lokale
 * databasen idet det skjer; synk skjer i bakgrunnen. Ett svar per felt (upsert på
 * `(trial_form_id, field_key)`). Tekstfelt skriver både `value` og `text_state` (Yjs), ventet
 * ca. 300 ms etter siste tastetrykk, og fletter med det som ligger lagret, så tekst fra en annen
 * enhet ikke forsvinner. Bildefilen legges i IndexedDB og raden i `trial_photos`.
 *
 * Synkstatus (docs/funksjoner/fase1-synkstatus.md, K3 og K5): «Synk nå» sender køen selv
 * (`connector.uploadAll`) og venter så på en henting fra PowerSync-tjenesten. `serverConfirmed`
 * bygger bare på svar fra serveren og tjenesten, aldri på `navigator.onLine` alene.
 */
import type { AbstractPowerSyncDatabase, SyncStatus, Transaction } from "@powersync/web";
import { uuidv7 } from "@/shared/lib/uuid";
import type { TrialPhoto, TrialValue } from "../../answers";
import { textOf } from "../../text-merge";
import { listTrialFields, trialForm, type TrialFieldType } from "../../trial-form";
import { confirmLocalPhoto, listConfirmedPhotoIds, putLocalPhoto } from "../photo-store";
import { isPhotoWaiting } from "../photo-upload";
import { nextTextState, safeTextOf, TEXT_WRITE_DELAY_MS } from "../text-state";
import { runSyncNow, singleFlight, SYNC_NOW_TIMEOUT_MS } from "../sync-now";
import { lastUploadFailed, TrialSyncConnector } from "./connector";
import type {
  TrialAnswerRow,
  TrialFormSnapshot,
  TrialFormSummary,
  TrialPhotoRow,
  TrialSyncRoundResult,
  TrialSyncStatus,
  TrialSyncStore,
} from "../types";

// Delt med ElectricSQL-lageret; eksporteres herfra også så testen store-text.test.ts står.
export { nextTextState, TEXT_WRITE_DELAY_MS } from "../text-state";

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

interface PendingText {
  formId: string;
  fieldKey: string;
  text: string;
  timer: ReturnType<typeof setTimeout>;
  waiters: { resolve: () => void; reject: (error: unknown) => void }[];
}

/** PowerSync-utgaven. Alt står i `TrialSyncStore` (avgjørelse A); navnet beholdes for provideren. */
export type PowerSyncTrialStore = TrialSyncStore;

interface FormRecord {
  id: string;
  name: string;
  created_at: string | null;
}

function toFormSummary(record: FormRecord): TrialFormSummary {
  return { id: record.id, name: record.name, createdAt: record.created_at ?? "" };
}

const PENDING_PHOTOS_SQL = `SELECT id, trial_form_id, field_key, name, size_bytes, sha256, uploaded_at, device_id,
          created_at, updated_at, deleted_at
   FROM trial_photos WHERE uploaded_at IS NULL AND device_id = ? AND deleted_at IS NULL
   ORDER BY created_at, id`;

function isOnline(): boolean {
  // Node har `navigator` uten `onLine` (tester); bare et uttrykkelig `false` betyr uten nett.
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Noe er galt mot tjenesten nå: ikke koblet til, eller feil ved henting eller opplasting. */
function hasSyncProblem(status: SyncStatus): boolean {
  return !status.connected || Boolean(status.downloadError) || Boolean(status.uploadError);
}

/** En henting fra tjenesten er ferdig etter `since` (ms). */
function downloadedSince(status: SyncStatus, since: number): boolean {
  const syncedAt = status.lastSyncedAt?.getTime();
  return (
    status.connected &&
    syncedAt !== undefined &&
    syncedAt > since &&
    !status.downloading &&
    !status.downloadError
  );
}

/**
 * `connector` kan sendes inn (tester); ellers lages en ny. Låsen rundt opplastingen er per
 * database (connector.ts), så den deles med connectoren SDK-en bruker (database.ts).
 */
export function createPowerSyncTrialStore(
  db: AbstractPowerSyncDatabase,
  deviceId: string,
  organizationId: string,
  connector: TrialSyncConnector = new TrialSyncConnector(organizationId),
): PowerSyncTrialStore {
  // Organisasjonen bestemmer hvilken lokal database som er åpnet (database.ts); radene har ikke
  // organization_id lokalt, serveren setter den fra grant.
  const pendingText = new Map<string, PendingText>();
  /** Varsler som ikke kommer fra en tabell eller SDK-status: bekreftede bilder og «Synk nå». */
  const statusListeners = new Set<() => void>();

  function notifyStatus() {
    for (const listener of statusListeners) listener();
  }

  // K5: tidspunktet (ms) for siste feil, frakobling eller tap av nett. Bekreftet krever en henting
  // fra tjenesten etter dette. Starter ved åpning, så `lastSyncedAt` fra en tidligere økt ikke teller.
  let lastProblemAt = Date.now();
  function markProblem() {
    lastProblemAt = Date.now();
  }
  const disposeProblemWatch = db.registerListener({
    statusChanged: (status) => {
      if (hasSyncProblem(status)) markProblem();
    },
  });
  const onOffline = () => {
    markProblem();
    notifyStatus();
  };
  if (typeof window !== "undefined") window.addEventListener("offline", onOffline);

  function isServerConfirmed(): boolean {
    if (!isOnline() || lastUploadFailed(db)) return false;
    const status = db.currentStatus;
    if (hasSyncProblem(status)) return false;
    return downloadedSince(status, lastProblemAt);
  }

  /**
   * Venter på en henting fra tjenesten som er ferdig etter `since`. Ikke koblet til: kaster straks
   * (runden er sending og henting, som for ElectricSQL). Tidsavbruddet ligger i `runSyncNow`.
   */
  function waitForDownload(since: number, uploaded: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const check = (status: SyncStatus): boolean => {
        if (!status.connected) {
          reject(new Error("Ikke koblet til synktjenesten."));
          return true;
        }
        // Ingenting ble sendt i runden og tjenesten er koblet til uten feil, med en henting etter
        // siste problem: strømmen er oppdatert, så vi venter ikke på et sjekkpunkt som ikke kommer.
        if (
          downloadedSince(status, since) ||
          (!uploaded && !hasSyncProblem(status) && downloadedSince(status, lastProblemAt))
        ) {
          resolve();
          return true;
        }
        return false;
      };
      if (check(db.currentStatus)) return;
      // Lytteren fjernes også etter tidsavbruddet, så den ikke blir hengende etter runden.
      const timer = setTimeout(() => {
        dispose();
        reject(new Error("Tidsavbrudd ved henting."));
      }, SYNC_NOW_TIMEOUT_MS);
      const dispose = db.registerListener({
        statusChanged: (status) => {
          if (!check(status)) return;
          clearTimeout(timer);
          dispose();
        },
      });
    });
  }

  async function round(): Promise<void> {
    const startedAt = Date.now();
    await flush();
    const before = await db.get<{ n: number }>("SELECT count(*) AS n FROM ps_crud");
    try {
      await connector.uploadAll(db);
    } catch (error) {
      markProblem();
      throw error;
    }
    await waitForDownload(startedAt, before.n > 0);
  }

  const syncNowOnce = singleFlight(async (): Promise<TrialSyncRoundResult> => {
    try {
      return await runSyncNow({ isOnline, round });
    } finally {
      notifyStatus();
    }
  });

  /** Bilder fra denne enheten som venter på opplasting (uten `uploaded_at`, ikke bekreftet). */
  async function waitingPhotos(): Promise<PhotoRecord[]> {
    const [rows, confirmed] = await Promise.all([
      db.getAll<PhotoRecord>(PENDING_PHOTOS_SQL, [deviceId]),
      listConfirmedPhotoIds(),
    ]);
    return rows.filter((row) => isPhotoWaiting(row, deviceId, confirmed));
  }
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

  async function readForms(): Promise<TrialFormSummary[]> {
    const rows = await db.getAll<FormRecord>(
      `SELECT id, name, created_at FROM trial_forms
       WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
    );
    return rows.map(toFormSummary);
  }

  async function readSnapshot(formId: string): Promise<TrialFormSnapshot> {
    const [form, answers, photos] = await Promise.all([
      db.getOptional<FormRecord>(
        "SELECT id, name, created_at FROM trial_forms WHERE id = ? AND deleted_at IS NULL",
        [formId],
      ),
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
    return {
      form: form ? toFormSummary(form) : null,
      answers: answers.map(toAnswerRow),
      photos: photos.map(toPhotoRow),
    };
  }

  return {
    flush,

    syncNow: syncNowOnce,

    async close(): Promise<void> {
      await flush();
      disposeProblemWatch();
      if (typeof window !== "undefined") window.removeEventListener("offline", onOffline);
      await db.close();
    },

    listForms: readForms,

    subscribeForms(listener: (forms: TrialFormSummary[]) => void): () => void {
      let active = true;
      const dispose = db.onChange(
        {
          onChange: async () => {
            const forms = await readForms();
            if (active) listener(forms);
          },
        },
        { tables: ["trial_forms"], throttleMs: 30, triggerImmediate: true },
      );
      return () => {
        active = false;
        dispose();
      };
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
        {
          tables: ["trial_forms", "trial_answers", "trial_photos"],
          throttleMs: 30,
          triggerImmediate: true,
        },
      );
      return () => {
        active = false;
        dispose();
        void flush();
      };
    },

    onStatusChange(listener: () => void): () => void {
      // Bekreftede bilder (`confirmLocalPhoto`) endrer ingen tabell, så de varsles her.
      statusListeners.add(listener);
      const disposeTables = db.onChange(
        { onChange: () => listener() },
        { tables: ["ps_crud", "trial_answers", "trial_photos"], throttleMs: 100 },
      );
      const disposeStatus = db.registerListener({ statusChanged: () => listener() });
      return () => {
        statusListeners.delete(listener);
        disposeTables();
        disposeStatus();
      };
    },

    async listPendingPhotos(): Promise<TrialPhotoRow[]> {
      return (await waitingPhotos()).map(toPhotoRow);
    },

    async markPhotoUploaded(id: string, sha256: string): Promise<void> {
      // Bare i bildelageret, aldri i ps_crud eller trial_photos (avgjørelse 6, småfunn 6):
      // serveren eier `uploaded_at` og `sha256` og setter dem selv.
      await confirmLocalPhoto(id, sha256);
      notifyStatus();
    },

    async status(): Promise<TrialSyncStatus> {
      const [crud, photos] = await Promise.all([
        db.get<{ n: number }>("SELECT count(*) AS n FROM ps_crud"),
        waitingPhotos(),
      ]);
      return {
        online: isOnline(),
        serverConfirmed: isServerConfirmed(),
        pendingChanges: crud.n,
        pendingPhotos: photos.length,
      };
    },
  };
}
