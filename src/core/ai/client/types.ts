import type { AiFeatureCode } from "../types";

/*
 * Grensesnittet for KI-køen uten nett (docs/adr/0006-ki-i-bunnen.md del 10,
 * docs/funksjoner/fase2a-ki-ko.md). Køen ligger bare på enheten. Den sender aldri noe selv:
 * siden gir inn `send`, som går til serveren og videre gjennom `requestSuggestion`.
 *
 * Mappen er et rent blad: verdi-importer bare fra egen mappe, `../limits`, `@/shared` og `zod`.
 * Fra `../types` og `../features` er bare `import type` lov. Håndheves av lint-regelen
 * `ezprop/module-boundaries`. Måltypen for prøvesiden står ikke her; den gis inn fra siden.
 *
 * Støtter hovedmål: KI i bunnen (KI virker likt med og uten nett) og de ansatte (ett trykk uten
 * dekning, og ingen ser en annens tekst på en delt iPad).
 */

/** Egen IndexedDB-database for køen (A186). Flyttes inn i den ekte lokale databasen i fase 2b. */
export const AI_QUEUE_DB_NAME = "local-ai-queue";
export const AI_QUEUE_DB_VERSION = 1;
/** Lageret i databasen. Nøkkel er `requestId`, ingen indeks (A187). */
export const AI_QUEUE_STORE_NAME = "ai_queue";

/** Høyeste antall poster i køen (A187). Erstatning på samme mål og felt teller ikke som ny. */
export const AI_QUEUE_MAX_ENTRIES = 50;
/** Poster eldre enn dette slettes ved lesing (A189). */
export const AI_QUEUE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tidsavbrudd for ett kall til `send`. Gir «prøv senere». */
export const AI_QUEUE_SEND_TIMEOUT_MS = 30_000;
/** Antall forsøk ved ukjent serverfeil før posten fjernes med fast melding. */
export const AI_QUEUE_MAX_ATTEMPTS = 3;

/** Den innloggede, fra `grant` på serveren. Brukes bare til lokal tømming, sendes aldri (A190). */
export type AiQueueOwner = {
  organizationId: string;
  employeeId: string;
};

/** Målet forslaget gjelder. `assignmentId` er `null` på prøvesiden. */
export type AiQueueTarget = {
  targetType: string;
  targetId: string;
  fieldKey: string;
  assignmentId: string | null;
};

/**
 * Én post i køen. Én post per mål og felt (`targetType`, `targetId`, `fieldKey`).
 * `organizationId`, `employeeId`, `queuedAt` og `attempts` blir på enheten: de sendes aldri og
 * logges aldri (ventetid per person er tidsmåling).
 */
export type AiQueueEntry = AiQueueTarget &
  AiQueueOwner & {
    /**
     * Tilfeldig UUID v4 fra `crypto.randomUUID()`, ikke v7 (A191). Blir id-en i `ai_usage_log`.
     * Ny id hver gang en post erstattes.
     */
    requestId: string;
    feature: AiFeatureCode;
    /** Feltkode → verdi. Bare koder fra `AI_QUEUE_ALLOWED_FIELDS`, høyst `AI_FIELD_MAX_LENGTH` tegn. */
    fields: Record<string, string>;
    /** Enhetens klokke da posten ble lagt i kø, millisekunder siden 1970. */
    queuedAt: number;
    /** Antall forsøk som endte med ukjent serverfeil. Starter på 0. */
    attempts: number;
  };

/** Det `send` får: posten uten eier, tid og forsøk. Typen hindrer at de sendes. */
export type AiQueueSendPayload = Omit<
  AiQueueEntry,
  "organizationId" | "employeeId" | "queuedAt" | "attempts"
>;

/* ---------- Lageret ---------- */

/** Endringen `decide` vil ha gjort, og verdien `update` skal gi tilbake. */
export type AiQueueStoreChange<T> = {
  put: readonly AiQueueEntry[];
  /** `requestId` på poster som skal slettes. */
  remove: readonly string[];
  result: T;
};

/**
 * Lageret køen ligger i. To utgaver: IndexedDB (`queue-store.ts`) og minne (enhetstester).
 * `queue.ts` kjenner bare dette grensesnittet; i fase 2b byttes bare utgaven.
 *
 * Lageret validerer ikke. Det gir tilbake det som ligger der som `unknown`, og `queue.ts`
 * kjører Zod-skjemaet og eiersjekken.
 */
export interface AiQueueStore {
  /**
   * Leser alle poster, kaller `decide` og skriver endringen, alt i én transaksjon. `decide` er
   * synkron og ren, slik at IndexedDB-transaksjonen ikke lukkes underveis. Slik blir «finn,
   * erstatt og tell» én operasjon, og to like poster kan ikke oppstå.
   * Kaster `AiQueueUnavailableError` når lageret mangler eller feiler.
   */
  update<T>(decide: (stored: readonly unknown[]) => AiQueueStoreChange<T>): Promise<T>;
  /** Sletter alle poster, uansett eier. Brukes ved utlogging. */
  clear(): Promise<void>;
}

/**
 * Lageret mangler eller feilet. Bærer bare navnet på den opprinnelige feilen, aldri melding eller
 * verdier (feil fra IndexedDB kan inneholde tekst fra posten).
 */
export type AiQueueUnavailableErrorShape = Error & {
  name: "AiQueueUnavailableError";
  causeName: string;
};

/* ---------- Køen ---------- */

export type AiQueueEnqueueInput = AiQueueTarget & {
  feature: AiFeatureCode;
  fields: Record<string, string>;
};

/** Faste koder for avslag. Siden viser en fast norsk melding per kode, aldri teksten fra en feil. */
export type AiQueueRejectReason =
  /** Køen har `AI_QUEUE_MAX_ENTRIES` poster, og dette er ikke en erstatning. */
  | "full"
  /** En verdi er lengre enn `AI_FIELD_MAX_LENGTH`. */
  | "too_long"
  /** Ukjent funksjon, feltkode utenfor tillatt-listen eller ugyldig id. */
  | "invalid"
  /** IndexedDB mangler eller feilet. */
  | "unavailable";

export type AiQueueEnqueueResult =
  | {
      kind: "queued";
      entry: AiQueueEntry;
      /** `requestId` på posten som ble erstattet på samme mål og felt, ellers `null`. */
      replacedRequestId: string | null;
    }
  | { kind: "rejected"; reason: AiQueueRejectReason };

export type AiQueueListResult =
  /** Sortert på `queuedAt`, deretter `requestId`. Bare den innloggedes egne, gyldige poster. */
  { kind: "listed"; entries: AiQueueEntry[] } | { kind: "unavailable" };

/* ---------- Sending ---------- */

/** Faste koder på avslag fra serverhandlingen. Klienten tolker aldri norsk tekst. */
export type AiQueueFailureReason = "invalid" | "no_access" | "unknown";

/**
 * Det minste køen må vite om svaret fra `send`. Svaret fra serverhandlingen på siden har flere
 * felt (forslagsteksten, `usageId`); de går uendret tilbake til siden gjennom `onEvent`.
 * `blocked` vises av serverhandlingen som `disabled`.
 */
export type AiQueueSendResult =
  | { kind: "suggestion" | "no_match" | "error" | "disabled" }
  | { kind: "failed"; reason: AiQueueFailureReason };

/** Gis inn fra siden, så kjernen ikke importerer app eller moduler. `signal` avbrytes ved tidsavbrudd. */
export type AiQueueSend<R extends AiQueueSendResult> = (
  payload: AiQueueSendPayload,
  signal: AbortSignal,
) => Promise<R>;

/** Hvordan ett kall til `send` endte, før det er klassifisert. */
export type AiQueueSendAttempt<R extends AiQueueSendResult> =
  | { kind: "answered"; result: R }
  /** `send` kastet. Bare `error instanceof TypeError` og `error.name` leses, aldri meldingen. */
  | { kind: "threw"; error: unknown }
  | { kind: "timed_out" };

/**
 * De tre grenene:
 * - `retry_later`: nettfeil (`online` er false, eller `TypeError`) eller tidsavbrudd. Posten blir
 *   liggende og runden stopper.
 * - `done`: alle kjente svar, og `failed` med `invalid` eller `no_access`. Posten fjernes og
 *   runden går videre.
 * - `server_error`: unntak mens nettet er oppe, eller `failed` med `unknown`. `attempts` økes og
 *   runden går videre; etter `AI_QUEUE_MAX_ATTEMPTS` fjernes posten.
 */
export type AiQueueOutcome = "retry_later" | "done" | "server_error";

/** Ren funksjon. `online` gis inn; funksjonen leser ikke `navigator.onLine`. */
export type ClassifyQueueOutcome = <R extends AiQueueSendResult>(
  attempt: AiQueueSendAttempt<R>,
  online: boolean,
) => AiQueueOutcome;

/**
 * Det siden får vite om hver post som er ferdig. `entry` er posten slik den ble sendt, så siden
 * kan sammenligne teksten med feltet og vise forslag på eldre tekst uten «Bruk» (A188).
 */
export type AiQueueEvent<R extends AiQueueSendResult> =
  | { kind: "answered"; entry: AiQueueEntry; result: R }
  /** Fjernet etter `AI_QUEUE_MAX_ATTEMPTS` forsøk. Siden viser den faste meldingen. */
  | { kind: "gave_up"; entry: AiQueueEntry };

export type AiQueueRunResult =
  /** `remaining` er antall poster som fortsatt ligger i køen. */
  | { kind: "completed"; remaining: number }
  | { kind: "stopped"; reason: "offline" | "cleared" | "unavailable"; remaining: number }
  /** En annen behandling går allerede i denne fanen. Ingenting ble sendt. */
  | { kind: "already_running" };

export type AiQueueDeps = {
  store: AiQueueStore;
  /** Den innloggede slik siden fikk den ved lasting. Poster med annen eier slettes ved lesing. */
  owner: AiQueueOwner;
  /** Standard `Date.now`. Gis inn i tester. */
  now?: () => number;
  /** Standard `crypto.randomUUID` (v4). Gis inn i tester. */
  newRequestId?: () => string;
  /** Standard `() => navigator.onLine`. Gis inn i tester. */
  isOnline?: () => boolean;
  /** Standard `AI_QUEUE_SEND_TIMEOUT_MS`. */
  sendTimeoutMs?: number;
};

export interface AiQueue {
  /**
   * Legger en forespørsel i køen. Finnes en post på samme mål og felt, erstattes den i samme
   * transaksjon, og den nye får ny `requestId`.
   */
  enqueue(input: AiQueueEnqueueInput): Promise<AiQueueEnqueueResult>;
  /**
   * Leser køen. Poster med feil form, annen eier eller eldre enn `AI_QUEUE_MAX_AGE_MS` slettes
   * fra lageret i samme transaksjon og gis aldri tilbake.
   */
  list(): Promise<AiQueueListResult>;
  /** Fjerner på `requestId`, aldri på mål, så en nyere post på samme felt ikke slettes. */
  remove(requestId: string): Promise<void>;
  /**
   * Sender postene én om gangen, i køens rekkefølge. Én behandling av gangen per fane. Én
   * dårlig post stopper aldri resten. Etter `clearAiQueue` verken kalles `onEvent` eller
   * skrives noe tilbake til lageret.
   */
  processQueue<R extends AiQueueSendResult>(
    send: AiQueueSend<R>,
    onEvent: (event: AiQueueEvent<R>) => void,
  ): Promise<AiQueueRunResult>;
}

/** Signaturen `queue.ts` skal eksportere som `createAiQueue`. */
export type CreateAiQueue = (deps: AiQueueDeps) => AiQueue;

/**
 * Signaturen `queue.ts` skal eksportere som `clearAiQueue`. Tømmer hele lageret uansett eier og
 * stopper en behandling som pågår i fanen (teller i minnet). Kaster aldri: feil ved tømming skal
 * ikke stoppe utloggingen. Uten argument brukes IndexedDB-utgaven.
 */
export type ClearAiQueue = (store?: AiQueueStore) => Promise<{ cleared: boolean }>;

/** Signaturen `queue-store.ts` skal eksportere som `createIndexedDbAiQueueStore`. */
export type CreateIndexedDbAiQueueStore = () => AiQueueStore;

/** Signaturen `memory-store.ts` skal eksportere som `createMemoryAiQueueStore`. */
export type CreateMemoryAiQueueStore = (initial?: readonly unknown[]) => AiQueueStore;
