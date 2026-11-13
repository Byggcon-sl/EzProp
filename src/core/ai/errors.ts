/*
 * Feiltypene i KI-modulen. Manglende rettighet gir `AccessDeniedError` fra `@/core/access`.
 */

/**
 * Meldingen for alle andre avslag (ukjent funksjon, felt, mål, `reportId`, `candidates`, lengde,
 * `requestId`, oppdrag, id hos en annen, slettet rad). Samme klasse og samme melding uansett
 * grunn, så svaret aldri røper om en id finnes hos en annen.
 */
export const AI_REQUEST_REJECTED_MESSAGE = "Forespørselen til KI kan ikke behandles.";

export class AiRequestRejectedError extends Error {
  constructor() {
    super(AI_REQUEST_REJECTED_MESSAGE);
    this.name = "AiRequestRejectedError";
  }
}

/** Ugyldig endring av status på et KI-forslag (tabellen over lovlige endringer, A162). */
export const AI_DECISION_ERROR_MESSAGE = "Denne endringen av KI-forslaget er ikke lov.";

export class AiDecisionError extends Error {
  constructor() {
    super(AI_DECISION_ERROR_MESSAGE);
    this.name = "AiDecisionError";
  }
}

/**
 * Ugyldig oppbevaringstid for avviste KI-forslag (K7). Meldingen og `fieldErrors` gjengir aldri
 * det som ble skrevet.
 */
export const AI_RETENTION_YEARS_ERROR = "Skriv et helt antall år fra 1 til 10.";

export class AiRetentionValidationError extends Error {
  /** Norsk melding per felt, for eksempel `rejectedRetentionYears`. */
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string> = {}, message = "Innstillingen er ugyldig.") {
    super(message);
    this.name = "AiRetentionValidationError";
    this.fieldErrors = fieldErrors;
  }
}
