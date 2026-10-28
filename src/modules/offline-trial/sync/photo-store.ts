/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Bildefilene på enheten, i IndexedDB-databasen `offline-trial-photos` (rått API, ingen
 * avhengighet). Ett objektlager; nøkkelen er `photo.id`. Filen slettes bare av opplasteren når
 * serveren har bekreftet fingeravtrykket (oppgavekortet pkt. 22).
 */

export const TRIAL_PHOTO_DB_NAME = "offline-trial-photos";
const STORE_NAME = "photos";

let opening: Promise<IDBDatabase> | null = null;

function openPhotoDb(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(TRIAL_PHOTO_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error ?? new Error("Kunne ikke åpne lageret for bilder."));
    };
  });
  return opening;
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openPhotoDb();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? request.error);
    transaction.onabort = () => reject(transaction.error ?? new Error("Lagring av bilde avbrutt."));
  });
}

export async function putLocalPhoto(id: string, file: Blob): Promise<void> {
  await run("readwrite", (store) => store.put(file, id));
}

export async function getLocalPhoto(id: string): Promise<Blob | undefined> {
  const value = await run<unknown>("readonly", (store) => store.get(id));
  return value instanceof Blob ? value : undefined;
}

export async function deleteLocalPhoto(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

/** Tømmer lageret (ved bytte av organisasjon på samme enhet). */
export async function clearLocalPhotos(): Promise<void> {
  await run("readwrite", (store) => store.clear());
}
