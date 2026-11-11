/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Tekstene og reglene bak synkstatusen (docs/funksjoner/fase1-synkstatus.md, «Regler»). Ren fil:
 * ingen React, ingen `window`. «Lagret kl.» regnes ut bare her (`nextSavedAt`), likt for alle
 * kandidater.
 */
import type { SetAsideField, TrialSyncRoundResult, TrialSyncStatus } from "./sync/types";
import { listTrialFields, trialForm, type TrialForm } from "./trial-form";

export const SYNC_NOW_OFFLINE_MESSAGE =
  "Du er uten nett. Alt er lagret på iPaden og sendes når nettet kommer.";
export const SYNC_NOW_FAILED_MESSAGE = "Fikk ikke sendt. Prøver igjen automatisk.";

export const SYNC_STATE_OFFLINE = "Uten nett";
export const SYNC_STATE_ALL_SAVED = "Alt er lagret";
export const SYNC_STATE_AWAITING_SERVER = "Venter på kontakt med serveren";
export const SYNC_STATE_SIGN_IN_REQUIRED = "Logg inn på nytt for å sende. Alt er lagret på iPaden.";
export const SAVED_AT_NEVER = "Ikke lagret på serveren ennå";

export const SYNC_NOW_LABEL = "Synk nå";
export const SYNC_NOW_RUNNING_LABEL = "Synker …";
export const SIGN_IN_LABEL = "Logg inn";

/** Hvilken av de fem tilstandene statusen er i (styrer farge og ikon; teksten bærer betydningen). */
export type SyncStatusKind =
  "offline" | "allSaved" | "pending" | "awaitingServer" | "signInRequired";

function isAllSaved(status: TrialSyncStatus): boolean {
  return (
    status.online &&
    status.serverConfirmed &&
    status.pendingChanges === 0 &&
    status.pendingPhotos === 0
  );
}

/**
 * «Uten nett» har forrang; deretter «Logg inn på nytt» (når serveren har sagt at økten er borte)
 * foran alt annet (docs/funksjoner/fase1-prove-f-innlogging.md, punkt 2).
 */
export function syncStatusKind(status: TrialSyncStatus, signInRequired = false): SyncStatusKind {
  if (!status.online) return "offline";
  if (signInRequired) return "signInRequired";
  if (status.pendingChanges > 0 || status.pendingPhotos > 0) return "pending";
  return status.serverConfirmed ? "allSaved" : "awaitingServer";
}

/**
 * «Uten nett», «Venter: N endringer, M bilder», «Alt er lagret» eller «Venter på kontakt med
 * serveren». «Alt er lagret» bare når serveren har bekreftet og ingenting venter.
 */
export function syncStatusText(status: TrialSyncStatus, signInRequired = false): string {
  switch (syncStatusKind(status, signInRequired)) {
    case "offline":
      return SYNC_STATE_OFFLINE;
    case "signInRequired":
      return SYNC_STATE_SIGN_IN_REQUIRED;
    case "allSaved":
      return SYNC_STATE_ALL_SAVED;
    case "awaitingServer":
      return SYNC_STATE_AWAITING_SERVER;
    default: {
      const changes = `${status.pendingChanges} ${status.pendingChanges === 1 ? "endring" : "endringer"}`;
      const photos = `${status.pendingPhotos} ${status.pendingPhotos === 1 ? "bilde" : "bilder"}`;
      return `Venter: ${changes}, ${photos}`;
    }
  }
}

export const SET_ASIDE_PREFIX = "Kunne ikke sendes:";
export const SET_ASIDE_FORM = "testskjemaet";
/** Når feltkoden ikke finnes i skjemaet (skal ikke skje). */
export const SET_ASIDE_UNKNOWN_FIELD = "et felt";

/**
 * «Kunne ikke sendes: Generell beskrivelse, bilde i Tak – bilde, testskjemaet» for endringer som er
 * lagt til side og ikke løst (funn T-0001). Feltnavnet hentes fra skjemaet, aldri fra koden. Samme
 * felt nevnes én gang. `null` når ingenting er lagt til side.
 */
export function setAsideText(
  fields: readonly SetAsideField[] | undefined,
  form: TrialForm = trialForm,
): string | null {
  if (!fields || fields.length === 0) return null;
  const labels = new Map(listTrialFields(form).map((field) => [field.key, field.label]));
  const names: string[] = [];
  for (const field of fields) {
    let name: string;
    if (field.table === "trial_forms") name = SET_ASIDE_FORM;
    else {
      const label = (field.fieldKey && labels.get(field.fieldKey)) || SET_ASIDE_UNKNOWN_FIELD;
      name = field.table === "trial_photos" ? `bilde i ${label}` : label;
    }
    if (!names.includes(name)) names.push(name);
  }
  return `${SET_ASIDE_PREFIX} ${names.join(", ")}`;
}

/** «Synk nå» skjules mens «Logg inn» vises. */
export function showSyncNow(kind: SyncStatusKind | null): boolean {
  return kind !== "signInRequired";
}

/**
 * Lenken «Logg inn»: `/logg-inn?neste=<sti>`. Bare stien sendes med; spørrestreng og `#` fjernes.
 * Innloggingssiden godtar bare trygge stier (`safeNextPath`).
 */
export function signInHref(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] ?? "";
  return `/logg-inn?neste=${encodeURIComponent(path)}`;
}

interface DateParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function partsIn(date: Date, timeZone: string): DateParts {
  const parts = new Intl.DateTimeFormat("nb-NO", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
  };
}

/**
 * «Lagret kl. 14:32» samme dag, «Lagret 28.10. kl. 14:32» en annen dag, «Ikke lagret på serveren
 * ennå» når tidspunktet mangler eller ikke kan leses. Dagen regnes i `timeZone`, ikke maskinens.
 */
export function savedAtText(savedAt: string | null, now: Date, timeZone: string): string {
  if (!savedAt) return SAVED_AT_NEVER;
  const saved = new Date(savedAt);
  if (Number.isNaN(saved.getTime())) return SAVED_AT_NEVER;
  const at = partsIn(saved, timeZone);
  const today = partsIn(now, timeZone);
  const time = `${at.hour}:${at.minute}`;
  const sameDay = at.year === today.year && at.month === today.month && at.day === today.day;
  return sameDay ? `Lagret kl. ${time}` : `Lagret ${at.day}.${at.month}. kl. ${time}`;
}

/**
 * Neste verdi for «Lagret kl.» (ISO-tekst): `now` bare når statusen er online, bekreftet av
 * serveren og ingenting venter; ellers `previous` uendret.
 */
export function nextSavedAt(
  status: TrialSyncStatus,
  previous: string | null,
  now: Date,
): string | null {
  return isAllSaved(status) ? now.toISOString() : previous;
}

// Knappen «Synk nå» (ren tilstandsmaskin, testplan 2.3).

export interface SyncButtonState {
  running: boolean;
  /** Beskjeden under linjen. Null = ingen beskjed. */
  message: string | null;
}

export type SyncButtonEvent =
  | { type: "start" }
  | { type: "done"; result: TrialSyncRoundResult }
  /** Pillen viser «Alt er lagret»: beskjeden fjernes. */
  | { type: "allSaved" };

export const SYNC_BUTTON_IDLE: SyncButtonState = { running: false, message: null };

export function syncNowMessage(result: TrialSyncRoundResult): string | null {
  if (result === "offline") return SYNC_NOW_OFFLINE_MESSAGE;
  if (result === "failed") return SYNC_NOW_FAILED_MESSAGE;
  return null;
}

/** Nytt trykk fjerner gammel beskjed; utfallet av runden gir ny beskjed (eller ingen ved `"ok"`). */
export function syncButtonReducer(state: SyncButtonState, event: SyncButtonEvent): SyncButtonState {
  switch (event.type) {
    case "start":
      return { running: true, message: null };
    case "done":
      return { running: false, message: syncNowMessage(event.result) };
    case "allSaved":
      return state.message === null ? state : { ...state, message: null };
  }
}

/** Det knappen viser: «Synker …» og ikke trykkbar under runden, ellers «Synk nå». */
export function syncButtonState(state: SyncButtonState): {
  label: string;
  disabled: boolean;
  message: string | null;
} {
  return {
    label: state.running ? SYNC_NOW_RUNNING_LABEL : SYNC_NOW_LABEL,
    disabled: state.running,
    message: state.message,
  };
}
