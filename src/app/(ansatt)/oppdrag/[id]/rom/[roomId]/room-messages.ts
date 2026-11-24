/*
 * Tekstene på skjermen for badet som ikke er oversettelse av koder (de står i
 * `@/core/reports/logic`). Egne ord, norsk bokmål, uten gjetteord. Samme fil brukes av server
 * actions og klientkomponentene, så meldingene er like.
 * Støtter hovedmål: de ansatte (korte, konkrete meldinger) og færre reklamasjoner.
 */

import type { SuggestionTg } from "@/core/reports/logic";
import type { ChosenTg, RuleSuggestionDecision } from "@/db/schema";

/**
 * Svaret fra en server action når noe ikke ble gjort. Meldingen er klar til visning. `code` er
 * bare satt der skjermen må skille svaret fra andre feil: `override_reason` betyr at verdien
 * krever en grunn (TG på avvik fra et forslag, A490), og at ny lagring av samme verdi aldri hjelper.
 */
export type ActionError = { status: "error"; message: string; code?: "override_reason" };

export function isActionError(value: unknown): value is ActionError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { status?: unknown }).status === "error" &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

export const ROOM_ACTION_MESSAGES = {
  templateMissing:
    "Det finnes ingen publisert mal for tilstandsrapport. Be en administrator om å publisere malen.",
  invalid: "Verdien er ugyldig. Ingenting er lagret.",
  network: "Fikk ikke kontakt med serveren. Ingenting er lagret. Prøv igjen.",
  startFailed: "Rapporten ble ikke startet. Prøv igjen.",
  noLongerApplies: "Forslaget gjelder ikke lenger. Feltet det bygde på er endret.",
  conflict: "Endret av andre",
} as const;

/** «TG3», «TG0», «TGIU». */
function tgLabel(tg: ChosenTg | SuggestionTg): string {
  return tg === "IU" ? "TGIU" : `TG${tg}`;
}

/** Klokkeslett i norsk tid med punktum: «10.42». Samme svar på iPad og PC uansett tidssone. */
const OSLO_TIME = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function osloClock(iso: string): string {
  const parts = OSLO_TIME.formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour.padStart(2, "0")}.${minute.padStart(2, "0")}`;
}

/**
 * Meldingene når et regelforslag og avviket det laget, henger sammen (T-0113, T-0116, T-0117,
 * A493, A494). Faste tekster fra oppgavekortet; testene sjekker dem eksakt (FA-L27).
 */
export const SUGGESTION_MESSAGES = {
  /** Etter «Fjern avviket» på et avvik fra et forslag. «Velg TG2 eller TG3» og HMS har ingen TG. */
  suggestionReopened: (tg: SuggestionTg | null) =>
    tg === null || tg === "choose"
      ? "Avviket er fjernet. Forslaget er åpent igjen."
      : `Avviket er fjernet. Forslaget om ${tgLabel(tg)} er åpent igjen.`,
  /** Forslaget er avgjort i et annet vindu (svaret `already_decided`). Aldri hvem. */
  alreadyDecided: (
    decision: RuleSuggestionDecision,
    chosenTg: ChosenTg | null,
    decidedAt: string,
  ) => {
    const clock = osloClock(decidedAt);
    if (decision === "rejected") return `Avvist i et annet vindu kl. ${clock}`;
    const verb = decision === "accepted" ? "Godtatt" : "Endret";
    return chosenTg === null
      ? `${verb} i et annet vindu kl. ${clock}`
      : `${verb} i et annet vindu kl. ${clock}: ${tgLabel(chosenTg)}`;
  },
  newerDecision:
    "Forslaget er avgjort på nytt etter at avviket ble fjernet. Avviket hentes ikke tilbake.",
  goToSuggestion: "Gå til forslaget",
  /** Grunnen mangler ved TG-bytte på avvik fra et forslag. */
  reasonMissing: "Velg en grunn for å endre TG fra forslaget.",
} as const;

export const ROOM_TEXTS = {
  back: "Oppdraget",
  backLabel: "Tilbake til oppdraget",
  reportType: "Tilstandsrapport",
  roomGroup: "Våtrom",
  listHeading: "Badet",
  listNav: "Kontrollpunkter",
  progressLabel: "Fremdrift",
  readOnly: "Du kan se badet, men ikke endre det.",
  notStartedHeading: "Rapporten er ikke startet",
  notStartedCanStart: "Når du starter, låses rapporten til malen som gjelder nå.",
  notStartedCannotStart: "Rapporten er ikke startet. En takstmann starter den.",
  start: "Start rapporten",
  starting: "Starter …",
  inspectionYearFromAssignment: (year: number) =>
    `Reglene regner med befaringsår ${year} (fra befaringstiden i oppdraget).`,
  inspectionYearFromToday: (year: number) =>
    `Reglene regner med befaringsår ${year} (dagens år, befaringstiden er ikke satt).`,
  seeWith: "Ses sammen med:",
  tgForCheckpoint: "TG for punktet",
  registration: "Registrering",
  tgWithoutDeviation: "TG uten avvik",
  tgWithoutDeviationHint: "Har punktet avvik, gjelder TG fra avvikene.",
  tgLockedByDeviations: "Punktet har avvik med TG. Fjern avvikene for å sette TG0 eller TG1.",
  removeTg: "Fjern TG",
  addDeviation: "+ Avvik",
  deviationLimit: "Punktet har 50 avvik, som er grensen.",
  description: "Beskrivelse av punktet (valgfri)",
  toReview: (count: number) => `Å se over (${count})`,
  done: "Ferdig med punktet",
  reopen: "Åpne punktet igjen",
  saving: "Lagrer …",
  previous: "Forrige punkt",
  next: "Neste punkt",
  checkpoints: (done: number, total: number) => `Punkter (${done} av ${total})`,
  close: "Lukk",
  shortcutsLink: "Snarveier (?)",
  shortcutsHeading: "Snarveier",
  allDone: (total: number) => `Alle ${total} punktene er ferdige.`,
  notDoneFieldUnsaved: "Punktet er ikke ferdig. Ett felt er ikke lagret.",
  doneAnnouncement: (done: number, total: number, opened: string | null, warnings: number) => {
    const head =
      warnings > 0 ? `Punktet er ferdig, med ${warnings} ting å se over.` : "Punktet er ferdig.";
    const progress = `${done} av ${total} ferdig.`;
    return opened ? `${head} ${progress} Åpnet: ${opened}.` : `${head} ${progress}`;
  },
  deviationAdded: (tg: string | null) => (tg ? `Avvik lagt til, ${tg}` : "Avvik lagt til"),
  deviationNumber: (n: number) => `Avvik ${n}`,
  deviationRemoved: (n: number) => `Avvik ${n} er fjernet.`,
  tgiuRemoved: "TGIU er fjernet.",
  undo: "Angre",
  tgiuSet: "TGIU satt på punktet",
  tg0Set: "TG0 satt på punktet",
  goToField: "gå til feltet",
  goToFieldLink: "Gå til feltet",
} as const;
