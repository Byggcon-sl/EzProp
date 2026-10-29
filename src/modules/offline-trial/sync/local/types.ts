/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Den lokale kjernen (docs/funksjoner/fase1-kandidat-egenbygd.md, forarbeid pkt. 1): det vi eier
 * selv uansett kandidat når synkverktøyet bare gir lesing. Kjernen har lokal lagring i IndexedDB,
 * skriving, endringskø, sending og innfletting. En kandidat legger bare til en leser
 * (`LocalTrialReader`): ElectricSQL leser shapes, egenbygd leser hente-ruten.
 *
 * Bare typer og signaturer. Implementasjonen ligger i `idb.ts` og `trial-store.ts`.
 */
import type { TrialTableName } from "../local-columns";
import type { IncomingChange, OutboxEntry, TrialSyncStore, TrialSyncTestable } from "../types";

/** Bunten slik den sendes til `POST /api/prove/synk/endringer` (uten `seq`). */
export type OutboxBatchBody = (
  organizationId: string,
  batch: readonly OutboxEntry[],
) => { organizationId: string; operations: Omit<OutboxEntry, "seq">[] };

// --- Lokal database (`idb.ts`) ---

/** Lagrene for de synkede radene. Like for alle kandidater som bruker kjernen. */
export const LOCAL_SYNCED_STORES = {
  /** Nøkkel `id`. */
  trial_forms: "synced_trial_forms",
  /** Nøkkel `id`, indeks `form_field` på `[trial_form_id, field_key]` (unik). */
  trial_answers: "synced_trial_answers",
  /** Nøkkel `id`, indeks `trial_form_id`. */
  trial_photos: "synced_trial_photos",
} as const satisfies Record<TrialTableName, string>;

/** Endringskøen, nøkkel `seq`. */
export const LOCAL_OUTBOX_STORE = "outbox";

/**
 * Raden i tilstandslageret der neste `seq` for køen ligger: `{ [keyPath]: OUTBOX_META_KEY, nextSeq }`.
 * Ingen tabell og ingen markør heter dette.
 */
export const OUTBOX_META_KEY = "outbox_next_seq";

/**
 * Oppsett for én lokal database. Electric: `{ name: "offline-trial-electric", version: 1,
 * stateStore: { name: "shape_state", keyPath: "table" } }` (samme som før, ingen data flyttes).
 * Egenbygd: `{ name: "offline-trial-custom", version: 1, stateStore: { name: "sync_state",
 * keyPath: "key" } }`.
 */
export interface LocalDbOptions {
  name: string;
  /** Økes når et lager legges til eller endres. */
  version: number;
  /** Kandidatens tilstandslager (synkposisjon og `OUTBOX_META_KEY`). */
  stateStore: { name: string; keyPath: string };
}

/** Navnene på lagrene i en lokal database. */
export type LocalStoreName =
  (typeof LOCAL_SYNCED_STORES)[TrialTableName] | typeof LOCAL_OUTBOX_STORE | (string & {});

/**
 * Én lokal database. Forbindelsen åpnes én gang per instans (ikke per side), så to databaser
 * aldri ser hverandre. Ingen av metodene vet noe om synk.
 */
export interface LocalDb {
  readonly options: LocalDbOptions;
  open(): Promise<IDBDatabase>;
  /** Lukker forbindelsen. Sletter ingenting. */
  close(): Promise<void>;
  /** Lukker og sletter hele databasen (organisasjonsbytte). Bildene tømmes av `photo-store.ts`. */
  clear(): Promise<void>;
  /**
   * Kjører `body` i én transaksjon og venter til den er lagret. Inne i `body` ventes det bare på
   * forespørsler i samme transaksjon. Kaster `body`, avbrytes transaksjonen og ingenting lagres.
   */
  inTransaction<T>(
    stores: readonly LocalStoreName[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T>;
  /** Alle verdier i et lager (prøvens datamengder er små). */
  readAll<T>(storeName: LocalStoreName): Promise<T[]>;
  /** Lagernavnet for de synkede radene i en tabell. */
  syncedStoreOf(table: TrialTableName): LocalStoreName;
}

export type CreateLocalDb = (options: LocalDbOptions) => LocalDb;

// --- Kjernen og leseren (`trial-store.ts`) ---

/**
 * Det kjernen gir leseren. Leseren skriver aldri selv i lagringen; alt går gjennom `mergeIncoming`,
 * `resetTable` og `deleteState`, som går i samme rekke som skrivingene (`serial`).
 */
export interface LocalReadContext {
  organizationId: string;
  /** Radene i tilstandslageret slik de lå ved åpning, uten `OUTBOX_META_KEY`. */
  storedState: readonly Record<string, unknown>[];
  isClosed(): boolean;
  isOnline(): boolean;
  /**
   * Fletter endringer for én tabell inn med `applyIncoming`. Køen og «bekreftet»-settet beskytter
   * usendte lokale endringer. `stateRow` (synkposisjonen) skrives i samme transaksjon, etter
   * radene, aldri før. Tom `changes` og `stateRow = null` gjør ingenting.
   */
  mergeIncoming(
    table: TrialTableName,
    changes: readonly IncomingChange[],
    stateRow: Record<string, unknown> | null,
  ): Promise<void>;
  /**
   * Alt for tabellen hentes på nytt: raden `stateKey` i tilstandslageret og de synkede radene uten
   * usendte endringer slettes. Køen røres aldri.
   */
  resetTable(table: TrialTableName, stateKey: string): Promise<void>;
  /** Sletter én rad i tilstandslageret (f.eks. en ugyldig markør). Synkede rader og køen røres ikke. */
  deleteState(key: string): Promise<void>;
  /**
   * Varsler `onStatusChange`-lytterne (etter hver vellykkede henting). Kjernen leser
   * `reader.serverConfirmed()` her, så leseren oppdaterer den før kallet.
   */
  notifyStatus(): void;
  /** Kalles etter hver bunt serveren har svart 200 på. */
  afterAck(listener: () => void): void;
}

/** Kandidatens leser. Startes én gang av kjernen når lageret er åpnet. */
export interface LocalTrialReader {
  start(ctx: LocalReadContext): void;
  /** Nettet kom tilbake: hent med en gang (ventetiden nullstilles). */
  wake(): void;
  /**
   * «Synk nå» (docs/funksjoner/fase1-synkstatus.md): hent én runde med en gang og hopp over
   * ventetiden. Løses når en henting som startet etter kallet, har fått 200 og er ferdig hentet.
   * Avvises ved feil, uten nett og når leseren stoppes. Kjernen setter tidsavbruddet
   * (`runSyncNow`).
   */
  syncNow(): Promise<void>;
  /**
   * Siste henting fikk 200 og var ferdig, og ingenting har feilet etter den. `false` før første
   * henting, ved feil og når leseren ser at nettet er borte. Bygger bare på svar fra serveren.
   */
  serverConfirmed(): boolean;
  /** Lageret lukkes: avbryt kall som pågår og ikke start nye. */
  stop(): void;
}

export interface LocalTrialStoreOptions {
  db: LocalDb;
  deviceId: string;
  organizationId: string;
  reader: LocalTrialReader;
}

/**
 * `TrialSyncStore` og `TrialSyncTestable` for en kandidat som bruker kjernen. `readRows` tar i
 * tillegg tilstandslagerets navn (uten `OUTBOX_META_KEY`) og `"outbox"`.
 */
export type LocalTrialStore = TrialSyncStore &
  TrialSyncTestable & {
    readRows(
      table: TrialTableName | "outbox" | (string & {}),
      formId?: string,
    ): Promise<Record<string, unknown>[]>;
  };

export type CreateLocalTrialStore = (options: LocalTrialStoreOptions) => Promise<LocalTrialStore>;
