/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Den lokale lagringen for ElectricSQL-kandidaten: IndexedDB-databasen `offline-trial-electric`
 * (rått API, ingen avhengighet, ingen wasm). Lagrene står i `ELECTRIC_STORES`. Hjelperne her vet
 * ingenting om synk; `store.ts` bestemmer hva som skrives. Kan gjenbrukes av kandidat 3.
 */
import type { TrialTableName } from "../local-columns";
import { ELECTRIC_DB_NAME, ELECTRIC_DB_VERSION, ELECTRIC_STORES } from "./types";

export type ElectricStoreName = (typeof ELECTRIC_STORES)[keyof typeof ELECTRIC_STORES];

/** Indeksen på `[trial_form_id, field_key]` i `synced_trial_answers` (unik). */
export const ANSWER_FORM_FIELD_INDEX = "form_field";
/** Indeksen på `trial_form_id` i `synced_trial_photos`. */
export const PHOTO_FORM_INDEX = "trial_form_id";

let opening: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase) {
  const has = (name: string) => db.objectStoreNames.contains(name);
  if (!has(ELECTRIC_STORES.trial_forms)) {
    db.createObjectStore(ELECTRIC_STORES.trial_forms, { keyPath: "id" });
  }
  if (!has(ELECTRIC_STORES.trial_answers)) {
    const answers = db.createObjectStore(ELECTRIC_STORES.trial_answers, { keyPath: "id" });
    answers.createIndex(ANSWER_FORM_FIELD_INDEX, ["trial_form_id", "field_key"], { unique: true });
  }
  if (!has(ELECTRIC_STORES.trial_photos)) {
    const photos = db.createObjectStore(ELECTRIC_STORES.trial_photos, { keyPath: "id" });
    photos.createIndex(PHOTO_FORM_INDEX, "trial_form_id");
  }
  if (!has(ELECTRIC_STORES.shapeState)) {
    db.createObjectStore(ELECTRIC_STORES.shapeState, { keyPath: "table" });
  }
  if (!has(ELECTRIC_STORES.outbox)) {
    db.createObjectStore(ELECTRIC_STORES.outbox, { keyPath: "seq" });
  }
}

/** Åpner databasen én gang per side. */
export function openElectricDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(ELECTRIC_DB_NAME, ELECTRIC_DB_VERSION);
    request.onupgradeneeded = () => upgrade(request.result);
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

/** Lukker forbindelsen (når lageret lukkes). Sletter ingenting. */
export async function closeElectricDb(): Promise<void> {
  const current = opening;
  opening = null;
  if (!current) return;
  const db = await current.catch(() => null);
  db?.close();
}

/** Tømmer hele `offline-trial-electric` (ved organisasjonsbytte). Bildene tømmes av `photo-store.ts`. */
export async function clearElectricStorage(): Promise<void> {
  await closeElectricDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(ELECTRIC_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Kunne ikke tømme lagringen."));
  });
}

/** Venter på én forespørsel. Brukes inne i en transaksjon (holder den åpen). */
export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Lagringen svarte med feil."));
  });
}

/**
 * Kjører `body` i én transaksjon og venter til den er lagret. Inne i `body` ventes det bare på
 * forespørsler i samme transaksjon, aldri på nett eller tidtakere (da lukkes transaksjonen).
 * Kaster `body`, avbrytes transaksjonen og ingenting lagres.
 */
export async function inTransaction<T>(
  stores: readonly ElectricStoreName[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openElectricDb();
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

/** Lagernavnet for de synkede radene i en tabell. */
export function syncedStoreOf(table: TrialTableName): ElectricStoreName {
  return ELECTRIC_STORES[table];
}

/** Alle verdier i et lager (prøvens datamengder er små). */
export async function readAll<T>(storeName: ElectricStoreName): Promise<T[]> {
  return inTransaction([storeName], "readonly", (tx) =>
    requestResult(tx.objectStore(storeName).getAll() as IDBRequest<T[]>),
  );
}
