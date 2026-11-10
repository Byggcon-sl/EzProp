/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kontrakten for serversiden av synken (bare typer og signaturer). Rutene under `/api/prove/` er
 * tynne og kaller funksjonene her; all tilgang sjekkes først med `requireOrganizationAccess`, og
 * hver spørring filtrerer på `grant.organizationId`, aldri på `organizationId` fra nyttelasten
 * (CLAUDE.md regel 2). Valget av egenbygd synk står i docs/adr/0004-drift-uten-nett.md.
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
  /** Navn på skjema (`trial_forms.name`) og bilde (`trial_photos.name`), i tegn (småfunn 9). */
  maxNameLength: 200,
} as const;

export interface TrialChangesResult {
  /** Antall operasjoner som ble skrevet (upsert). Samme bunt to ganger gir samme data. */
  applied: number;
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

// Signaturer for funksjonene i `server/`. Alle kaller `requireOrganizationAccess(actor,
// organizationId, "organization.read")` først og bruker `grant.organizationId` videre.

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

// Egenbygd synk: hente-ruten `GET /api/prove/synk/hent`
// (docs/funksjoner/fase1-kandidat-egenbygd.md, forarbeid pkt. 2 og bit 2).

/** Største antall rader i ett svar, for alle tre tabellene til sammen. */
export const TRIAL_PULL_LIMIT = 500;
/** Når en tabell er ferdig lest, flyttes markøren så mye tilbake (se `TrialPullCursor`). */
export const TRIAL_PULL_OVERLAP_MS = 60_000;
/** Lengste markør ruten tar imot. Lengre gir `InvalidTrialCursorError` (400). */
export const TRIAL_PULL_CURSOR_MAX_LENGTH = 1_024;
/** Rekkefølgen tabellene leses i. En tabell som ikke ble nådd, beholder markøren sin. */
export const TRIAL_PULL_TABLE_ORDER = ["trial_forms", "trial_answers", "trial_photos"] as const;
/** Brukes som `id` i markøren etter overlapp, så alle rader med samme `u` leses på nytt. */
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";
export const TRIAL_PULL_CACHE_CONTROL = "private, no-store";

/**
 * Posisjonen i én tabell: `(updated_at, id)` for siste rad som er lest. `u` er `updated_at` som
 * tekst med mikrosekunder slik PostgreSQL skriver den (`updated_at::text` eller `to_char` med `US`),
 * **aldri** gjennom JS `Date` (da mistes mikrosekundene og sidene kan gå i ring).
 */
export interface TrialPullPosition {
  u: string;
  id: string;
}

/**
 * Markøren, base64url-JSON `{ v: 1, t: { <tabell>: { u, id } } }`. Mangler en tabell, leses den
 * fra start. Ingen organisasjons-ID og ingen signatur: spørringen filtrerer alltid på
 * `grant.organizationId`, så en markør kan ikke gi en annen organisasjons rader.
 *
 * Mens sidene leses (`ferdig: false`), er markøren ren keyset (`(updated_at, id) > (u, id)`).
 * Når en tabell er ferdig lest, settes den til `(største u minus TRIAL_PULL_OVERLAP_MS, NIL_UUID)`:
 * hver henting leser da de siste 60 s på nytt. Det dekker at `updated_at` settes av databasens
 * `now()` (start av transaksjonen) ved innsetting og av appserverens klokke ved oppdatering, så en
 * skriving kan få en tid før en rad som allerede er hentet. Dobbel levering er ufarlig
 * (`applyIncoming` tåler samme rad flere ganger).
 */
export interface TrialPullCursor {
  v: 1;
  t: Partial<Record<TrialChangeTable, TrialPullPosition>>;
}

/** `server/changes-since.ts`. Tekst til markør; ugyldig (Zod, base64, JSON, lengde) gir `InvalidTrialCursorError`. */
export type DecodeTrialPullCursor = (text: string) => TrialPullCursor;
export type EncodeTrialPullCursor = (cursor: TrialPullCursor) => string;

/**
 * Svaret fra hente-ruten. Radene i snake_case med nøyaktig kolonnene i `localColumnsOf(table)`
 * (aldri `storage_path`, `created_by`, `updated_by`, `deleted_by`, `organization_id`), i samme form
 * som `normalizeLocalRow` venter: tid som ISO-tekst, `value` som JSON-tekst, `size_bytes` som tall.
 * Myk slettede rader er med (`deleted_at` satt), så enheten fjerner dem.
 */
export interface TrialChangesSinceResult {
  endringer: Record<TrialChangeTable, Record<string, unknown>[]>;
  /** Ny markør. Klienten lagrer og sender den tilbake uendret. */
  markor: string;
  /** `true` bare når alle tre tabellene ga færre rader enn plassen som var igjen. */
  ferdig: boolean;
}

/**
 * `server/changes-since.ts`. Rekkefølge: `requireOrganizationAccess(actor, organizationId,
 * "organization.read")` → markøren (`null` = fra start; ugyldig gir `InvalidTrialCursorError`) →
 * per tabell i `TRIAL_PULL_TABLE_ORDER`: `organization_id = grant.organizationId AND
 * (updated_at, id) > (u, id)`, sortert på `updated_at, id`, høyst plassen som er igjen av
 * `TRIAL_PULL_LIMIT`. Aldri en organisasjons-ID fra adressen eller markøren i spørringen.
 * Ingen indeks på `(organization_id, updated_at, id)` i prøven (funn til ADR-en).
 */
export type ListTrialChangesSince = (
  actor: Actor,
  organizationId: string,
  cursor: string | null,
) => Promise<TrialChangesSinceResult>;
