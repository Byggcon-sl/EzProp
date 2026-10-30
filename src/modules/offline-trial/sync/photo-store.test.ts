import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  clearLocalPhotos,
  confirmLocalPhoto,
  displayCopyKey,
  displayFailedKey,
  getLocalPhoto,
  hasDisplayCopyFailed,
  isConfirmedPhotoKey,
  listConfirmedPhotoIds,
  listDisplayFailedPhotoIds,
  listLocalDisplayCopyIds,
  markDisplayCopyFailed,
  onDisplayFailedChange,
  putLocalPhoto,
} from "./photo-store";

// Vitest har ingen IndexedDB, og vi legger ikke til en avhengighet for det. Dette er det minste
// `photo-store.ts` bruker: åpne databasen, lagre, transaksjon over ett eller flere lagre og
// `get`/`put`/`delete`/`clear`/`getAllKeys`. Alt kjører synkront; `oncomplete` kommer etterpå.
// Testplan avsnitt 2 (U8, U9, U10). Alle data er oppdiktet.

type Store = Map<IDBValidKey, unknown>;
const stores = new Map<string, Store>();

function request<T>(result: T) {
  return { result, error: null } as unknown as IDBRequest<T>;
}

function fakeDb() {
  return {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      stores.set(name, new Map());
    },
    onversionchange: null,
    close: () => undefined,
    transaction(names: string[]) {
      const tx = {
        error: null,
        oncomplete: null as null | (() => void),
        onerror: null,
        onabort: null,
        objectStore(name: string) {
          if (!names.includes(name)) throw new Error(`Lageret ${name} er ikke i transaksjonen`);
          const store = stores.get(name)!;
          return {
            get: (key: IDBValidKey) => request(store.get(key)),
            put: (value: unknown, key: IDBValidKey) => {
              store.set(key, value);
              return request(key);
            },
            delete: (key: IDBValidKey) => {
              store.delete(key);
              return request(undefined);
            },
            clear: () => {
              store.clear();
              return request(undefined);
            },
            getAllKeys: () => request([...store.keys()]),
          };
        },
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
}

beforeAll(() => {
  const db = fakeDb();
  vi.stubGlobal("indexedDB", {
    open: () => {
      const open = {
        result: db,
        onupgradeneeded: null as null | (() => void),
        onsuccess: null as null | (() => void),
      };
      setTimeout(() => {
        open.onupgradeneeded?.();
        open.onsuccess?.();
      }, 0);
      return open;
    },
  });
});

beforeEach(() => {
  for (const store of stores.values()) store.clear();
});

function confirmedStore(): Store {
  return stores.get("confirmed")!;
}

describe("merknaden om endelig feilet visningskopi", () => {
  // U9 (alvorlig hvis den mangler)
  it("merknaden er aldri et bekreftet bilde", async () => {
    const id = uuidv7();
    await markDisplayCopyFailed(id, "400");

    const confirmed = await listConfirmedPhotoIds();
    expect(confirmed.has(id)).toBe(false);
    expect(confirmed.has(displayFailedKey(id))).toBe(false);
    expect(confirmed.size).toBe(0);
    expect(confirmedStore().has(displayFailedKey(id))).toBe(true);

    // Med en bekreftet original står bare id-en, aldri merknaden
    const other = uuidv7();
    await confirmLocalPhoto(other, "a".repeat(64));
    expect([...(await listConfirmedPhotoIds())]).toEqual([other]);
  });

  it("isConfirmedPhotoKey godtar bilde-id og avviser merknaden og andre typer", () => {
    const id = uuidv7();
    expect(isConfirmedPhotoKey(id)).toBe(true);
    expect(isConfirmedPhotoKey(displayFailedKey(id))).toBe(false);
    expect(isConfirmedPhotoKey(42)).toBe(false);
  });

  // U10
  it.each(["400", "404"] as const)(
    "merknaden har bare uuid i nøkkelen og fast kode som verdi (%s)",
    async (reason) => {
      const id = uuidv7();
      await markDisplayCopyFailed(id, reason);

      expect([...confirmedStore().keys()]).toEqual([`display-failed:${id}`]);
      expect(confirmedStore().get(displayFailedKey(id))).toBe(reason);
      expect(await hasDisplayCopyFailed(id)).toBe(true);
      expect(await listDisplayFailedPhotoIds()).toEqual(new Set([id]));
    },
  );

  it("merknaden sletter kopien, men aldri originalen", async () => {
    const id = uuidv7();
    const original = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    await putLocalPhoto(id, original);
    await putLocalPhoto(displayCopyKey(id), new Blob([new Uint8Array([4])]));

    await markDisplayCopyFailed(id, "404");

    expect(await getLocalPhoto(displayCopyKey(id))).toBeUndefined();
    expect(await getLocalPhoto(id)).toBe(original);
    expect(await listLocalDisplayCopyIds()).toEqual([]);
  });

  // U8
  it("clearLocalPhotos tømmer merknaden", async () => {
    const id = uuidv7();
    await markDisplayCopyFailed(id, "400");
    const listener = vi.fn();
    const dispose = onDisplayFailedChange(listener);

    await clearLocalPhotos();

    expect(await hasDisplayCopyFailed(id)).toBe(false);
    expect(await listDisplayFailedPhotoIds()).toEqual(new Set());
    expect(confirmedStore().size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("varsler siden når en merknad settes", async () => {
    const listener = vi.fn();
    const dispose = onDisplayFailedChange(listener);
    await markDisplayCopyFailed(uuidv7(), "404");
    expect(listener).toHaveBeenCalledTimes(1);
    dispose();
    await markDisplayCopyFailed(uuidv7(), "404");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
