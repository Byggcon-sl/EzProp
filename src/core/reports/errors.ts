/*
 * Feilene fra rapportkjernen (docs/funksjoner/fase2a-badet-pc.md). Meldingene er norske og
 * inneholder aldri id-er, feltverdier eller tekst fra rapporten. Fremmed, ukjent eller slettet id
 * gir `AccessDeniedError` fra `@/core/access` (404), ikke en feil herfra.
 */

/** Faste koder for valideringsfeil. Testene sjekker koden, ikke meldingen. */
export const REPORT_VALIDATION_CODES = [
  /** Inndata har feil form, for lang tekst eller fødselsnummer. */
  "invalid_input",
  /** Feltet, punktet, spørsmålet, utfallet eller regelen finnes ikke i rapportens malversjon. */
  "unknown_key",
  /** Verdien passer ikke feltet (valg som ikke finnes, tall utenfor grensene). */
  "invalid_value",
  /** Rapporten er ikke startet. */
  "report_not_started",
  /** Rapporten er ikke under arbeid og kan ikke endres. */
  "report_not_editable",
  /** Taket på avvik per punkt eller tiltak per avvik er nådd. */
  "limit_reached",
  /** TG1 kan ikke settes på et punkt med avvik med TG2 eller TG3. */
  "tg_direct_with_deviations",
  /** Punktet har TGIU, og avviket kan ikke få TG før TGIU er fjernet. */
  "tgiu_on_checkpoint",
  /** Begrunnelsen ved Endre eller Avvis mangler eller er ikke lov (A380, A398). */
  "override_reason",
  /** Valget passer ikke forslaget (for eksempel utfall uten TG, eller TG som ikke finnes). */
  "invalid_choice",
  /** Feltet kan ikke endres her (for eksempel TGIU-opplysninger uten TGIU). */
  "not_applicable",
] as const;
export type ReportValidationCode = (typeof REPORT_VALIDATION_CODES)[number];

const MESSAGES: Record<ReportValidationCode, string> = {
  invalid_input: "Det som ble sendt, kan ikke lagres. Sjekk feltet og prøv igjen.",
  unknown_key: "Feltet finnes ikke i malen for denne rapporten.",
  invalid_value: "Verdien passer ikke feltet.",
  report_not_started: "Rapporten er ikke startet.",
  report_not_editable: "Rapporten kan ikke endres lenger.",
  limit_reached: "Grensen er nådd. Det kan ikke legges til flere her.",
  tg_direct_with_deviations: "Punktet har avvik med TG. Fjern avvikene for å sette TG0 eller TG1.",
  tgiu_on_checkpoint: "Punktet har TGIU. Fjern TGIU før avviket får TG.",
  override_reason: "Velg en grunn for å lagre.",
  invalid_choice: "Valget passer ikke forslaget.",
  not_applicable: "Dette kan ikke endres her.",
};

/** Inndata som ikke kan lagres. Ingenting er endret. */
export class ReportValidationError extends Error {
  readonly code: ReportValidationCode;
  constructor(code: ReportValidationCode, message: string = MESSAGES[code]) {
    super(message);
    this.name = "ReportValidationError";
    this.code = code;
  }
}

/** Det finnes ingen publisert systemmal for tilstandsrapport i organisasjonen. */
export class ReportTemplateMissingError extends Error {
  constructor() {
    super(
      "Rapporten kan ikke startes fordi det ikke finnes en publisert systemmal for tilstandsrapport. Be en med maltilgang publisere malen.",
    );
    this.name = "ReportTemplateMissingError";
  }
}
