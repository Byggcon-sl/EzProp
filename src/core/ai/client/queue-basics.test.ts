import { afterEach, describe, expect, it, vi } from "vitest";

import { AI_FIELD_MAX_LENGTH } from "../limits";
import {
  AI_QUEUE_MAX_AGE_MS,
  AI_QUEUE_MAX_ENTRIES,
  AI_QUEUE_REJECT_MESSAGES,
  type AiQueueEnqueueInput,
  type AiQueueSendPayload,
  type AiQueueSendResult,
  classifyQueueOutcome,
  clearAiQueue,
  createAiQueue,
  createIndexedDbAiQueueStore,
  createMemoryAiQueueStore,
} from "./index";

/*
 * Utviklerens egne småtester for KI-køen. Testplanens K1-K3 ligger i egne filer.
 * Alle data er oppdiktet.
 */

const OWNER = { organizationId: "org-a", employeeId: "emp-a" };
const OTHER_ORG = { organizationId: "org-b", employeeId: "emp-a" };
const OTHER_EMPLOYEE = { organizationId: "org-a", employeeId: "emp-b" };
const NOW = 1_800_000_000_000;

function input(targetId: string, text = "Taket er gammelt."): AiQueueEnqueueInput {
  return {
    feature: "language_polish",
    targetType: "trial_note",
    targetId,
    fieldKey: "text",
    assignmentId: null,
    fields: { text },
  };
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
}

function setup(owner = OWNER, store = createMemoryAiQueueStore()) {
  const queue = createAiQueue({ store, owner, now: () => NOW, newRequestId: nextId });
  return { store, queue };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("enqueue og list", () => {
  it("legger i kø, erstatter på samme mål med ny requestId, og fjerner på requestId", async () => {
    const { queue } = setup();
    const first = await queue.enqueue(input("t1", "Første"));
    expect(first.kind).toBe("queued");
    const second = await queue.enqueue(input("t1", "Andre"));
    if (first.kind !== "queued" || second.kind !== "queued") throw new Error("ikke i kø");
    expect(second.replacedRequestId).toBe(first.entry.requestId);
    expect(second.entry.requestId).not.toBe(first.entry.requestId);

    const listed = await queue.list();
    expect(listed).toEqual({ kind: "listed", entries: [second.entry] });

    await queue.remove(first.entry.requestId);
    expect((await queue.list()).kind === "listed").toBe(true);
    await queue.remove(second.entry.requestId);
    expect(await queue.list()).toEqual({ kind: "listed", entries: [] });
  });

  it("standard requestId er UUID v4", async () => {
    const queue = createAiQueue({ store: createMemoryAiQueueStore(), owner: OWNER });
    const result = await queue.enqueue(input("t1"));
    if (result.kind !== "queued") throw new Error("ikke i kø");
    expect(result.entry.requestId[14]).toBe("4");
  });

  it("gir full ved nr. 51, men erstatning går", async () => {
    const { queue, store } = setup();
    for (let i = 0; i < AI_QUEUE_MAX_ENTRIES; i += 1) {
      expect((await queue.enqueue(input(`t${i}`))).kind).toBe("queued");
    }
    expect(await queue.enqueue(input("ny"))).toEqual({ kind: "rejected", reason: "full" });
    expect(store.snapshot()).toHaveLength(AI_QUEUE_MAX_ENTRIES);
    expect((await queue.enqueue(input("t3", "Ny tekst"))).kind).toBe("queued");
    expect(store.snapshot()).toHaveLength(AI_QUEUE_MAX_ENTRIES);
  });

  it("grensen på lengde og ugyldig input gir faste koder", async () => {
    const { queue } = setup();
    expect((await queue.enqueue(input("a", "x".repeat(AI_FIELD_MAX_LENGTH)))).kind).toBe("queued");
    expect(await queue.enqueue(input("b", "x".repeat(AI_FIELD_MAX_LENGTH + 1)))).toEqual({
      kind: "rejected",
      reason: "too_long",
    });
    const badField = { ...input("c"), fields: { other: "x" } };
    expect(await queue.enqueue(badField)).toEqual({ kind: "rejected", reason: "invalid" });
    const proto = {
      ...input("d"),
      fields: JSON.parse('{"__proto__":"x"}') as Record<string, string>,
    };
    expect(await queue.enqueue(proto)).toEqual({ kind: "rejected", reason: "invalid" });
    expect(await queue.enqueue({ ...input("e"), targetId: "" })).toEqual({
      kind: "rejected",
      reason: "invalid",
    });
  });

  it("lesing sletter poster fra andre organisasjoner, andre ansatte, feil form og for gamle", async () => {
    const mine = await setup(OWNER).queue.enqueue(input("mine"));
    const org = await setup(OTHER_ORG).queue.enqueue(input("org"));
    const emp = await setup(OTHER_EMPLOYEE).queue.enqueue(input("emp"));
    if (org.kind !== "queued" || emp.kind !== "queued") throw new Error("ikke i kø");
    if (mine.kind !== "queued") throw new Error("ikke i kø");
    const old = {
      ...mine.entry,
      requestId: nextId(),
      targetId: "old",
      queuedAt: NOW - AI_QUEUE_MAX_AGE_MS - 1,
    };
    const badProto = JSON.parse(
      `{"requestId":"${nextId()}","feature":"language_polish","targetType":"x","targetId":"y","fieldKey":"text","assignmentId":null,"organizationId":"org-a","employeeId":"emp-a","fields":{"__proto__":"x"},"queuedAt":${NOW},"attempts":0}`,
    ) as unknown;
    const store = createMemoryAiQueueStore([mine.entry, org.entry, emp.entry, old, badProto]);
    const { queue } = setup(OWNER, store);

    expect(await queue.list()).toEqual({ kind: "listed", entries: [mine.entry] });
    expect(store.snapshot()).toEqual([mine.entry]);
  });

  it("feil i lageret gir fast kode", async () => {
    const store = createMemoryAiQueueStore([], { failWith: () => new Error("Hemmelig tekst") });
    const { queue } = setup(OWNER, store);
    expect(await queue.enqueue(input("t1", "Hemmelig tekst"))).toEqual({
      kind: "rejected",
      reason: "unavailable",
    });
    expect(await queue.list()).toEqual({ kind: "unavailable" });
    expect(AI_QUEUE_REJECT_MESSAGES.unavailable).not.toContain("Hemmelig");
  });

  it("IndexedDB mangler: fast kode, ikke unntak", async () => {
    vi.stubGlobal("indexedDB", undefined);
    try {
      const queue = createAiQueue({ store: createIndexedDbAiQueueStore(), owner: OWNER });
      expect(await queue.enqueue(input("t1"))).toEqual({ kind: "rejected", reason: "unavailable" });
      expect(await queue.list()).toEqual({ kind: "unavailable" });
      expect(await clearAiQueue(createIndexedDbAiQueueStore())).toEqual({ cleared: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("classifyQueueOutcome", () => {
  it.each([
    [{ kind: "threw", error: new TypeError("x") }, true, "retry_later"],
    [{ kind: "threw", error: new Error("x") }, true, "server_error"],
    [{ kind: "timed_out" }, true, "retry_later"],
    [{ kind: "answered", result: { kind: "suggestion" } }, false, "retry_later"],
    [{ kind: "answered", result: { kind: "no_match" } }, true, "done"],
    [{ kind: "answered", result: { kind: "failed", reason: "no_access" } }, true, "done"],
    [{ kind: "answered", result: { kind: "failed", reason: "unknown" } }, true, "server_error"],
    [{ kind: "answered", result: { kind: "future" } }, true, "server_error"],
  ] as const)("%j online=%s gir %s", (attempt, online, expected) => {
    expect(
      classifyQueueOutcome(attempt as Parameters<typeof classifyQueueOutcome>[0], online),
    ).toBe(expected);
  });
});

describe("processQueue", () => {
  type Result = AiQueueSendResult & { text?: string };

  it("sender bare payload, fjerner ferdige, teller forsøk og gir opp etter tre", async () => {
    const { queue, store } = setup();
    const a = await queue.enqueue(input("a"));
    const b = await queue.enqueue(input("b"));
    if (a.kind !== "queued" || b.kind !== "queued") throw new Error("ikke i kø");
    const payloads: AiQueueSendPayload[] = [];
    const send = vi.fn(async (payload: AiQueueSendPayload): Promise<Result> => {
      payloads.push(payload);
      return payload.requestId === a.entry.requestId
        ? { kind: "failed", reason: "unknown" }
        : { kind: "suggestion", text: "Forslag" };
    });
    const events: string[] = [];
    const onEvent = (event: { kind: string }) => events.push(event.kind);

    expect(await queue.processQueue(send, onEvent)).toEqual({ kind: "completed", remaining: 1 });
    expect(Object.keys(payloads[0] ?? {}).sort()).toEqual(
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
    expect(events).toEqual(["answered"]);
    await queue.processQueue(send, onEvent);
    await queue.processQueue(send, onEvent);
    expect(events).toEqual(["answered", "gave_up"]);
    expect(store.snapshot()).toEqual([]);
  });

  it("nettfeil stopper runden og beholder postene", async () => {
    const { queue, store } = setup();
    await queue.enqueue(input("a"));
    await queue.enqueue(input("b"));
    const send = vi.fn(async (): Promise<Result> => {
      throw new TypeError("Failed to fetch");
    });
    expect(await queue.processQueue(send, () => {})).toEqual({
      kind: "stopped",
      reason: "offline",
      remaining: 2,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.snapshot()).toHaveLength(2);
  });

  it("tidsavbrudd etter 30 sekunder", async () => {
    vi.useFakeTimers();
    const { queue, store } = setup();
    await queue.enqueue(input("a"));
    let aborted = false;
    const send = (_payload: AiQueueSendPayload, signal: AbortSignal) =>
      new Promise<Result>(() => {
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      });
    const running = queue.processQueue(send, () => {});
    await vi.advanceTimersByTimeAsync(29_999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await running).toEqual({ kind: "stopped", reason: "offline", remaining: 1 });
    expect(aborted).toBe(true);
    expect(store.snapshot()).toHaveLength(1);
  });

  it("låsen gir ett kall per post, også på tvers av køobjekter", async () => {
    const store = createMemoryAiQueueStore();
    const { queue } = setup(OWNER, store);
    const { queue: other } = setup(OWNER, store);
    await queue.enqueue(input("a"));
    const send = vi.fn(async (): Promise<Result> => ({ kind: "no_match" }));
    const [first, second] = await Promise.all([
      queue.processQueue(send, () => {}),
      other.processQueue(send, () => {}),
    ]);
    expect(first.kind).toBe("completed");
    expect(second).toEqual({ kind: "already_running" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("svar på erstattet post fjerner ikke den nye", async () => {
    const { queue, store } = setup();
    const old = await queue.enqueue(input("a", "Gammel"));
    if (old.kind !== "queued") throw new Error("ikke i kø");
    let release: (value: Result) => void = () => {};
    const send = () => new Promise<Result>((resolve) => (release = resolve));
    const events: unknown[] = [];
    const running = queue.processQueue(send, (event) => events.push(event));
    await vi.waitFor(() => expect(release).not.toBe(undefined));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const replaced = await queue.enqueue(input("a", "Ny"));
    if (replaced.kind !== "queued") throw new Error("ikke i kø");
    release({ kind: "suggestion" });
    await running;
    expect(events).toEqual([
      { kind: "answered", entry: old.entry, result: { kind: "suggestion" } },
    ]);
    expect(store.snapshot()).toEqual([replaced.entry]);
  });

  it("tømming under behandling: ingen hendelse og ingen skriving", async () => {
    const { queue, store } = setup();
    await queue.enqueue(input("a"));
    let release: (value: Result) => void = () => {};
    const send = () => new Promise<Result>((resolve) => (release = resolve));
    const onEvent = vi.fn();
    const running = queue.processQueue(send, onEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await clearAiQueue(store)).toEqual({ cleared: true });
    release({ kind: "failed", reason: "unknown" });
    expect(await running).toEqual({ kind: "stopped", reason: "cleared", remaining: 0 });
    expect(onEvent).not.toHaveBeenCalled();
    expect(store.snapshot()).toEqual([]);
  });
});
