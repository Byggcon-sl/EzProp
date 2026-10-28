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
 * Serverstyrte kolonner (`organization_id`, `created_by`, `updated_by`, `deleted_at`, `deleted_by`,
 * `row_version`, `uploaded_at`, `sha256`, `storage_path`, `text_state`) overses uten feil.
 * `text_state` godtas som null eller streng, men skrives aldri (tekstfletting er egen oppgave).
 * `deleted_at`/`deleted_by` er med i listen fordi `DELETE` er kuttet: enheten kan verken slette
 * eller gjenopprette en rad i prøven. `created_at` fra enheten beholdes ved første innsetting
 * (bilderekkefølgen bygger på den) og endres aldri etterpå.
 *
 * **`PUT` med hele raden, alltid** (arkitekt, forhåndsvurdering runde 2, 28.10.2026): PowerSync
 * lager `PATCH` med bare de endrede kolonnene ved lokal `UPDATE`, og da mangler
 * `trial_form_id`/`field_key` som serveren upserter `trial_answers` på. Enhetens `id` kan dessuten
 * være forkastet av serveren (serverens id vinner på nøkkelen), så `PATCH` på `id` ville gått i
 * tomme. Derfor leser `connector.ts` hele den lokale raden i `uploadData` (raden ligger lokalt til
 * bunten er fullført) og sender alltid `op: "PUT"` med alle kolonner. Serveren godtar fortsatt
 * `PATCH`, men bare når raden finnes på `id` i `grant.organizationId` (ellers
 * `InvalidTrialChangeError`); den brukes ikke av PowerSync-utgaven.
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

/**
 * Grenser for ruten. Utenfor grensene gir 400 og ingen skriving. `maxBodyBytes` sjekkes mot
 * `Content-Length` **før** `request.json()` leses og gir 413 (500 operasjoner à 64 kB er i teorien
 * over 30 MB).
 */
export const TRIAL_SYNC_LIMITS = {
  maxBodyBytes: 4 * 1024 * 1024,
  maxOperationsPerBatch: 500,
  maxValueBytes: 64 * 1024,
  maxDeviceIdLength: 64,
} as const;

export interface TrialChangesResult {
  /** Antall operasjoner som ble skrevet (upsert). Samme bunt to ganger gir samme data. */
  applied: number;
}

/**
 * JWT-en synktjenesten godtar: HS256, bare disse claimene, aldri e-post eller navn.
 *
 * Nøkkelen (arkitekt, 28.10.2026): `POWERSYNC_JWT_SECRET` er en **base64url-streng** (minst 43
 * tegn = 32 byte dekodet). Tjenesten leser den som JWK `{ kty: "oct", alg: "HS256", kid: "trial",
 * k: <strengen> }` i `config.yaml`, og JWK-feltet `k` er per definisjon base64url av nøkkelbytene.
 * Serveren må derfor signere med nøyaktig samme byte: `jose.importJWK({ kty: "oct", alg: "HS256",
 * k: process.env.POWERSYNC_JWT_SECRET })`, aldri `new TextEncoder().encode(secret)` (da ville
 * tjenesten og serveren bruke ulike byte, og alle token ble avvist). `SYNC_TOKEN_SECRET_MIN_BYTES`
 * gjelder de dekodede bytene. Token-hodet får `kid: SYNC_TOKEN_KEY_ID`, så tjenesten finner
 * nøkkelen i JWKS-en uten å prøve alle.
 */
export const SYNC_TOKEN_AUDIENCE = "powersync";
export const SYNC_TOKEN_KEY_ID = "trial";
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

// Signaturer for de fire funksjonene i `server/`. Bildeopplasting (`storeTrialPhoto`) er kuttet til
// oppgaven «Bildekø for prøve A og D» (runde 2, 28.10.2026). Alle kaller `requireOrganizationAccess(actor,
// organizationId, "organization.read")` først og bruker `grant.organizationId` videre.

/** `server/sync-token.ts`. Kaster tydelig feil uten `POWERSYNC_JWT_SECRET`; nekter utviklingsverdien utenfor localhost. */
export type IssueSyncToken = (actor: Actor, organizationId: string) => Promise<SyncTokenResult>;

/**
 * `server/apply-changes.ts`. Idempotent upsert. `trial_forms` og `trial_photos` på `id`,
 * `trial_answers` på `(trial_form_id, field_key)` der serverens `id` beholdes. Fremmed `id` i noen
 * av de tre tabellene gir `TrialIdConflictError` før noe skrives; `trial_answers`/`trial_photos`
 * uten skjema i `grant.organizationId` gir `InvalidTrialChangeError`. Alle felt følger siste
 * endring vinner; `text_state` skrives aldri (tekstfletting er egen oppgave).
 *
 * Presiseringer fra arkitekt (runde 1, 28.10.2026):
 * - Hele bunten skrives i én transaksjon, tabellene i rekkefølgen `trial_forms` →
 *   `trial_answers` → `trial_photos` uansett rekkefølge i nyttelasten (fremmednøkkelen til
 *   skjemaet må finnes først). Feiler én operasjon, skrives ingenting.
 * - `id` og `trial_form_id` må bestå `isUuid` i Zod-skjemaet (400), ellers ender en ugyldig id
 *   som databasefeil (500).
 * - Drizzle sitt `$onUpdate` kjører ikke ved `onConflictDoUpdate`: `row_version = row_version + 1`,
 *   `updated_at = now()` og `updated_by` settes eksplisitt i `set`, og bare når noe faktisk er endret
 *   (`WHERE` på at minst én kolonne er ulik), så samme bunt to ganger ikke øker versjonen.
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
