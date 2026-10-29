/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * `TrialSyncStore` for ElectricSQL (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 5–6,
 * avgjørelse D og «Avgjørelser før bygging» 1–4). Electric synker bare lesing. Skriving, kø og
 * innfletting ligger i den lokale kjernen (`sync/local/trial-store.ts`); her ligger bare
 * skjemaleseren (docs/funksjoner/fase1-kandidat-egenbygd.md, forarbeid pkt. 1):
 * - Lesing: én `fetch`-løkke per tabell mot proxy-ruten (`TRIAL_SHAPE_ROUTE`). Synkposisjonen
 *   (`shape_state`) skrives i samme transaksjon som radene, altså aldri før de er flettet inn.
 *   Feil prøves igjen etter `retryDelayMs` (aldri tettere enn 5 s per tabell). 409 eller
 *   `must-refetch`: synkposisjon og synkede rader for tabellen slettes og alt hentes på nytt;
 *   køen røres aldri, og rader med usendte endringer blir stående.
 *
 * Valgt bort: `ShapeStream` fra `@electric-sql/client` (holdt ikke 5-sekundersregelen, se
 * resultatfilen).
 */
import { TRIAL_TABLE_NAMES, type TrialTableName } from "../local-columns";
import { retryDelayMs } from "../local/outbox";
import { createLocalTrialStore } from "../local/trial-store";
import type { LocalReadContext, LocalTrialReader, LocalTrialStore } from "../local/types";
import {
  nextShapeParams,
  parseShapeMessages,
  readShapeHeaders,
  shapeSearchParams,
} from "./shape-messages";
import { electricDb } from "./storage";
import { TRIAL_SHAPE_ROUTE, type ShapeState } from "./types";

/** Skjemaleseren: én løkke per tabell mot proxy-ruten. */
function createShapeReader(): LocalTrialReader {
  const controllers = new Map<TrialTableName, AbortController>();
  const wakeups = new Map<TrialTableName, () => void>();

  /** Venter `ms`, eller til nettet kommer tilbake / lageret lukkes. */
  function sleep(table: TrialTableName, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wakeups.delete(table);
        resolve();
      }
      wakeups.set(table, done);
    });
  }

  function wakeAll() {
    for (const wake of [...wakeups.values()]) wake();
  }

  async function shapeLoop(ctx: LocalReadContext, table: TrialTableName) {
    let state =
      (ctx.storedState.find((row) => row.table === table) as ShapeState | undefined) ?? null;
    let cursor: string | undefined;
    let attempt = 0;
    let lastCall = 0;

    async function failed() {
      const delay = retryDelayMs(attempt);
      attempt++;
      await sleep(table, delay);
    }

    while (!ctx.isClosed()) {
      if (!ctx.isOnline()) {
        await sleep(table, 60_000);
        continue;
      }
      // Aldri to kall for samme tabell tettere enn 5 s etter en feil (attempt > 0).
      if (attempt > 0) {
        const wait = lastCall + retryDelayMs(attempt - 1) - Date.now();
        if (wait > 0) await sleep(table, wait);
        if (ctx.isClosed()) return;
      }
      const params = nextShapeParams(
        ctx.organizationId,
        table,
        state,
        state?.upToDate ?? false,
        cursor,
      );
      const controller = new AbortController();
      controllers.set(table, controller);
      lastCall = Date.now();
      let response: Response;
      try {
        response = await fetch(`${TRIAL_SHAPE_ROUTE}?${shapeSearchParams(params)}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        if (ctx.isClosed()) return;
        await failed();
        continue;
      } finally {
        controllers.delete(table);
      }

      if (response.status === 409) {
        await response.text().catch(() => undefined);
        await ctx.resetTable(table, table);
        state = null;
        cursor = undefined;
        await failed();
        continue;
      }
      if (response.status !== 200 && response.status !== 204) {
        await response.text().catch(() => undefined);
        await failed();
        continue;
      }

      const headers = readShapeHeaders(response.headers);
      let body: unknown = [];
      if (response.status === 200) {
        try {
          body = await response.json();
        } catch {
          if (ctx.isClosed()) return;
          await failed();
          continue;
        }
      }
      const parsed = parseShapeMessages(table, body);
      if (parsed.mustRefetch) {
        await ctx.resetTable(table, table);
        state = null;
        cursor = undefined;
        await failed();
        continue;
      }
      const nextState: ShapeState | null =
        headers.handle && headers.offset
          ? {
              table,
              handle: headers.handle,
              offset: headers.offset,
              upToDate: Boolean(state?.upToDate) || parsed.upToDate || headers.upToDate,
            }
          : state;
      try {
        await ctx.mergeIncoming(
          table,
          parsed.changes,
          nextState === state ? null : (nextState as unknown as Record<string, unknown> | null),
        );
      } catch (error) {
        console.warn("Synk: kunne ikke legge inn rader fra serveren.", error);
        await failed();
        continue;
      }
      state = nextState;
      cursor = headers.cursor ?? cursor;
      attempt = 0;
      ctx.notifyStatus();
    }
  }

  return {
    start(ctx) {
      for (const table of TRIAL_TABLE_NAMES) void shapeLoop(ctx, table);
    },
    wake: wakeAll,
    stop() {
      for (const controller of controllers.values()) controller.abort();
      wakeAll();
    },
  };
}

export function createElectricTrialStore(
  deviceId: string,
  organizationId: string,
): Promise<LocalTrialStore> {
  return createLocalTrialStore({
    db: electricDb,
    deviceId,
    organizationId,
    reader: createShapeReader(),
  });
}
