/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Hente-leseren for den egenbygde kandidaten (docs/funksjoner/fase1-kandidat-egenbygd.md pkt. 5–6).
 * Henter «endringer siden sist» fra `GET /api/prove/synk/hent` og gir radene til den lokale
 * kjernen (`ctx.mergeIncoming`), tabell for tabell (forms, answers, photos). Markøren skrives bare
 * sammen med den siste tabellen, så en stopp midt i gir samme rader på nytt (ufarlig).
 * - Takten kommer fra den rene funksjonen i `pull-schedule.ts`.
 * - 400 (ugyldig markør): bare markøren slettes, og neste henting går uten `siden` med en gang.
 *   Synkede rader og køen røres aldri.
 * - Henting blokkerer aldri skriving: leseren skriver bare via konteksten.
 * - «Synk nå» (`syncNow`): henting med en gang, også under feilventetid; feiltelleren står.
 *   `serverConfirmed()` er sann først etter 200 med `ferdig: true`, og usann etter feil eller når
 *   leseren ser at nettet er borte (docs/funksjoner/fase1-synkstatus.md, krav K4 og K5).
 * - Ren ved import: `fetch`, tidtaker og klokke settes inn, og nett leses bare via `ctx.isOnline()`.
 *
 * Ingen lang-polling, ingen websocket.
 */
import { TRIAL_TABLE_NAMES, type TrialTableName } from "../local-columns";
import { normalizeLocalRow } from "../local/normalize-row";
import { localRowKey } from "../local/outbox";
import type { LocalReadContext, LocalTrialReader } from "../local/types";
import type { IncomingChange } from "../types";
import { INITIAL_PULL_SCHEDULE, nextPullDelay } from "./pull-schedule";
import {
  CUSTOM_CURSOR_KEY,
  PULL_INTERVAL_MS,
  TRIAL_PULL_ROUTE,
  type CreatePullReader,
  type CustomCursorRow,
  type PullOutcome,
  type PullResponseBody,
  type PullScheduleState,
} from "./types";

type TimerHandle = ReturnType<typeof setTimeout>;

interface SyncWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

export interface CustomReaderDeps {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  now?: () => number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Svaret fra hente-ruten, eller `null` hvis formen er feil. */
export function parsePullResponse(body: unknown): PullResponseBody | null {
  if (!isRecord(body)) return null;
  const { endringer, markor, ferdig } = body;
  if (!isRecord(endringer) || typeof markor !== "string" || markor === "") return null;
  if (typeof ferdig !== "boolean") return null;
  const parsed: PullResponseBody["endringer"] = {};
  for (const table of TRIAL_TABLE_NAMES) {
    const rows = endringer[table];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || !rows.every(isRecord)) return null;
    parsed[table] = rows;
  }
  return { endringer: parsed, markor, ferdig };
}

/** Radene for én tabell som innkommende endringer (`kind: "update"`), i lokal form. */
function toChanges(
  table: TrialTableName,
  rows: readonly Record<string, unknown>[],
): IncomingChange[] {
  const changes: IncomingChange[] = [];
  for (const raw of rows) {
    const row = normalizeLocalRow(table, raw);
    if (typeof row.id !== "string") continue;
    changes.push({ table, kind: "update", key: localRowKey(table, row), row });
  }
  return changes;
}

function storedCursor(ctx: LocalReadContext): string | null {
  const row = ctx.storedState.find((state) => state.key === CUSTOM_CURSOR_KEY);
  return typeof row?.value === "string" && row.value !== "" ? row.value : null;
}

export function createCustomReader({
  fetchImpl = (input, init) => fetch(input, init),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (handle) => clearTimeout(handle),
  now = () => Date.now(),
}: CustomReaderDeps = {}): LocalTrialReader {
  let ctx: LocalReadContext | null = null;
  let stopped = false;
  let schedule: PullScheduleState = INITIAL_PULL_SCHEDULE;
  let cursor: string | null = null;
  let timer: TimerHandle | null = null;
  /** Øker når en planlagt henting avlyses, så en henting «med en gang» som er avlyst, ikke går. */
  let generation = 0;
  /** Når den planlagte hentingen går (fra `now()`), eller `null`. */
  let dueAt: number | null = null;
  let running = false;
  let controller: AbortController | null = null;
  /** Kom mens en henting pågikk; tas med når den er ferdig. */
  let wakeWhileRunning = false;
  let ackWhileRunning = false;
  /** «Synk nå» kom mens en henting pågikk; ny henting med en gang når den er ferdig. */
  let syncNowWhileRunning = false;
  /** Siste henting fikk 200 og var ferdig, ingen feil etter den. */
  let confirmed = false;
  /** Venter på at en henting som ennå ikke har startet, blir ferdig (`syncNow`). */
  let queuedWaiters: SyncWaiter[] = [];
  /** Venter på hentingen som går nå (og sidene etter den, ved `more`). */
  let activeWaiters: SyncWaiter[] = [];

  function settleWaiters(ok: boolean) {
    const waiters = activeWaiters;
    activeWaiters = [];
    for (const waiter of waiters) {
      if (ok) waiter.resolve();
      else waiter.reject(new Error("Hentingen lyktes ikke."));
    }
  }

  function rejectAllWaiters() {
    activeWaiters.push(...queuedWaiters);
    queuedWaiters = [];
    settleWaiters(false);
  }

  const active = () => !stopped && ctx !== null && !ctx.isClosed();

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    dueAt = null;
    generation += 1;
  }

  function plan(delayMs: number) {
    if (!active()) return;
    cancelTimer();
    dueAt = now() + delayMs;
    if (delayMs === 0) {
      // «Med en gang» går uten tidtaker: en tidtaker på 0 ms kan bli forsinket.
      const planned = generation;
      void Promise.resolve().then(() => {
        if (planned !== generation) return;
        dueAt = null;
        void run();
      });
      return;
    }
    timer = setTimer(() => {
      timer = null;
      dueAt = null;
      void run();
    }, delayMs);
  }

  async function run() {
    if (running || !active() || !ctx) return;
    if (!ctx.isOnline()) {
      // Uten nett hentes ingenting. `wake()` kommer når nettet er tilbake; sjekken her er en reserve.
      confirmed = false;
      rejectAllWaiters();
      plan(PULL_INTERVAL_MS);
      return;
    }
    running = true;
    // De som ba om «Synk nå» før denne hentingen startet, venter på den.
    activeWaiters.push(...queuedWaiters);
    queuedWaiters = [];
    let outcome: PullOutcome | null;
    try {
      outcome = await pullOnce(ctx);
      if (outcome !== "ok") confirmed = false;
    } finally {
      running = false;
      controller = null;
    }
    if (outcome === null || !active()) {
      confirmed = false;
      rejectAllWaiters();
      return;
    }
    if (outcome === "ok") settleWaiters(true);
    else if (outcome === "failed") settleWaiters(false);
    // `more` og `invalid-cursor`: neste side hentes med en gang, og de som venter, venter på den.
    const next = nextPullDelay(schedule, outcome);
    schedule = next.state;
    let delayMs = next.delayMs;
    if (ackWhileRunning) {
      const acked = nextPullDelay(schedule, "acked");
      schedule = acked.state;
      delayMs = Math.min(delayMs, acked.delayMs);
    }
    if (syncNowWhileRunning) {
      const syncNow = nextPullDelay(schedule, "sync-now");
      schedule = syncNow.state;
      if (syncNow.delayMs !== null) delayMs = Math.min(delayMs, syncNow.delayMs);
    }
    if (wakeWhileRunning) {
      schedule = INITIAL_PULL_SCHEDULE;
      delayMs = 0;
    }
    ackWhileRunning = false;
    wakeWhileRunning = false;
    syncNowWhileRunning = false;
    plan(delayMs);
  }

  /** Én henting. `null` betyr at leseren ble stoppet underveis (ingen ny henting planlegges). */
  async function pullOnce(context: LocalReadContext): Promise<PullOutcome | null> {
    const sentCursor = cursor;
    const params = new URLSearchParams({ organisasjon: context.organizationId });
    if (sentCursor !== null) params.set("siden", sentCursor);
    controller = typeof AbortController === "undefined" ? null : new AbortController();

    let response: Response;
    try {
      response = await fetchImpl(`${TRIAL_PULL_ROUTE}?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller?.signal,
      });
    } catch {
      return active() ? "failed" : null;
    }
    if (!active()) return null;

    if (response.status === 400 && sentCursor !== null) {
      await response.text().catch(() => undefined);
      // Bare markøren slettes; synkede rader og køen røres ikke.
      try {
        await context.deleteState(CUSTOM_CURSOR_KEY);
      } catch {
        return active() ? "failed" : null;
      }
      cursor = null;
      return "invalid-cursor";
    }
    if (response.status !== 200) {
      await response.text().catch(() => undefined);
      // Bare status i loggen, aldri innholdet.
      console.warn(`Synk: hente-ruten svarte ${response.status}. Prøver igjen senere.`);
      return "failed";
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return active() ? "failed" : null;
    }
    const parsed = parsePullResponse(body);
    if (!parsed) return "failed";

    const tables = TRIAL_TABLE_NAMES;
    try {
      for (const [index, table] of tables.entries()) {
        if (!active()) return null;
        const last = index === tables.length - 1;
        const stateRow: CustomCursorRow | null = last
          ? { key: CUSTOM_CURSOR_KEY, value: parsed.markor }
          : null;
        await context.mergeIncoming(
          table,
          toChanges(table, parsed.endringer[table] ?? []),
          stateRow as Record<string, unknown> | null,
        );
      }
    } catch (error) {
      console.warn("Synk: kunne ikke legge inn rader fra serveren.", error);
      return active() ? "failed" : null;
    }
    cursor = parsed.markor;
    // Oppdateres før varselet, så kjernen leser riktig verdi (`LocalReadContext.notifyStatus`).
    confirmed = parsed.ferdig;
    context.notifyStatus();
    return parsed.ferdig ? "ok" : "more";
  }

  function onAck() {
    if (!active()) return;
    if (running) {
      ackWhileRunning = true;
      return;
    }
    const next = nextPullDelay(schedule, "acked");
    schedule = next.state;
    // Flytter aldri en henting som allerede er planlagt tidligere (skriving uten pause skal ikke
    // skyve hentingen foran seg).
    if (dueAt === null || now() + next.delayMs < dueAt) plan(next.delayMs);
  }

  return {
    start(context) {
      if (ctx) return;
      ctx = context;
      cursor = storedCursor(context);
      context.afterAck(onAck);
      plan(0);
    },
    wake() {
      if (!active()) return;
      if (running) {
        wakeWhileRunning = true;
        return;
      }
      schedule = INITIAL_PULL_SCHEDULE;
      plan(0);
    },
    syncNow() {
      if (!active() || !ctx || !ctx.isOnline()) {
        return Promise.reject(new Error("Ingen henting uten nett."));
      }
      const promise = new Promise<void>((resolve, reject) => {
        queuedWaiters.push({ resolve, reject });
      });
      if (running) {
        syncNowWhileRunning = true;
        return promise;
      }
      const next = nextPullDelay(schedule, "sync-now");
      schedule = next.state;
      // `null` skjer bare når takten mener nettet er borte; da avvises kallet som uten nett.
      if (next.delayMs === null) {
        rejectAllWaiters();
        return promise;
      }
      plan(next.delayMs);
      return promise;
    },
    serverConfirmed() {
      return confirmed && active() && ctx !== null && ctx.isOnline();
    },
    stop() {
      stopped = true;
      confirmed = false;
      cancelTimer();
      controller?.abort();
      controller = null;
      rejectAllWaiters();
    },
  };
}

export const createPullReader: CreatePullReader = () => createCustomReader();
