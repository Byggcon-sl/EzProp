/**
 * «Synk nå» i den lokale kjernen uten nettleser (docs/agenter/oppgaver/fase1-smafunn-synkstatus.md
 * pkt. 1, testplanen avsnitt 1). Falsk `LocalDb` i minnet (ingen ny avhengighet), stub-leser og
 * byttet ut `fetch`. Falske tidtakere, aldri ekte venting. Oppdiktede data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrialTableName } from "../local-columns";
import type { OutboxEntry } from "../types";
import { retryDelayMs } from "./outbox";
import { createLocalTrialStore } from "./trial-store";
import {
  LOCAL_OUTBOX_STORE,
  LOCAL_SYNCED_STORES,
  type LocalDb,
  type LocalStoreName,
  type LocalTrialReader,
  type LocalTrialStore,
} from "./types";

const ORGANIZATION_ID = "00000000-0000-4000-8000-0000000000aa";
const FORM_ID = "00000000-0000-4000-8000-0000000000f1";
const STATE_STORE = { name: "sync_state", keyPath: "key" };

/** Forespørsel som lykkes i neste mikrooppgave (etter at `requestResult` har satt `onsuccess`). */
function fakeRequest<T>(result: T): IDBRequest<T> {
  const request = { result, error: null } as unknown as {
    result: T;
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
  };
  request.onsuccess = null;
  request.onerror = null;
  void Promise.resolve().then(() => request.onsuccess?.());
  return request as unknown as IDBRequest<T>;
}

interface FakeDbFaults {
  /** Satt: `inTransaction` kaster denne feilen. */
  transaction?: Error | null;
  readAllStore?: { store: LocalStoreName; error: Error } | null;
}

/** Håndskrevet `LocalDb` i minnet: lagrene er `Map` fra nøkkel til rad. */
function createFakeDb(outbox: OutboxEntry[]) {
  const stores = new Map<string, Map<unknown, Record<string, unknown>>>();
  const store = (name: string) => {
    let found = stores.get(name);
    if (!found) {
      found = new Map();
      stores.set(name, found);
    }
    return found;
  };
  for (const entry of outbox) store(LOCAL_OUTBOX_STORE).set(entry.seq, { ...entry });
  const keyPathOf = (name: string) =>
    name === LOCAL_OUTBOX_STORE ? "seq" : name === STATE_STORE.name ? STATE_STORE.keyPath : "id";

  const faults: FakeDbFaults = {};
  const tx = {
    objectStore(name: string) {
      const rows = store(name);
      return {
        delete: (key: unknown) => {
          rows.delete(key);
          return fakeRequest(undefined);
        },
        put: (row: Record<string, unknown>) => {
          rows.set(row[keyPathOf(name)], row);
          return fakeRequest(row[keyPathOf(name)]);
        },
        get: (key: unknown) => fakeRequest(rows.get(key)),
        getAll: () => fakeRequest([...rows.values()]),
      };
    },
  } as unknown as IDBTransaction;

  const db: LocalDb = {
    options: { name: "offline-trial-test", version: 1, stateStore: STATE_STORE },
    open: () => Promise.reject(new Error("Ikke i bruk i testen.")),
    close: async () => {},
    clear: async () => {},
    async inTransaction(_stores, _mode, body) {
      if (faults.transaction) throw faults.transaction;
      return body(tx);
    },
    async readAll<T>(name: LocalStoreName): Promise<T[]> {
      if (faults.readAllStore && faults.readAllStore.store === name)
        throw faults.readAllStore.error;
      return [...store(name).values()].map((row) => ({ ...row })) as T[];
    },
    syncedStoreOf: (table: TrialTableName) => LOCAL_SYNCED_STORES[table],
  };
  return { db, faults };
}

/** Leser uten egne tidtakere. `syncNow` er en `vi.fn`. */
function createStubReader() {
  return {
    start: vi.fn(),
    wake: vi.fn(),
    syncNow: vi.fn(async () => {}),
    serverConfirmed: vi.fn(() => true),
    stop: vi.fn(),
  } satisfies LocalTrialReader;
}

function outboxEntries(): OutboxEntry[] {
  const now = "2026-10-29T08:00:00.000Z";
  return [
    {
      seq: 1,
      op: "PUT",
      table: "trial_forms",
      id: FORM_ID,
      data: { name: "Testskjema 1", created_at: now, updated_at: now },
    },
    {
      seq: 2,
      op: "PUT",
      table: "trial_answers",
      id: "00000000-0000-4000-8000-0000000000a1",
      data: {
        trial_form_id: FORM_ID,
        field_key: "floors",
        value: "2",
        text_state: null,
        device_id: "enhet-test-1",
        created_at: now,
        updated_at: now,
      },
    },
  ];
}

const response = (status: number) => new Response("{}", { status });

let store: LocalTrialStore | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

async function openStore(options: { online?: boolean } = {}) {
  vi.stubGlobal("navigator", { onLine: options.online ?? true });
  const fake = createFakeDb(outboxEntries());
  const reader = createStubReader();
  store = await createLocalTrialStore({
    db: fake.db,
    deviceId: "enhet-test-1",
    organizationId: ORGANIZATION_ID,
    reader,
  });
  return { ...fake, reader, store };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  if (store) {
    const closing = store.close();
    await vi.runOnlyPendingTimersAsync();
    await closing;
    store = null;
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("«Synk nå» i den lokale kjernen (trial-store)", () => {
  it("Synk nå sender køen med en gang etter en feil, forbi ventetiden", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(response(503)).mockResolvedValue(response(200));
    const { store, reader } = await openStore();

    // Første sending (planlagt ved åpning) får 503: køen står og venter på neste forsøk.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await store.readRows("outbox")).toHaveLength(2);

    // «Synk nå» uten å flytte tiden: sendes med en gang.
    const result = await store.syncNow();
    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await store.readRows("outbox")).toEqual([]);

    // T1d: leseren henter i runden, etter at køen er sendt.
    expect(reader.syncNow).toHaveBeenCalledTimes(1);
    const lastFetch = Math.max(...fetchMock.mock.invocationCallOrder);
    expect(reader.syncNow.mock.invocationCallOrder[0]).toBeGreaterThan(lastFetch);

    // Den gamle ventetiden gir ingen nye kall, og ingen tidtaker henger igjen.
    await vi.advanceTimersByTimeAsync(retryDelayMs(0) + 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Synk nå gir failed ved 500, og køen står", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(response(500));
    const { store } = await openStore();
    const before = await store.readRows("outbox");
    expect(before).toHaveLength(2);

    const result = await store.syncNow();

    expect(result).toBe("failed");
    expect(fetchMock).toHaveBeenCalled();
    expect(await store.readRows("outbox")).toEqual(before);
  });

  it("Synk nå uten nett gir offline og sender ingenting", async () => {
    const { store, reader } = await openStore({ online: false });
    const before = await store.readRows("outbox");

    await vi.advanceTimersByTimeAsync(0);
    const result = await store.syncNow();

    expect(result).toBe("offline");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reader.syncNow).not.toHaveBeenCalled();
    expect(await store.readRows("outbox")).toEqual(before);
  });

  it("Synk nå henter etter at køen er sendt", async () => {
    fetchMock.mockResolvedValue(response(200));
    const { store, reader } = await openStore();

    const result = await store.syncNow();

    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalled();
    expect(reader.syncNow).toHaveBeenCalledTimes(1);
    const lastFetch = Math.max(...fetchMock.mock.invocationCallOrder);
    expect(reader.syncNow.mock.invocationCallOrder[0]).toBeGreaterThan(lastFetch);
  });

  it("Synk nå ved nettfeil gir failed, og køen står", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const { store } = await openStore();
    const before = await store.readRows("outbox");

    const result = await store.syncNow();

    expect(result).toBe("failed");
    expect(fetchMock).toHaveBeenCalled();
    expect(await store.readRows("outbox")).toEqual(before);
  });
});

describe("loggen i trial-store", () => {
  /** Ingen argumenter er feilobjekter eller andre objekter; bare tekst (og tall). */
  function expectOnlyText(args: unknown[]) {
    for (const arg of args) {
      expect(arg instanceof Error).toBe(false);
      expect(typeof arg === "object" && arg !== null).toBe(false);
    }
    expect(typeof args[0]).toBe("string");
  }

  it("loggen viser bare feilmeldingen, aldri feilobjektet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(response(200));
    const { store, faults } = await openStore();
    // Kvitteringen (sletting fra køen) kaster.
    faults.transaction = new Error("hemmelig-innhold");

    const result = await store.syncNow();
    expect(result).toBe("failed");

    const stopped = warn.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("Synk: sendingen stoppet."),
    );
    expect(stopped.length).toBeGreaterThan(0);
    for (const call of stopped) expectOnlyText(call);
  });

  it("advarslene «kunne ikke lese listen» og «kunne ikke lese skjemaet» viser ikke feilobjektet", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue(response(200));
    const { store, faults } = await openStore();
    await vi.advanceTimersByTimeAsync(0);

    faults.readAllStore = {
      store: LOCAL_SYNCED_STORES.trial_forms,
      error: new Error("hemmelig-innhold"),
    };
    faults.transaction = new Error("hemmelig-innhold");
    const stopForms = store.subscribeForms(() => {});
    const stopForm = store.subscribe(FORM_ID, () => {});
    await vi.advanceTimersByTimeAsync(0);
    stopForms();
    faults.transaction = null;
    stopForm();
    faults.readAllStore = null;

    const readFailures = warn.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("kunne ikke lese"),
    );
    expect(readFailures.length).toBe(2);
    for (const call of readFailures) expectOnlyText(call);
  });
});
