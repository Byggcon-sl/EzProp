/*
 * Feilene fra tidsmålingen. Meldingene er på norsk og inneholder aldri id-er eller navn, slik at
 * de trygt kan logges.
 */

/** Oppdraget finnes ikke, er kansellert (slettet) eller hører til en annen organisasjon. */
export class NotFoundError extends Error {
  constructor() {
    super("Fant ikke oppdraget.");
    this.name = "NotFoundError";
  }
}

/** Innstillingene for tidsmåling er ugyldige. Ingenting er lagret. */
export class TimeTrackingValidationError extends Error {
  /** Norsk melding per felt, for eksempel `baseline.office`. */
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string> = {}, message = "Innstillingene er ugyldige.") {
    super(message);
    this.name = "TimeTrackingValidationError";
    this.fieldErrors = fieldErrors;
  }
}
