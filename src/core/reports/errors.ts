import { AccessDeniedError } from "@/core/access";
import { AiDecisionError, AiInputTooLargeError, AiRequestRejectedError } from "@/core/ai";
import { TemplateNotFoundError } from "@/core/templates";
import { logger } from "@/shared/lib/logger";
import { REPORT_PUBLISHED_MESSAGE } from "./published-lock";

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
  /** Rapporten er publisert. Skriving krever «Lag ny versjon» (ADR 0015). */
  "report_published",
  /** Rapporten har ikke noe våtrom. Kan ikke krysses bort (A447). */
  "no_wet_room",
  /** Den ansatte har ingen gyldig sertifisering i dag (A29). */
  "certification_missing",
  /** Oppdraget har ikke selskap, og utgivelsen krever utstedende selskap. */
  "company_missing",
  /** Overstyringen gjelder ikke en sperre serveren har regnet ut, eller begrunnelsen er ugyldig. */
  "publish_override",
  /** Teksten har en plassholder fra vasken før KI, for eksempel «[adresse]» (A466). */
  "text_has_placeholder",
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
  report_published: REPORT_PUBLISHED_MESSAGE,
  no_wet_room: "Rapporten har ikke noe våtrom å publisere.",
  certification_missing:
    "Du har ingen gyldig sertifisering. En kollega med gyldig sertifisering kan publisere.",
  company_missing: "Oppdraget mangler selskap. Velg selskap på oppdraget før du publiserer.",
  publish_override: "Velg en grunn for hver sperre du krysser bort.",
  text_has_placeholder:
    "Teksten har en plassholder fra KI, for eksempel [adresse]. Skriv inn riktig verdi.",
};

/** Den faste norske meldingen for koden. */
export function reportValidationMessage(code: ReportValidationCode): string {
  return MESSAGES[code];
}

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

/**
 * Uventet feil ved lesing eller lagring (for eksempel databasen). Meldingen er fast og har aldri
 * feltverdier eller databaseparametre; årsaken logges vasket (bare navn, kode og skranke).
 */
export class ReportStorageError extends Error {
  constructor() {
    super("Det som står i rapporten, kunne ikke lagres eller leses nå. Prøv igjen om litt.");
    this.name = "ReportStorageError";
  }
}

/**
 * Feil tjenestene gir med vilje. De sendes videre som de er. Feilene fra `@/core/ai` har egne,
 * nøytrale meldinger uten id-er eller tekst (avslag, for mye inndata, beslutning som ikke passer).
 */
function isExpectedError(error: unknown): boolean {
  return (
    error instanceof AccessDeniedError ||
    error instanceof AiRequestRejectedError ||
    error instanceof AiDecisionError ||
    error instanceof AiInputTooLargeError ||
    error instanceof ReportValidationError ||
    error instanceof ReportTemplateMissingError ||
    error instanceof TemplateNotFoundError
  );
}

/** Koden og skranken fra Postgres, aldri meldingen eller parametrene. */
function databaseDetails(error: unknown): { code: string | null; constraint: string | null } {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return {
        code: candidate.code,
        constraint:
          typeof candidate.constraint_name === "string" ? candidate.constraint_name : null,
      };
    }
    current = candidate.cause;
  }
  return { code: null, constraint: null };
}

/**
 * Kjører tjenesten og gjør uventede feil om til `ReportStorageError`. Loggen får bare
 * handlingen og feilkoden, aldri feltverdier eller parametre (B4.27).
 */
export async function guardReportErrors<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isExpectedError(error)) throw error;
    logger.error("Rapporten: uventet feil", { operation, ...databaseDetails(error) });
    throw new ReportStorageError();
  }
}
