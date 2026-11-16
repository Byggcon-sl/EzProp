/** Ordren er alt avvist eller gjort om til oppdrag. Ingenting er endret. */
export class OrderAlreadyHandledError extends Error {
  constructor() {
    super("Ordren er allerede behandlet.");
    this.name = "OrderAlreadyHandledError";
  }
}

/**
 * Ordren er endret (også avvist eller gjort om) siden skjemaet ble åpnet: `row_version` stemmer
 * ikke. Ingenting er lagret. Meldingen har aldri verdier fra ordren.
 */
export class OrderChangedError extends Error {
  constructor() {
    super("Ordren er endret av en annen. Last siden på nytt.");
    this.name = "OrderChangedError";
  }
}

/** Felles med «Nytt oppdrag» (ADR 0011). Står i `@/core/assignments/errors`. */
export { OfficeNotFoundError } from "@/core/assignments/errors";
