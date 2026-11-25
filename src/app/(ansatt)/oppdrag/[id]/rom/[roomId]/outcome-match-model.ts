import type { FindOutcomesResult, OutcomeMatchHit } from "@/core/reports/types";
import { OUTCOME_MATCH_NOTE_MAX } from "@/shared/config/ai-targets";
import { containsNationalId } from "@/shared/validation/free-text";
import { OUTCOME_MATCH_TEXTS } from "./room-messages";

/*
 * «Skriv det du ser» i «+ Avvik» (docs/funksjoner/fase2a-skriv-det-du-ser-skisse.md avsnitt 3 og
 * 8). Rene funksjoner uten React: hva søket med KI har svart (`outcomeMatchReducer`), og hva
 * skjermen viser ut fra det, nettet og notatet (`outcomeMatchView`). Ingen tilgangslogikk: serveren
 * sjekker hvert kall. Testet i room-model.test.ts (S6.1–S6.6).
 *
 * Hovedmål: KI i bunnen (KI foreslår, takstmannen velger, ingen forhåndsvalg), best for de ansatte
 * (samme hjelp uten nett, ingenting flytter seg under fingeren) og færre reklamasjoner.
 */

/** Tegntelleren under feltet vises først over denne lengden (skisse avsnitt 3). */
export const OUTCOME_NOTE_COUNTER_FROM = 400;
/** Uten svar etter så lang tid: «KI svarte ikke. Bruk søket.» (kortet, «Skjermer»). */
export const OUTCOME_MATCH_TIMEOUT_MS = 8_000;
/** Tekstsøkets treff tar ikke imot trykk så lenge etter at KI-treffene er satt inn (skisse 2). */
export const OUTCOME_MATCH_SETTLE_MS = 300;
/** Ro etter siste tastetrykk før «Nærmeste treff (uten KI)» regnes (skisse avsnitt 8). */
export const OUTCOME_NEAREST_DELAY_MS = 250;

/** Det siste søket med KI i panelet. `note` er teksten søket ble gjort med. */
export type OutcomeMatchState =
  | { kind: "idle" }
  | { kind: "pending"; requestId: string; note: string }
  | { kind: "ranked"; requestId: string; note: string; usageId: string; hits: OutcomeMatchHit[] }
  | { kind: "no_match"; note: string }
  /** Kallet feilet eller svarte ikke i tide. «Prøv igjen» bruker samme `requestId`. */
  | { kind: "error"; requestId: string; note: string }
  /** Valget svarte `suggestion_outdated`: et nyere søk på rapporten har avvist dette (A555). */
  | { kind: "outdated" };

export const OUTCOME_MATCH_IDLE: OutcomeMatchState = { kind: "idle" };

export type OutcomeMatchEvent =
  | { type: "requested"; requestId: string; note: string }
  /** Svaret fra serveren. Nettfeil og andre feil kommer som `null`. */
  | { type: "responded"; requestId: string; result: FindOutcomesResult | null }
  | { type: "timed_out"; requestId: string }
  | { type: "outdated" }
  | { type: "cleared" };

/** Det svaret gjør med resten av rommet: KI av og for mange utfall gjelder til rommet forlates. */
export type OutcomeMatchSideEffect = "ai_off" | "too_many_candidates" | "note_too_long" | null;

/** Hva et svar betyr for rommet utenfor panelet (se `OutcomeMatchSideEffect`). */
export function outcomeMatchSideEffect(result: FindOutcomesResult | null): OutcomeMatchSideEffect {
  if (!result) return null;
  if (result.status === "ai_off") return "ai_off";
  if (result.status === "too_many_candidates") return "too_many_candidates";
  if (result.status === "note_too_long") return "note_too_long";
  return null;
}

/**
 * Neste tilstand. **Bare siste svar vises:** et svar eller et tidsavbrudd for en annen
 * `requestId` enn søket som venter, gjør ingenting (overlappende søk, A555). Svar uten treff som
 * gjelder hele rommet (`ai_off`, `too_many_candidates`, `note_too_long`), gir tilbake `idle`;
 * rommet viser meldingen (`outcomeMatchSideEffect`).
 */
export function outcomeMatchReducer(
  state: OutcomeMatchState,
  event: OutcomeMatchEvent,
): OutcomeMatchState {
  switch (event.type) {
    case "requested":
      return { kind: "pending", requestId: event.requestId, note: event.note };
    case "cleared":
      return OUTCOME_MATCH_IDLE;
    case "outdated":
      return { kind: "outdated" };
    case "timed_out":
      if (state.kind !== "pending" || state.requestId !== event.requestId) return state;
      return { kind: "error", requestId: state.requestId, note: state.note };
    case "responded": {
      if (state.kind !== "pending" || state.requestId !== event.requestId) return state;
      const result = event.result;
      if (!result || result.status === "ai_error") {
        return { kind: "error", requestId: state.requestId, note: state.note };
      }
      switch (result.status) {
        case "ranked":
          return result.hits.length === 0
            ? { kind: "no_match", note: state.note }
            : {
                kind: "ranked",
                requestId: state.requestId,
                note: state.note,
                usageId: result.usageId,
                hits: result.hits,
              };
        case "no_match":
          return { kind: "no_match", note: state.note };
        case "ai_off":
        case "too_many_candidates":
        case "note_too_long":
          return OUTCOME_MATCH_IDLE;
      }
    }
  }
}

/**
 * `requestId` for neste «Finn med KI»: samme id ved «Prøv igjen» med samme tekst (ingen dobbel rad
 * i loggen), ellers en ny.
 */
export function nextOutcomeRequestId(
  state: OutcomeMatchState,
  note: string,
  newId: () => string,
): string {
  if (state.kind === "error" && state.note === note.trim()) return state.requestId;
  return newId();
}

/** Den åpne rangerte listen som skal avvises når panelet lukkes eller noe annet velges. */
export function openOutcomeMatchUsageId(state: OutcomeMatchState): string | null {
  return state.kind === "ranked" ? state.usageId : null;
}

export type OutcomeMatchViewInput = {
  state: OutcomeMatchState;
  /** Teksten i feltet nå. */
  note: string;
  online: boolean;
  /** Serveren har svart `ai_off` i dette rommet. */
  aiOff: boolean;
  /** Serveren har svart `too_many_candidates` i dette rommet. */
  tooManyCandidates: boolean;
  /** Antall treff i tekstsøket for teksten nå. */
  textHitCount: number;
  /** Et valg lagres (alle treffknapper og «Finn på nytt» er sperret). */
  choosing: boolean;
};

export type OutcomeMatchButton = {
  label: string;
  disabled: boolean;
  busy: boolean;
};

export type OutcomeMatchMessage = {
  text: string;
  /** `neutral` i gruppen, `watch` for varsel, `plain` for en linje uten flate. */
  tone: "neutral" | "watch" | "plain";
};

export type OutcomeMatchView = {
  /** Tilstanden i skissen (3.1–3.13), for testene og `data-state`. */
  state:
    | "empty"
    | "ready"
    | "pending"
    | "ranked"
    | "stale"
    | "no_match"
    | "error"
    | "ai_off"
    | "offline"
    | "note_too_long"
    | "too_many_candidates"
    | "national_id"
    | "outdated";
  /** «Finn med KI» og variantene, eller `null` når knappen er skjult. */
  button: OutcomeMatchButton | null;
  /** Linjen i `aria-live` (én linje, ikke én per melding). */
  message: OutcomeMatchMessage | null;
  /** Feilen under feltet (for langt notat, fødselsnummer). Gjengir aldri notatet. */
  fieldError: string | null;
  /** «412 av 500 tegn» over 400 tegn, ellers `null`. */
  counter: { text: string; over: boolean } | null;
  /** KI-treffene som vises, i rekkefølgen KI ga. Ingen er valgt. */
  hits: OutcomeMatchHit[];
  /** Teksten er endret etter svaret: treffene vises grå. */
  hitsStale: boolean;
  /** «Nærmeste treff (uten KI)» (skisse avsnitt 8). */
  showNearest: boolean;
  /** Enter i feltet kjører «Finn med KI». */
  enterRunsAi: boolean;
  /** «Legg notatet til» og «Bruk bare notatet» er sperret (fødselsnummer, A567). */
  noteActionsBlocked: boolean;
};

/** Notatet slik det sendes og sammenlignes: trimmet. */
export function normalizeOutcomeNote(note: string): string {
  return note.trim();
}

/** Om notatet har et fødselsnummer (samme sjekk som serveren, A567). */
export function noteHasNationalId(note: string): boolean {
  return containsNationalId(note);
}

/**
 * Hva panelet viser (skisse avsnitt 3). Rekkefølgen: uten nett, KI av, for mange utfall, tomt felt,
 * fødselsnummer, for langt notat, så svaret på siste søk.
 */
export function outcomeMatchView(input: OutcomeMatchViewInput): OutcomeMatchView {
  const T = OUTCOME_MATCH_TEXTS;
  const note = normalizeOutcomeNote(input.note);
  const empty = note === "";
  const length = [...input.note].length;
  const tooLong = length > OUTCOME_MATCH_NOTE_MAX;
  const nationalId = !empty && noteHasNationalId(input.note);
  const unavailable = !input.online || input.aiOff || input.tooManyCandidates;
  const counter =
    length > OUTCOME_NOTE_COUNTER_FROM
      ? { text: T.noteCount(length, OUTCOME_MATCH_NOTE_MAX), over: tooLong }
      : null;
  const fieldError = nationalId ? T.nationalId : tooLong ? T.noteTooLong : null;

  const ranked = input.state.kind === "ranked" ? input.state : null;
  const hits = ranked && !unavailable ? ranked.hits : [];
  const hitsStale = ranked !== null && hits.length > 0 && ranked.note !== note;

  const base = {
    fieldError,
    counter,
    hits,
    hitsStale,
    showNearest: unavailable && !empty && input.textHitCount === 0,
    noteActionsBlocked: nationalId,
  };
  const button = (label: string, disabled = false, busy = false): OutcomeMatchButton => ({
    label,
    disabled: disabled || input.choosing,
    busy,
  });
  const result = (
    state: OutcomeMatchView["state"],
    shown: OutcomeMatchButton | null,
    message: OutcomeMatchMessage | null,
  ): OutcomeMatchView => ({
    ...base,
    state,
    button: shown,
    message,
    enterRunsAi:
      shown !== null &&
      !shown.disabled &&
      input.online &&
      !input.aiOff &&
      input.textHitCount === 0 &&
      !empty,
  });

  if (!input.online) return result("offline", null, { text: T.offline, tone: "plain" });
  if (input.aiOff) return result("ai_off", null, { text: T.aiOff, tone: "plain" });
  if (input.tooManyCandidates) {
    return result("too_many_candidates", null, { text: T.tooManyCandidates, tone: "plain" });
  }
  if (empty) return result("empty", button(T.find, true), null);
  if (nationalId) return result("national_id", button(T.find, true), null);
  if (tooLong) return result("note_too_long", button(T.find, true), null);

  const state = input.state;
  switch (state.kind) {
    case "pending":
      return result("pending", button(T.finding, true, true), null);
    case "ranked":
      return hitsStale
        ? result("stale", button(T.findAgain), { text: T.stale, tone: "neutral" })
        : result("ranked", button(T.findAgain), {
            text: T.ranked(state.hits.length),
            tone: "neutral",
          });
    case "no_match":
      return result("no_match", button(T.findAgain), { text: T.noMatch, tone: "neutral" });
    case "error":
      return result(
        "error",
        button(state.note === note ? T.retry : T.find),
        state.note === note ? { text: T.aiError, tone: "watch" } : null,
      );
    case "outdated":
      return result("outdated", button(T.find), { text: T.outdated, tone: "neutral" });
    case "idle":
      return result("ready", button(T.find), null);
  }
}

// --- Notatet i rommet (A566) -------------------------------------------------------------------

/**
 * Tilbudet om notatet i avvikskortet (skisse avsnitt 6). `phase` er hva takstmannen sist gjorde;
 * `original` er avviksteksten før han trykket, slik «Angre» setter den tilbake.
 */
export type NoteOffer = {
  deviationId: string;
  note: string;
  phase: "offer" | "added" | "used" | "restored";
  original: string | null;
};

/**
 * Det rommet husker om «Skriv det du ser» mens det er åpent. Bare i minnet til skjermen for
 * rommet: aldri i nettleserens lagring eller i adressen. Forsvinner når rommet forlates og ved
 * utlogging, fordi skjermen da tas ned.
 */
export type RoomOutcomeNote = {
  /** Teksten i feltet i «+ Avvik». Står når panelet lukkes, ved «Avbryt» og Escape. */
  note: string;
  aiOff: boolean;
  tooManyCandidates: boolean;
  offer: NoteOffer | null;
};

export const EMPTY_ROOM_OUTCOME_NOTE: RoomOutcomeNote = {
  note: "",
  aiOff: false,
  tooManyCandidates: false,
  offer: null,
};

export type RoomOutcomeNoteEvent =
  | { type: "typed"; note: string }
  /** Panelet lukkes («Avbryt», Escape, lagret avvik på annen måte): notatet står. */
  | { type: "panel_closed" }
  | { type: "side_effect"; effect: OutcomeMatchSideEffect }
  /** Avviket er laget fra et KI-treff: notatet flyttes til tilbudet i avvikskortet. */
  | { type: "deviation_from_note"; deviationId: string; note: string }
  /** Et avvik er laget på annen måte: feltet tømmes, og tilbudet forsvinner uten å endre noe. */
  | { type: "deviation_added" }
  | { type: "offer_changed"; phase: NoteOffer["phase"]; original?: string | null }
  | { type: "offer_closed" };

export function roomOutcomeNoteReducer(
  state: RoomOutcomeNote,
  event: RoomOutcomeNoteEvent,
): RoomOutcomeNote {
  switch (event.type) {
    case "typed":
      return state.note === event.note ? state : { ...state, note: event.note };
    case "panel_closed":
      return state;
    case "side_effect":
      if (event.effect === "ai_off") return { ...state, aiOff: true };
      if (event.effect === "too_many_candidates") return { ...state, tooManyCandidates: true };
      return state;
    case "deviation_from_note": {
      const note = normalizeOutcomeNote(event.note);
      return {
        ...state,
        note: "",
        offer:
          note === "" || noteHasNationalId(note)
            ? null
            : { deviationId: event.deviationId, note, phase: "offer", original: null },
      };
    }
    case "deviation_added":
      return state.offer || state.note !== "" ? { ...state, note: "", offer: null } : state;
    case "offer_changed":
      if (!state.offer) return state;
      return {
        ...state,
        offer: {
          ...state.offer,
          phase: event.phase,
          original: event.original !== undefined ? event.original : state.offer.original,
        },
      };
    case "offer_closed":
      return state.offer ? { ...state, offer: null } : state;
  }
}
