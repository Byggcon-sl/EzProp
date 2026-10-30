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
 * - «Synk nå» (`syncNow`): avbryter ventetid og pågående kall, og hver tabell henter én gang uten
 *   `live` (svarer straks). Løses når alle tabellene har fått 200 i runden, avvises ved første
 *   feil. `serverConfirmed()` er sann bare når alle tabellene har fått 200 og ingen har feilet
 *   etter det (docs/funksjoner/fase1-synkstatus.md, krav K5).
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

/** Én runde fra «Synk nå»: tabellene som ennå ikke har fått 200. */
interface SyncRound {
  remaining: Set<TrialTableName>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/** Skjemaleseren: én løkke per tabell mot proxy-ruten. */
function createShapeReader(): LocalTrialReader {
  const controllers = new Map<TrialTableName, AbortController>();
  const wakeups = new Map<TrialTableName, () => void>();
  let context: LocalReadContext | null = null;
  let stopped = false;
  /** Tabeller med 200 på siste svar og ingen feil etter det. */
  const confirmedTables = new Set<TrialTableName>();
  const rounds = new Set<SyncRound>();
  /** Tabeller som skal hente med en gang, uten ventetid og uten `live` («Synk nå»). */
  const catchUp = new Set<TrialTableName>();
  /** Kall avbrutt av «Synk nå»: ikke en feil, tabellen henter på nytt med en gang. */
  const restarted = new Set<TrialTableName>();

  function tableFailed(table: TrialTableName) {
    confirmedTables.delete(table);
    for (const round of [...rounds]) {
      rounds.delete(round);
      round.reject(new Error("Hentingen lyktes ikke."));
    }
  }

  function tableConfirmed(table: TrialTableName) {
    confirmedTables.add(table);
    for (const round of [...rounds]) {
      round.remaining.delete(table);
      if (round.remaining.size === 0) {
        rounds.delete(round);
        round.resolve();
      }
    }
  }

  /** Et kall avbrutt av «Synk nå» regnes ikke som feil. */
  function wasRestarted(table: TrialTableName): boolean {
    return restarted.delete(table);
  }

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
      restarted.delete(table);
      tableFailed(table);
      const delay = retryDelayMs(attempt);
      attempt++;
      await sleep(table, delay);
    }

    while (!ctx.isClosed()) {
      if (!ctx.isOnline()) {
        tableFailed(table);
        await sleep(table, 60_000);
        continue;
      }
      // Aldri to kall for samme tabell tettere enn 5 s etter en feil (attempt > 0), unntatt
      // «Synk nå», som hopper over ventetiden (feiltelleren står til neste 200).
      if (attempt > 0 && !catchUp.has(table)) {
        const wait = lastCall + retryDelayMs(attempt - 1) - Date.now();
        if (wait > 0) await sleep(table, wait);
        if (ctx.isClosed()) return;
      }
      // «Synk nå» henter uten `live`, så svaret kommer straks og ikke først når noe endres.
      const live = (state?.upToDate ?? false) && !catchUp.has(table);
      const params = nextShapeParams(ctx.organizationId, table, state, live, cursor);
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
        if (wasRestarted(table)) continue;
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
          if (wasRestarted(table)) continue;
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
        // Bare feilmeldingen, aldri feilobjektet (kan bære rader fra serveren).
        console.warn(
          "Synk: kunne ikke legge inn rader fra serveren.",
          error instanceof Error ? error.message : String(error),
        );
        await failed();
        continue;
      }
      state = nextState;
      cursor = headers.cursor ?? cursor;
      attempt = 0;
      // Et svar som kom før «Synk nå» avbrøt kallet, teller fortsatt: det er et ekte 200.
      restarted.delete(table);
      // Ut av «Synk nå» også ved 204, så tabellen aldri spør uten `live` i en tett løkke.
      catchUp.delete(table);
      if (response.status === 200) tableConfirmed(table);
      // Oppdateres før varselet, så kjernen leser riktig `serverConfirmed()`.
      ctx.notifyStatus();
    }
  }

  return {
    start(ctx) {
      context = ctx;
      for (const table of TRIAL_TABLE_NAMES) void shapeLoop(ctx, table);
    },
    wake: wakeAll,
    syncNow() {
      const ctx = context;
      if (stopped || !ctx || ctx.isClosed() || !ctx.isOnline()) {
        return Promise.reject(new Error("Ingen henting uten nett."));
      }
      const promise = new Promise<void>((resolve, reject) => {
        rounds.add({ remaining: new Set(TRIAL_TABLE_NAMES), resolve, reject });
      });
      for (const table of TRIAL_TABLE_NAMES) {
        catchUp.add(table);
        // Et `live`-kall kan vente lenge på neste endring: avbryt og hent på nytt med en gang.
        const controller = controllers.get(table);
        if (controller) {
          restarted.add(table);
          controller.abort();
        }
      }
      wakeAll();
      return promise;
    },
    serverConfirmed() {
      const ctx = context;
      if (stopped || !ctx || ctx.isClosed() || !ctx.isOnline()) return false;
      return TRIAL_TABLE_NAMES.every((table) => confirmedTables.has(table));
    },
    stop() {
      stopped = true;
      for (const controller of controllers.values()) controller.abort();
      wakeAll();
      confirmedTables.clear();
      for (const round of [...rounds]) {
        rounds.delete(round);
        round.reject(new Error("Lageret er lukket."));
      }
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
