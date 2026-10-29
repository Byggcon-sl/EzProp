/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Det som er særegent for kandidat 3 (egenbygd), bare typer og signaturer
 * (docs/funksjoner/fase1-kandidat-egenbygd.md pkt. 5–9). Skriving, kø og innfletting kommer fra
 * den lokale kjernen (`sync/local/`); her ligger bare hentelesingen mot `GET /api/prove/synk/hent`.
 * Ingen ny tjeneste, ingen ny avhengighet, ingen websocket, ingen lang-polling.
 *
 * Lokal lagring: IndexedDB-databasen `offline-trial-custom` med samme lagre som Electric, pluss
 * `sync_state` (nøkkel `key`) med radene `{ key: "cursor", value }` og
 * `{ key: "outbox_next_seq", nextSeq }`. Bildefilene ligger som før i `offline-trial-photos`.
 */
import type { TrialTableName } from "../local-columns";
import type { LocalDbOptions, LocalTrialReader, LocalTrialStore } from "../local/types";

export const CUSTOM_DB_NAME = "offline-trial-custom";
export const CUSTOM_DB_OPTIONS: LocalDbOptions = {
  name: CUSTOM_DB_NAME,
  version: 1,
  stateStore: { name: "sync_state", keyPath: "key" },
};

/** Nøkkelen i `sync_state` for hentemarkøren. Tømmes ved organisasjonsbytte (hele databasen). */
export const CUSTOM_CURSOR_KEY = "cursor";

/** Raden med hentemarkøren i `sync_state`. `value` er teksten fra serveren, uendret. */
export interface CustomCursorRow {
  key: typeof CUSTOM_CURSOR_KEY;
  value: string;
}

/** Hente-ruten i appen. */
export const TRIAL_PULL_ROUTE = "/api/prove/synk/hent";

/** Spørrestrengen klienten sender. `siden` utelates ved første henting og etter 400. */
export interface PullRequestParams {
  organisasjon: string;
  siden?: string;
}

/** Svaret fra hente-ruten slik klienten leser det (`TrialChangesSinceResult` på serveren). */
export interface PullResponseBody {
  endringer: Partial<Record<TrialTableName, Record<string, unknown>[]>>;
  markor: string;
  ferdig: boolean;
}

// --- Takten for henting (`custom/pull-schedule.ts`, ren funksjon med egen Vitest-test) ---

/** Vanlig takt med nett: høyst én henting per 5 s. */
export const PULL_INTERVAL_MS = 5_000;
/** Ventetid etter feil: 5, 10, 20, 40, 60 s, tak 60 s. Tilbake til 5 s etter en vellykket henting. */
export const PULL_BACKOFF_MAX_MS = 60_000;

/**
 * Det som skjedde med forrige henting (eller at en bunt ble sendt):
 * - `ok`: vellykket, `ferdig: true`.
 * - `more`: vellykket, `ferdig: false` (neste side med en gang).
 * - `failed`: nettverksfeil, 5xx, 401/403 eller ugyldig kropp.
 * - `invalid-cursor`: 400; markøren slettes og neste henting går uten `siden` (med en gang).
 * - `acked`: en bunt fikk 200 (`afterAck`); hent ved neste takt.
 */
export type PullOutcome = "ok" | "more" | "failed" | "invalid-cursor" | "acked";

export interface PullScheduleState {
  /** Antall feil på rad. 0 etter en vellykket henting. */
  failures: number;
}

/**
 * Ren funksjon: ny tilstand og ventetid i ms før neste henting. Ingen tidtakere, ingen `Date`.
 * `ok` og `acked` gir `PULL_INTERVAL_MS` og `failures = 0`; `more` og `invalid-cursor` gir 0;
 * `failed` gir `min(5 000 · 2^failures, 60 000)` og `failures + 1`.
 */
export type NextPullDelay = (
  state: PullScheduleState,
  outcome: PullOutcome,
) => { state: PullScheduleState; delayMs: number };

// --- Leseren og lageret ---

/**
 * `custom/reader.ts`. Henter `TRIAL_PULL_ROUTE` med `cache: "no-store"` og
 * `credentials: "same-origin"`, normaliserer radene med `normalizeLocalRow`, sender dem som
 * `kind: "update"` til `ctx.mergeIncoming` tabell for tabell (forms, answers, photos) og skriver
 * `CustomCursorRow` bare sammen med den siste tabellen. 400: `ctx.deleteState(CUSTOM_CURSOR_KEY)`,
 * synkede rader og køen røres ikke. Henting blokkerer aldri skriving. Uten nett: venter på `wake()`.
 * Markøren leses ved start fra `ctx.storedState`.
 */
export type CreatePullReader = () => LocalTrialReader;

/**
 * `custom/store.ts`. `createLocalTrialStore` med `createLocalDb(CUSTOM_DB_OPTIONS)` og
 * `createPullReader()`. `readRows` tar `TrialTableName | "sync_state" | "outbox"`; `sync_state`
 * leses uten raden `outbox_next_seq`.
 */
export type CreateCustomTrialStore = (
  deviceId: string,
  organizationId: string,
) => Promise<LocalTrialStore>;

/** Tømmer hele `offline-trial-custom`, også hentemarkøren (organisasjonsbytte). */
export type ClearCustomStorage = () => Promise<void>;
