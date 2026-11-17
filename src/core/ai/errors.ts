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

/**
 * For mye til ett kall: for mange kandidater, eller for mange eller for lange funn til
 * sammendraget (`limits.ts`). Ingen rad og intet kall. Kjernen kutter aldri stille: kalleren får
 * beskjed og viser meldingen. `reason` er fast kode, meldingen har ingen tekst fra inndata.
 */
export const AI_INPUT_TOO_LARGE_REASONS = ["too_many_candidates", "too_many_findings"] as const;
export type AiInputTooLargeReason = (typeof AI_INPUT_TOO_LARGE_REASONS)[number];

export const AI_INPUT_TOO_LARGE_MESSAGES: Readonly<Record<AiInputTooLargeReason, string>> = {
  too_many_candidates: "Det er for mange tekster å velge blant til at KI kan sortere dem.",
  too_many_findings:
    "Det er for mange eller for lange funn til ett utkast. Skriv sammendraget selv, eller kort ned tekstene.",
};

export class AiInputTooLargeError extends Error {
  readonly reason: AiInputTooLargeReason;
  constructor(reason: AiInputTooLargeReason) {
    super(AI_INPUT_TOO_LARGE_MESSAGES[reason]);
    this.name = "AiInputTooLargeError";
    this.reason = reason;
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
