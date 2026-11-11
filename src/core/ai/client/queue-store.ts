import { AiQueueUnavailableError, toAiQueueUnavailableError } from "./errors";
import {
  AI_QUEUE_DB_NAME,
  AI_QUEUE_DB_VERSION,
  AI_QUEUE_STORE_NAME,
  type AiQueueStore,
  type AiQueueStoreChange,
  type CreateIndexedDbAiQueueStore,
} from "./types";

/*
 * IndexedDB-utgaven av lageret for KI-køen (A186, A187). Rått API med en egen liten åpner:
 * kjernen kan ikke importere åpneren i prøvemodulen. Egen database, ett lager med nøkkel
 * `requestId` og ingen indeks. Tilkoblingen lukkes etter hver operasjon og ved `versionchange`,
 * så en annen fane aldri blokkeres. Alle feil blir `AiQueueUnavailableError` med bare feilnavnet.
 * Prøves i e2e; Vitest har ikke IndexedDB.
 */

function openDatabase(): Promise<IDBDatabase> {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!factory) return Promise.reject(new AiQueueUnavailableError("MissingIndexedDB"));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(AI_QUEUE_DB_NAME, AI_QUEUE_DB_VERSION);
    } catch (error) {
      reject(toAiQueueUnavailableError(error));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AI_QUEUE_STORE_NAME)) {
        db.createObjectStore(AI_QUEUE_STORE_NAME, { keyPath: "requestId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(toAiQueueUnavailableError(request.error));
  });
}

/** Åpner, kjører `work` i én transaksjon, og lukker alltid tilkoblingen. */
async function withTransaction<T>(
  work: (store: IDBObjectStore, tx: IDBTransaction, fail: (error: unknown) => void) => () => T,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(AI_QUEUE_STORE_NAME, "readwrite");
      } catch (error) {
        reject(toAiQueueUnavailableError(error));
        return;
      }
      let failure: unknown = undefined;
      let failed = false;
      const fail = (error: unknown) => {
        if (!failed) {
          failed = true;
          failure = error;
        }
        try {
          tx.abort();
        } catch {
          // Transaksjonen er allerede avsluttet.
        }
      };
      let readResult: () => T;
      try {
        readResult = work(tx.objectStore(AI_QUEUE_STORE_NAME), tx, fail);
      } catch (error) {
        fail(error);
        reject(toAiQueueUnavailableError(error));
        return;
      }
      tx.oncomplete = () => {
        try {
          resolve(readResult());
        } catch (error) {
          reject(toAiQueueUnavailableError(error));
        }
      };
      tx.onabort = () => reject(toAiQueueUnavailableError(failed ? failure : tx.error));
    });
  } catch (error) {
    throw toAiQueueUnavailableError(error);
  } finally {
    db.close();
  }
}

export const createIndexedDbAiQueueStore: CreateIndexedDbAiQueueStore = (): AiQueueStore => ({
  update<T>(decide: (stored: readonly unknown[]) => AiQueueStoreChange<T>): Promise<T> {
    return withTransaction<T>((store, _tx, fail) => {
      let result: { value: T } | null = null;
      const read = store.getAll();
      read.onsuccess = () => {
        try {
          // `decide` er synkron, så transaksjonen lever til alt er skrevet.
          const change = decide(read.result as unknown[]);
          for (const requestId of change.remove) store.delete(requestId);
          for (const raw of change.drop ?? []) {
            // Med `keyPath` har hver lagret post en gyldig nøkkel, også når den ikke er tekst.
            const key = (raw as { requestId?: IDBValidKey } | null)?.requestId;
            if (key !== undefined) store.delete(key);
          }
          for (const entry of change.put) store.put(entry);
          result = { value: change.result };
        } catch (error) {
          fail(error);
        }
      };
      return () => {
        if (!result) throw new AiQueueUnavailableError("MissingResult");
        return result.value;
      };
    });
  },
  clear(): Promise<void> {
    return withTransaction<void>((store) => {
      store.clear();
      return () => undefined;
    });
  },
});
