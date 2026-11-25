import type { PdfPageAnchor, PdfPageMapEntry, RenderedPage } from "@/core/pdf";

/*
 * Kontrakten mellom ruten `GET /oppdrag/[id]/forhandsvisning` og ruten på badskjermen
 * (docs/funksjoner/fase2a-levende-forhandsvisning.md Omfang 8–10, tillegget til ADR 0016,
 * A603–A612). Bare typer og faste koder: filen har ingen importer av verdier, så den kan lastes
 * i nettleseren. Klienten importerer aldri verdier fra `@/core/pdf` (inngangen er `server-only`).
 *
 * Støtter hovedmål: de ansatte (siden vises mens det skrives), færre reklamasjoner (feil i den
 * ferdige siden ses før sending) og KI i bunnen (ventende forslag vises ved avsnittet; ingen KI i
 * gjengivelsen).
 *
 * Svaret lagres aldri, verken på serveren eller i nettleseren: sidene har adresse og matrikkel
 * fra forsiden. Svarhoder: `Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff`,
 * `Cross-Origin-Resource-Policy: same-origin`. Sidene sendes bare inni JSON, aldri fra en adresse
 * med `image/svg+xml`.
 */

/** Adressen til ruten. Id-en er oppdragets; rapporten finner serveren selv med `grant.organizationId`. */
export const livePreviewPath = (assignmentId: string): string =>
  `/oppdrag/${encodeURIComponent(assignmentId)}/forhandsvisning`;

/**
 * Et ventende KI-forslag til margen (A607). Samme liste som publiseringssjekken
 * (`pendingAiSuggestions` i `@/core/reports`). Aldri forslagsteksten.
 */
export type LivePreviewAiSuggestion = {
  aiUsageId: string;
  /**
   * Avsnittet merkelappen festes til. Mangler feltet et eget avsnitt i siden, er dette punktets
   * anker (`kind: "checkpoint"`), så ingen forslag blir usynlige.
   */
  anchor: PdfPageAnchor;
  /** Den faste funksjonskoden (`AiFeatureCode`), til `aria-label`. */
  featureCode: string;
  /** Den faste feltkoden (`AiTargetRef.fieldKey`), til `aria-label` og til å finne feltet. */
  fieldKey: string;
};

/** 200. */
export type LivePreviewResponse = {
  /** Profilen sidene er laget med (fast kode). */
  profileCode: string;
  /** Sidene i rekkefølge. Klienten bytter bare sidene der `hash` er endret. */
  pages: RenderedPage[];
  pageMap: PdfPageMapEntry[];
  aiSuggestions: LivePreviewAiSuggestion[];
};

/** De faste feilkodene i JSON-svarene (A612). En kode endres aldri (regel 6). */
export const LIVE_PREVIEW_ERROR_CODES = [
  "not_signed_in",
  "not_found",
  "too_large",
  "busy",
  "failed",
] as const;
export type LivePreviewErrorCode = (typeof LIVE_PREVIEW_ERROR_CODES)[number];

/** HTTP-status per feilkode. 401 er aldri en videresending (303) her. */
export const LIVE_PREVIEW_ERROR_STATUS = {
  not_signed_in: 401,
  not_found: 404,
  too_large: 413,
  busy: 429,
  failed: 500,
} as const satisfies Record<LivePreviewErrorCode, number>;

/**
 * Feilsvaret. `message` er fast norsk tekst per kode, uten verdier fra adressen, rapporten eller
 * feilen. 429 har også hodet `Retry-After` (sekunder).
 */
export type LivePreviewErrorResponse = { error: { code: LivePreviewErrorCode; message: string } };

/*
 * Rekkefølgen i ruten (A606, A612). Hvert steg som feiler, svarer og frigir det som er tatt:
 *
 * 1. innlogging (`getCurrentActor`), ellers 401;
 * 2. ansatt (`findEmployeeGrant`), ellers 404;
 * 3. forhåndsvisningens tak (`PDF_PREVIEW_MAX_CONCURRENT`, nøkkel `preview:<employeeId>`), ellers 429;
 * 4. tilgang og data (`getReportDraftPdfData` med `grant.organizationId`) og ventende KI-forslag
 *    (gjennom `@/core/reports`), ellers 404;
 * 5. det felles taket (`pdfLimiter`), ellers 429;
 * 6. gjengivelsen (`renderReportPages`), `too_many_pages` og `pages_too_large` gir 413, ellers 500.
 *
 * Ingen hendelse skrives her; `report.live_preview_opened` skrives av serverhandlingen når
 * bryteren slås på (A608). Loggen per gjengivelse har bare antall sider og millisekunder.
 */

// --- Køen i nettleseren (A605) -------------------------------------------------------------------

/** Ventetiden etter «lagret» før sidene hentes på nytt. Flere lagringer gir én henting. */
export const LIVE_PREVIEW_DEBOUNCE_MS = 150;
/** Høyst så mange nye forsøk ved 429 og 500, med økende opphold (minst `Retry-After`). */
export const LIVE_PREVIEW_MAX_RETRIES = 3;
/** Kravet i e2e: medianen fra «lagret» til nytt bilde er dekodet, over 10 lagringer. */
export const LIVE_PREVIEW_MAX_MEDIAN_MS = 1000;

/** Den ene faste nøkkelen i `localStorage` (A609). Uten oppdrags-, rapport- eller ansatt-id. */
export const LIVE_PREVIEW_STORAGE_KEY = "live-preview.v1";
/** Det eneste som lagres i nettleseren. Aldri sider, sidekart eller id-er. */
export type LivePreviewStoredState = { on: boolean; paneWidthPx: number };

/** Bryteren vises bare når dette stemmer (A609). iPad Pro på tvers (1194 px, berøring) får den ikke. */
export const LIVE_PREVIEW_MEDIA_QUERY = "(min-width: 1280px) and (pointer: fine)";
/** Skjemaet har alltid minst så mange piksler når ruten er på. */
export const LIVE_PREVIEW_MIN_FORM_WIDTH_PX = 600;

export type LivePreviewStatus =
  "loading" | "ready" | "updating" | "stale" | "offline" | "error" | "not_found";

/**
 * Køen som henter sidene (ren logikk uten React, egen enhetstest): én henting om gangen,
 * endringer under en henting slås sammen til én ny etterpå, svar i feil rekkefølge forkastes, og
 * forsøkene stopper når ruten slås av, fanen er skjult eller nettet er borte.
 */
export type LivePreviewQueue = {
  /** Et felt er lagret (`saved` fra lagringskøen). Starter ventetiden på nytt. */
  requestRefresh(): void;
  /** «Prøv igjen». */
  retryNow(): void;
  /** Ruten slås av eller komponenten fjernes. Avbryter hentingen og tømmer sidene fra minnet. */
  stop(): void;
};

export type LivePreviewQueueOptions = {
  fetchPages: (signal: AbortSignal) => Promise<LivePreviewFetchResult>;
  onPages: (response: LivePreviewResponse) => void;
  onStatus: (status: LivePreviewStatus) => void;
  /** Klokken og ventingen settes inn, så køen kan prøves uten ekte tid. */
  setTimer: (callback: () => void, ms: number) => () => void;
  isOnline: () => boolean;
  isVisible: () => boolean;
};

export type LivePreviewFetchResult =
  | { ok: true; response: LivePreviewResponse }
  | { ok: false; code: LivePreviewErrorCode; retryAfterMs: number | null };

export type CreateLivePreviewQueue = (options: LivePreviewQueueOptions) => LivePreviewQueue;
