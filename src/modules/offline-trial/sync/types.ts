/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Kontrakten mellom skjermene i testskjemaet og synkløsningen (bare typer, ingen kode). Lik for
 * alle kandidater (docs/funksjoner/fase1-kandidat-electricsql.md, avgjørelse A). Skjermene og
 * bildekøen bruker bare `TrialSyncStore` og `select-store.ts`; PowerSync-utgaven ligger i
 * `sync/powersync/`, ElectricSQL-utgaven i `sync/electricsql/` og egenbygd i `sync/custom/`. De to
 * siste bygger på den lokale kjernen i `sync/local/` (lagring, kø, innfletting).
 * Ellers blir kriteriet «Arbeid» skjevt mellom kandidatene.
 *
 * Radene speiler kolonnene i PostgreSQL (src/db/schema/offline-trial.ts) slik de ligger lokalt
 * (`sync/local-columns.ts`): tidsstempler som ISO-tekst, `value` som JSON-tekst. Svar nøkles
 * alltid på `(trial_form_id, field_key)`, aldri på `id`.
 */
import type { TrialAnswers, TrialPhoto, TrialValue } from "../answers";
import type { TrialTableName } from "./local-columns";

export type { TrialTableName } from "./local-columns";
export { TRIAL_TABLE_NAMES, trialColumns, localColumnsOf } from "./local-columns";

// Valg av kandidat (innstilling i nettleseren, ikke en kode i datamodellen).

/**
 * `"custom"` er den egenbygde kandidaten (knappen «Egenbygd», `openCustom` i `select-store.ts`,
 * docs/funksjoner/fase1-kandidat-egenbygd.md). Standardvalget forblir `powersync`.
 */
export const TRIAL_SYNC_CANDIDATES = ["powersync", "electricsql", "custom"] as const;
export type TrialSyncCandidate = (typeof TRIAL_SYNC_CANDIDATES)[number];
/** Nøkkel i `localStorage`. Bytte = skriv nøkkelen og `location.reload()`; lageret byttes aldri mens siden lever. */
export const TRIAL_SYNC_CANDIDATE_KEY = "trial_sync_candidate";
export const DEFAULT_TRIAL_SYNC_CANDIDATE: TrialSyncCandidate = "powersync";
/** Nøkkel i `localStorage` for organisasjonen som brukte enheten sist. Ulik organisasjon tømmer all lokal lagring for alle kandidater (også hentemarkøren). */
export const TRIAL_LAST_ORGANIZATION_KEY = "trial_last_organization_id";

// Rader slik de ligger lokalt.

/** Et testskjema i listen. `createdAt` er ISO 8601 (tekst i den lokale lagringen). */
export interface TrialFormSummary {
  id: string;
  name: string;
  createdAt: string;
}

/** En rad i `trial_answers` slik den ligger lokalt. `value` er `TrialValue` som JSON-tekst. */
export interface TrialAnswerRow {
  id: string;
  trialFormId: string;
  fieldKey: string;
  value: string | null;
  /** Base64-kodet Yjs-tilstand, bare tekstfelt. Sannheten for tekst. */
  textState: string | null;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** En rad i `trial_photos` slik den ligger lokalt. `storage_path` synkes aldri til enheten. */
export interface TrialPhotoRow {
  id: string;
  trialFormId: string;
  fieldKey: string;
  name: string;
  sizeBytes: number;
  sha256: string | null;
  /** Settes bare av serveren. Null = filen venter på opplasting fra denne eller en annen enhet. */
  uploadedAt: string | null;
  deviceId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Alt skjermen trenger for ett skjema. `form` er null når skjemaet ikke finnes på enheten (ennå).
 * Bildefeltene bygges av `photos`, aldri av `answers`.
 */
export interface TrialFormSnapshot {
  form: TrialFormSummary | null;
  answers: TrialAnswerRow[];
  photos: TrialPhotoRow[];
}

/**
 * Grunnlaget for synkstatusen (`sync-status.tsx`, docs/funksjoner/fase1-synkstatus.md): «Uten nett»,
 * «Venter: N endringer, M bilder», «Venter på kontakt med serveren» eller «Alt er lagret».
 */
export interface TrialSyncStatus {
  online: boolean;
  /**
   * Siste runde mot serveren (sending og henting) lyktes, og ingenting har feilet etter den. Settes
   * til `false` ved feil, tidsavbrudd og når nettet forsvinner. Hver kandidat setter feltet ut fra
   * sine egne svar fra serveren, aldri ut fra `navigator.onLine`.
   */
  serverConfirmed: boolean;
  /** Endringer i endringskøen som serveren ikke har bekreftet. */
  pendingChanges: number;
  /** Bilder på denne enheten uten `uploadedAt`. */
  pendingPhotos: number;
}

/** Utfallet av én runde fra «Synk nå». */
export type TrialSyncRoundResult = "ok" | "offline" | "failed";

/**
 * Synklageret skjermene og bildekøen bygger mot. Én implementasjon per kandidat. Alle metoder
 * virker uten nett; synk skjer i bakgrunnen. Lytterne (`subscribe`, `subscribeForms`,
 * `onStatusChange`) kalles både ved lokale skrivinger og når synk leverer rader fra serveren.
 */
export interface TrialSyncStore {
  listForms(): Promise<TrialFormSummary[]>;
  /** Kalles med hele listen (nyeste først) straks og hver gang den endres. Returnerer avmelding. */
  subscribeForms(listener: (forms: TrialFormSummary[]) => void): () => void;
  /** Lager et nytt skjema lokalt. Returnerer id laget på enheten (uuidv7). Tomt navn gir «Testskjema N». */
  createForm(name: string): Promise<string>;
  /**
   * Upsert av én `trial_answers`-rad på `(trial_form_id, field_key)`. Tekstfelt skrives ca. 300 ms
   * etter siste tastetrykk, med både `value` og `text_state` flettet mot det som ligger lagret.
   * Bildefelt skrives aldri her.
   */
  setAnswer(formId: string, fieldKey: string, value: TrialValue): Promise<void>;
  /** Lagrer filen lokalt (`photo-store.ts`, IndexedDB) først, så `trial_photos`-raden. Opplasting skjer i bakgrunnen. */
  addPhoto(formId: string, fieldKey: string, file: Blob, photo: TrialPhoto): Promise<void>;
  /** Kalles med en ny snapshot straks og hver gang lokale rader for skjemaet endres. Returnerer avmelding. */
  subscribe(formId: string, listener: (snapshot: TrialFormSnapshot) => void): () => void;
  status(): Promise<TrialSyncStatus>;
  /**
   * Varsler når noe som påvirker `status()` endres (kø, bilderader, nett, synkstatus). Det eneste
   * måleindikatoren og bildekøen lytter på; de kjenner aldri kandidatens egne tabeller.
   */
  onStatusChange(listener: () => void): () => void;
  /** Bilder fra denne enheten uten `uploadedAt`, i stabil rekkefølge (`createdAt`, så `id`). */
  listPendingPhotos(): Promise<TrialPhotoRow[]>;
  /**
   * Serveren har bekreftet filen: sletter den lokale filen og merker bildet bekreftet i
   * `photo-store.ts` (`confirmLocalPhoto`), så det ikke lenger regnes som ventende. Skriver aldri
   * `uploaded_at` eller `sha256` og legger ingenting i endringskøen: serveren eier begge kolonnene
   * og setter dem selv (`storeTrialPhoto`).
   */
  markPhotoUploaded(id: string, sha256: string): Promise<void>;
  /**
   * «Synk nå»: sender køen og henter med en gang, og hopper over ventetiden etter en feil. Varsler
   * `onStatusChange` (bildekøen starter av det varselet). Kaster aldri. Uten nett: `"offline"` straks,
   * uten fetch. Feil eller tidsavbrudd (`SYNC_NOW_TIMEOUT_MS` i `sync/sync-now.ts`): `"failed"`.
   * Bygges med `runSyncNow` fra `sync/sync-now.ts`, så reglene er like for alle kandidater.
   */
  syncNow(): Promise<TrialSyncRoundResult>;
  /** Skriver tekst som venter (ved blur, når siden skjules, ved avmelding og før siden lukkes). */
  flush(): Promise<void>;
  /** Stopper synk og lytting og lukker lokal lagring. Sletter ingenting. */
  close(): Promise<void>;
}

/**
 * Testkroken for e2e, bak `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1`. Rader i snake_case som i den
 * lokale lagringen. `applySyncedRows` oppfører seg som om synk leverte radene fra serveren
 * (upsert på `(trial_form_id, field_key)` for `trial_answers`, ellers på `id`). Antall i køen
 * leses med `store.status()`.
 */
export interface TrialSyncTestable {
  applySyncedRows(table: TrialTableName, rows: Record<string, unknown>[]): Promise<void>;
  readRows(table: TrialTableName, formId?: string): Promise<Record<string, unknown>[]>;
}

/** `window.__offlineTrial` (`sync/test-hooks.ts`). PowerSync-kroken har i tillegg `db` og `pendingOverride` for dagens e2e. */
export interface TrialTestHooks extends TrialSyncTestable {
  candidate: TrialSyncCandidate;
  store: TrialSyncStore;
  deviceId: string;
  organizationId: string;
  /** Later som om en annen organisasjon brukte enheten sist; neste lasting tømmer all lokal lagring. */
  simulateOrganizationChange(organizationId: string): void;
}

// `sync/select-store.ts`: det eneste stedet sidene velger kandidat (signaturer).

export interface OpenedTrialStore {
  store: TrialSyncStore;
  deviceId: string;
  organizationId: string;
  candidate: TrialSyncCandidate;
}

/** Leser `localStorage[TRIAL_SYNC_CANDIDATE_KEY]`; ukjent eller manglende verdi gir standardverdien. */
export type ReadSyncCandidate = () => TrialSyncCandidate;
/** Skriver nøkkelen. Den som kaller, laster siden på nytt etterpå. */
export type WriteSyncCandidate = (candidate: TrialSyncCandidate) => void;
/**
 * Åpner lageret for kandidaten med dynamisk `import()` per kandidat, så bare den valgte SDK-en
 * lastes. Samme instans for hele siden. Organisasjonsbytte (`TRIAL_LAST_ORGANIZATION_KEY`) tømmer
 * lager, synkposisjon, kø og bilder for **alle** kandidater før det nye åpnes. Aldri under SSR.
 */
export type OpenTrialStore = (
  candidate: TrialSyncCandidate,
  organizationId: string,
) => Promise<OpenedTrialStore>;

// Rene funksjoner som utvikler bygger (signaturer; implementasjonen ligger i filene som er nevnt).

/** Base64-kodet Yjs-oppdatering. Tåler JSON-rundtur og ligger i en tekstkolonne både lokalt og i PostgreSQL. */
export type TextState = string;

/** `text-merge.ts`: ingen React, ingen database. Kjører likt på iPad og server. */
export interface TextMerge {
  createTextState(text: string): TextState;
  /** Regner ut innsetting og sletting fra forrige tekst og legger dem på tilstanden. */
  applyTextEdit(state: TextState, newText: string): TextState;
  /** Kommutativ og idempotent: `merge(a, b)` = `merge(b, a)`, `merge(a, a)` = `a`. */
  mergeTextStates(a: TextState, b: TextState): TextState;
  textOf(state: TextState): string;
}

/**
 * `foreign-change.ts`: feltnøklene (bare `tg`, `choice`, `number`) der verdien ble endret av en
 * annen enhet. Tom `previousRows` gir aldri varsel; uendret verdi gir ikke varsel.
 */
export type DetectForeignChanges = (
  previousRows: readonly TrialAnswerRow[],
  nextRows: readonly TrialAnswerRow[],
  deviceId: string,
) => Set<string>;

/** Det klienten skriver for ett svar. Serveren eier resten av kolonnene. */
export type TrialAnswerRowInput = Pick<
  TrialAnswerRow,
  "id" | "trialFormId" | "fieldKey" | "value" | "textState" | "deviceId"
>;

/** `answer-rows.ts`: rene funksjoner mellom rader og `TrialAnswers`. */
export interface AnswerRows {
  answerToRow(
    formId: string,
    fieldKey: string,
    value: TrialValue,
    deviceId: string,
  ): TrialAnswerRowInput;
  /** Hopper over rader med `deletedAt`. Bilder i stabil rekkefølge (`createdAt`, så `id`). */
  rowsToAnswers(
    answerRows: readonly TrialAnswerRow[],
    photoRows: readonly TrialPhotoRow[],
  ): TrialAnswers;
}

/** Svaret fra `PUT /api/prove/bilder/[id]` slik klienten ser det. `undefined` = ikke noe svar. */
export interface PhotoUploadResponse {
  status: number;
  body?: { sha256?: string };
}

/**
 * `sync/photo-upload.ts`: den lokale filen slettes bare når serveren svarte 200 og `sha256` er lik
 * fingeravtrykket regnet lokalt. Alt annet gir «behold».
 */
export type ShouldReleaseLocalPhoto = (
  localSha256: string,
  response: PhotoUploadResponse | undefined,
) => boolean;

/** `sync/device.ts`: fast id per nettleser-installasjon (uuidv7 i `localStorage`, nøkkel `trial_device_id`). */
export type GetTrialDeviceId = () => string;

/**
 * `sync/photo-uploader.ts`: `startPhotoUploader(store, organizationId)`. Kandidatuavhengig: bruker
 * bare `listPendingPhotos`, `markPhotoUploaded` og `onStatusChange`. Kjører ved `online`, ved
 * statusvarsel og hvert 10. sekund, én runde om gangen. Returnerer stopp.
 */
export type StartPhotoUploader = (store: TrialSyncStore, organizationId: string) => () => void;

// Endringskø og innfletting vi eier selv (ElectricSQL og egenbygd), i `sync/local/`. Rene filer:
// ingen `window`, React eller SDK. Signaturene her er bindende.

/** En lokal rad i snake_case, slik den ligger i den lokale lagringen (`localColumnsOf(table)` pluss `id`). */
export type LocalRow = Record<string, unknown>;

/**
 * Nøkkelen en rad kjennes igjen på lokalt: `trial_answers` på `trial_form_id:field_key`, de andre
 * på `id`. Samme nøkkel brukes i køen (koalesering), ved innfletting og i «bekreftet»-settet.
 */
export type LocalRowKey = (table: TrialTableName, row: LocalRow) => string;

/** Én operasjon i endringskøen. Samme form som `TrialChangeOperation` på serveren, pluss `seq`. */
export interface OutboxEntry {
  /** Stigende, aldri gjenbrukt. Bestemmer rekkefølgen i buntene (skjema før svar). */
  seq: number;
  op: "PUT" | "PATCH";
  table: TrialTableName;
  id: string;
  /** Kolonner i snake_case, `value` som JSON-tekst. Serverstyrte kolonner er aldri med. */
  data: LocalRow;
}

/** Køens tilstand som ren verdi. Lagres i objektlageret `outbox` (`seq` → operasjon) og `nextSeq` i kandidatens tilstandslager (`shape_state` eller `sync_state`, raden `outbox_next_seq`). */
export interface OutboxState {
  entries: readonly OutboxEntry[];
  nextSeq: number;
  /** `seq` for bunten som er sendt og venter på svar. Null når ingen bunt er underveis. */
  inFlight: readonly number[] | null;
}

/**
 * Køens tilstandsmaskin (ren):
 * - `enqueue`: ny operasjon. Finnes en operasjon med samme (tabell, id) som **ikke** er underveis,
 *   flettes `data` inn i den og dens `seq` beholdes (koalesering). Er den underveis, legges en ny
 *   operasjon til med nytt `seq`, så et svar på den gamle bunten aldri fjerner den nye endringen.
 * - `takeBatch`: de første `limit` operasjonene i `seq`-rekkefølge som ikke er underveis
 *   (`TRIAL_SYNC_LIMITS.maxOperationsPerBatch`). Gir null når køen er tom eller en bunt er underveis.
 * - `ackBatch`: **bare ved 200.** Fjerner bunten som var underveis.
 * - `keepBatch`: alt annet (4xx, 5xx, avbrutt, uten nett). Bunten blir liggende og `inFlight` nullstilles.
 *   Avviste bunter (400/409) blir liggende som i PR #8 (kjent svakhet).
 */
export interface OutboxMachine {
  enqueue(state: OutboxState, entry: Omit<OutboxEntry, "seq">): OutboxState;
  takeBatch(
    state: OutboxState,
    limit: number,
  ): { state: OutboxState; batch: readonly OutboxEntry[] } | null;
  ackBatch(state: OutboxState): OutboxState;
  keepBatch(state: OutboxState): OutboxState;
  /** Nøklene (`LocalRowKey`) som venter i køen, også de underveis. */
  pendingKeys(state: OutboxState, keyOf: LocalRowKey): Set<string>;
}

/**
 * Ventetid før neste forsøk (sending av bunt eller henting av shape): første forsøk etter 5 s,
 * dobling til 60 s. Altså høyst ett kall per 5 s. `attempt` starter på 0 etter en feil.
 */
export type RetryDelayMs = (attempt: number) => number;
export const RETRY_DELAY_MIN_MS = 5_000;
export const RETRY_DELAY_MAX_MS = 60_000;

/** Én endring fra serveren, uavhengig av hvor den kom fra (Electric-shape eller egenbygd henting). */
export interface IncomingChange {
  table: TrialTableName;
  kind: "insert" | "update" | "delete";
  /** Nøkkelen fra `LocalRowKey`. */
  key: string;
  /**
   * Kolonnene som fulgte med, i snake_case og lokal form (`value` som JSON-tekst, tidsstempler som
   * ISO-tekst). Ved `update` bare de endrede kolonnene; radene patches per kolonne, aldri hele.
   */
  row: LocalRow;
}

/**
 * Innfletting av nedlastede rader i den lokale lagringen (ren). Regler:
 * - Nøkler i `pendingKeys` (i køen, underveis, eller bekreftet men ennå ikke speilet fra serveren):
 *   ingen kolonne overskrives, unntatt at innkommende `text_state` flettes inn med `mergeTextStates`
 *   så en annen enhets ord ikke går tapt. Nøkkelen føres i `skippedKeys`. Nedlastede rader legges
 *   aldri over usendte lokale endringer.
 * - Andre nøkler: `insert` legger til, `update` patcher per kolonne, `text_state` flettes alltid
 *   (kommutativ, så rekkefølgen er likegyldig), `delete` eller `deleted_at` satt fjerner raden
 *   lokalt. Serveren beholder raden (regel 3).
 * - Returnerer alltid nye verdier, endrer aldri `localRows`.
 */
export type ApplyIncoming = (
  table: TrialTableName,
  localRows: readonly LocalRow[],
  changes: readonly IncomingChange[],
  pendingKeys: ReadonlySet<string>,
) => { rows: LocalRow[]; skippedKeys: string[] };
