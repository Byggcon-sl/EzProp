import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { OutboxEntry } from "../types";
import { createLocalTrialStore } from "./trial-store";
import {
  LOCAL_OUTBOX_STORE,
  LOCAL_SYNCED_STORES,
  type LocalDb,
  type LocalStoreName,
  type LocalTrialReader,
  type LocalTrialStore,
} from "./types";

/*
 * Funn T-0001: én endring serveren ikke kan lagre, skal ikke stoppe resten av køen
 * (docs/agenter/oppgaver/rett-t0001-synkko.md Omfang 5–7, testplan avsnitt 1c og 1d, 16–33 og 35).
 * Prøves gjennom lageret (`createLocalTrialStore`), samme vei som skjermen bruker, så testene ikke
 * avhenger av hva den nye køfunksjonen heter. Ingen IndexedDB og ingen nettleser: databasen er en
 * liten falsk `LocalDb` i minnet (samme oppsett som trial-store.test.ts), `fetch` og `navigator`
 * byttes ut, og tidtakerne er falske. Merket `setAside` leses fra køen slik den ligger lagret.
 * Alle data er oppdiktet.
 * Støtter hovedmål: de ansatte (takstmannen mister ikke arbeid fordi ett felt har et rart tegn)
 * og færre reklamasjoner (de andre svarene kommer fram, så rapporten får ikke hull).
 */

// Bildelageret bruker IndexedDB direkte; her finnes ingen bilder, så det byttes ut med et tomt.
vi.mock("../photo-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../photo-store")>()),
  listConfirmedPhotoIds: async () => new Set<string>(),
  confirmLocalPhoto: async () => undefined,
  putLocalPhoto: async () => undefined,
}));

const ORG = "0192d3a0-0000-7000-8000-0000000000f1";
const FORM = "0192d3a0-0000-7000-8000-000000000001";
const A1 = "0192d3a0-0000-7000-8000-0000000000a1";
const A2 = "0192d3a0-0000-7000-8000-0000000000a2";
const A3 = "0192d3a0-0000-7000-8000-0000000000a3";
const NOW = "2026-11-11T09:00:00.000Z";
const STATE_STORE = "sync_state";
const POISON = "Fukt\u0000 i kjeller HEMMELIG-T0001";
const CHANGES_ROUTE = "/api/prove/synk/endringer";

type SetAside = { at: string; resolved?: boolean };
type StoredEntry = OutboxEntry & { setAside?: SetAside };

function answer(
  seq: number,
  id: string,
  fieldKey: string,
  value: unknown,
  setAside?: SetAside,
): StoredEntry {
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
    ...(setAside && { setAside }),
  };
}

/** Tre svar: «Generell beskrivelse» med nulltegn, byggeår og samlet kommentar. */
function threeAnswers(poisonAt: 0 | 1 | 2): StoredEntry[] {
  const fields: [string, string, unknown][] = [
    [A1, "general_description", "Oppdiktet beskrivelse"],
    [A2, "building_year", 1985],
    [A3, "summary", "Oppdiktet kommentar"],
  ];
  fields[poisonAt] = [fields[poisonAt]![0], "general_description", POISON];
  if (poisonAt !== 0) fields[0] = [A1, "floors", 2];
  return fields.map(([id, key, value], index) => answer(index + 1, id, key, value));
}

/** Liten falsk `LocalDb`: lagrene er `Map`-er, transaksjonen kan bare `get`, `put` og `delete`. */
function createFakeDb(outbox: readonly StoredEntry[]) {
  const stores = new Map<string, Map<unknown, unknown>>();
  const storeOf = (name: string) => {
    let store = stores.get(name);
    if (!store) stores.set(name, (store = new Map()));
    return store;
  };
  const keyPathOf = (name: string) => (name === LOCAL_OUTBOX_STORE ? "seq" : "id");
  for (const entry of outbox) storeOf(LOCAL_OUTBOX_STORE).set(entry.seq, structuredClone(entry));

  function request<T>(result: T) {
    const req: { result: T; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      result,
      onsuccess: null,
      onerror: null,
    };
    void Promise.resolve().then(() => req.onsuccess?.());
    return req;
  }

  const deletes: { store: string; key: unknown }[] = [];

  const db: LocalDb = {
    options: { name: "test-local", version: 1, stateStore: { name: STATE_STORE, keyPath: "key" } },
    open: () => Promise.reject(new Error("Ikke i bruk i testen.")),
    close: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    async inTransaction(_names, _mode, body) {
      const rowsOf = (name: string) =>
        [...storeOf(name).values()].map((v) => structuredClone(v) as Record<string, unknown>);
      const tx = {
        objectStore: (name: string) => ({
          get: (key: unknown) => request(structuredClone(storeOf(name).get(key))),
          getAll: () => request(rowsOf(name)),
          put: (value: Record<string, unknown>) =>
            request(storeOf(name).set(value[keyPathOf(name)], structuredClone(value))),
          delete: (key: unknown) => {
            deletes.push({ store: name, key });
            return request(storeOf(name).delete(key));
          },
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
      return body(tx as unknown as IDBTransaction);
    },
    readAll<T>(name: LocalStoreName): Promise<T[]> {
      return Promise.resolve([...storeOf(name).values()].map((v) => structuredClone(v) as T));
    },
    syncedStoreOf: (table) => LOCAL_SYNCED_STORES[table],
  };
  return { db, deletes };
}

function createReader() {
  return {
    start: vi.fn(),
    wake: vi.fn(),
    syncNow: vi.fn(() => Promise.resolve()),
    serverConfirmed: vi.fn(() => true),
    stop: vi.fn(),
  } satisfies LocalTrialReader;
}

let store: LocalTrialStore | null = null;
let fetchMock: Mock<typeof fetch>;
let warn: Mock;

/** Svar fra skriveruten. `endring` er det serveren peker på ved 400. */
function reply(status: number, body?: unknown): Response {
  return body === undefined
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
}

function rejected(entry: StoredEntry): Response {
  return reply(400, {
    feil: "Endringen kunne ikke lagres. Noe i den er ugyldig.",
    endring: {
      id: entry.id,
      table: entry.table,
      field_key: (entry.data.field_key as string | undefined) ?? null,
    },
  });
}

async function open(queue: readonly StoredEntry[], online = true) {
  vi.stubGlobal("navigator", { onLine: online });
  const fake = createFakeDb(queue);
  store = await createLocalTrialStore({
    db: fake.db,
    deviceId: "enhet-1",
    organizationId: ORG,
    reader: createReader(),
  });
  return fake;
}

/** Køen slik den ligger lagret, sortert på `seq`. */
async function storedQueue(): Promise<StoredEntry[]> {
  const rows = (await store!.readRows("outbox")) as unknown as StoredEntry[];
  return [...rows].sort((a, b) => a.seq - b.seq);
}

/** Id-ene i bunten fra kall nummer `call` (0 = første). */
function sentIds(call: number): string[] {
  const init = fetchMock.mock.calls[call]![1]!;
  const body = JSON.parse(String(init.body)) as { operations: { id: string }[] };
  return body.operations.map((operation) => operation.id);
}

function changeCalls(): number {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(CHANGES_ROUTE)).length;
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  // Bare det lageret bruker: grensene for svarene på ett skjema
  vi.stubGlobal("IDBKeyRange", { bound: (lower: [string, string]) => ({ formId: lower[0] }) });
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined) as unknown as Mock;
});

afterEach(async () => {
  await store?.close();
  store = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("400 legger den avviste endringen til side, resten sendes (T-0001)", () => {
  it.each([
    ["først", 0],
    ["i midten", 1],
    ["sist", 2],
  ] as const)("giftig endring %s: legges til side, resten sendes og kvitteres", async (_n, at) => {
    const queue = threeAnswers(at);
    const poisoned = queue[at]!;
    fetchMock.mockImplementationOnce(async () => rejected(poisoned));
    fetchMock.mockImplementation(async () => reply(200, { applied: 2 }));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");

    // Første bunt hadde alle tre; neste bunt har bare de to gode, med en gang
    expect(sentIds(0)).toEqual(queue.map((entry) => entry.id));
    expect(changeCalls()).toBe(2);
    expect(sentIds(1)).toEqual(queue.filter((e) => e !== poisoned).map((e) => e.id));

    const left = await storedQueue();
    expect(left.map((entry) => entry.seq)).toEqual([poisoned.seq]);
    expect(left[0]!.data).toEqual(poisoned.data);
    expect(typeof left[0]!.setAside?.at).toBe("string");
    expect(Number.isNaN(new Date(left[0]!.setAside!.at).getTime())).toBe(false);
    expect(left[0]!.setAside?.resolved).toBeFalsy();

    // Ventetallet teller den ikke
    expect((await store!.status()).pendingChanges).toBe(0);

    // Loggen får bare status og antall, aldri innholdet
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("HEMMELIG-T0001");
    expect(logged).not.toContain("Fukt");
  });

  it("alle køoppføringer med samme table+id i bunten legges til side", async () => {
    const queue = [
      answer(1, A1, "general_description", POISON),
      // Laget mens den første var underveis: samme rad, ny seq
      answer(2, A1, "general_description", `${POISON} mer`),
      answer(3, A2, "building_year", 1985),
    ];
    fetchMock.mockImplementationOnce(async () => rejected(queue[0]!));
    fetchMock.mockImplementation(async () => reply(200, { applied: 1 }));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");

    expect(sentIds(1)).toEqual([A2]);
    const left = await storedQueue();
    expect(left.map((entry) => entry.seq)).toEqual([1, 2]);
    for (const entry of left) expect(entry.setAside?.at, String(entry.seq)).toBeTruthy();
  });

  it("400 uten endring og bunt med én endring: legges til side", async () => {
    const queue = [answer(1, A1, "general_description", POISON)];
    fetchMock.mockImplementation(async () => reply(400, { feil: "Ugyldig." }));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");

    const left = await storedQueue();
    expect(left).toHaveLength(1);
    expect(left[0]!.setAside?.at).toBeTruthy();
    expect((await store!.status()).pendingChanges).toBe(0);
  });

  it("400 uten kropp og bunt med én endring: legges til side", async () => {
    const queue = [answer(1, A1, "general_description", POISON)];
    fetchMock.mockImplementation(async () => reply(400));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");
    expect((await storedQueue())[0]!.setAside?.at).toBeTruthy();
  });

  it("400 uten endring og flere i bunten: nytt forsøk, ingenting lagt til side, ingen sending én og én", async () => {
    const queue = threeAnswers(0);
    fetchMock.mockImplementation(async () => reply(400, { feil: "Ugyldig." }));
    await open(queue);

    expect(await store!.syncNow()).toBe("failed");

    expect(changeCalls()).toBe(1);
    const left = await storedQueue();
    expect(left.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    for (const entry of left) expect(entry.setAside, String(entry.seq)).toBeUndefined();
    expect((await store!.status()).pendingChanges).toBe(3);
  });

  it("400 med endring som ikke finnes i bunten: nytt forsøk, ingenting lagt til side", async () => {
    const queue = threeAnswers(0);
    const stranger = answer(9, "0192d3a0-0000-7000-8000-0000000000ff", "summary", "x");
    fetchMock.mockImplementation(async () => rejected(stranger));
    await open(queue);

    expect(await store!.syncNow()).toBe("failed");

    const left = await storedQueue();
    expect(left).toHaveLength(3);
    for (const entry of left) expect(entry.setAside, String(entry.seq)).toBeUndefined();
  });

  it.each([401, 403, 409, 413, 500, 503, undefined])(
    "svar %s gir nytt forsøk og legger ingenting til side",
    async (status) => {
      const queue = threeAnswers(1);
      if (status === undefined) fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      // Også med en kropp som peker på endringen: bare 400 legger til side
      else
        fetchMock.mockImplementation(async () => {
          const body = (await rejected(queue[1]!).json()) as unknown;
          return reply(status, body);
        });
      await open(queue);

      expect(await store!.syncNow()).toBe("failed");

      const left = await storedQueue();
      expect(left.map((entry) => entry.seq)).toEqual([1, 2, 3]);
      for (const entry of left) expect(entry.setAside, String(entry.seq)).toBeUndefined();
      expect((await store!.status()).pendingChanges).toBe(3);
    },
  );
});

describe("lagt til side i køen (T-0001)", () => {
  it("lagt til side slettes aldri, heller ikke etter flere runder med 200", async () => {
    const queue = threeAnswers(0);
    fetchMock.mockImplementationOnce(async () => rejected(queue[0]!));
    fetchMock.mockImplementation(async () => reply(200, { applied: 1 }));
    const { deletes } = await open(queue);
    expect(await store!.syncNow()).toBe("ok");

    for (const year of [1990, 1991, 1992]) {
      await store!.setAnswer(FORM, "building_year", year);
      expect(await store!.syncNow()).toBe("ok");
    }

    const left = await storedQueue();
    expect(left.map((entry) => entry.seq)).toEqual([1]);
    expect(left[0]!.setAside?.at).toBeTruthy();
    // Ingen sletting i køen av oppføringen som er lagt til side
    expect(deletes.filter((d) => d.store === LOCAL_OUTBOX_STORE && d.key === 1)).toEqual([]);
  });

  it("ventetallet teller ikke lagt til side (3 i køen, 1 lagt til side gir 2)", async () => {
    const queue = threeAnswers(0);
    queue[0] = { ...queue[0]!, setAside: { at: NOW } };
    await open(queue, false);

    expect((await store!.status()).pendingChanges).toBe(2);
  });

  it("lagt til side overlever omlasting: nytt lager fra samme kø sender den ikke", async () => {
    const queue = [
      answer(1, A1, "general_description", POISON, { at: NOW }),
      answer(2, A2, "building_year", 1985),
    ];
    fetchMock.mockImplementation(async () => reply(200, { applied: 1 }));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");

    expect(changeCalls()).toBe(1);
    expect(sentIds(0)).toEqual([A2]);
    const left = await storedQueue();
    expect(left).toHaveLength(1);
    expect(left[0]!.setAside).toEqual({ at: NOW });
  });

  it("Synk nå regner køen som tømt når bare lagt-til-side-oppføringer står igjen", async () => {
    const queue = [answer(1, A1, "general_description", POISON, { at: NOW })];
    fetchMock.mockImplementation(async () => reply(200, { applied: 0 }));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");
    expect(changeCalls()).toBe(0);
    const status = await store!.status();
    expect(status.pendingChanges).toBe(0);
    expect(status.serverConfirmed).toBe(true);
  });

  it("200 på en senere endring i samme felt løser den gamle, som blir liggende", async () => {
    const queue = [
      answer(1, A1, "general_description", POISON, { at: NOW }),
      answer(2, A1, "general_description", "Fukt i kjeller"),
    ];
    fetchMock.mockImplementation(async () => reply(200, { applied: 1 }));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");

    expect(sentIds(0)).toEqual([A1]);
    const left = await storedQueue();
    expect(left.map((entry) => entry.seq)).toEqual([1]);
    expect(left[0]!.setAside?.resolved).toBe(true);
    expect(left[0]!.setAside?.at).toBe(NOW);
    expect(left[0]!.data.value).toBe(JSON.stringify(POISON));
  });

  it("200 på en senere endring med annen id, men samme felt (trial_form_id:field_key), løser også", async () => {
    const queue = [
      answer(1, A1, "general_description", POISON, { at: NOW }),
      answer(2, A3, "general_description", "Fukt i kjeller"),
    ];
    fetchMock.mockImplementation(async () => reply(200, { applied: 1 }));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");
    expect((await storedQueue())[0]!.setAside?.resolved).toBe(true);
  });

  it("200 på et annet felt løser ikke", async () => {
    const queue = [
      answer(1, A1, "general_description", POISON, { at: NOW }),
      answer(2, A2, "building_year", 1985),
    ];
    fetchMock.mockImplementation(async () => reply(200, { applied: 1 }));
    await open(queue);

    expect(await store!.syncNow()).toBe("ok");
    const left = await storedQueue();
    expect(left).toHaveLength(1);
    expect(left[0]!.setAside?.resolved).toBeFalsy();
  });

  it("ny endring i samme felt etter 400 blir ny oppføring og sendes", async () => {
    const queue = [answer(1, A1, "building_year", 1985)];
    fetchMock.mockImplementationOnce(async () => rejected(queue[0]!));
    fetchMock.mockImplementation(async () => reply(200, { applied: 1 }));
    await open(queue);
    expect(await store!.syncNow()).toBe("ok");

    await store!.setAnswer(FORM, "building_year", 1986);
    const before = await storedQueue();
    expect(before).toHaveLength(2);
    expect(before[0]!.setAside?.at).toBeTruthy();
    expect(before[0]!.data.value).toBe(JSON.stringify(1985));
    expect(before[1]!.setAside).toBeUndefined();
    expect((await store!.status()).pendingChanges).toBe(1);

    expect(await store!.syncNow()).toBe("ok");
    const left = await storedQueue();
    expect(left.map((entry) => entry.seq)).toEqual([1]);
    expect(left[0]!.setAside?.resolved).toBe(true);
  });
});

describe("henting etter vask gir ingen evig løkke (T-0001)", () => {
  it("hentet vasket svar lager ingen ny køoppføring", async () => {
    await open([], false);

    await store!.applySyncedRows("trial_answers", [
      {
        id: A1,
        trial_form_id: FORM,
        field_key: "general_description",
        value: JSON.stringify("Fukt i kjeller"),
        text_state: null,
        device_id: "enhet-1",
        created_at: NOW,
        updated_at: NOW,
        deleted_at: null,
      },
    ]);

    expect(await storedQueue()).toEqual([]);
    expect((await store!.status()).pendingChanges).toBe(0);
  });
});
