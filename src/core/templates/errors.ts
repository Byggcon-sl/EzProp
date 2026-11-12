/*
 * Feilene fra malmotoren (docs/funksjoner/fase2a-malmotor.md, Omfang 3). Meldingene er norske og
 * inneholder aldri id-er eller tekst fra malen (titler, ledetekster, avvikstekster).
 */

/** Familien eller versjonen finnes ikke, er slettet mykt eller hører til en annen organisasjon. */
export class TemplateNotFoundError extends Error {
  constructor() {
    super("Fant ikke malen.");
    this.name = "TemplateNotFoundError";
  }
}

export const TEMPLATE_DRAFT_EXISTS_MESSAGE = "Det finnes allerede et utkast av denne malen.";
export const TEMPLATE_NOT_DRAFT_MESSAGE = "Malversjonen er publisert og kan ikke endres.";

/** Versjonen er ikke et utkast, eller det finnes allerede et utkast i familien. Ingenting endret. */
export class TemplateStateError extends Error {
  constructor(message: typeof TEMPLATE_DRAFT_EXISTS_MESSAGE | typeof TEMPLATE_NOT_DRAFT_MESSAGE) {
    super(message);
    this.name = "TemplateStateError";
  }
}

/**
 * Faste regelkoder for feil i maldokumentet. Testene sjekker koden, ikke meldingsteksten.
 * - `schema`: feil type, manglende felt eller ukjent verdi (Zod), eller felt som ikke passer
 *   sammen (seksjoner i ring, regler med feil form, se `checkDocumentRules`).
 * - `key_format`: koden har feil format.
 * - `key_duplicate`: samme kode to ganger i samme område (A141).
 * - `key_unknown`: en referanse peker på en kode som ikke finnes i dokumentet.
 * - `key_archived`: koden er arkivert og kan ikke tas i bruk igjen (A136).
 * - `tg_logic_in_custom`: kontrollpunkt eller TG-regel i en egen mal (beslutning 27.10.2026).
 * - `outcome_tgiu`: utfall med `tgiu` (innspill D1).
 */
export const TEMPLATE_ISSUE_RULES = [
  "schema",
  "key_format",
  "key_duplicate",
  "key_unknown",
  "key_archived",
  "tg_logic_in_custom",
  "outcome_tgiu",
] as const;
export type TemplateIssueRule = (typeof TEMPLATE_ISSUE_RULES)[number];

/** Én feil i dokumentet. `path` er stedet i dokumentet, for eksempel `sections.0.key`. */
export type TemplateIssue = { path: string; rule: TemplateIssueRule; message: string };

/** Dokumentet er ugyldig. Ingenting er lagret. */
export class TemplateValidationError extends Error {
  readonly issues: TemplateIssue[];
  constructor(issues: TemplateIssue[]) {
    super("Malen har feil. Rett feilene og prøv igjen.");
    this.name = "TemplateValidationError";
    this.issues = issues;
  }
}
