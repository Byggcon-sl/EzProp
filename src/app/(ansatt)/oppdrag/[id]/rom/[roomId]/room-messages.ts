import type { SuggestionTg } from "@/core/reports/logic";
import type { AiGuardCode, ChosenTg, RuleSuggestionDecision } from "@/db/schema";

/*
 * Tekstene på skjermen for badet som ikke er oversettelse av koder (de står i
 * `@/core/reports/logic`). Egne ord, norsk bokmål, uten gjetteord. Samme fil brukes av server
 * actions og klientkomponentene, så meldingene er like.
 * Støtter hovedmål: de ansatte (korte, konkrete meldinger) og færre reklamasjoner.
 */

/** Svaret fra en server action når noe ikke ble gjort. Meldingen er klar til visning. */
export type ActionError = {
  status: "error";
  message: string;
  /**
   * Bare satt der skjermen må skille svaret fra andre feil.
   * `report_published`: rapporten er publisert, og serveren tar aldri imot endringen. Køen legger
   * den til side og prøver den ikke igjen, så resten sendes som før (ADR 0015 punkt 15, T-0001).
   * `override_reason`: verdien krever en grunn (TG på avvik fra et forslag, A490), og ny lagring
   * av samme verdi uten grunn hjelper aldri.
   */
  code?: "report_published" | "override_reason";
};

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

// --- KI i veien (docs/funksjoner/fase2a-ki-i-veien-design.md avsnitt 9) ------------------------

/** Feltene som har «Forslag». Feltkodene er de faste kodene i `PHRASE_FIELDS`. */
export type PhraseFieldName = "deviation_text" | "cause_text" | "consequence_text" | "new_measure";

const PHRASE_FIELD_NAMES: Record<PhraseFieldName, string> = {
  deviation_text: "avvik",
  cause_text: "årsak",
  consequence_text: "konsekvens",
  new_measure: "tiltak",
};

const OFFLINE = "Trenger nett. Teksten din er lagret.";

export const AI_ROOM_TEXTS = {
  suggest: "Forslag",
  /** Tilgjengelig navn: det synlige ordet står først (WCAG 2.5.3). */
  suggestLabel: (field: PhraseFieldName) => `Forslag til ${PHRASE_FIELD_NAMES[field]} (/)`,
  listTextSearch: "Tekstsøk",
  listRanked: "Sortert av KI",
  listFallback: "Uten KI: treff fra tekstsøk",
  countRanked: (n: number) => `${n} forslag`,
  countHits: (n: number) => `${n} treff`,
  draft: "Utkast",
  draftSr: ", standardtekst som ikke er godkjent ennå",
  mostUsed: "Mest brukt",
  mostUsedSr: " i organisasjonen",
  hms: "HMS",
  actionInsert: "Sett inn",
  actionReplace: "Bytt ut teksten",
  actionAddMeasure: "Legg til som tiltak",
  inserted: "Teksten er satt inn.",
  replaced: "Teksten er byttet ut.",
  measureAdded: "Tiltaket er lagt til.",
  undo: "Angre",
  close: "Lukk",
  noMatchAi: "Ingen treff. KI fant ingen tekst som passer.",
  noHitsSearching: "Ingen treff i tekstsøket. KI ser etter",
  noHits: "Ingen treff.",
  limit: "Teksten er for lang for KI. Treffene er fra tekstsøk.",
  liveHits: (n: number) => `${n} treff fra tekstsøk.`,
  liveRanked: (n: number) => `Sortert av KI. ${n} forslag.`,
  liveFallback: (n: number) => `Uten KI: ${n} treff fra tekstsøk.`,
  liveApplied: (after: string) => `${after} Angre står under feltet.`,
  liveUndone: "Angret.",
  // Språkvask
  polishDeviation: "Språkvask avviket",
  polish: "Språkvask",
  polishing: "Språkvasker …",
  polishSource: (n: number) => `språkvask av avvik ${n}`,
  polishDescriptionSource: "språkvask",
  nothingToPolish: "Det er ingen tekst å språkvaske.",
  polishTooLong: (limit: number) =>
    `Teksten er for lang for språkvask. Grensen er ${limit.toLocaleString("nb-NO")} tegn.`,
  offline: OFFLINE,
  aiOff: "KI er av.",
  aiError: "KI svarte ikke. Prøv igjen.",
  rowMeasure: (n: number) => `Tiltak ${n}`,
  // Sammendraget
  summaryHeading: "Sammendrag for hele rapporten",
  summaryLabel: "Sammendrag",
  summaryDraft: "Lag utkast",
  summaryDrafting: "Lager utkast …",
  summarySource: "utkast til sammendrag",
  summaryNoFindings: "Ingen avvik med TG ennå.",
  summaryMissingTg: (n: number) =>
    n === 1 ? "1 avvik mangler TG og er ikke med." : `${n} avvik mangler TG og er ikke med.`,
  summaryFixNow: "Rett nå",
  summaryChanged: "Funnene er endret etter sammendraget. Lag nytt utkast.",
  summaryAdded: (checkpoint: string) => `${checkpoint}: nytt funn`,
  summaryChangedItem: (checkpoint: string, tg: string | null) =>
    tg ? `${checkpoint}: endret, nå ${tg}` : `${checkpoint}: funnet er endret`,
  summaryRemoved: (n: number) => (n === 1 ? "1 funn er fjernet." : `${n} funn er fjernet.`),
  summaryUncovered: (checkpoint: string, tg: "TG3" | "TGIU") =>
    `${checkpoint} har ${tg} og er ikke nevnt i sammendraget.`,
  summaryTooMany: (limit: number) =>
    `Rapporten har flere enn ${limit} funn. Utkastet kan ikke lages. Skriv sammendraget selv.`,
  summaryNotWritten: "Ikke skrevet ennå.",
  summaryReady: "Utkast klart",
  summaryUsed: "Sammendraget er brukt",
  summaryStale: "Funnene er endret etter sammendraget",
  summaryConflict: "Sammendraget er endret av andre. Teksten under er den nyeste.",
  // Plassholder fra vasken (A466)
  placeholder: "Teksten har en plassholder fra KI, for eksempel [adresse]. Skriv inn riktig verdi.",
} as const;

/** Meldingen ved feltet når en vakt stoppet språkvasken (A460). Teksten fra KI vises aldri. */
export function polishStoppedText(guard: AiGuardCode): string {
  if (guard === "placeholder_guard") {
    return "KI-svaret ble stoppet fordi det endret skjulte opplysninger. Teksten din er uendret.";
  }
  return "KI-svaret ble stoppet fordi det endret TG eller la til tall. Teksten din er uendret.";
}

/** Meldingen når en vakt stoppet utkastet til sammendrag (A460, A461, A466). */
export function summaryStoppedText(guard: AiGuardCode): string {
  switch (guard) {
    case "coverage_guard":
      return "Utkastet ble stoppet fordi et funn manglet. Prøv igjen.";
    case "placeholder_guard":
      return "KI-svaret ble stoppet fordi det endret skjulte opplysninger. Sammendraget ditt er uendret.";
    default:
      return "KI-svaret ble stoppet fordi det endret TG eller la til tall. Sammendraget ditt er uendret.";
  }
}
