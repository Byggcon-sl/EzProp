import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { LocalRow, OutboxEntry, TrialFormSnapshot } from "../types";
import { ANSWER_FORM_FIELD_INDEX } from "./idb";
import { localRowKey, retryDelayMs } from "./outbox";
import { createLocalTrialStore } from "./trial-store";
import {
  LOCAL_OUTBOX_STORE,
  LOCAL_SYNCED_STORES,
  type LocalDb,
  type LocalStoreName,
  type LocalTrialReader,
  type LocalTrialStore,
} from "./types";

// «Synk nå» i den lokale kjernen (docs/funksjoner/fase1-synkstatus.md, testplan
// docs/agenter/oppgaver/fase1-smafunn-synkstatus-testplan.md avsnitt 1). Ingen IndexedDB og ingen
// nettleser: databasen er en liten falsk `LocalDb` i minnet, leseren er en stub, `fetch` og
// `navigator` byttes ut. Tidtakerne er falske, aldri ekte venting. Alle data er oppdiktet.

const ORG = "0192d3a0-0000-7000-8000-0000000000f1";
const FORM = "0192d3a0-0000-7000-8000-000000000001";
const ANSWER = "0192d3a0-0000-7000-8000-0000000000a1";
const NOW = "2026-10-28T10:00:00.000Z";
const STATE_STORE = "sync_state";

const QUEUE: OutboxEntry[] = [
  {
    seq: 1,
    op: "PUT",
    table: "trial_forms",
    id: FORM,
    data: { name: "Testskjema 1", created_at: NOW, updated_at: NOW },
  },
  {
    seq: 2,
    op: "PUT",
    table: "trial_answers",
    id: ANSWER,
    data: {
      trial_form_id: FORM,
      field_key: "floors",
      value: "2",
      text_state: null,
      device_id: "enhet-1",
      created_at: NOW,
      updated_at: NOW,
    },
  },
];

type FailWhen = (stores: readonly LocalStoreName[], mode: IDBTransactionMode) => boolean;

/**
 * Liten falsk `LocalDb`: lagrene er `Map`-er, transaksjonen kan `get`, `getAll`, `put`, `delete` og
 * de to indeksene (skjema + felt for svar, skjema for bilder). `holdReadonly` holder igjen svaret
 * fra neste `readonly`-transaksjon etter at den har lest (én gang), til testen slipper løftet.
 */
function createFakeDb(outbox: readonly OutboxEntry[]) {
  const stores = new Map<string, Map<unknown, unknown>>();
  const storeOf = (name: string) => {
    let store = stores.get(name);
    if (!store) stores.set(name, (store = new Map()));
    return store;
  };
  for (const entry of outbox) storeOf(LOCAL_OUTBOX_STORE).set(entry.seq, structuredClone(entry));

  const control: {
    failTransaction: FailWhen;
    failReadAll: (name: string) => boolean;
    holdReadonly: Promise<void> | null;
  } = {
    failTransaction: () => false,
    failReadAll: () => false,
    holdReadonly: null,
  };

  /** Forespørsel som får `onsuccess` etter at kalleren har satt den (som i IndexedDB). */
  function request<T>(result: T) {
    const req: { result: T; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      result,
      onsuccess: null,
      onerror: null,
    };
    void Promise.resolve().then(() => req.onsuccess?.());
    return req;
  }

  const keyPathOf = (name: string) => (name === LOCAL_OUTBOX_STORE ? "seq" : "id");

  /** Indeksene: [skjema, felt] for svar, skjema for bilder. Et område (`IDBKeyRange`) gir skjemaet. */
  function indexMatches(indexName: string, row: Record<string, unknown>, query: unknown) {
    if (indexName === ANSWER_FORM_FIELD_INDEX) {
      if (Array.isArray(query)) return row.trial_form_id === query[0] && row.field_key === query[1];
      return row.trial_form_id === (query as { lower: unknown[] }).lower[0];
    }
    return row.trial_form_id === query;
  }
  const rowsOf = (name: string) => [...storeOf(name).values()] as Record<string, unknown>[];

  const db: LocalDb = {
    options: { name: "test-local", version: 1, stateStore: { name: STATE_STORE, keyPath: "key" } },
    open: () => Promise.reject(new Error("Ikke i bruk i testen.")),
    close: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    async inTransaction(names, mode, body) {
      if (control.failTransaction(names, mode)) throw new Error("hemmelig-innhold");
      const tx = {
        objectStore: (name: string) => ({
          get: (key: unknown) => request(structuredClone(storeOf(name).get(key))),
          getAll: () => request(structuredClone(rowsOf(name))),
          put: (value: Record<string, unknown>) =>
            request(storeOf(name).set(value[keyPathOf(name)], structuredClone(value))),
          delete: (key: unknown) => request(storeOf(name).delete(key)),
          index: (indexName: string) => ({
            get: (query: unknown) =>
              request(structuredClone(rowsOf(name).find((r) => indexMatches(indexName, r, query)))),
            getAll: (query: unknown) =>
              request(
                structuredClone(rowsOf(name).filter((r) => indexMatches(indexName, r, query))),
              ),
          }),
        }),
      };
      const hold = mode === "readonly" ? control.holdReadonly : null;
      if (hold) control.holdReadonly = null;
      const result = await body(tx as unknown as IDBTransaction);
      // Lest nå, men svaret kommer først når testen slipper løftet (en treg lesing).
      if (hold) await hold;
      return result;
    },
    readAll<T>(name: LocalStoreName): Promise<T[]> {
      if (control.failReadAll(name)) return Promise.reject(new Error("hemmelig-innhold"));
      return Promise.resolve([...storeOf(name).values()].map((v) => structuredClone(v) as T));
    },
    syncedStoreOf: (table) => LOCAL_SYNCED_STORES[table],
  };
  /** Legger en rad rett i et lager, uten kø (som om den alt var synket). */
  const seed = (name: string, row: LocalRow) => storeOf(name).set(row.id, structuredClone(row));
  return { db, control, seed };
}

function createReader() {
  const reader = {
    start: vi.fn(),
    wake: vi.fn(),
    syncNow: vi.fn(() => Promise.resolve()),
    serverConfirmed: vi.fn(() => true),
    stop: vi.fn(),
  } satisfies LocalTrialReader;
  return reader;
}

const response = (status: number) => new Response(null, { status });

let store: LocalTrialStore | null = null;
let fetchMock: Mock<typeof fetch>;
let reader: ReturnType<typeof createReader>;

async function open(online = true, queue: readonly OutboxEntry[] = QUEUE) {
  vi.stubGlobal("navigator", { onLine: online });
  const fake = createFakeDb(queue);
  reader = createReader();
  store = await createLocalTrialStore({
    db: fake.db,
    deviceId: "enhet-1",
    organizationId: ORG,
    reader,
  });
  return fake;
}

/** Køen slik den ligger lagret, sortert på `seq`. */
async function storedQueue() {
  const rows = await store!.readRows("outbox");
  return [...rows].sort((a, b) => Number(a.seq) - Number(b.seq));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await store?.close();
  store = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Synk nå i den lokale kjernen", () => {
  it("Synk nå sender køen med en gang etter en feil, forbi ventetiden, og henter etterpå", async () => {
    fetchMock.mockResolvedValueOnce(response(503)).mockResolvedValue(response(200));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open();

    // Første sending (planlagt ved åpning) får 503: køen står og venter på neste forsøk.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await storedQueue()).toEqual(QUEUE);

    // «Synk nå» uten å flytte tiden.
    const result = await store!.syncNow();
    expect(result).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await storedQueue()).toEqual([]);

    // T1d: leseren hentes én gang, etter siste sending.
    expect(reader.syncNow).toHaveBeenCalledTimes(1);
    const lastFetch = fetchMock.mock.invocationCallOrder.at(-1)!;
    expect(reader.syncNow.mock.invocationCallOrder[0]).toBeGreaterThan(lastFetch);

    // Ventetiden fra feilen er borte: ingen nye forsøk når tiden går.
    await vi.advanceTimersByTimeAsync(retryDelayMs(0) + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Synk nå gir failed ved 500, og køen står", async () => {
    fetchMock.mockResolvedValue(response(500));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open();

    expect(await store!.syncNow()).toBe("failed");
    expect(fetchMock).toHaveBeenCalled();
    expect(await storedQueue()).toEqual(QUEUE);
    expect(reader.syncNow).not.toHaveBeenCalled();
  });

  it("Synk nå uten nett gir offline og sender ingenting", async () => {
    await open(false);

    expect(await store!.syncNow()).toBe("offline");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reader.syncNow).not.toHaveBeenCalled();
    expect(await storedQueue()).toEqual(QUEUE);
  });

  it("Synk nå ved nettfeil gir failed, og køen står", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open();

    expect(await store!.syncNow()).toBe("failed");
    expect(fetchMock).toHaveBeenCalled();
    expect(await storedQueue()).toEqual(QUEUE);
  });
});

describe("loggen i den lokale kjernen", () => {
  /** Kallene til `console.warn` som starter med `message`. */
  function warnCalls(warn: Mock, message: string): unknown[][] {
    return warn.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].startsWith(message),
    );
  }

  /** Bare tekst i loggen (meldingen eller en fast tekst), aldri feilobjektet. */
  function expectOnlyText(calls: unknown[][]) {
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      for (const arg of args) {
        expect(arg).not.toBeInstanceOf(Error);
        expect(typeof arg).not.toBe("object");
      }
    }
  }

  it("loggen viser bare feilmeldingen, aldri feilobjektet, når kvitteringen feiler", async () => {
    fetchMock.mockResolvedValue(response(200));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { control } = await open();
    // Kvitteringen (sletting i køen etter 200) feiler i lagringen.
    control.failTransaction = (names, mode) =>
      mode === "readwrite" && names.length === 1 && names[0] === LOCAL_OUTBOX_STORE;

    expect(await store!.syncNow()).toBe("failed");
    expectOnlyText(warnCalls(warn, "Synk: sendingen stoppet."));
  });

  it("loggen viser bare feilmeldingen når listen eller skjemaet ikke kan leses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { control } = await open(false);
    control.failReadAll = (name) => name === LOCAL_SYNCED_STORES.trial_forms;
    control.failTransaction = (_names, mode) => mode === "readonly";

    store!.subscribeForms(() => undefined);
    store!.subscribe(FORM, () => undefined);
    await vi.advanceTimersByTimeAsync(0);

    expectOnlyText(warnCalls(warn, "Lagring: kunne ikke lese listen."));
    expectOnlyText(warnCalls(warn, "Lagring: kunne ikke lese skjemaet."));
  });
});

// Testplan docs/agenter/oppgaver/fase1-smafunn-prove-e-testplan.md avsnitt 1 (W1-W3).
describe("øyeblikksbilder og nyere lokale skrivinger (localWriteGeneration)", () => {
  const FIELD = "building_year";
  const FORM_ROW: LocalRow = {
    id: FORM,
    name: "Testskjema 1",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  };
  const answerRow = (value: number): LocalRow => ({
    id: ANSWER,
    trial_form_id: FORM,
    field_key: FIELD,
    value: JSON.stringify(value),
    text_state: null,
    device_id: "enhet-2",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
  });

  /** Verdien til feltet i et bilde (JSON-tekst), eller `null` når svaret mangler. */
  const valueIn = (snapshot: TrialFormSnapshot) =>
    snapshot.answers.find((answer) => answer.fieldKey === FIELD)?.value ?? null;

  /** Et løfte testen slipper selv. */
  function gate() {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  /** Åpner uten nett og med tom kø, med skjemaet og ett svar (1990) lagret fra før. */
  async function openWithAnswer() {
    vi.stubGlobal("IDBKeyRange", {
      bound: (lower: unknown, upper: unknown) => ({ lower, upper }),
    });
    const fake = await open(false, []);
    fake.seed(LOCAL_SYNCED_STORES.trial_forms, FORM_ROW);
    fake.seed(LOCAL_SYNCED_STORES.trial_answers, answerRow(1990));
    return fake;
  }

  /** Lytter på skjemaet mens svaret fra lesingen holdes igjen etter at den har lest. */
  async function subscribeWithHeldRead(control: { holdReadonly: Promise<void> | null }) {
    const held = gate();
    control.holdReadonly = held.promise;
    const listener = vi.fn<(snapshot: TrialFormSnapshot) => void>();
    store!.subscribe(FORM, listener);
    // Lesingen er gjort (gammel verdi), men svaret venter på løftet.
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();
    return { listener, release: held.release };
  }

  it("øyeblikksbilde lest før en nyere lokal skriving forkastes", async () => {
    const { control } = await openWithAnswer();
    const { listener, release } = await subscribeWithHeldRead(control);

    await store!.setAnswer(FORM, FIELD, 2001);
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);

    const values = listener.mock.calls.map(([snapshot]) => valueIn(snapshot));
    expect(values.length).toBeGreaterThan(0);
    expect(values).not.toContain("1990");
    expect(values.at(-1)).toBe("2001");
  });

  it("øyeblikksbilde uten nyere skriving brukes", async () => {
    const { control } = await openWithAnswer();
    const { listener, release } = await subscribeWithHeldRead(control);

    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledTimes(1);
    const [snapshot] = listener.mock.calls[0]!;
    expect(snapshot.form?.id).toBe(FORM);
    expect(valueIn(snapshot)).toBe("1990");
  });

  it("innkommende rader fra serveren teller som nyere skriving", async () => {
    const { control } = await openWithAnswer();
    const { listener, release } = await subscribeWithHeldRead(control);

    const context = reader.start.mock.calls[0]![0];
    const row = { ...answerRow(2010), updated_at: "2026-10-28T11:00:00.000Z" };
    await context.mergeIncoming(
      "trial_answers",
      [{ table: "trial_answers", kind: "update", key: localRowKey("trial_answers", row), row }],
      null,
    );
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);

    const values = listener.mock.calls.map(([snapshot]) => valueIn(snapshot));
    expect(values.length).toBeGreaterThan(0);
    expect(values).not.toContain("1990");
    expect(values.at(-1)).toBe("2010");
  });
});
