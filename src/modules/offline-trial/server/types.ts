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

/** Tabellene synken får skrive til. Alt annet gir `InvalidTrialChangeError`. */
export const TRIAL_CHANGE_TABLES = ["trial_forms", "trial_answers", "trial_photos"] as const;
export type TrialChangeTable = (typeof TRIAL_CHANGE_TABLES)[number];

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
