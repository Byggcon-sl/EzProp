/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Det som er særegent for kandidat 2 (ElectricSQL), bare typer og signaturer
 * (docs/funksjoner/fase1-kandidat-electricsql.md, avgjørelse B og D). Electric synker bare
 * lesing: utsnitt av tabeller («shapes») over vanlig HTTP, alltid gjennom proxy-ruten
 * `GET /api/prove/synk/shape` i appen. Skriving går som før til `POST /api/prove/synk/endringer`,
 * med en endringskø vi eier selv (`OutboxMachine` i `sync/types.ts`).
 *
 * Lokal lagring: IndexedDB-databasen `offline-trial-electric` (rått API, ingen PGlite, ingen
 * wasm). Bildefilene ligger som før i `offline-trial-photos`.
 */
import type { TrialTableName } from "../local-columns";
import type { IncomingChange, OutboxEntry, TrialSyncStore, TrialSyncTestable } from "../types";

export const ELECTRIC_DB_NAME = "offline-trial-electric";

/** Objektlagrene i `offline-trial-electric`. Versjonen økes når et lager legges til eller endres. */
export const ELECTRIC_DB_VERSION = 1;
export const ELECTRIC_STORES = {
  /** Nedlastede rader med lokale endringer lagt på, nøkkel `id`. */
  trial_forms: "synced_trial_forms",
  /** Nøkkel `id`, indeks `form_field` på `[trial_form_id, field_key]` (unik). */
  trial_answers: "synced_trial_answers",
  /** Nøkkel `id`, indeks `trial_form_id`. */
  trial_photos: "synced_trial_photos",
  /** Én rad per tabell: hvor langt shapen er lest. Nøkkel = tabellnavn. */
  shapeState: "shape_state",
  /** Endringskøen, nøkkel `seq`. */
  outbox: "outbox",
} as const;

/** Proxy-ruten i appen. iPaden snakker aldri med Electric direkte. */
export const TRIAL_SHAPE_ROUTE = "/api/prove/synk/shape";

/** Spørrestrengen klienten sender til proxyen. Alt annet overses av proxyen. */
export interface ShapeRequestParams {
  organisasjon: string;
  tabell: TrialTableName;
  /** `-1` ved første henting eller etter `must-refetch`; ellers `electric-offset` fra forrige svar. */
  offset: string;
  /** `electric-handle` fra forrige svar. Utelates ved første henting. */
  handle?: string;
  /** `true` for lang-polling når shapen er oppdatert (`up-to-date`). */
  live?: "true";
  /** `electric-cursor` fra forrige svar, bare sammen med `live`. */
  cursor?: string;
}

/** Synkposisjonen for én tabell, lagret i `shape_state` så synken fortsetter der den slapp. */
export interface ShapeState {
  table: TrialTableName;
  handle: string;
  offset: string;
  /** Satt når Electric har sagt `up-to-date`; da kan neste kall være `live`. */
  upToDate: boolean;
}

/**
 * Svarhodene fra proxyen (bare disse videresendes fra Electric). `electric-offset` og
 * `electric-handle` skrives til `shape_state` etter at radene i kroppen er flettet inn, aldri før.
 */
export interface ShapeResponseHeaders {
  handle?: string;
  offset?: string;
  cursor?: string;
  upToDate: boolean;
}

/** Leser hodene over fra et `Headers`-objekt eller et vanlig objekt (for testene). */
export type ReadShapeHeaders = (
  headers: Headers | Readonly<Record<string, string | undefined>>,
) => ShapeResponseHeaders;

/** Spørrestrengen for neste henting av en tabell. Uten `state`: `offset=-1`, ingen `handle`. */
export type NextShapeParams = (
  organizationId: string,
  table: TrialTableName,
  state: ShapeState | null,
  live: boolean,
  cursor?: string,
) => ShapeRequestParams;

/**
 * Resultatet av å tolke én kropp fra Electric (JSON-liste med meldinger). Radmeldinger har
 * `headers.operation` (`insert` | `update` | `delete`), `key` og `value`; kontrollmeldinger har
 * `headers.control` (`up-to-date` | `must-refetch`). Verdiene normaliseres til lokal form:
 * `value` (jsonb) til JSON-tekst, tidsstempler til ISO-tekst, tall til `number`.
 * Ukjente meldinger og ukjente kolonner overses uten feil.
 */
export interface ParsedShapeBody {
  changes: IncomingChange[];
  upToDate: boolean;
  /**
   * 409 eller kontrollmeldingen `must-refetch`: slett `shape_state` og de synkede radene for
   * tabellen og hent på nytt fra `offset=-1`. `outbox` røres aldri.
   */
  mustRefetch: boolean;
}

export type ParseShapeBody = (table: TrialTableName, body: unknown) => ParsedShapeBody;

/** Bunten slik den sendes til `POST /api/prove/synk/endringer` (uten `seq`). */
export type OutboxBatchBody = (
  organizationId: string,
  batch: readonly OutboxEntry[],
) => { organizationId: string; operations: Omit<OutboxEntry, "seq">[] };

/**
 * `sync/electricsql/store.ts`: `createElectricTrialStore(deviceId, organizationId)`.
 * - Skriver lokalt først (`synced_*`), så i `outbox`; begge i samme IndexedDB-transaksjon.
 * - Sender bunter i `seq`-rekkefølge bare med nett; en bunt tas ut av køen **bare** ved 200.
 *   Ellers beholdes den med ventetid etter `RetryDelayMs`.
 * - Henter de tre shapene gjennom proxyen (`offset`/`handle` fra `shape_state`), fletter inn med
 *   `applyIncoming` og nøklene i køen pluss «bekreftet»-settet som `pendingKeys`. En nøkkel er
 *   «bekreftet» fra 200 til neste shape-melding for samme nøkkel kommer (kjent svakhet: en eldre
 *   melding underveis, føres i resultatfilen). Feil i henting prøves igjen etter `RetryDelayMs`
 *   og blokkerer aldri skriving.
 * - `status().pendingChanges` = antall operasjoner i `outbox`. `onStatusChange` varsler ved
 *   endring i køen, i `synced_trial_photos`, ved `online`/`offline` og etter hver henting.
 * - Lytterne får snapshot fra `synced_*`; tekstfelt vises som `textOf(text_state)` når den finnes.
 */
export type CreateElectricTrialStore = (
  deviceId: string,
  organizationId: string,
) => Promise<TrialSyncStore & TrialSyncTestable>;

/** Tømmer hele `offline-trial-electric` (ved organisasjonsbytte). Bildene tømmes av `photo-store.ts`. */
export type ClearElectricStorage = () => Promise<void>;
