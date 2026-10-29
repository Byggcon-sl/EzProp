/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kontrakten for serversiden av synken (bare typer og signaturer). Rutene under `/api/prove/` er
 * tynne og kaller funksjonene her; all tilgang sjekkes først med `requireOrganizationAccess`, og
 * hver spørring filtrerer på `grant.organizationId`, aldri på `organizationId` fra nyttelasten
 * (CLAUDE.md regel 2). Detaljene står i docs/funksjoner/fase1-kandidat-powersync.md pkt. 11.
 */
import type { Actor } from "@/core/access";
import type { TrialAnswerRecord, TrialFormRecord } from "@/db/schema";
import type { TrialTableName } from "../sync/local-columns";

/** Tabellene synken får skrive til og lese fra. Alt annet gir `InvalidTrialChangeError`. */
export const TRIAL_CHANGE_TABLES = ["trial_forms", "trial_answers", "trial_photos"] as const;
export type TrialChangeTable = (typeof TRIAL_CHANGE_TABLES)[number];
/** Samme liste som klienten bruker lokalt (`sync/local-columns.ts`); typene skal være like. */
type _TablesMatch = TrialChangeTable extends TrialTableName
  ? TrialTableName extends TrialChangeTable
    ? true
    : never
  : never;
const _tablesMatch: _TablesMatch = true;
void _tablesMatch;

/** `DELETE` er bevisst ikke med: ingen skjerm sletter noe i prøven. Den gir 400. */
export type TrialChangeOp = "PUT" | "PATCH";

/**
 * Én endring fra enheten (én rad). `data` har kolonnenavn i snake_case som i PostgreSQL, med
 * verdiene slik de lå i den lokale databasen (`value` som JSON-tekst, tidsstempler som tekst).
 * Serverstyrte kolonner (`organization_id`, `created_by`, `updated_by`, `row_version`,
 * `uploaded_at`, `sha256`, `storage_path`) overses uten feil.
 */
export interface TrialChangeOperation {
  op: TrialChangeOp;
  table: TrialChangeTable;
  id: string;
  data: Record<string, unknown>;
}

/** Kroppen i `POST /api/prove/synk/endringer`. `organizationId` brukes bare til tilgangssjekken. */
export interface TrialChangesRequest {
  organizationId: string;
  operations: TrialChangeOperation[];
}

/** Grenser for Zod-skjemaet i ruten. Utenfor grensene gir 400 og ingen skriving. */
export const TRIAL_SYNC_LIMITS = {
  maxOperationsPerBatch: 500,
  maxValueBytes: 64 * 1024,
  maxTextStateBytes: 64 * 1024,
  maxDeviceIdLength: 64,
} as const;

export interface TrialChangesResult {
  /** Antall operasjoner som ble skrevet (upsert). Samme bunt to ganger gir samme data. */
  applied: number;
}

/** JWT-en synktjenesten godtar: HS256, bare disse claimene, aldri e-post eller navn. */
export const SYNC_TOKEN_AUDIENCE = "powersync";
export const SYNC_TOKEN_TTL_SECONDS = 60 * 60;
export const SYNC_TOKEN_SECRET_MIN_BYTES = 32;

export interface SyncTokenClaims {
  /** Bruker-id fra innloggingen. */
  sub: string;
  /** Alltid `grant.organizationId`. Synkreglene filtrerer bøtta på denne. */
  organization_id: string;
  aud: typeof SYNC_TOKEN_AUDIENCE;
  iat: number;
  exp: number;
}

export interface SyncTokenResult {
  token: string;
  /** `POWERSYNC_URL`. */
  endpoint: string;
}

/** Det ruten `PUT /api/prove/bilder/[id]` leser fra spørrestrengen og hodene. */
export interface TrialPhotoMeta {
  trialFormId: string;
  fieldKey: string;
  name: string;
  sizeBytes: number;
  /** Må begynne med `image/`, ellers 400. */
  contentType: string;
}

export interface StoreTrialPhotoResult {
  /** Hex-kodet SHA-256 av filen slik den ble lagret. Klienten sammenligner før den sletter lokalt. */
  sha256: string;
}

/** Standardgrense for `TRIAL_PHOTO_MAX_BYTES` (25 MB). Over gir 413. */
export const TRIAL_PHOTO_DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

// Signaturer for de fem funksjonene i `server/`. Alle kaller `requireOrganizationAccess(actor,
// organizationId, "organization.read")` først og bruker `grant.organizationId` videre.

/** `server/sync-token.ts`. Kaster tydelig feil uten `POWERSYNC_JWT_SECRET`; nekter utviklingsverdien utenfor localhost. */
export type IssueSyncToken = (actor: Actor, organizationId: string) => Promise<SyncTokenResult>;

/**
 * `server/apply-changes.ts`. Idempotent upsert. `trial_forms` og `trial_photos` på `id`,
 * `trial_answers` på `(trial_form_id, field_key)` der serverens `id` beholdes. Fremmed `id` i noen
 * av de tre tabellene gir `TrialIdConflictError` før noe skrives; `trial_answers`/`trial_photos`
 * uten skjema i `grant.organizationId` gir `InvalidTrialChangeError`. Tekstfelt med `text_state`
 * flettes med lagret tilstand, og `value` settes til den flettede teksten.
 */
export type ApplyTrialChanges = (
  actor: Actor,
  organizationId: string,
  operations: readonly TrialChangeOperation[],
) => Promise<TrialChangesResult>;

/** `server/queries.ts`. Bare for testene (tenant-isolasjonsbeviset). Ingen side bruker dem. */
export type ListTrialForms = (actor: Actor, organizationId: string) => Promise<TrialFormRecord[]>;
export type ListTrialAnswers = (
  actor: Actor,
  organizationId: string,
  trialFormId: string,
) => Promise<TrialAnswerRecord[]>;

/**
 * `server/photo-storage.ts`. `photoId` må bestå `isUuid` før stien bygges (ellers
 * `TrialPhotoNotFoundError`). Raden lages fra `meta` hvis den mangler. Filen skrives til
 * `TRIAL_UPLOAD_DIR/<organizationId>/<photoId>`, og stien kontrolleres å ligge under
 * `path.resolve(TRIAL_UPLOAD_DIR)`. Idempotent.
 */
export type StoreTrialPhoto = (
  actor: Actor,
  organizationId: string,
  photoId: string,
  meta: TrialPhotoMeta,
  bytes: Uint8Array,
) => Promise<StoreTrialPhotoResult>;

// Kandidat 2 (ElectricSQL): proxy-ruten `GET /api/prove/synk/shape`
// (docs/funksjoner/fase1-kandidat-electricsql.md pkt. 9 og avgjørelse B).

/**
 * Det eneste klienten får sende videre til Electric, etter formatsjekk. Alt annet i spørrestrengen
 * (`table`, `where`, `columns`, `params[1]`, `replica`, `secret`, `api_secret`, …) overses.
 */
export const SHAPE_CLIENT_PARAMS = ["offset", "handle", "live", "cursor"] as const;
export type ShapeClientParam = (typeof SHAPE_CLIENT_PARAMS)[number];
/** `offset`, `handle` og `cursor` må passe mønsteret; `live` må være nøyaktig `true`. Ellers 400. */
export const SHAPE_PARAM_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Filteret i hver shape. `$1` er alltid `grant.organizationId`, sendt som `params[1]`, aldri limt inn. */
export const SHAPE_WHERE = "organization_id = $1 AND deleted_at IS NULL";

/**
 * Hodene fra Electric som når klienten. `ETag`, `Age`, `Expires` og Electrics `Cache-Control`
 * gjør det aldri; proxyen setter alltid `Cache-Control: private, no-store`.
 */
export const SHAPE_FORWARDED_HEADERS = [
  "content-type",
  "electric-handle",
  "electric-offset",
  "electric-schema",
  "electric-cursor",
  "electric-up-to-date",
] as const;
export const SHAPE_CACHE_CONTROL = "private, no-store";

/** Statusene fra Electric som videresendes uendret. Nettverksfeil og tidsavbrudd gir 502 `{ feil }`. */
export const SHAPE_FORWARDED_STATUSES = [200, 204, 400, 409, 429] as const;

/** Lang-polling (`live=true`) varer opptil ca. 20 s hos Electric; proxyen gir opp litt senere. */
export const SHAPE_UPSTREAM_TIMEOUT_MS = 30_000;

/** `ELECTRIC_SECRET`: minst 32 byte; utviklingsverdien fra `.env.example` nektes utenfor localhost. Aldri med `NEXT_PUBLIC_`. */
export const ELECTRIC_SECRET_MIN_BYTES = 32;

/**
 * `server/electric-shape.ts`. Rekkefølge: `requireOrganizationAccess(actor, organizationId,
 * "organization.read")` → tabellsjekk (bare `TRIAL_CHANGE_TABLES`, ellers `InvalidTrialChangeError`
 * uten kall) → `new URL(ELECTRIC_URL + "/v1/shape")` med `searchParams.set` for `table`, `where`
 * (`SHAPE_WHERE`), `params[1]` = `grant.organizationId`, `columns` = `localColumnsOf(table)` (aldri
 * `storage_path`, `created_by`, `updated_by`, `deleted_by`), `secret` = `ELECTRIC_SECRET`, og til
 * slutt de av `SHAPE_CLIENT_PARAMS` som finnes i `clientParams` og passer `SHAPE_PARAM_PATTERN`.
 * Ulovlig format gir `InvalidTrialChangeError`. `organizationId` fra adressen brukes bare til
 * tilgangssjekken.
 */
export type BuildTrialShapeRequest = (
  actor: Actor,
  organizationId: string,
  table: string,
  clientParams: URLSearchParams,
) => Promise<{ url: URL }>;

/**
 * `server/electric-shape.ts`. Kaller `buildTrialShapeRequest` og henter fra Electric med
 * `fetchImpl` (byttes i testene). Svaret har bare `SHAPE_FORWARDED_HEADERS` og
 * `Cache-Control: SHAPE_CACHE_CONTROL`; statusene i `SHAPE_FORWARDED_STATUSES` og kroppen
 * strømmes uendret. Nettverksfeil eller tidsavbrudd gir 502 med `{ feil }` uten Electrics tekst og
 * uten ny prøving. `ELECTRIC_URL` og `ELECTRIC_SECRET` står aldri i noe svar. Logger bare rute,
 * bruker-id, tabellnavn og status, aldri spørrestrengen.
 */
export type ForwardTrialShape = (
  actor: Actor,
  organizationId: string,
  searchParams: URLSearchParams,
  fetchImpl?: typeof fetch,
) => Promise<Response>;
