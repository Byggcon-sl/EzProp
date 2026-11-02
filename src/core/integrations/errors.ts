/*
 * Feilene fra tjenesten for tilkoblinger. Meldingene er på norsk og inneholder aldri verdier fra
 * `settings` eller hemmeligheter, slik at de trygt kan logges og vises.
 */

/** Input er ugyldig, eller det finnes alt en tilkobling for porten. Ingenting er skrevet. */
export class ConnectionValidationError extends Error {
  constructor(message = "Tilkoblingen er ugyldig.") {
    super(message);
    this.name = "ConnectionValidationError";
  }
}

/** Tilkoblingen finnes ikke, er merket som slettet eller tilhører en annen organisasjon. */
export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Fant ikke tilkoblingen.");
    this.name = "ConnectionNotFoundError";
  }
}
