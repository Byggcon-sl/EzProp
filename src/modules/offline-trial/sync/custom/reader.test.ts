import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrialTableName } from "../local-columns";
import { applyIncoming } from "../local/apply-incoming";
import { localRowKey } from "../local/outbox";
import type { LocalReadContext, LocalTrialReader } from "../local/types";
import type { IncomingChange, LocalRow } from "../types";
import { createCustomReader } from "./reader";
import { CUSTOM_CURSOR_KEY, TRIAL_PULL_ROUTE } from "./types";

// Hente-leseren i kandidat 3, egenbygd (docs/funksjoner/fase1-kandidat-egenbygd.md pkt. 5–6 og
// beslutningen «myk sletting» i runde 1). Testplan avsnitt 2.2. Ingen IndexedDB og ingen DOM:
// konteksten er falsk, men `mergeIncoming` bruker den ekte `applyIncoming` over tabeller i minnet
// og et sett med usendte nøkler. Tidtakerne er falske. Alle data er oppdiktet.

const ORG = "0192d3a0-0000-7000-8000-0000000000f1";
const FORM = "0192d3a0-0000-7000-8000-000000000001";
const ANSWER = "0192d3a0-0000-7000-8000-0000000000a1";
const PHOTO = "0192d3a0-0000-7000-8000-0000000000b1";
const NOW = "2026-10-28T10:00:00.000Z";
const LATER = "2026-10-28T10:05:00.000Z";
const ORDER: TrialTableName[] = ["trial_forms", "trial_answers", "trial_photos"];

function formRow(extra: Partial<LocalRow> = {}): LocalRow {
  return {
    id: FORM,
    name: "Testskjema 1",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...extra,
  };
}

function answerRow(extra: Partial<LocalRow> = {}): LocalRow {
  return {
    id: ANSWER,
    trial_form_id: FORM,
    field_key: "floors",
    value: "7",
    text_state: null,
    device_id: "enhet-1",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...extra,
  };
}

function photoRow(extra: Partial<LocalRow> = {}): LocalRow {
  return {
    id: PHOTO,
    trial_form_id: FORM,
    field_key: "cover_photo",
    name: "test-image.png",
    size_bytes: 120,
    sha256: null,
    uploaded_at: null,
    device_id: "annen-enhet",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...extra,
  };
}

interface Body {
  endringer: Partial<Record<TrialTableName, LocalRow[]>>;
  markor: string;
  ferdig: boolean;
}

function body(
  markor: string,
  endringer: Partial<Record<TrialTableName, LocalRow[]>> = {},
  ferdig = true,
): Body {
  return {
    endringer: { trial_forms: [], trial_answers: [], trial_photos: [], ...endringer },
    markor,
    ferdig,
  };
}

/** Minste svar leseren trenger. Ingen ekte strøm, så falske tidtakere ikke henger. */
function respond(status: number, payload: unknown): Response {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => JSON.parse(text) as unknown,
    text: async () => text,
    clone() {
      return respond(status, payload);
    },
  } as unknown as Response;
}

type Handler = () => Response | Promise<Response>;

interface FakeOptions {
  stored?: Record<string, unknown>[];
  tables?: Partial<Record<TrialTableName, LocalRow[]>>;
  pending?: string[];
  online?: boolean;
  /** `isClosed()` blir sann etter så mange kall til `mergeIncoming`. */
  closeAfterMerges?: number;
}

interface MergeCall {
  table: TrialTableName;
  changes: readonly IncomingChange[];
  stateRow: Record<string, unknown> | null;
}

/** Falsk `LocalReadContext` med ekte innfletting over tabeller i minnet. */
function fakeContext(options: FakeOptions = {}) {
  const tables: Record<TrialTableName, LocalRow[]> = {
    trial_forms: [],
    trial_answers: [],
    trial_photos: [],
    ...options.tables,
  };
  const pending = new Set(options.pending ?? []);
  const state = new Map<string, Record<string, unknown>>();
  for (const row of options.stored ?? []) state.set(String(row.key), { ...row });
  const merges: MergeCall[] = [];
  const ackListeners: (() => void)[] = [];
  let online = options.online ?? true;
  let closed = false;

  const deleteState = vi.fn(async (key: string) => {
    state.delete(key);
  });
  const resetTable = vi.fn(async () => {});
  const notifyStatus = vi.fn();

  const ctx: LocalReadContext = {
    organizationId: ORG,
    storedState: (options.stored ?? []).map((row) => ({ ...row })),
    isClosed: () => closed,
    isOnline: () => online,
    async mergeIncoming(table, changes, stateRow) {
      merges.push({ table, changes: [...changes], stateRow });
      tables[table] = applyIncoming(table, tables[table], changes, pending).rows;
      if (stateRow) state.set(String(stateRow.key), { ...stateRow });
      if (options.closeAfterMerges !== undefined && merges.length >= options.closeAfterMerges) {
        closed = true;
      }
    },
    resetTable,
    deleteState,
    notifyStatus,
    afterAck(listener) {
      ackListeners.push(listener);
    },
  };

  return {
    ctx,
    tables,
    pending,
    state,
    merges,
    ackListeners,
    deleteState,
    resetTable,
    notifyStatus,
    setOnline(value: boolean) {
      online = value;
    },
  };
}

/** Falsk `fetch`: svarer med køen av svar, deretter tomt og ferdig. Husker adressene. */
function fakeFetch(handlers: Handler[] = []) {
  const calls: { url: URL; init: RequestInit | undefined }[] = [];
  let fallbackCount = 0;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url: new URL(raw, "http://localhost"), init });
    const next = handlers.shift();
    if (next) return next();
    fallbackCount += 1;
    return respond(200, body(`tom-${fallbackCount}`));
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function startReader(fetchImpl: typeof fetch, ctx: LocalReadContext): LocalTrialReader {
  const reader = createCustomReader({
    fetchImpl,
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
    now: () => Date.now(),
  });
  reader.start(ctx);
  return reader;
}

/** Lar løfter og tidtakere på 0 ms gå, uten at klokken flyttes. */
async function settle() {
  for (let i = 0; i < 30; i++) await vi.advanceTimersByTimeAsync(0);
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
}

let readers: LocalTrialReader[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  readers = [];
});

afterEach(() => {
  for (const reader of readers) reader.stop();
  vi.useRealTimers();
});

function start(fetchImpl: typeof fetch, ctx: LocalReadContext) {
  const reader = startReader(fetchImpl, ctx);
  readers.push(reader);
  return reader;
}

describe("createCustomReader (custom/reader.ts)", () => {
  // Obligatorisk
  it("rad med deleted_at fra hente-ruten fjernes lokalt", async () => {
    const fake = fakeContext({ tables: { trial_forms: [formRow()] } });
    const { fetchImpl } = fakeFetch([
      () =>
        respond(
          200,
          body("m1", { trial_forms: [formRow({ deleted_at: LATER, updated_at: LATER })] }),
        ),
    ]);
    start(fetchImpl, fake.ctx);
    await settle();
    expect(fake.tables.trial_forms).toEqual([]);
    expect(fake.resetTable).not.toHaveBeenCalled();
  });

  // Obligatorisk (tap av data)
  it("rad med deleted_at og usendt lokal endring røres ikke", async () => {
    const local = answerRow({ value: "7" });
    const fake = fakeContext({
      tables: { trial_answers: [local] },
      pending: [localRowKey("trial_answers", local)],
    });
    const { fetchImpl } = fakeFetch([
      () =>
        respond(
          200,
          body("m1", {
            trial_answers: [
              answerRow({
                value: "3",
                device_id: "annen-enhet",
                deleted_at: LATER,
                updated_at: LATER,
              }),
            ],
          }),
        ),
    ]);
    start(fetchImpl, fake.ctx);
    await settle();
    expect(fake.merges.length).toBeGreaterThan(0);
    expect(fake.tables.trial_answers).toHaveLength(1);
    expect(fake.tables.trial_answers[0]).toMatchObject({
      id: ANSWER,
      value: "7",
      deleted_at: null,
    });
  });

  it("innkommende rader sendes som update, tabellene i rekkefølgen forms, answers, photos", async () => {
    const fake = fakeContext();
    const { fetchImpl } = fakeFetch([
      () =>
        respond(
          200,
          body("m1", {
            trial_forms: [formRow()],
            trial_answers: [answerRow()],
            trial_photos: [photoRow()],
          }),
        ),
    ]);
    start(fetchImpl, fake.ctx);
    await settle();
    const first = fake.merges.slice(0, 3);
    expect(first.map((call) => call.table)).toEqual(ORDER);
    for (const call of first) {
      expect(call.changes.length).toBe(1);
      for (const change of call.changes) {
        expect(change.kind).toBe("update");
        expect(change.table).toBe(call.table);
        expect(change.key).toBe(localRowKey(call.table, change.row));
      }
    }
    expect(fake.tables.trial_forms).toHaveLength(1);
    expect(fake.tables.trial_answers).toHaveLength(1);
    expect(fake.tables.trial_photos).toHaveLength(1);
  });

  it.each([
    ["alle tre tabellene har rader", true],
    ["trial_photos er tom", false],
  ])("markøren skrives bare sammen med den siste tabellen (%s)", async (_name, withPhotos) => {
    const fake = fakeContext({ stored: [{ key: CUSTOM_CURSOR_KEY, value: "m0" }] });
    let release: () => void = () => {};
    const { fetchImpl } = fakeFetch([
      () =>
        respond(
          200,
          body("m1", {
            trial_forms: [formRow()],
            trial_answers: [answerRow()],
            trial_photos: withPhotos ? [photoRow()] : [],
          }),
        ),
      // Neste henting henger, så bare første svar er flettet
      () => new Promise<Response>((resolve) => (release = () => resolve(respond(500, {})))),
    ]);
    start(fetchImpl, fake.ctx);
    await settle();
    const withState = fake.merges.filter((call) => call.stateRow !== null);
    expect(withState).toHaveLength(1);
    const last = fake.merges.at(-1)!;
    expect(last.table).toBe("trial_photos");
    expect(last.stateRow).toEqual({ key: CUSTOM_CURSOR_KEY, value: "m1" });
    if (!withPhotos) expect(last.changes).toEqual([]);
    for (const call of fake.merges.slice(0, -1)) expect(call.stateRow).toBeNull();
    expect(fake.state.get(CUSTOM_CURSOR_KEY)).toEqual({ key: CUSTOM_CURSOR_KEY, value: "m1" });
    release();
  });

  it("stopp midt i flettingen gir samme rader på nytt og ingen markør", async () => {
    const stored = [{ key: CUSTOM_CURSOR_KEY, value: "m1" }];
    const page = () =>
      respond(
        200,
        body("m2", {
          trial_forms: [formRow()],
          trial_answers: [answerRow({ device_id: "annen-enhet" })],
          trial_photos: [photoRow()],
        }),
      );

    const first = fakeContext({ stored, closeAfterMerges: 1 });
    const one = fakeFetch([page]);
    start(one.fetchImpl, first.ctx);
    await settle();
    await advance(60_000);
    // Lageret ble lukket etter første tabell: ingen flere flettinger, markøren er ikke flyttet
    expect(first.merges).toHaveLength(1);
    expect(first.merges[0]!.table).toBe("trial_forms");
    expect(first.merges[0]!.stateRow).toBeNull();
    expect(first.state.get(CUSTOM_CURSOR_KEY)).toEqual({ key: CUSTOM_CURSOR_KEY, value: "m1" });

    // Ny start med samme lagrede markør og samme lokale rader
    const second = fakeContext({ stored, tables: first.tables });
    const two = fakeFetch([page]);
    start(two.fetchImpl, second.ctx);
    await settle();
    expect(two.calls[0]!.url.searchParams.get("siden")).toBe("m1");
    expect(second.tables.trial_forms).toHaveLength(1);
    expect(second.tables.trial_answers).toHaveLength(1);
    expect(second.tables.trial_photos).toHaveLength(1);
    expect(second.state.get(CUSTOM_CURSOR_KEY)).toEqual({ key: CUSTOM_CURSOR_KEY, value: "m2" });
  });

  it("spørrestrengen har organisasjonen fra konteksten og den lagrede markøren", async () => {
    const withCursor = fakeContext({
      stored: [{ key: CUSTOM_CURSOR_KEY, value: "lagret-markor" }],
    });
    const a = fakeFetch();
    start(a.fetchImpl, withCursor.ctx);
    await settle();
    const url = a.calls[0]!.url;
    expect(url.pathname).toBe(TRIAL_PULL_ROUTE);
    expect([...url.searchParams.keys()].sort()).toEqual(["organisasjon", "siden"]);
    expect(url.searchParams.get("organisasjon")).toBe(ORG);
    expect(url.searchParams.get("siden")).toBe("lagret-markor");

    const fresh = fakeContext();
    const b = fakeFetch();
    start(b.fetchImpl, fresh.ctx);
    await settle();
    const firstUrl = b.calls[0]!.url;
    expect(firstUrl.pathname).toBe(TRIAL_PULL_ROUTE);
    expect([...firstUrl.searchParams.keys()]).toEqual(["organisasjon"]);
    expect(firstUrl.searchParams.get("organisasjon")).toBe(ORG);
  });

  it("kallet går med cache no-store og credentials same-origin (tillegg, kontrakten)", async () => {
    const fake = fakeContext();
    const { fetchImpl, calls } = fakeFetch();
    start(fetchImpl, fake.ctx);
    await settle();
    expect(calls[0]!.init?.cache).toBe("no-store");
    expect(calls[0]!.init?.credentials).toBe("same-origin");
  });

  it("ferdig: false gir neste side med en gang med den nye markøren", async () => {
    const fake = fakeContext();
    const { fetchImpl, calls } = fakeFetch([
      () => respond(200, body("side-1", { trial_forms: [formRow()] }, false)),
      () => respond(200, body("side-2", { trial_answers: [answerRow()] }, true)),
    ]);
    start(fetchImpl, fake.ctx);
    // Klokken flyttes ikke: andre side må gå uten ventetid
    await settle();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]!.url.searchParams.has("siden")).toBe(false);
    expect(calls[1]!.url.searchParams.get("siden")).toBe("side-1");
    expect(fake.state.get(CUSTOM_CURSOR_KEY)).toEqual({ key: CUSTOM_CURSOR_KEY, value: "side-2" });
    expect(fake.tables.trial_forms).toHaveLength(1);
    expect(fake.tables.trial_answers).toHaveLength(1);
  });

  // Obligatorisk (tap av data)
  it("400 sletter bare markøren, og neste henting går uten siden", async () => {
    const local = answerRow({ value: "7" });
    const key = localRowKey("trial_answers", local);
    const fake = fakeContext({
      stored: [{ key: CUSTOM_CURSOR_KEY, value: "ugyldig" }],
      tables: { trial_forms: [formRow()], trial_answers: [local] },
      pending: [key],
    });
    const before = JSON.parse(JSON.stringify(fake.tables)) as unknown;
    const { fetchImpl, calls } = fakeFetch([
      () => respond(400, { feil: "Ugyldig markør." }),
      // Neste henting henger, så vi ser tilstanden rett etter 400
      () => new Promise<Response>(() => {}),
    ]);
    start(fetchImpl, fake.ctx);
    await settle();

    expect(fake.deleteState).toHaveBeenCalledTimes(1);
    expect(fake.deleteState).toHaveBeenCalledWith(CUSTOM_CURSOR_KEY);
    expect(fake.resetTable).not.toHaveBeenCalled();
    expect(fake.merges).toEqual([]);
    expect(fake.tables).toEqual(before);
    expect([...fake.pending]).toEqual([key]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("siden")).toBe("ugyldig");
    expect(calls[1]!.url.searchParams.has("siden")).toBe(false);
  });

  it.each<[string, Handler]>([
    ["401", () => respond(401, { feil: "Ikke innlogget." })],
    ["403", () => respond(403, { feil: "Ingen tilgang." })],
    ["500", () => respond(500, { feil: "Feil." })],
    ["502", () => respond(502, { feil: "Feil." })],
    [
      "nettverksfeil",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])(
    "401, 403, 500 og nettverksfeil fletter ingenting og rører ikke markøren (%s)",
    async (_name, handler) => {
      const fake = fakeContext({
        stored: [{ key: CUSTOM_CURSOR_KEY, value: "m1" }],
        tables: { trial_forms: [formRow()] },
      });
      const { fetchImpl, calls } = fakeFetch([handler]);
      start(fetchImpl, fake.ctx);
      await settle();
      expect(calls).toHaveLength(1);
      expect(fake.merges).toEqual([]);
      expect(fake.deleteState).not.toHaveBeenCalled();
      expect(fake.resetTable).not.toHaveBeenCalled();
      expect(fake.state.get(CUSTOM_CURSOR_KEY)).toEqual({ key: CUSTOM_CURSOR_KEY, value: "m1" });
      expect(fake.tables.trial_forms).toEqual([formRow()]);

      // Neste forsøk etter ventetiden fra pull-schedule (første feil: 5 s), ikke før
      await advance(4_900);
      expect(calls).toHaveLength(1);
      await advance(200);
      expect(calls).toHaveLength(2);
      expect(calls[1]!.url.searchParams.get("siden")).toBe("m1");
    },
  );

  it("radene normaliseres før fletting", async () => {
    const fake = fakeContext();
    const { fetchImpl } = fakeFetch([
      () =>
        respond(
          200,
          body("m1", {
            trial_answers: [
              answerRow({
                field_key: "roof_tg",
                value: JSON.stringify("TG2"),
                device_id: "annen-enhet",
              }),
            ],
            trial_photos: [
              photoRow({ size_bytes: "120", storage_path: "oppdiktet/sti", created_by: "x" }),
            ],
          }),
        ),
    ]);
    start(fetchImpl, fake.ctx);
    await settle();
    const photo = fake.tables.trial_photos[0]!;
    expect(photo.size_bytes).toBe(120);
    expect(typeof photo.size_bytes).toBe("number");
    expect(photo).not.toHaveProperty("storage_path");
    expect(photo).not.toHaveProperty("created_by");
    const answer = fake.tables.trial_answers[0]!;
    expect(answer.value).toBe(JSON.stringify("TG2"));
    expect(JSON.parse(String(answer.value))).toBe("TG2");
  });

  it("ingen henting uten nett og ingen etter stop", async () => {
    const fake = fakeContext({ online: false });
    const { fetchImpl, calls } = fakeFetch();
    const reader = start(fetchImpl, fake.ctx);
    await settle();
    await advance(60_000);
    expect(calls).toHaveLength(0);

    fake.setOnline(true);
    reader.wake();
    await settle();
    expect(calls).toHaveLength(1);

    reader.stop();
    await advance(120_000);
    expect(calls).toHaveLength(1);
  });

  it("wake under feilventetid gir henting med en gang (tillegg, kontrakten)", async () => {
    const fake = fakeContext();
    const fail = () => respond(500, {});
    const { fetchImpl, calls } = fakeFetch([fail, fail, fail]);
    const reader = start(fetchImpl, fake.ctx);
    await settle();
    await advance(5_100);
    await advance(10_100);
    // Tre feil: neste forsøk om 20 s
    expect(calls).toHaveLength(3);
    reader.wake();
    await settle();
    expect(calls).toHaveLength(4);
  });

  it("afterAck gir henting ved neste takt", async () => {
    const fake = fakeContext();
    const fail = () => respond(500, {});
    const { fetchImpl, calls } = fakeFetch([fail, fail, fail]);
    start(fetchImpl, fake.ctx);
    await settle();
    expect(fake.ackListeners.length).toBeGreaterThan(0);
    await advance(5_100);
    await advance(10_100);
    // Tre feil: uten bunt ville neste forsøk vært om 20 s
    expect(calls).toHaveLength(3);
    await advance(1_000);
    for (const listener of fake.ackListeners) listener();
    await settle();
    await advance(5_100);
    expect(calls).toHaveLength(4);
  });

  it("notifyStatus kalles etter en vellykket henting (tillegg)", async () => {
    const fake = fakeContext();
    const { fetchImpl } = fakeFetch([() => respond(200, body("m1", { trial_forms: [formRow()] }))]);
    start(fetchImpl, fake.ctx);
    await settle();
    expect(fake.notifyStatus).toHaveBeenCalled();
  });
});
