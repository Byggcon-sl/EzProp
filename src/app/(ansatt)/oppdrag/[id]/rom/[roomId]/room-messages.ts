/*
 * Tekstene på skjermen for badet som ikke er oversettelse av koder (de står i
 * `@/core/reports/logic`). Egne ord, norsk bokmål, uten gjetteord. Samme fil brukes av server
 * actions og klientkomponentene, så meldingene er like.
 * Støtter hovedmål: de ansatte (korte, konkrete meldinger) og færre reklamasjoner.
 */

/** Svaret fra en server action når noe ikke ble gjort. Meldingen er klar til visning. */
export type ActionError = { status: "error"; message: string };

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
