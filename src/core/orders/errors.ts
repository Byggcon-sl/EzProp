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

/**
 * «Gyldig til» ble forsøkt endret på et tilbud som er gjort om til oppdrag eller avslått
 * (ADR 0012). Ingenting er lagret. Meldingen har aldri verdier fra tilbudet.
 */
export class OfferValidUntilLockedError extends Error {
  constructor() {
    super("Gyldig til kan bare endres på åpne og utløpte tilbud.");
    this.name = "OfferValidUntilLockedError";
  }
}

/** Felles med «Nytt oppdrag» (ADR 0011). Står i `@/core/assignments/errors`. */
export { OfficeNotFoundError } from "@/core/assignments/errors";
