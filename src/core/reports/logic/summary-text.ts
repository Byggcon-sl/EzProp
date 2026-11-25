import {
  normalizeForRedaction,
  PII_EMAIL_RULE,
  PII_PLACEHOLDER,
  PII_REDACTION_RULES,
  WORD_END,
  WORD_START,
} from "@/shared/lib/pii-patterns";
import type { OverrideSummaryTextIssue, ValidateSummaryText } from "../override-types";
import { formatWholeNumber } from "./labels";
import { containsPiiPlaceholder } from "./summary";

/*
 * Kontrollen av lederens månedsoppsummering før lagring (docs/funksjoner/fase2a-overstyringer-leder.md,
 * A574). Ren funksjon: samme kontroll kan vises i nettleseren, og serveren kjører den alltid.
 *
 * Støtter hovedmål: de ansatte (teksten tas med i fagmøtet uten personopplysninger, og ingen
 * ansatt pekes ut med navn) og KI i bunnen (samme krav til tekst fra KI og tekst leder skriver).
 *
 * Meldingene nevner aldri det som ble funnet (navnet, tallet eller adressen).
 */

/**
 * Høyeste lengde på teksten. Samme tall som `OVERRIDE_SUMMARY_TEXT_MAX_CHARS` i `@/db/schema`
 * (CHECK-regelen); står her også fordi filen lastes i nettleseren. Testen holder dem like.
 */
export const OVERRIDE_SUMMARY_TEXT_MAX_LENGTH = 2000;

/** Den norske meldingen per feil. */
export const OVERRIDE_SUMMARY_TEXT_MESSAGES: Record<OverrideSummaryTextIssue, string> = {
  empty: "Skriv oppsummeringen før du lagrer.",
  too_long: `Teksten er for lang. Grensen er ${formatWholeNumber(OVERRIDE_SUMMARY_TEXT_MAX_LENGTH)} tegn.`,
  id_number: "Teksten ser ut til å inneholde et fødselsnummer. Fjern det.",
  email: "Oppsummeringen kan ikke inneholde e-postadresser.",
  phone: "Oppsummeringen kan ikke inneholde telefonnumre.",
  employee_name: "Oppsummeringen kan ikke inneholde navn på ansatte.",
  placeholder: "Teksten har en plassholder fra KI, for eksempel [adresse]. Skriv inn riktig verdi.",
};

/**
 * Elleve sifre på rad, også med ett mellomrom, punktum eller bindestrek etter de seks første
 * («010190 12345», «010190.12345»). Ikke inne i et lengre tall.
 */
const ID_NUMBER = /(?<![\p{N}])(?<!\p{N}[  .-])\d{6}[  .-]?\d{5}(?![\p{N}])(?![  .-]\p{N})/u;

/** Samme mønstre som vasken før KI, uten flagget `g` (så `test` ikke husker posisjonen). */
function single(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags.replace("g", ""));
}
const EMAIL = single(PII_EMAIL_RULE.pattern);
const PHONE_RULE = PII_REDACTION_RULES.find((rule) => rule.placeholder === PII_PLACEHOLDER.phone);
if (!PHONE_RULE) throw new Error("Mønsteret for telefon mangler");
const PHONE = single(PHONE_RULE.pattern);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Formene av et navn som stoppes: hele navnet, og fornavn med etternavn når navnet har
 * mellomnavn («Åse Marie Testesen» stopper også «Åse Testesen»). Ett ord alene stoppes ikke, så
 * vanlige ord som også er fornavn går gjennom.
 */
function nameForms(name: string): string[] {
  const words = normalizeForRedaction(name)
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length < 2) return [];
  const forms = new Set([words.join(" ")]);
  if (words.length > 2) forms.add(`${words[0]} ${words[words.length - 1]}`);
  return [...forms];
}

function containsName(text: string, name: string): boolean {
  return nameForms(name).some((form) => {
    const pattern = form.split(" ").map(escapeRegExp).join("[\\s\\u00A0]+");
    return new RegExp(`${WORD_START}${pattern}${WORD_END}`, "iu").test(text);
  });
}

/** Se `ValidateSummaryText`. Gir første feil, eller `null` når teksten kan lagres. */
export const validateSummaryText: ValidateSummaryText = (text, employeeNames) => {
  if (typeof text !== "string" || text.trim().length === 0) return "empty";
  if (text.length > OVERRIDE_SUMMARY_TEXT_MAX_LENGTH) return "too_long";
  const normalized = normalizeForRedaction(text);
  if (containsPiiPlaceholder(normalized)) return "placeholder";
  if (EMAIL.test(normalized)) return "email";
  if (ID_NUMBER.test(normalized)) return "id_number";
  if (PHONE.test(normalized)) return "phone";
  if (employeeNames.some((name) => containsName(normalized, name))) return "employee_name";
  return null;
};
