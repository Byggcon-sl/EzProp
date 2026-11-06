/**
 * Avtalen, firmaet eller oppdraget finnes ikke i organisasjonen, er slettet eller id-en er
 * ugyldig. Ingenting er endret.
 */
export class NotFoundError extends Error {
  constructor(message = "Fant ikke det du lette etter.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Firmaet på avtalen finnes ikke i organisasjonen, eller er slettet. En `NotFoundError`. */
export class AgreementFirmNotFoundError extends NotFoundError {
  constructor() {
    super("Firmaet finnes ikke.");
    this.name = "AgreementFirmNotFoundError";
  }
}

export const AGREEMENT_EXPIRED_MESSAGE = "Avtalen gjelder ikke i dag.";
export const AGREEMENT_DELETED_MESSAGE = "Avtalen er fjernet.";

/**
 * Avtalen kan ikke velges på oppdraget: den er fjernet, utløpt eller ikke påbegynt (A111).
 * Ingenting er endret.
 */
export class AgreementNotUsableError extends Error {
  constructor(message: typeof AGREEMENT_EXPIRED_MESSAGE | typeof AGREEMENT_DELETED_MESSAGE) {
    super(message);
    this.name = "AgreementNotUsableError";
  }
}
