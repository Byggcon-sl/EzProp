/** Ordren er alt avvist eller gjort om til oppdrag. Ingenting er endret. */
export class OrderAlreadyHandledError extends Error {
  constructor() {
    super("Ordren er allerede behandlet.");
    this.name = "OrderAlreadyHandledError";
  }
}

/**
 * Ordren er endret av en annen siden skjemaet ble åpnet (`row_version` er ikke lik). Ingenting
 * er endret (A253).
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
