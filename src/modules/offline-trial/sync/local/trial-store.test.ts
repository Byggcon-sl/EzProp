import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
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

// `status()` leser bekreftede bilder fra bildelageret (IndexedDB); i testen finnes ingen.
vi.mock("../photo-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../photo-store")>()),
  listConfirmedPhotoIds: () => Promise.resolve(new Set<string>()),
}));

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

/** Liten falsk `LocalDb`: lagrene er `Map`-er, transaksjonen kan bare `get`, `put` og `delete`. */
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
    /**
     * Holder igjen neste `readonly`-transaksjon etter at den har lest (som et øyeblikksbilde som
     * er lest, men ikke levert ennå). Brukes én gang, så settes den tilbake til `null`.
     */
    holdNextRead: Promise<void> | null;
  } = {
    failTransaction: () => false,
    failReadAll: () => false,
    holdNextRead: null,
  };

  /** Legger en rad rett i et lager (som om den lå der fra før). */
  const seed = (name: string, row: Record<string, unknown>) =>
    storeOf(name).set(row[keyPathOf(name)], structuredClone(row));

  const keyPathOf = (name: string) => (name === LOCAL_OUTBOX_STORE ? "seq" : "id");

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

  const db: LocalDb = {
    options: { name: "test-local", version: 1, stateStore: { name: STATE_STORE, keyPath: "key" } },
    open: () => Promise.reject(new Error("Ikke i bruk i testen.")),
    close: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    async inTransaction(names, mode, body) {
      if (control.failTransaction(names, mode)) throw new Error("hemmelig-innhold");
      const rowsOf = (name: string) =>
        [...storeOf(name).values()].map((v) => structuredClone(v) as Record<string, unknown>);
      const tx = {
        objectStore: (name: string) => ({
          get: (key: unknown) => request(structuredClone(storeOf(name).get(key))),
          getAll: () => request(rowsOf(name)),
          put: (value: Record<string, unknown>) =>
            request(storeOf(name).set(value[keyPathOf(name)], structuredClone(value))),
          delete: (key: unknown) => request(storeOf(name).delete(key)),
          // Bare det kjernen bruker: svar på [skjema, felt] og bilder på skjema.
          index: () => ({
            get: ([formId, fieldKey]: [string, string]) =>
              request(
                rowsOf(name).find(
                  (row) => row.trial_form_id === formId && row.field_key === fieldKey,
                ),
              ),
            getAll: (query: string | { formId: string }) => {
              const formId = typeof query === "string" ? query : query.formId;
              return request(rowsOf(name).filter((row) => row.trial_form_id === formId));
            },
          }),
        }),
      };
      const result = await body(tx as unknown as IDBTransaction);
      const hold = mode === "readonly" ? control.holdNextRead : null;
      if (hold) {
        control.holdNextRead = null;
        await hold;
      }
      return result;
    },
    readAll<T>(name: LocalStoreName): Promise<T[]> {
      if (control.failReadAll(name)) return Promise.reject(new Error("hemmelig-innhold"));
      return Promise.resolve([...storeOf(name).values()].map((v) => structuredClone(v) as T));
    },
    syncedStoreOf: (table) => LOCAL_SYNCED_STORES[table],
  };
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

describe("øyeblikksbilder og nyere lokale skrivinger (localWriteGeneration)", () => {
  // Testplan docs/agenter/oppgaver/fase1-smafunn-prove-e-testplan.md avsnitt 1 (W1–W3).
  // Lesingen av skjemaet holdes igjen etter at den har lest, mens en nyere skriving skjer.
  // Et bilde som ble lest før skrivingen, skal aldri nå lytteren.

  const FIELD = "floors";
  const ANSWER_KEY = `${FORM}:${FIELD}`;

  /** Utsatt løfte som testen slipper selv. */
  function deferred() {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  }

  /** Åpner uten nett og uten kø, med ett skjema og ett svar (`floors` = 2) i lagringen. */
  async function openWithAnswer() {
    // Bare det `readSnapshot` trenger: grensene for svarene på skjemaet.
    vi.stubGlobal("IDBKeyRange", {
      bound: (lower: [string, string]) => ({ formId: lower[0] }),
    });
    const fake = await open(false, []);
    fake.seed(LOCAL_SYNCED_STORES.trial_forms, {
      id: FORM,
      name: "Testskjema 1",
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    fake.seed(LOCAL_SYNCED_STORES.trial_answers, {
      id: ANSWER,
      trial_form_id: FORM,
      field_key: FIELD,
      value: "2",
      text_state: null,
      device_id: "enhet-1",
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    return fake;
  }

  /** Verdien til `floors` i hvert bilde lytteren fikk, i rekkefølge. */
  function valuesSeen(listener: Mock): (string | null | undefined)[] {
    return listener.mock.calls.map(
      ([snapshot]) =>
        (snapshot as { answers: { fieldKey: string; value: string | null }[] }).answers.find(
          (answer) => answer.fieldKey === FIELD,
        )?.value,
    );
  }

  it("øyeblikksbilde lest før en nyere lokal skriving forkastes", async () => {
    const { control } = await openWithAnswer();
    const gate = deferred();
    control.holdNextRead = gate.promise;
    const listener = vi.fn();

    // Første lesing leser «2» og holdes igjen før den leveres.
    store!.subscribe(FORM, listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();

    // Nyere lokal skriving mens den gamle lesingen venter. Varselet gir et nytt bilde.
    await store!.setAnswer(FORM, FIELD, 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(valuesSeen(listener).at(-1)).toBe("3");

    // Den gamle lesingen slippes: bildet med «2» skal aldri vises etter skrivingen.
    gate.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(valuesSeen(listener)).not.toContain("2");
    expect(valuesSeen(listener).at(-1)).toBe("3");
  });

  it("øyeblikksbilde uten nyere skriving brukes", async () => {
    const { control } = await openWithAnswer();
    const gate = deferred();
    control.holdNextRead = gate.promise;
    const listener = vi.fn();

    store!.subscribe(FORM, listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();

    gate.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(valuesSeen(listener)).toEqual(["2"]);
  });

  it("innkommende rader fra serveren teller som nyere skriving", async () => {
    const { control } = await openWithAnswer();
    const context = reader.start.mock.calls[0]![0];
    const gate = deferred();
    control.holdNextRead = gate.promise;
    const listener = vi.fn();

    store!.subscribe(FORM, listener);
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).not.toHaveBeenCalled();

    // Serveren sender en ny verdi mens den gamle lesingen venter.
    await context.mergeIncoming(
      "trial_answers",
      [
        {
          table: "trial_answers",
          kind: "update",
          key: ANSWER_KEY,
          row: { id: ANSWER, value: "4", updated_at: "2026-10-28T10:05:00.000Z" },
        },
      ],
      null,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(valuesSeen(listener).at(-1)).toBe("4");

    gate.release();
    await vi.advanceTimersByTimeAsync(0);

    expect(valuesSeen(listener)).not.toContain("2");
    expect(valuesSeen(listener).at(-1)).toBe("4");
  });
});

describe("avvist endring legges til side (funn T-0001)", () => {
  // Testplan docs/agenter/oppgaver/rett-t0001-synkko-testplan.md 16, 26, 27, 30, 33 og 35, gjennom
  // lageret: sendQueue, status, syncNow og mergeIncoming.
  const ANSWER_2 = "0192d3a0-0000-7000-8000-0000000000a2";
  const POISON: OutboxEntry = {
    seq: 1,
    op: "PUT",
    table: "trial_answers",
    id: ANSWER,
    data: {
      trial_form_id: FORM,
      field_key: "general_description",
      value: JSON.stringify("Fukt\u0000 i kjeller"),
      text_state: null,
      device_id: "enhet-1",
      created_at: NOW,
      updated_at: NOW,
    },
  };
  const GOOD: OutboxEntry = {
    seq: 2,
    op: "PUT",
    table: "trial_answers",
    id: ANSWER_2,
    data: {
      trial_form_id: FORM,
      field_key: "building_year",
      value: "1985",
      text_state: null,
      device_id: "enhet-1",
      created_at: NOW,
      updated_at: NOW,
    },
  };

  const rejectPoison = () =>
    new Response(
      JSON.stringify({
        feil: "Endringen kunne ikke lagres.",
        endring: { id: ANSWER, table: "trial_answers", field_key: "general_description" },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );

  /** Svarer 400 når den giftige er med i bunten, ellers 200. */
  function serverRejectingPoison() {
    fetchMock.mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { operations: { id: string }[] };
      const hasPoison = body.operations.some((operation) => operation.id === ANSWER);
      return Promise.resolve(hasPoison ? rejectPoison() : response(200));
    });
  }

  it("giftig endring først: resten kvitteres, den giftige ligger igjen lagt til side", async () => {
    serverRejectingPoison();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(true, [POISON, GOOD]);

    expect(await store!.syncNow()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const queue = await storedQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ seq: 1, id: ANSWER });
    expect(queue[0]!.setAside).toEqual({ at: expect.any(String) });

    const status = await store!.status();
    expect(status.pendingChanges).toBe(0);
    expect(status.rejected).toEqual([{ table: "trial_answers", fieldKey: "general_description" }]);
    // Loggen har bare status og antall, aldri tekst eller felt.
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("400");
    expect(logged).not.toContain("Fukt");
    expect(logged).not.toContain("general_description");
  });

  it("lagt til side overlever omlasting og sendes ikke igjen", async () => {
    serverRejectingPoison();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(true, [POISON, GOOD]);
    expect(await store!.syncNow()).toBe("ok");
    const saved = (await storedQueue()) as unknown as OutboxEntry[];
    await store!.close();

    fetchMock.mockClear();
    await open(true, saved);
    expect(await store!.syncNow()).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await storedQueue()).toEqual(saved);
    expect((await store!.status()).rejected).toHaveLength(1);
  });

  it("400 uten endring for flere i bunten: nytt forsøk, ingenting lagt til side", async () => {
    fetchMock.mockResolvedValue(response(400));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(true, [POISON, GOOD]);

    expect(await store!.syncNow()).toBe("failed");
    expect(await storedQueue()).toEqual([POISON, GOOD]);
    expect((await store!.status()).pendingChanges).toBe(2);
  });

  it("ny endring på feltet som kvitteres, løser den gamle (meldingen forsvinner)", async () => {
    serverRejectingPoison();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = await open(true, [POISON]);
    fake.seed(LOCAL_SYNCED_STORES.trial_answers, { ...POISON.data, id: ANSWER, deleted_at: null });
    expect(await store!.syncNow()).toBe("ok");
    expect((await store!.status()).rejected).toHaveLength(1);

    // Et annet felt kvitteres: den gamle står.
    fetchMock.mockResolvedValue(response(200));
    await store!.setAnswer(FORM, "building_year", 1990);
    expect(await store!.syncNow()).toBe("ok");
    expect((await store!.status()).rejected).toHaveLength(1);

    // Ny tekst i samme felt: ny oppføring, kvittert med 200, den gamle er løst (ikke slettet).
    const written = store!.setAnswer(FORM, "general_description", "Fukt i kjeller");
    await store!.flush();
    await written;
    expect(await store!.syncNow()).toBe("ok");
    const status = await store!.status();
    expect(status.rejected).toEqual([]);
    expect(status.pendingChanges).toBe(0);
    const queue = await storedQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]!.setAside).toEqual({ at: expect.any(String), resolved: true });
  });

  it("henting fra serveren lager ingen ny køoppføring og overskriver ikke feltet", async () => {
    serverRejectingPoison();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = await open(true, [POISON]);
    fake.seed(LOCAL_SYNCED_STORES.trial_answers, { ...POISON.data, id: ANSWER, deleted_at: null });
    expect(await store!.syncNow()).toBe("ok");
    const before = await storedQueue();

    const context = reader.start.mock.calls[0]![0];
    await context.mergeIncoming(
      "trial_answers",
      [
        {
          table: "trial_answers",
          kind: "update",
          key: `${FORM}:general_description`,
          row: { id: ANSWER, value: JSON.stringify("Fra serveren"), updated_at: NOW },
        },
      ],
      null,
    );

    expect(await storedQueue()).toEqual(before);
    const rows = await store!.readRows("trial_answers");
    expect(rows.find((row) => row.id === ANSWER)!.value).toBe(POISON.data.value);
  });
});

// --- Funn T-0001: én endring som ikke kan lagres, stopper ikke resten av køen. Testplan
// docs/agenter/oppgaver/rett-t0001-synkko-testplan.md avsnitt 1c og 1d (test 16–24, 27, 30, 33
// og 35). Testene går gjennom lageret, så de bruker samme køfunksjon som trial-store.ts kaller.
// Merket på oppføringen er `setAside?: { at: string; resolved?: boolean }` (oppgavekortet, Data).
// Alle data er oppdiktet.
// Støtter hovedmål: de ansatte (takstmannen mister ikke arbeid fra iPaden) og færre reklamasjoner
// (svarene kommer fram, så rapporten får ikke hull).

describe("lagt til side ved 400 (T-0001)", () => {
  const ID_TEXT = "0192d3a0-0000-7000-8000-0000000000c1";
  const ID_YEAR = "0192d3a0-0000-7000-8000-0000000000c2";
  const ID_SUMMARY = "0192d3a0-0000-7000-8000-0000000000c3";

  type SetAside = { at: string; resolved?: boolean };
  type StoredEntry = OutboxEntry & { setAside?: SetAside };

  function answer(seq: number, id: string, fieldKey: string, value: unknown): StoredEntry {
    return {
      seq,
      op: "PUT",
      table: "trial_answers",
      id,
      data: {
        trial_form_id: FORM,
        field_key: fieldKey,
        value: JSON.stringify(value),
        text_state: null,
        device_id: "enhet-1",
        created_at: NOW,
        updated_at: NOW,
      },
    };
  }

  /** Giftig tekst først, så byggeår og samlet kommentar (som i funnet). */
  const TEXT = answer(1, ID_TEXT, "general_description", "Fukt\u0000 i kjeller");
  const YEAR = answer(2, ID_YEAR, "building_year", 1985);
  const SUMMARY = answer(3, ID_SUMMARY, "summary", "Oppdiktet samlet kommentar");
  const THREE = [TEXT, YEAR, SUMMARY];

  /** 400 med `endring` som peker på oppføringen (eller uten `endring`). */
  function rejected(entry?: OutboxEntry, status = 400): Response {
    const body = entry
      ? {
          feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
          endring: { id: entry.id, table: entry.table, field_key: entry.data.field_key ?? null },
        }
      : { feil: "Endringen kunne ikke lagres. Noe i den er ugyldig." };
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  /** Svarer etter tur; siste svar gjentas. Nytt `Response` hver gang (kroppen leses én gang). */
  function respond(...answers: (() => Response)[]) {
    let call = 0;
    fetchMock.mockImplementation(async () => {
      const make = answers[Math.min(call, answers.length - 1)]!;
      call++;
      return make();
    });
  }

  /** Id-ene i bunten fetch fikk i kall nummer `index`. */
  function sentIds(index: number): string[] {
    const init = fetchMock.mock.calls[index]?.[1];
    const body = JSON.parse(String(init?.body)) as { operations: { id: string }[] };
    return body.operations.map((operation) => operation.id);
  }

  async function queue(): Promise<StoredEntry[]> {
    return (await storedQueue()) as unknown as StoredEntry[];
  }

  function expectSetAside(entry: StoredEntry | undefined) {
    expect(entry, "oppføringen ligger i køen").toBeDefined();
    expect(entry!.setAside, `seq ${entry!.seq} er lagt til side`).toBeDefined();
    expect(typeof entry!.setAside!.at).toBe("string");
    expect(Number.isNaN(new Date(entry!.setAside!.at).getTime())).toBe(false);
    expect(entry!.setAside!.resolved).toBeFalsy();
  }

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("IDBKeyRange", { bound: (lower: [string, string]) => ({ formId: lower[0] }) });
  });

  it.each<[string, OutboxEntry, string[]]>([
    ["16 giftig endring først", TEXT, [ID_YEAR, ID_SUMMARY]],
    ["17 giftig endring i midten", YEAR, [ID_TEXT, ID_SUMMARY]],
    ["18 giftig endring sist", SUMMARY, [ID_TEXT, ID_YEAR]],
  ])("%s: legges til side, resten sendes med en gang og kvitteres", async (_name, poison, rest) => {
    respond(
      () => rejected(poison),
      () => response(200),
    );
    await open(true, THREE);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentIds(0)).toEqual([ID_TEXT, ID_YEAR, ID_SUMMARY]);
    expect(sentIds(1)).toEqual(rest);

    const left = await queue();
    expect(left.map((entry) => entry.seq)).toEqual([poison.seq]);
    expectSetAside(left[0]);
    expect(left[0]!.data).toEqual(poison.data);
    // Ingen nye forsøk for den som er lagt til side
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("19 alle køoppføringer med samme table+id i bunten legges til side", async () => {
    // To oppføringer for samme rad (den andre ble laget mens den første var underveis)
    const again = { ...answer(2, ID_TEXT, "general_description", "Fukt\u0000 i kjelleren") };
    const year = { ...YEAR, seq: 3 };
    respond(
      () => rejected(TEXT),
      () => response(200),
    );
    await open(true, [TEXT, again, year]);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentIds(1)).toEqual([ID_YEAR]);
    const left = await queue();
    expect(left.map((entry) => entry.seq)).toEqual([1, 2]);
    for (const entry of left) expectSetAside(entry);
  });

  it("20 400 uten endring og bunt med én endring: legges til side", async () => {
    respond(() => rejected());
    await open(true, [TEXT]);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const left = await queue();
    expect(left).toHaveLength(1);
    expectSetAside(left[0]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("21 400 uten endring og flere i bunten: nytt forsøk, ingenting lagt til side", async () => {
    respond(() => rejected());
    await open(true, THREE);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const left = await queue();
    expect(left).toEqual(THREE);
    for (const entry of left) expect(entry.setAside).toBeUndefined();
    // Nytt forsøk etter ventetiden, med hele bunten
    await vi.advanceTimersByTimeAsync(retryDelayMs(0) + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentIds(1)).toEqual([ID_TEXT, ID_YEAR, ID_SUMMARY]);
    expect((await queue()).every((entry) => entry.setAside === undefined)).toBe(true);
  });

  it("22 400 med endring som ikke finnes i bunten: nytt forsøk", async () => {
    const stranger = answer(9, "0192d3a0-0000-7000-8000-0000000000ff", "floors", 2);
    respond(() => rejected(stranger));
    await open(true, THREE);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await queue()).toEqual(THREE);
    await vi.advanceTimersByTimeAsync(retryDelayMs(0) + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await queue()).toEqual(THREE);
  });

  it.each<[string, number | undefined]>([
    ["401", 401],
    ["403", 403],
    ["409", 409],
    ["413", 413],
    ["500", 500],
    ["503", 503],
    ["nettfeil", undefined],
  ])("23 %s gir nytt forsøk og legger ingenting til side", async (_name, status) => {
    if (status === undefined) {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    } else {
      // Kroppen peker på en endring, men bare 400 skal legge til side
      respond(() => rejected(TEXT, status));
    }
    await open(true, THREE);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await queue()).toEqual(THREE);
    expect(await store!.syncNow()).toBe("failed");
    expect(await queue()).toEqual(THREE);
  });

  it("24 lagt til side slettes aldri", async () => {
    respond(
      () => rejected(TEXT),
      () => response(200),
    );
    await open(true, THREE);
    await vi.advanceTimersByTimeAsync(0);

    // Flere runder med 200 for andre endringer
    for (const value of [3, 4, 5]) {
      await store!.setAnswer(FORM, "floors", value);
      await vi.advanceTimersByTimeAsync(0);
      expect(await store!.syncNow()).toBe("ok");
    }
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
    const left = await queue();
    expect(left.map((entry) => entry.seq)).toEqual([TEXT.seq]);
    expectSetAside(left[0]);
    expect(left[0]!.data).toEqual(TEXT.data);
  });

  it("27 ventetallet teller ikke lagt til side", async () => {
    await open(false, [{ ...TEXT, setAside: { at: NOW } } as StoredEntry, YEAR, SUMMARY]);
    expect((await store!.status()).pendingChanges).toBe(2);
  });

  it("27 ventetallet er 0 etter 400 for én og 200 for resten", async () => {
    respond(
      () => rejected(TEXT),
      () => response(200),
    );
    await open(true, THREE);
    await vi.advanceTimersByTimeAsync(0);
    expect((await store!.status()).pendingChanges).toBe(0);
    expect(await queue()).toHaveLength(1);
  });

  it("30 200 på senere endring i samme felt løser den gamle", async () => {
    const old: StoredEntry = {
      ...answer(1, ID_YEAR, "building_year", 1985),
      setAside: { at: NOW },
    };
    const fresh = answer(2, ID_YEAR, "building_year", 1986);
    respond(() => response(200));
    await open(true, [old, fresh]);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentIds(0)).toEqual([ID_YEAR]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
      operations: { data: { value: string } }[];
    };
    expect(body.operations[0]!.data.value).toBe(JSON.stringify(1986));
    const left = await queue();
    expect(left.map((entry) => entry.seq)).toEqual([1]);
    expect(left[0]!.setAside).toMatchObject({ at: NOW, resolved: true });
  });

  it("31 200 på et annet felt løser ikke", async () => {
    const old: StoredEntry = { ...TEXT, setAside: { at: NOW } };
    respond(() => response(200));
    await open(true, [old, YEAR]);
    await vi.advanceTimersByTimeAsync(0);

    const left = await queue();
    expect(left.map((entry) => entry.seq)).toEqual([1]);
    expect(left[0]!.setAside?.resolved).toBeFalsy();
  });

  it("33 «Synk nå» regner køen som tømt når bare lagt-til-side-oppføringer står igjen", async () => {
    respond(
      () => rejected(TEXT),
      () => response(200),
    );
    await open(true, THREE);

    expect(await store!.syncNow()).toBe("ok");
    expect(reader.syncNow).toHaveBeenCalled();
    expect(await queue()).toHaveLength(1);

    // Og på nytt, når bare den lagt til side ligger der
    const calls = fetchMock.mock.calls.length;
    expect(await store!.syncNow()).toBe("ok");
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("33 «Synk nå» med bare lagt til side fra før gir ok uten å sende", async () => {
    await open(true, [{ ...TEXT, setAside: { at: NOW } } as StoredEntry]);
    expect(await store!.syncNow()).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("35 hentet vasket svar lager ingen ny køoppføring", async () => {
    await open(false, []);
    const context = reader.start.mock.calls[0]![0];
    await context.mergeIncoming(
      "trial_answers",
      [
        {
          table: "trial_answers",
          kind: "insert",
          key: `${FORM}:general_description`,
          row: {
            id: ID_TEXT,
            trial_form_id: FORM,
            field_key: "general_description",
            value: JSON.stringify("Fukt i kjeller"),
            text_state: null,
            device_id: "enhet-1",
            created_at: NOW,
            updated_at: NOW,
            deleted_at: null,
          },
        },
      ],
      null,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await queue()).toEqual([]);
    expect((await store!.status()).pendingChanges).toBe(0);
  });
});
