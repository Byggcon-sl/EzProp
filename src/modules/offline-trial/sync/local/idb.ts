/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Lokal kjerne: én IndexedDB-database per kandidat (rått API, ingen avhengighet, ingen wasm).
 * Flyttet fra `electricsql/storage.ts` uten logikkendring; navn, versjon og tilstandslager kommer
 * nå fra `LocalDbOptions`, og forbindelsen ligger per instans. Hjelperne her vet ingenting om synk.
 */
import type { TrialTableName } from "../local-columns";
import {
  LOCAL_OUTBOX_STORE,
  LOCAL_SYNCED_STORES,
  type CreateLocalDb,
  type LocalDb,
  type LocalDbOptions,
  type LocalStoreName,
} from "./types";

/** Indeksen på `[trial_form_id, field_key]` i `synced_trial_answers` (unik). */
export const ANSWER_FORM_FIELD_INDEX = "form_field";
/** Indeksen på `trial_form_id` i `synced_trial_photos`. */
export const PHOTO_FORM_INDEX = "trial_form_id";

function upgrade(db: IDBDatabase, options: LocalDbOptions) {
  const has = (name: string) => db.objectStoreNames.contains(name);
  if (!has(LOCAL_SYNCED_STORES.trial_forms)) {
    db.createObjectStore(LOCAL_SYNCED_STORES.trial_forms, { keyPath: "id" });
  }
  if (!has(LOCAL_SYNCED_STORES.trial_answers)) {
    const answers = db.createObjectStore(LOCAL_SYNCED_STORES.trial_answers, { keyPath: "id" });
    answers.createIndex(ANSWER_FORM_FIELD_INDEX, ["trial_form_id", "field_key"], { unique: true });
  }
  if (!has(LOCAL_SYNCED_STORES.trial_photos)) {
    const photos = db.createObjectStore(LOCAL_SYNCED_STORES.trial_photos, { keyPath: "id" });
    photos.createIndex(PHOTO_FORM_INDEX, "trial_form_id");
  }
  if (!has(options.stateStore.name)) {
    db.createObjectStore(options.stateStore.name, { keyPath: options.stateStore.keyPath });
  }
  if (!has(LOCAL_OUTBOX_STORE)) {
    db.createObjectStore(LOCAL_OUTBOX_STORE, { keyPath: "seq" });
  }
}

/** Venter på én forespørsel. Brukes inne i en transaksjon (holder den åpen). */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Lagringen svarte med feil."));
  });
}

export const createLocalDb: CreateLocalDb = (options: LocalDbOptions): LocalDb => {
  let opening: Promise<IDBDatabase> | null = null;

  /** Åpner databasen én gang per instans. */
  function open(): Promise<IDBDatabase> {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(options.name, options.version);
      request.onupgradeneeded = () => upgrade(request.result, options);
      request.onsuccess = () => {
        const db = request.result;
        // En annen fane som vil slette databasen (organisasjonsbytte), skal ikke bli blokkert.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        opening = null;
        reject(request.error ?? new Error("Kunne ikke åpne lagringen på enheten."));
      };
    });
    return opening;
  }

  async function close(): Promise<void> {
    const current = opening;
    opening = null;
    if (!current) return;
    const db = await current.catch(() => null);
    db?.close();
  }

  async function clear(): Promise<void> {
    await close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(options.name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("Kunne ikke tømme lagringen."));
    });
  }

  async function inTransaction<T>(
    stores: readonly LocalStoreName[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await open();
    const tx = db.transaction([...stores], mode);
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Lagringen feilet."));
      tx.onabort = () => reject(tx.error ?? new Error("Lagringen ble avbrutt."));
    });
    let result: T;
    try {
      result = await body(tx);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // Allerede avsluttet.
      }
      await done.catch(() => undefined);
      throw error;
    }
    await done;
    return result;
  }

  function readAll<T>(storeName: LocalStoreName): Promise<T[]> {
    return inTransaction([storeName], "readonly", (tx) =>
      requestResult(tx.objectStore(storeName).getAll() as IDBRequest<T[]>),
    );
  }

  function syncedStoreOf(table: TrialTableName): LocalStoreName {
    return LOCAL_SYNCED_STORES[table];
  }

  return { options, open, close, clear, inTransaction, readAll, syncedStoreOf };
};
