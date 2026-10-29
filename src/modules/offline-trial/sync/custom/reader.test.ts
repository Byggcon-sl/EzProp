import { describe, expect, it, vi } from "vitest";
import type { TrialTableName } from "../local-columns";
import { applyIncoming } from "../local/apply-incoming";
import { localRowKey } from "../local/outbox";
import type { LocalReadContext } from "../local/types";
import type { IncomingChange, LocalRow } from "../types";
import { createCustomReader } from "./reader";

// Hente-leseren (docs/funksjoner/fase1-kandidat-egenbygd.md pkt. 5–6 og beslutningen «myk
// sletting»). Testplan avsnitt 2.2. Falsk `LocalReadContext` der `mergeIncoming` bruker den ekte
// `applyIncoming` over tabeller i minnet. Klokke, tidtaker og `fetch` settes inn. Alle data er
// oppdiktet.

const ORG = "0192d3a0-0000-7000-8000-00000000000a";
const FORM = "0192d3a0-0000-7000-8000-000000000001";
const PHOTO = "0192d3a0-0000-7000-8000-000000000002";
const ANSWER = "0192d3a0-0000-7000-8000-000000000003";
const NOW = "2026-10-29T10:00:00.000Z";
const LATER = "2026-10-29T10:05:00.000Z";

/** Lar ventende løfter og `setImmediate` gå ferdig. */
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Klokke og tidtaker vi styrer selv. */
function fakeClock() {
  let time = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => time,
    setTimer: (callback: () => void, ms: number) => {
      const id = ++nextId;
      timers.set(id, { at: time + ms, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle: ReturnType<typeof setTimeout>) => {
      timers.delete(handle as unknown as number);
    },
    pendingTimers: () => timers.size,
    async advance(ms: number) {
      const end = time + ms;
      for (;;) {
        await settle();
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].callback();
      }
      time = end;
      await settle();
    },
  };
}

type FakeResponse = { status: number; body?: unknown } | "network-error";

function pullBody(
  endringer: Partial<Record<TrialTableName, Record<string, unknown>[]>>,
  markor = "markor-1",
  ferdig = true,
): FakeResponse {
  return { status: 200, body: { endringer, markor, ferdig } };
}

const EMPTY = pullBody({ trial_forms: [], trial_answers: [], trial_photos: [] });

/** `fetch` som gir svarene i rekkefølge, deretter et tomt svar. Husker URL-ene. */
function fakeFetch(responses: FakeResponse[] = []) {
  const urls: URL[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    urls.push(new URL(input, "http://localhost"));
    inits.push(init);
    const next = responses.shift() ?? EMPTY;
    if (next === "network-error") throw new TypeError("Failed to fetch");
    return {
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body ?? ""),
    } as unknown as Response;
  });
  return { fetchImpl, urls, inits };
}

interface MergeCall {
  table: TrialTableName;
  changes: IncomingChange[];
  stateRow: Record<string, unknown> | null;
}

function fakeContext(options: { cursor?: string; online?: boolean } = {}) {
  const tables: Record<TrialTableName, LocalRow[]> = {
    trial_forms: [],
    trial_answers: [],
    trial_photos: [],
  };
  const state = new Map<string, Record<string, unknown>>();
  if (options.cursor) state.set("cursor", { key: "cursor", value: options.cursor });
  const pendingKeys = new Set<string>();
  const merges: MergeCall[] = [];
  const ackListeners: (() => void)[] = [];
  const flags = { closed: false, online: options.online ?? true, closeAfterMerges: Infinity };

  const ctx: LocalReadContext = {
    organizationId: ORG,
    storedState: [...state.values()],
    isClosed: () => flags.closed,
    isOnline: () => flags.online,
    mergeIncoming: vi.fn(
      async (
        table: TrialTableName,
        changes: readonly IncomingChange[],
        stateRow: Record<string, unknown> | null,
      ) => {
        merges.push({ table, changes: [...changes], stateRow });
        if (changes.length > 0) {
          tables[table] = applyIncoming(table, tables[table], changes, pendingKeys).rows;
        }
        if (stateRow) state.set(String(stateRow.key), stateRow);
        if (merges.length >= flags.closeAfterMerges) flags.closed = true;
      },
    ),
    resetTable: vi.fn(async () => undefined),
    deleteState: vi.fn(async (key: string) => {
      state.delete(key);
    }),
    notifyStatus: vi.fn(),
    afterAck: (listener) => {
      ackListeners.push(listener);
    },
  };
  return { ctx, tables, state, pendingKeys, merges, ackListeners, flags };
}

function setup(
  responses: FakeResponse[] = [],
  options: { cursor?: string; online?: boolean } = {},
) {
  const clock = fakeClock();
  const fetch = fakeFetch(responses);
  const context = fakeContext(options);
  const reader = createCustomReader({
    fetchImpl: fetch.fetchImpl,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
  });
  return { clock, fetch, context, reader };
}

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

function answerRow(value: unknown, extra: Partial<LocalRow> = {}): LocalRow {
  return {
    id: ANSWER,
    trial_form_id: FORM,
    field_key: "floors",
    value: JSON.stringify(value),
    text_state: null,
    device_id: "enhet-1",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...extra,
  };
}

describe("createCustomReader (reader.ts)", () => {
  // Obligatorisk
  it("rad med deleted_at fra hente-ruten fjernes lokalt", async () => {
    const { clock, context, reader } = setup([
      pullBody({ trial_forms: [formRow({ deleted_at: LATER, updated_at: LATER })] }),
    ]);
    context.tables.trial_forms = [formRow()];
    reader.start(context.ctx);
    await clock.advance(0);
    expect(context.tables.trial_forms).toEqual([]);
    reader.stop();
  });

  // Obligatorisk (tap av data)
  it("rad med deleted_at og usendt lokal endring røres ikke", async () => {
    const { clock, context, reader } = setup([
      pullBody({ trial_answers: [answerRow(3, { deleted_at: LATER, updated_at: LATER })] }),
    ]);
    const local = answerRow(7);
    context.tables.trial_answers = [local];
    context.pendingKeys.add(localRowKey("trial_answers", local));
    reader.start(context.ctx);
    await clock.advance(0);
    expect(context.tables.trial_answers).toHaveLength(1);
    expect(context.tables.trial_answers[0]?.value).toBe(JSON.stringify(7));
    expect(context.tables.trial_answers[0]?.deleted_at).toBeNull();
    reader.stop();
  });

  it("innkommende rader sendes som update, tabellene i rekkefølgen forms, answers, photos", async () => {
    const { clock, context, reader } = setup([
      pullBody({
        trial_photos: [
          {
            id: PHOTO,
            trial_form_id: FORM,
            field_key: "cover_photo",
            name: "tak.jpg",
            size_bytes: 120,
            device_id: "enhet-2",
            created_at: NOW,
            updated_at: NOW,
          },
        ],
        trial_answers: [answerRow(7)],
        trial_forms: [formRow()],
      }),
    ]);
    reader.start(context.ctx);
    await clock.advance(0);
    expect(context.merges.map((call) => call.table)).toEqual([
      "trial_forms",
      "trial_answers",
      "trial_photos",
    ]);
    const kinds = context.merges.flatMap((call) => call.changes.map((change) => change.kind));
    expect(kinds).toEqual(["update", "update", "update"]);
    reader.stop();
  });

  it("markøren skrives bare sammen med den siste tabellen", async () => {
    const { clock, context, reader } = setup([
      pullBody(
        { trial_forms: [formRow()], trial_answers: [answerRow(7)], trial_photos: [] },
        "m-2",
      ),
    ]);
    reader.start(context.ctx);
    await clock.advance(0);
    expect(context.merges.map((call) => call.stateRow)).toEqual([
      null,
      null,
      { key: "cursor", value: "m-2" },
    ]);
    // Også når trial_photos er tom, kalles mergeIncoming med []
    expect(context.merges[2]?.changes).toEqual([]);
    expect(context.state.get("cursor")).toEqual({ key: "cursor", value: "m-2" });
    reader.stop();
  });

  it("stopp midt i flettingen gir samme rader på nytt og ingen markør", async () => {
    const body = pullBody({ trial_forms: [formRow()], trial_answers: [answerRow(7)] }, "m-ny");
    const first = setup([body], { cursor: "m-gammel" });
    first.context.flags.closeAfterMerges = 1;
    first.reader.start(first.context.ctx);
    await first.clock.advance(0);
    expect(first.context.merges).toHaveLength(1);
    expect(first.context.state.get("cursor")).toEqual({ key: "cursor", value: "m-gammel" });
    await first.clock.advance(60_000);
    expect(first.fetch.fetchImpl).toHaveBeenCalledTimes(1);

    // Ny leser med samme lagrede markør (som etter omstart) og samme lokale tabeller
    const second = setup([body], { cursor: "m-gammel" });
    second.context.tables.trial_forms = first.context.tables.trial_forms;
    second.reader.start(second.context.ctx);
    await second.clock.advance(0);
    expect(second.fetch.urls[0]?.searchParams.get("siden")).toBe("m-gammel");
    expect(second.context.tables.trial_forms).toHaveLength(1);
    expect(second.context.tables.trial_answers).toHaveLength(1);
    expect(second.context.state.get("cursor")).toEqual({ key: "cursor", value: "m-ny" });
    second.reader.stop();
  });

  it("spørrestrengen har organisasjonen fra konteksten og den lagrede markøren", async () => {
    const withCursor = setup([], { cursor: "lagret-markor" });
    withCursor.reader.start(withCursor.context.ctx);
    await withCursor.clock.advance(0);
    const url = withCursor.fetch.urls[0]!;
    expect(url.pathname).toBe("/api/prove/synk/hent");
    expect([...url.searchParams.keys()].sort()).toEqual(["organisasjon", "siden"]);
    expect(url.searchParams.get("organisasjon")).toBe(ORG);
    expect(url.searchParams.get("siden")).toBe("lagret-markor");
    expect(withCursor.fetch.inits[0]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    });
    withCursor.reader.stop();

    const withoutCursor = setup();
    withoutCursor.reader.start(withoutCursor.context.ctx);
    await withoutCursor.clock.advance(0);
    expect([...withoutCursor.fetch.urls[0]!.searchParams.keys()]).toEqual(["organisasjon"]);
    withoutCursor.reader.stop();
  });

  it("ferdig: false gir neste side med en gang med den nye markøren", async () => {
    const { clock, fetch, context, reader } = setup([
      pullBody({ trial_forms: [formRow()] }, "side-1", false),
      pullBody({}, "side-2", true),
    ]);
    reader.start(context.ctx);
    await clock.advance(0);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetch.urls[1]?.searchParams.get("siden")).toBe("side-1");
    // Deretter vanlig takt: neste kall om 5 s, ikke før
    await clock.advance(4_999);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(2);
    await clock.advance(1);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetch.urls[2]?.searchParams.get("siden")).toBe("side-2");
    reader.stop();
  });

  // Obligatorisk (tap av data)
  it("400 sletter bare markøren, og neste henting går uten siden", async () => {
    const { clock, fetch, context, reader } = setup(
      [{ status: 400, body: { feil: "Ugyldig markør." } }],
      { cursor: "odelagt" },
    );
    const local = answerRow(7);
    context.tables.trial_answers = [local];
    context.pendingKeys.add(localRowKey("trial_answers", local));
    reader.start(context.ctx);
    await clock.advance(0);
    expect(context.ctx.deleteState).toHaveBeenCalledTimes(1);
    expect(context.ctx.deleteState).toHaveBeenCalledWith("cursor");
    expect(context.ctx.resetTable).not.toHaveBeenCalled();
    // Den andre hentingen (uten siden) fletter et tomt svar; ingen fletting fra 400-svaret
    expect(context.merges.every((call) => call.changes.length === 0)).toBe(true);
    expect(context.tables.trial_answers).toEqual([local]);
    expect([...context.pendingKeys]).toEqual([localRowKey("trial_answers", local)]);
    expect(fetch.urls[0]?.searchParams.get("siden")).toBe("odelagt");
    expect(fetch.urls[1]?.searchParams.has("siden")).toBe(false);
    reader.stop();
  });

  it("400 uten siden regnes som feil, så hentingen ikke går i ring", async () => {
    const { clock, fetch, context, reader } = setup([{ status: 400, body: { feil: "Ugyldig." } }]);
    reader.start(context.ctx);
    await clock.advance(0);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(1);
    expect(context.ctx.deleteState).not.toHaveBeenCalled();
    await clock.advance(5_000);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(2);
    reader.stop();
  });

  it.each<[string, FakeResponse]>([
    ["401", { status: 401, body: { feil: "x" } }],
    ["403", { status: 403, body: { feil: "x" } }],
    ["500", { status: 500, body: { feil: "x" } }],
    ["502", { status: 502, body: "x" }],
    ["nettverksfeil", "network-error"],
    ["ugyldig kropp", { status: 200, body: { endringer: [], markor: 1 } }],
  ])("%s fletter ingenting og rører ikke markøren", async (_name, response) => {
    const { clock, fetch, context, reader } = setup([response, response], { cursor: "m-1" });
    reader.start(context.ctx);
    await clock.advance(0);
    expect(context.ctx.mergeIncoming).not.toHaveBeenCalled();
    expect(context.ctx.deleteState).not.toHaveBeenCalled();
    expect(context.state.get("cursor")).toEqual({ key: "cursor", value: "m-1" });
    // Neste kall etter ventetiden fra pull-schedule (5 s, så 10 s)
    await clock.advance(4_999);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(1);
    await clock.advance(1);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetch.urls[1]?.searchParams.get("siden")).toBe("m-1");
    await clock.advance(9_999);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(2);
    await clock.advance(1);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(3);
    reader.stop();
  });

  it("radene normaliseres før fletting", async () => {
    const { clock, context, reader } = setup([
      pullBody({
        trial_answers: [{ ...answerRow(null), value: '{"a":1}' }],
        trial_photos: [
          {
            id: PHOTO,
            trial_form_id: FORM,
            field_key: "cover_photo",
            name: "tak.jpg",
            size_bytes: "120",
            storage_path: "skal/aldri/med",
            created_at: "2026-10-29 10:00:00+00",
            updated_at: "2026-10-29 10:00:00+00",
          },
        ],
      }),
    ]);
    reader.start(context.ctx);
    await clock.advance(0);
    const photo = context.tables.trial_photos[0]!;
    expect(photo.size_bytes).toBe(120);
    expect(photo.created_at).toBe(NOW);
    expect(photo).not.toHaveProperty("storage_path");
    expect(context.tables.trial_answers[0]?.value).toBe('{"a":1}');
    reader.stop();
  });

  it("ingen henting uten nett og ingen etter stop", async () => {
    const { clock, fetch, context, reader } = setup([], { online: false });
    reader.start(context.ctx);
    await clock.advance(30_000);
    expect(fetch.fetchImpl).not.toHaveBeenCalled();

    context.flags.online = true;
    reader.wake();
    await clock.advance(0);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(1);

    reader.stop();
    expect(clock.pendingTimers()).toBe(0);
    reader.wake();
    context.ackListeners.forEach((listener) => listener());
    await clock.advance(120_000);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("afterAck gir henting ved neste takt", async () => {
    const { clock, fetch, context, reader } = setup([
      "network-error",
      "network-error",
      "network-error",
    ]);
    reader.start(context.ctx);
    await clock.advance(0);
    await clock.advance(5_000);
    await clock.advance(10_000);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(3);
    // Nå ventes det 20 s. En bunt får 200: neste henting om 5 s.
    expect(context.ackListeners).toHaveLength(1);
    context.ackListeners[0]!();
    await clock.advance(4_999);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(3);
    await clock.advance(1);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(4);
    reader.stop();
  });

  it("mange bunter på rad skyver ikke hentingen foran seg", async () => {
    const { clock, fetch, context, reader } = setup();
    reader.start(context.ctx);
    await clock.advance(0);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i++) {
      await clock.advance(1_000);
      context.ackListeners[0]!();
    }
    await clock.advance(1_000);
    expect(fetch.fetchImpl).toHaveBeenCalledTimes(2);
    reader.stop();
  });
});
