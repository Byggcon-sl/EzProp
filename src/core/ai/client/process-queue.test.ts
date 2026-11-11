import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_QUEUE_MAX_ATTEMPTS,
  AI_QUEUE_SEND_TIMEOUT_MS,
  clearAiQueue,
  createAiQueue,
  createMemoryAiQueueStore,
  type AiQueueDeps,
  type AiQueueEnqueueInput,
  type AiQueueEntry,
  type AiQueueEvent,
  type AiQueueOwner,
  type AiQueueRunResult,
  type AiQueueSendPayload,
  type AiQueueSendResult,
  type AiQueueStore,
} from ".";

/*
 * Behandlingen av KI-køen når nettet er tilbake (docs/funksjoner/fase2a-ki-ko-testplan.md
 * avsnitt 3, K3.1–K3.10). `send` er en spion som etterligner serverhandlingen; ingen ekte
 * leverandør og ingen database. Teksten er oppdiktet.
 * Støtter hovedmål: KI i bunnen (alt går gjennom serveren og `requestSuggestion`), de ansatte
 * (forslaget kommer uten nytt trykk) og færre reklamasjoner (et sent svar sletter aldri en
 * nyere post, og ingenting vises etter utlogging).
 */

const OWNER: AiQueueOwner = { organizationId: randomUUID(), employeeId: randomUUID() };
const TEXT = "Fukt i kjellervegg ved sluk";
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const UNKNOWN_MESSAGE = "Noe gikk galt. Teksten din er uendret. Prøv igjen.";

/** Svaret fra serverhandlingen har flere felt enn køen trenger; de skal gå uendret tilbake. */
type TrialResult = AiQueueSendResult & { usageId?: string; text?: string; message?: string };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function input(text = TEXT, overrides: Partial<AiQueueEnqueueInput> = {}): AiQueueEnqueueInput {
  return {
    feature: "language_polish",
    targetType: "ai_trial",
    targetId: randomUUID(),
    fieldKey: "text",
    assignmentId: null,
    fields: { text },
    ...overrides,
  };
}

function setUp(deps: Partial<AiQueueDeps> = {}) {
  const store = createMemoryAiQueueStore();
  let tick = 0;
  const queue = createAiQueue({
    store,
    owner: OWNER,
    // Én millisekund mellom postene, så rekkefølgen er kjent
    now: () => NOW + tick++,
    isOnline: () => true,
    ...deps,
  });
  return { store, queue };
}

async function add(queue: ReturnType<typeof setUp>["queue"], data = input()) {
  const result = await queue.enqueue(data);
  if (result.kind !== "queued") throw new Error(`ventet queued, fikk ${result.reason}`);
  return result.entry;
}

async function stored(store: AiQueueStore): Promise<AiQueueEntry[]> {
  return store.update((rows) => ({ put: [], remove: [], result: rows as AiQueueEntry[] }));
}

function events() {
  const seen: AiQueueEvent<TrialResult>[] = [];
  return { seen, onEvent: (event: AiQueueEvent<TrialResult>) => void seen.push(event) };
}

/** Spion med samme form som `send` fra siden. */
function spySend(impl: (payload: AiQueueSendPayload, signal: AbortSignal) => Promise<TrialResult>) {
  return vi.fn(impl);
}

/** `send` som svarer fra en tabell per `requestId`. */
function sendFrom(table: Map<string, () => Promise<TrialResult>>) {
  return vi.fn(async (payload: AiQueueSendPayload, _signal: AbortSignal) => {
    const answer = table.get(payload.requestId);
    if (!answer) throw new Error("ukjent requestId i testen");
    return answer();
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("K3.1 nettfeil stopper runden", () => {
  it("send kaster TypeError på første: 1 kall, alle tre ligger igjen, attempts uendret", async () => {
    const { store, queue } = setUp();
    await add(queue);
    await add(queue);
    await add(queue);
    const send = spySend(async () => {
      throw new TypeError("Failed to fetch");
    });
    const { seen, onEvent } = events();

    const result = await queue.processQueue(send, onEvent);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "stopped", reason: "offline", remaining: 3 });
    const left = await stored(store);
    expect(left).toHaveLength(3);
    expect(left.every((e) => e.attempts === 0)).toBe(true);
    expect(seen).toEqual([]);
  });

  it("uten nett sendes ingenting", async () => {
    const { store, queue } = setUp({ isOnline: () => false });
    await add(queue);
    const send = spySend(async () => ({ kind: "suggestion" as const }));
    const result = await queue.processQueue(send, () => {});
    expect(send).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "stopped", reason: "offline", remaining: 1 });
    expect(await stored(store)).toHaveLength(1);
  });
});

describe("K3.2 tidsavbrudd 30 s", () => {
  it("standarden er 30 000 ms: ingen avgjørelse etter 29 999, stopp etter 30 000, posten ligger igjen", async () => {
    expect(AI_QUEUE_SEND_TIMEOUT_MS).toBe(30_000);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Uten `sendTimeoutMs`: standarden skal brukes
    const { store, queue } = setUp();
    const entry = await add(queue);
    let signal: AbortSignal | null = null;
    const send = spySend((_payload: AiQueueSendPayload, s: AbortSignal) => {
      signal = s;
      return new Promise<TrialResult>(() => {});
    });

    let settled = false;
    const run = queue
      .processQueue(send, () => {})
      .then((result: AiQueueRunResult) => {
        settled = true;
        return result;
      });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(send).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await run;
    expect(settled).toBe(true);
    expect(result).toMatchObject({ kind: "stopped", remaining: 1 });
    expect(signal).not.toBeNull();
    expect(signal!.aborted).toBe(true);
    const left = await stored(store);
    expect(left.map((e) => e.requestId)).toEqual([entry.requestId]);
    expect(left[0]?.attempts).toBe(0);
  });
});

describe("K3.3 ferdig fjerner og går videre", () => {
  it("suggestion, no_match og failed no_access: tre kall, tom kø, tre hendelser med svaret uendret", async () => {
    const { store, queue } = setUp();
    const a = await add(queue);
    const b = await add(queue);
    const c = await add(queue);
    const answers: Record<string, TrialResult> = {
      [a.requestId]: {
        kind: "suggestion",
        usageId: a.requestId,
        text: "Fukt i kjellervegg ved sluket.",
      },
      [b.requestId]: { kind: "no_match", usageId: b.requestId },
      [c.requestId]: {
        kind: "failed",
        reason: "no_access",
        message: "Du har ikke tilgang til dette.",
      },
    };
    const send = sendFrom(new Map(Object.entries(answers).map(([id, r]) => [id, async () => r])));
    const { seen, onEvent } = events();

    const result = await queue.processQueue(send, onEvent);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.map(([p]) => p.requestId)).toEqual([
      a.requestId,
      b.requestId,
      c.requestId,
    ]);
    expect(result).toEqual({ kind: "completed", remaining: 0 });
    expect(await stored(store)).toEqual([]);
    expect(seen).toHaveLength(3);
    for (const event of seen) {
      expect(event.kind).toBe("answered");
      if (event.kind !== "answered") continue;
      // Samme objekt som serverhandlingen ga: forslagsteksten er uendret
      expect(event.result).toBe(answers[event.entry.requestId]);
    }
    expect(seen.map((e) => e.entry.requestId)).toEqual([a.requestId, b.requestId, c.requestId]);
  });

  it.each<TrialResult>([
    { kind: "error" },
    { kind: "disabled" },
    { kind: "failed", reason: "invalid" },
  ])("%o fjerner posten med én gang", async (answer) => {
    const { store, queue } = setUp();
    await add(queue);
    const send = spySend(async () => answer);
    const { seen, onEvent } = events();
    await queue.processQueue(send, onEvent);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await stored(store)).toEqual([]);
    expect(seen).toHaveLength(1);
  });
});

describe("K3.4 serverfeil og tre forsøk", () => {
  it("A øker attempts per runde og fjernes etter tredje forsøk; B sendes og fjernes i første runde", async () => {
    expect(AI_QUEUE_MAX_ATTEMPTS).toBe(3);
    const { store, queue } = setUp();
    const a = await add(queue);
    const b = await add(queue);
    const send = sendFrom(
      new Map<string, () => Promise<TrialResult>>([
        [
          a.requestId,
          async () => ({ kind: "failed", reason: "unknown", message: UNKNOWN_MESSAGE }),
        ],
        [b.requestId, async () => ({ kind: "suggestion", usageId: b.requestId, text: "Ok." })],
      ]),
    );
    const { seen, onEvent } = events();

    await queue.processQueue(send, onEvent);
    let left = await stored(store);
    expect(left.map((e) => [e.requestId, e.attempts])).toEqual([[a.requestId, 1]]);
    expect(seen.map((e) => [e.kind, e.entry.requestId])).toEqual([["answered", b.requestId]]);

    await queue.processQueue(send, onEvent);
    left = await stored(store);
    expect(left.map((e) => [e.requestId, e.attempts])).toEqual([[a.requestId, 2]]);
    expect(seen).toHaveLength(1);

    const last = await queue.processQueue(send, onEvent);
    expect(await stored(store)).toEqual([]);
    expect(last).toEqual({ kind: "completed", remaining: 0 });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ kind: "gave_up", entry: { requestId: a.requestId } });
    expect(send.mock.calls.filter(([p]) => p.requestId === a.requestId)).toHaveLength(3);
    expect(send.mock.calls.filter(([p]) => p.requestId === b.requestId)).toHaveLength(1);
  });

  it("kastet Error teller også som forsøk", async () => {
    const { store, queue } = setUp();
    await add(queue);
    const send = spySend(async () => {
      throw new Error("500");
    });
    await queue.processQueue(send, () => {});
    expect((await stored(store))[0]?.attempts).toBe(1);
  });
});

describe("K3.5 én dårlig post stopper ikke resten", () => {
  it("A kaster Error hver gang; B og C sendes i samme runde", async () => {
    const { store, queue } = setUp();
    const a = await add(queue);
    const b = await add(queue);
    const c = await add(queue);
    const send = sendFrom(
      new Map<string, () => Promise<TrialResult>>([
        [
          a.requestId,
          async () => {
            throw new Error("serverfeil");
          },
        ],
        [b.requestId, async () => ({ kind: "suggestion", text: "B." })],
        [c.requestId, async () => ({ kind: "no_match" })],
      ]),
    );
    const { seen, onEvent } = events();

    const result = await queue.processQueue(send, onEvent);
    expect(send).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ kind: "completed", remaining: 1 });
    expect((await stored(store)).map((e) => e.requestId)).toEqual([a.requestId]);
    expect(seen.map((e) => e.entry.requestId)).toEqual([b.requestId, c.requestId]);
  });
});

describe("K3.6 låsen", () => {
  it("to processQueue samtidig gir nøyaktig ett send-kall per post", async () => {
    const { store, queue } = setUp();
    await add(queue);
    await add(queue);
    await add(queue);
    const send = spySend(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { kind: "suggestion" as const };
    });

    const [first, second] = await Promise.all([
      queue.processQueue(send, () => {}),
      queue.processQueue(send, () => {}),
    ]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(new Set(send.mock.calls.map(([p]) => p.requestId)).size).toBe(3);
    expect([first.kind, second.kind].sort()).toEqual(["already_running", "completed"]);
    expect(await stored(store)).toEqual([]);
  });

  it("etter en runde kan en ny runde starte", async () => {
    const { queue } = setUp();
    await add(queue);
    const send = spySend(async () => ({ kind: "suggestion" as const }));
    await queue.processQueue(send, () => {});
    await add(queue);
    const result = await queue.processQueue(send, () => {});
    expect(result).toEqual({ kind: "completed", remaining: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe("K3.7 fjerning på requestId", () => {
  it("svar på erstattet X fjerner ikke Y; Y sendes neste runde, og hendelsen for X har den gamle teksten", async () => {
    const { store, queue } = setUp();
    const target = randomUUID();
    const x = await add(queue, input("Gammel tekst om fukt", { targetId: target }));
    const waiting = deferred<TrialResult>();
    const send = spySend(async (payload: AiQueueSendPayload) => {
      if (payload.requestId === x.requestId) return waiting.promise;
      return { kind: "suggestion" as const, text: "Ny." };
    });
    const { seen, onEvent } = events();

    const run = queue.processQueue(send, onEvent);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const y = await add(queue, input("Ny tekst om fukt i kjellervegg", { targetId: target }));
    expect(y.requestId).not.toBe(x.requestId);
    waiting.resolve({ kind: "suggestion", text: "Gammel tekst om fukt." });
    await run;

    const left = await stored(store);
    expect(left.map((e) => e.requestId)).toEqual([y.requestId]);
    expect(left[0]?.fields).toEqual({ text: "Ny tekst om fukt i kjellervegg" });
    const forX = seen.find((e) => e.entry.requestId === x.requestId);
    // Siden sammenligner teksten i posten med feltet og viser forslaget uten «Bruk» (K5.2)
    expect(forX?.entry.fields).toEqual({ text: "Gammel tekst om fukt" });

    await queue.processQueue(send, onEvent);
    expect(send.mock.calls.map(([p]) => p.requestId)).toContain(y.requestId);
    expect(await stored(store)).toEqual([]);
  });
});

describe("K3.8 bare det serveren trenger går ut", () => {
  it("send får ikke organizationId, employeeId, queuedAt eller attempts", async () => {
    const { queue } = setUp();
    const entry = await add(queue);
    const send = spySend(async () => ({ kind: "suggestion" as const }));
    await queue.processQueue(send, () => {});

    const payload = send.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      [
        "assignmentId",
        "feature",
        "fieldKey",
        "fields",
        "requestId",
        "targetId",
        "targetType",
      ].sort(),
    );
    for (const key of ["organizationId", "employeeId", "queuedAt", "attempts"]) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(JSON.stringify(payload)).not.toContain(OWNER.organizationId);
    expect(JSON.stringify(payload)).not.toContain(OWNER.employeeId);
    expect(payload).toMatchObject({
      requestId: entry.requestId,
      targetId: entry.targetId,
      fields: { text: TEXT },
    });
  });
});

describe("K3.9 tømming under behandling", () => {
  it("svar etter clearAiQueue kaller ikke onEvent og skriver ingenting tilbake", async () => {
    const { store, queue } = setUp();
    await add(queue);
    await add(queue);
    const waiting = deferred<TrialResult>();
    const send = spySend(async () => waiting.promise);
    const { seen, onEvent } = events();

    const run = queue.processQueue(send, onEvent);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(await clearAiQueue(store)).toEqual({ cleared: true });
    waiting.resolve({ kind: "failed", reason: "unknown" });
    const result = await run;

    expect(seen).toEqual([]);
    expect(await stored(store)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ kind: "stopped", reason: "cleared" });
  });

  it("svar med forslag etter tømming vises ikke heller", async () => {
    const { store, queue } = setUp();
    await add(queue);
    const waiting = deferred<TrialResult>();
    const send = spySend(async () => waiting.promise);
    const { seen, onEvent } = events();
    const run = queue.processQueue(send, onEvent);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await clearAiQueue(store);
    waiting.resolve({ kind: "suggestion", text: "Fukt i kjellervegg ved sluket." });
    await run;
    expect(seen).toEqual([]);
    expect(await stored(store)).toEqual([]);
  });
});

describe("K3.10 eier sjekkes før sending", () => {
  it("post fra en annen ansatt sendes ikke og er borte etterpå; egen post sendes", async () => {
    const raw = (employeeId: string) => ({
      requestId: randomUUID(),
      feature: "language_polish",
      targetType: "ai_trial",
      targetId: randomUUID(),
      fieldKey: "text",
      assignmentId: null,
      organizationId: OWNER.organizationId,
      employeeId,
      fields: { text: TEXT },
      queuedAt: NOW,
      attempts: 0,
    });
    const foreign = raw(randomUUID());
    const own = raw(OWNER.employeeId);
    const store = createMemoryAiQueueStore([foreign, own]);
    const queue = createAiQueue({ store, owner: OWNER, now: () => NOW, isOnline: () => true });
    const send = spySend(async () => ({ kind: "suggestion" as const }));
    await queue.processQueue(send, () => {});
    expect(send.mock.calls.map(([p]) => (p as AiQueueSendPayload).requestId)).toEqual([
      own.requestId,
    ]);
    expect(await stored(store)).toEqual([]);
  });

  it("post fra en annen organisasjon sendes ikke", async () => {
    const store = createMemoryAiQueueStore([
      {
        requestId: randomUUID(),
        feature: "language_polish",
        targetType: "ai_trial",
        targetId: randomUUID(),
        fieldKey: "text",
        assignmentId: null,
        organizationId: randomUUID(),
        employeeId: OWNER.employeeId,
        fields: { text: TEXT },
        queuedAt: NOW,
        attempts: 0,
      },
    ]);
    const queue = createAiQueue({ store, owner: OWNER, now: () => NOW, isOnline: () => true });
    const send = spySend(async () => ({ kind: "suggestion" as const }));
    await queue.processQueue(send, () => {});
    expect(send).not.toHaveBeenCalled();
    expect(await stored(store)).toEqual([]);
  });
});
