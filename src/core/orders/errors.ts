/** Ordren er alt avvist eller gjort om til oppdrag. Ingenting er endret. */
export class OrderAlreadyHandledError extends Error {
  constructor() {
    super("Ordren er allerede behandlet.");
    this.name = "OrderAlreadyHandledError";
  }
}

/**
 * Ordren er endret (eller avvist eller gjort om) etter at skjemaet ble åpnet: `row_version`
 * stemmer ikke (A253). Ingenting er endret. Meldingen har aldri verdier.
 */
export class OrderChangedError extends Error {
  constructor() {
    super("Ordren er endret av en annen. Last siden på nytt.");
    this.name = "OrderChangedError";
  }
}

/** Kontoret finnes ikke i organisasjonen, eller er slettet. */
export class OfficeNotFoundError extends Error {
  constructor() {
    super("Kontoret finnes ikke.");
    this.name = "OfficeNotFoundError";
  }
}
