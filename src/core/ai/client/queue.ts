import { createIndexedDbAiQueueStore } from "./queue-store";
import { classifyQueueOutcome } from "./outcome";
import { checkAiQueueFields, isAiQueueFeature, parseAiQueueEntry } from "./schema";
import {
  AI_QUEUE_MAX_AGE_MS,
  AI_QUEUE_MAX_CLOCK_SKEW_MS,
  AI_QUEUE_MAX_ATTEMPTS,
  AI_QUEUE_MAX_ENTRIES,
  AI_QUEUE_SEND_TIMEOUT_MS,
  type AiQueue,
  type AiQueueEnqueueInput,
  type AiQueueEnqueueResult,
  type AiQueueEntry,
  type AiQueueEvent,
  type AiQueueListResult,
  type AiQueueOwner,
  type AiQueueRunResult,
  type AiQueueSend,
  type AiQueueSendAttempt,
  type AiQueueSendPayload,
  type AiQueueSendResult,
  type AiQueueStore,
  type AiQueueStoreChange,
  type ClearAiQueue,
  type CreateAiQueue,
} from "./types";

/*
 * KI-køen uten nett (docs/funksjoner/fase2a-ki-ko.md, ADR 0006 del 10). Ren logikk over
 * `AiQueueStore`. Køen sender aldri noe selv: siden gir inn `send`, som går til serveren og
 * videre gjennom `requestSuggestion`. Ingen metode kaster; feil gir faste koder.
 *
 * Støtter hovedmål: KI i bunnen (KI virker likt med og uten nett) og de ansatte (ett trykk uten
 * dekning, og ingen ser en annens tekst på en delt iPad).
 */

/** Økes av `clearAiQueue`. En behandling som ser at verdien er endret, stopper uten å skrive. */
let clearGeneration = 0;
/** Én behandling av gangen i fanen, uansett hvor mange køobjekter siden har laget. */
let tabProcessing = false;

function defaultIsOnline(): boolean {
  // Uten `navigator` (tester i Node) regnes enheten som på nett; `send` avgjør da.
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function defaultNewRequestId(): string {
  return globalThis.crypto.randomUUID();
}

function requestIdOf(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  return Object.hasOwn(value, "requestId")
    ? (value as { requestId?: unknown }).requestId
    : undefined;
}

function compareEntries(a: AiQueueEntry, b: AiQueueEntry): number {
  if (a.queuedAt !== b.queuedAt) return a.queuedAt - b.queuedAt;
  if (a.requestId === b.requestId) return 0;
  return a.requestId < b.requestId ? -1 : 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Skiller gyldige poster fra dem som skal slettes: feil form, annen eier, for gammel.
 * Rå poster uten brukbar `requestId` kan ikke slettes på nøkkel og blir bare hoppet over.
 */
function sweep(
  stored: readonly unknown[],
  owner: AiQueueOwner,
  nowMs: number,
): { valid: AiQueueEntry[]; drop: unknown[] } {
  const valid: AiQueueEntry[] = [];
  const drop: unknown[] = [];
  const oldest = nowMs - AI_QUEUE_MAX_AGE_MS;
  // En post fra «framtiden» (feil klokke på iPaden) ville ellers levd lenger enn 7 dager (A192).
  for (const raw of stored) {
    const entry = parseAiQueueEntry(raw);
    if (
      entry &&
      entry.organizationId === owner.organizationId &&
      entry.employeeId === owner.employeeId &&
      entry.queuedAt >= oldest &&
      entry.queuedAt <= nowMs + AI_QUEUE_MAX_CLOCK_SKEW_MS
    ) {
      valid.push(entry);
      continue;
    }
    drop.push(raw);
  }
  valid.sort(compareEntries);
  return { valid, drop };
}

/** Det `send` får. Bygges med eksplisitte nøkler, så eier, tid og forsøk aldri følger med. */
function toPayload(entry: AiQueueEntry): AiQueueSendPayload {
  const fields: Record<string, string> = {};
  for (const key of Object.keys(entry.fields)) fields[key] = entry.fields[key] as string;
  return {
    requestId: entry.requestId,
    feature: entry.feature,
    targetType: entry.targetType,
    targetId: entry.targetId,
    fieldKey: entry.fieldKey,
    assignmentId: entry.assignmentId,
    fields,
  };
}

async function sendWithTimeout<R extends AiQueueSendResult>(
  send: AiQueueSend<R>,
  payload: AiQueueSendPayload,
  timeoutMs: number,
): Promise<AiQueueSendAttempt<R>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<AiQueueSendAttempt<R>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "timed_out" });
    }, timeoutMs);
  });
  const call = (async (): Promise<AiQueueSendAttempt<R>> => {
    try {
      return { kind: "answered", result: await send(payload, controller.signal) };
    } catch (error) {
      return { kind: "threw", error };
    }
  })();
  try {
    return await Promise.race([call, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

type CheckedInput =
  | { kind: "ok"; fields: Record<string, string> }
  | { kind: "rejected"; reason: "invalid" | "too_long" };

function checkInput(input: AiQueueEnqueueInput, owner: AiQueueOwner): CheckedInput {
  if (typeof input !== "object" || input === null) return { kind: "rejected", reason: "invalid" };
  if (!isNonEmptyString(owner.organizationId) || !isNonEmptyString(owner.employeeId)) {
    return { kind: "rejected", reason: "invalid" };
  }
  if (!isAiQueueFeature(input.feature)) return { kind: "rejected", reason: "invalid" };
  if (
    !isNonEmptyString(input.targetType) ||
    !isNonEmptyString(input.targetId) ||
    !isNonEmptyString(input.fieldKey)
  ) {
    return { kind: "rejected", reason: "invalid" };
  }
  if (input.assignmentId !== null && typeof input.assignmentId !== "string") {
    return { kind: "rejected", reason: "invalid" };
  }
  const checked = checkAiQueueFields(input.feature, input.fields);
  if (checked !== "ok") return { kind: "rejected", reason: checked };
  const fields: Record<string, string> = {};
  for (const key of Object.keys(input.fields)) fields[key] = input.fields[key] as string;
  return { kind: "ok", fields };
}

export const createAiQueue: CreateAiQueue = (deps) => {
  const { store, owner } = deps;
  const now = deps.now ?? Date.now;
  const newRequestId = deps.newRequestId ?? defaultNewRequestId;
  const isOnline = deps.isOnline ?? defaultIsOnline;
  const sendTimeoutMs = deps.sendTimeoutMs ?? AI_QUEUE_SEND_TIMEOUT_MS;
  let processing = false;

  /** Leser og rydder i én transaksjon. Kaster når lageret feiler. */
  function readAndSweep(): Promise<AiQueueEntry[]> {
    const nowMs = now();
    return store.update((stored): AiQueueStoreChange<AiQueueEntry[]> => {
      const { valid, drop } = sweep(stored, owner, nowMs);
      return { put: [], remove: [], drop, result: valid };
    });
  }

  async function list(): Promise<AiQueueListResult> {
    try {
      return { kind: "listed", entries: await readAndSweep() };
    } catch {
      return { kind: "unavailable" };
    }
  }

  async function remove(requestId: string): Promise<void> {
    if (!isNonEmptyString(requestId)) return;
    try {
      await store.update(() => ({ put: [], remove: [requestId], result: undefined }));
    } catch {
      // Posten blir liggende og ryddes eller sendes på nytt senere. Samme `requestId` gir samme
      // rad på serveren.
    }
  }

  async function enqueue(input: AiQueueEnqueueInput): Promise<AiQueueEnqueueResult> {
    try {
      const checked = checkInput(input, owner);
      if (checked.kind === "rejected") return checked;
      const nowMs = now();
      const candidate = parseAiQueueEntry({
        requestId: newRequestId(),
        feature: input.feature,
        targetType: input.targetType,
        targetId: input.targetId,
        fieldKey: input.fieldKey,
        assignmentId: input.assignmentId,
        organizationId: owner.organizationId,
        employeeId: owner.employeeId,
        fields: checked.fields,
        queuedAt: nowMs,
        attempts: 0,
      });
      if (!candidate) return { kind: "rejected", reason: "invalid" };
      const entry = candidate;
      return await store.update((stored): AiQueueStoreChange<AiQueueEnqueueResult> => {
        const { valid, drop } = sweep(stored, owner, nowMs);
        const same = valid.find(
          (existing) =>
            existing.targetType === entry.targetType &&
            existing.targetId === entry.targetId &&
            existing.fieldKey === entry.fieldKey,
        );
        if (same) {
          return {
            put: [entry],
            remove: [same.requestId],
            drop,
            result: { kind: "queued", entry, replacedRequestId: same.requestId },
          };
        }
        if (valid.length >= AI_QUEUE_MAX_ENTRIES) {
          return { put: [], remove: [], drop, result: { kind: "rejected", reason: "full" } };
        }
        return {
          put: [entry],
          remove: [],
          drop,
          result: { kind: "queued", entry, replacedRequestId: null },
        };
      });
    } catch {
      return { kind: "rejected", reason: "unavailable" };
    }
  }

  /** Øker `attempts` på posten med samme `requestId`. Gir `gave_up` når grensen er nådd. */
  function recordServerError(requestId: string): Promise<"gave_up" | "retry" | "gone"> {
    return store.update((stored): AiQueueStoreChange<"gave_up" | "retry" | "gone"> => {
      const raw = stored.find((row) => requestIdOf(row) === requestId);
      if (raw === undefined) return { put: [], remove: [], result: "gone" };
      const current = parseAiQueueEntry(raw);
      if (!current) return { put: [], remove: [requestId], result: "gone" };
      const attempts = current.attempts + 1;
      if (attempts >= AI_QUEUE_MAX_ATTEMPTS) {
        return { put: [], remove: [requestId], result: "gave_up" };
      }
      return { put: [{ ...current, attempts }], remove: [], result: "retry" };
    });
  }

  async function remaining(fallback: number): Promise<number> {
    const listed = await list();
    return listed.kind === "listed" ? listed.entries.length : fallback;
  }

  async function run<R extends AiQueueSendResult>(
    send: AiQueueSend<R>,
    onEvent: (event: AiQueueEvent<R>) => void,
  ): Promise<AiQueueRunResult> {
    const generation = clearGeneration;
    const cleared = (): boolean => clearGeneration !== generation;
    const stoppedCleared: AiQueueRunResult = { kind: "stopped", reason: "cleared", remaining: 0 };
    const emit = (event: AiQueueEvent<R>): void => {
      try {
        onEvent(event);
      } catch {
        // En feil på siden skal ikke stoppe køen. Posten er allerede ferdig behandlet.
      }
    };

    let entries: AiQueueEntry[];
    try {
      entries = await readAndSweep();
    } catch {
      return { kind: "stopped", reason: "unavailable", remaining: 0 };
    }
    if (cleared()) return stoppedCleared;

    let left = entries.length;
    for (const entry of entries) {
      // Uten nett sendes ingenting; posten blir liggende til `online` starter en ny runde.
      if (!isOnline()) return { kind: "stopped", reason: "offline", remaining: left };
      const attempt = await sendWithTimeout(send, toPayload(entry), sendTimeoutMs);
      if (cleared()) return stoppedCleared;

      const outcome = classifyQueueOutcome(attempt, isOnline());
      if (outcome === "retry_later") {
        return { kind: "stopped", reason: "offline", remaining: await remaining(left) };
      }

      if (outcome === "done") {
        // `attempt` er `answered` her: de andre grenene gir aldri `done`.
        if (attempt.kind !== "answered") continue;
        let storeFailed = false;
        try {
          // Bare på `requestId`: er posten erstattet underveis, blir den nye liggende.
          await store.update(() => ({ put: [], remove: [entry.requestId], result: undefined }));
        } catch {
          storeFailed = true;
        }
        if (cleared()) return stoppedCleared;
        left -= 1;
        emit({ kind: "answered", entry, result: attempt.result });
        if (storeFailed) return { kind: "stopped", reason: "unavailable", remaining: left };
        continue;
      }

      let recorded: "gave_up" | "retry" | "gone";
      try {
        recorded = await recordServerError(entry.requestId);
      } catch {
        if (cleared()) return stoppedCleared;
        return { kind: "stopped", reason: "unavailable", remaining: left };
      }
      if (cleared()) return stoppedCleared;
      if (recorded === "gave_up") {
        left -= 1;
        emit({ kind: "gave_up", entry });
      }
    }

    return { kind: "completed", remaining: await remaining(left) };
  }

  async function processQueue<R extends AiQueueSendResult>(
    send: AiQueueSend<R>,
    onEvent: (event: AiQueueEvent<R>) => void,
  ): Promise<AiQueueRunResult> {
    if (processing || tabProcessing) return { kind: "already_running" };
    processing = true;
    tabProcessing = true;
    try {
      return await run(send, onEvent);
    } finally {
      processing = false;
      tabProcessing = false;
    }
  }

  const queue: AiQueue = { enqueue, list, remove, processQueue };
  return queue;
};

export const clearAiQueue: ClearAiQueue = async (store?: AiQueueStore) => {
  // Telleren økes først, så en behandling som pågår stopper selv om tømmingen feiler.
  clearGeneration += 1;
  try {
    await (store ?? createIndexedDbAiQueueStore()).clear();
    return { cleared: true };
  } catch {
    return { cleared: false };
  }
};
