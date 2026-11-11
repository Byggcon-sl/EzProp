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

// `status()` leser bekreftede bilder fra bildelageret (egen IndexedDB); testene har ingen bilder.
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

// Rett T-0001 (A181): 400 legger én endring til side i køen, resten sendes. Testplan
// docs/agenter/oppgaver/rett-t0001-synkko-testplan.md 1c (23, 24, 26), 1d (33, 35) og loggen.
describe("lagt til side etter 400 i den lokale kjernen", () => {
  const DESCRIPTION = "0192d3a0-0000-7000-8000-0000000000a5";
  const POISON = "Fukt\u0000 i kjeller";
  const QUEUE_WITH_TEXT: OutboxEntry[] = [
    ...QUEUE,
    {
      seq: 3,
      op: "PUT",
      table: "trial_answers",
      id: DESCRIPTION,
      data: {
        trial_form_id: FORM,
        field_key: "general_description",
        value: JSON.stringify(POISON),
        text_state: null,
        device_id: "enhet-1",
        created_at: NOW,
        updated_at: NOW,
      },
    },
  ];

  const rejected = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  const pointingAt = (id: string, fieldKey: string | null) => ({
    feil: "Endringen kunne ikke lagres.",
    endring: { id, table: "trial_answers", field_key: fieldKey },
  });

  /** Operasjonene i hvert kall til fetch, som id-er. */
  function sentIds(): string[][] {
    return fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { operations: { id: string }[] };
      return body.operations.map((operation) => operation.id);
    });
  }

  it("400 med endring: den legges til side og lagres, resten sendes med en gang og kvitteres", async () => {
    fetchMock
      .mockResolvedValueOnce(rejected(pointingAt(DESCRIPTION, "general_description")))
      .mockResolvedValue(response(200));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(true, QUEUE_WITH_TEXT);

    await vi.advanceTimersByTimeAsync(0);
    expect(sentIds()).toEqual([
      [FORM, ANSWER, DESCRIPTION],
      [FORM, ANSWER],
    ]);

    const stored = await storedQueue();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      seq: 3,
      id: DESCRIPTION,
      setAside: { at: expect.any(String) },
    });
    const status = await store!.status();
    expect(status.pendingChanges).toBe(0);
    expect(status.unsent).toEqual([{ table: "trial_answers", fieldKey: "general_description" }]);
    // Ingen ventetid: ingen nye forsøk planlagt.
    await vi.advanceTimersByTimeAsync(retryDelayMs(0) + 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("400 uten endring og én endring i bunten: den legges til side", async () => {
    fetchMock.mockResolvedValueOnce(rejected({ feil: "Ugyldig." }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(true, [QUEUE[0]!]);

    await vi.advanceTimersByTimeAsync(0);
    const stored = await storedQueue();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.setAside).toBeDefined();
    expect((await store!.status()).unsent).toEqual([{ table: "trial_forms", fieldKey: null }]);
  });

  it("400 uten lesbar kropp og flere i bunten: nytt forsøk, ingenting lagt til side", async () => {
    fetchMock.mockResolvedValueOnce(new Response("ikke json", { status: 400 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open();

    await vi.advanceTimersByTimeAsync(0);
    expect(await storedQueue()).toEqual(QUEUE);
    expect((await store!.status()).pendingChanges).toBe(2);
  });

  it.each([401, 403, 409, 413, 500, 503, undefined])(
    "svar %s gir nytt forsøk og legger ingenting til side",
    async (status) => {
      if (status === undefined) {
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      } else {
        // Kroppen peker på en endring, men bare 400 skal lese den.
        fetchMock.mockResolvedValue(
          new Response(JSON.stringify(pointingAt(ANSWER, "floors")), { status }),
        );
      }
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      await open();

      await vi.advanceTimersByTimeAsync(0);
      expect(await storedQueue()).toEqual(QUEUE);
      const current = await store!.status();
      expect(current.pendingChanges).toBe(2);
      expect(current.unsent).toEqual([]);
    },
  );

  it("lagt til side står etter omlasting, sendes ikke og slettes aldri", async () => {
    fetchMock
      .mockResolvedValueOnce(rejected(pointingAt(DESCRIPTION, "general_description")))
      .mockResolvedValue(response(200));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = await open(true, QUEUE_WITH_TEXT);
    await vi.advanceTimersByTimeAsync(0);
    await store!.close();

    // Ny lasting av siden med samme lokale database.
    reader = createReader();
    store = await createLocalTrialStore({
      db: fake.db,
      deviceId: "enhet-1",
      organizationId: ORG,
      reader,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const stored = await storedQueue();
    expect(stored.map((row) => row.id)).toEqual([DESCRIPTION]);
    expect((await store!.status()).unsent).toHaveLength(1);
  });

  it("Synk nå regner køen som tømt når bare lagt til side står igjen", async () => {
    fetchMock
      .mockResolvedValueOnce(rejected(pointingAt(DESCRIPTION, "general_description")))
      .mockResolvedValue(response(200));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(true, QUEUE_WITH_TEXT);

    expect(await store!.syncNow()).toBe("ok");
    expect(reader.syncNow).toHaveBeenCalledTimes(1);
    expect(await storedQueue()).toHaveLength(1);
  });

  it("200 på ny endring i samme felt løser den gamle i lageret, uten å slette den", async () => {
    fetchMock
      .mockResolvedValueOnce(rejected(pointingAt(DESCRIPTION, "general_description")))
      .mockResolvedValue(response(200));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(true, QUEUE_WITH_TEXT);
    await vi.advanceTimersByTimeAsync(0);

    const written = store!.setAnswer(FORM, "general_description", "Fukt i kjeller");
    await store!.flush();
    await written;
    await vi.advanceTimersByTimeAsync(0);

    const stored = await storedQueue();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ seq: 3, setAside: { resolved: true } });
    // Den gamle verdien er urørt; den nye ble sendt som egen oppføring.
    expect((stored[0]!.data as Record<string, unknown>).value).toBe(JSON.stringify(POISON));
    expect(sentIds().at(-1)).toHaveLength(1);
    const status = await store!.status();
    expect(status.unsent).toEqual([]);
    expect(status.pendingChanges).toBe(0);
  });

  it("henting overskriver ikke feltet som er lagt til side, og lager ingen ny køoppføring", async () => {
    fetchMock
      .mockResolvedValueOnce(rejected(pointingAt(DESCRIPTION, "general_description")))
      .mockResolvedValue(response(200));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = await open(true, QUEUE_WITH_TEXT);
    fake.seed(LOCAL_SYNCED_STORES.trial_answers, {
      id: DESCRIPTION,
      trial_form_id: FORM,
      field_key: "general_description",
      value: JSON.stringify(POISON),
      text_state: null,
      device_id: "enhet-1",
      created_at: NOW,
      updated_at: NOW,
      deleted_at: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    // «Bekreftet» etter 200 beskytter de kvitterte feltene en stund; la den gå ut.
    await vi.advanceTimersByTimeAsync(121_000);
    const before = await storedQueue();
    const context = reader.start.mock.calls[0]![0];

    await context.mergeIncoming(
      "trial_answers",
      [
        {
          table: "trial_answers",
          kind: "update",
          key: `${FORM}:general_description`,
          row: { id: DESCRIPTION, value: JSON.stringify("Fra serveren"), updated_at: NOW },
        },
        {
          table: "trial_answers",
          kind: "insert",
          key: `${FORM}:floors`,
          row: { ...QUEUE[1]!.data, id: ANSWER, value: "2", deleted_at: null },
        },
      ],
      null,
    );

    const rows = await store!.readRows("trial_answers");
    const description = rows.find((row) => row.field_key === "general_description");
    expect(description?.value).toBe(JSON.stringify(POISON));
    expect(rows.find((row) => row.field_key === "floors")?.value).toBe("2");
    expect(await storedQueue()).toEqual(before);
    expect((await store!.status()).pendingChanges).toBe(0);
  });

  it("loggen ved 400 har bare status og antall, aldri tekst eller feltnavn", async () => {
    fetchMock
      .mockResolvedValueOnce(rejected(pointingAt(DESCRIPTION, "general_description")))
      .mockResolvedValue(response(200));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await open(true, QUEUE_WITH_TEXT);
    await vi.advanceTimersByTimeAsync(0);

    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("400");
    expect(logged).not.toContain("general_description");
    expect(logged).not.toContain("Generell beskrivelse");
    expect(logged).not.toContain("Fukt");
    expect(logged).not.toContain(DESCRIPTION);
  });
});
