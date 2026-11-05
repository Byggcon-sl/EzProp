import { z } from "zod";
import { isUuid } from "@/shared/lib/uuid";
import { FIRM_TYPES } from "./codes";
import { isValidOrgNumber, normalizeOrgNumber } from "./org-number";

/*
 * Validering av firma og kontakter. Samme skjema brukes av kjernen og skjermene, slik at
 * feltnavn og feilmeldinger er like. Verdiene trimmes; tom valgfri tekst blir `null`.
 *
 * `source` og `organizationId` finnes ikke i skjemaet: kjernen setter `manual` og
 * organisasjonen fra tilgangssjekken. Ukjente felt tas bort av Zod.
 */

const NAME = "Skriv inn navnet.";
const NAME_TOO_LONG = "Navnet kan ha høyst 200 tegn.";
const FIRST_NAME = "Skriv inn fornavnet.";
const FIRST_NAME_TOO_LONG = "Fornavnet kan ha høyst 100 tegn.";
const LAST_NAME_TOO_LONG = "Etternavnet kan ha høyst 100 tegn.";
const ORG_NUMBER_LENGTH = "Organisasjonsnummeret må ha 9 sifre.";
const ORG_NUMBER_INVALID = "Organisasjonsnummeret er ikke gyldig.";
const FIRM_TYPE = "Velg en type.";
const EMAIL = "E-postadressen er ikke gyldig.";
const PHONE = "Telefonnummeret kan bare ha sifre, mellomrom og +.";
const PHONE_TOO_LONG = "Telefonnummeret kan ha høyst 20 tegn.";
const NOTES_TOO_LONG = "Notatet kan ha høyst 1000 tegn.";
const FIRM_NOT_FOUND = "Firmaet finnes ikke.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";

/** Elleve sifre på rad ligner et fødselsnummer. Ti godtas (for eksempel telefonnummer med 0). */
const ELEVEN_DIGITS = /\d{11}/;

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hasNoNationalId(value: string | null): boolean {
  return value === null || !ELEVEN_DIGITS.test(value);
}

/** Påkrevd tekst: trimmes, minst ett tegn, høyst `max`, uten fødselsnummer. */
function requiredText(max: number, missing: string, tooLong: string) {
  return z
    .string({ error: missing })
    .trim()
    .min(1, { error: missing })
    .max(max, { error: tooLong })
    .refine((value) => !ELEVEN_DIGITS.test(value), { error: NATIONAL_ID });
}

/** Valgfri tekst: trimmes, tom tekst blir `null`, høyst `max` tegn. */
function optionalText(max: number, message: string) {
  return z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || value.length <= max, { error: message });
}

/** Valgfri tekst som ikke kan ha fødselsnummer (navn og notat). */
function optionalPersonText(max: number, message: string) {
  return optionalText(max, message).refine(hasNoNationalId, { error: NATIONAL_ID });
}

const emailFormat = z.email();

/** Organisasjonsnummer: valgfritt, mellomrom fjernes, nøyaktig ni sifre og gyldig kontrollsiffer. */
const orgNumber = z
  .string()
  .nullish()
  .transform((value, ctx) => {
    const trimmed = emptyToNull(value);
    if (trimmed === null) return null;
    const digits = normalizeOrgNumber(trimmed);
    if (!/^\d{9}$/.test(digits)) {
      ctx.addIssue({ code: "custom", message: ORG_NUMBER_LENGTH });
      return z.NEVER;
    }
    if (!isValidOrgNumber(digits)) {
      ctx.addIssue({ code: "custom", message: ORG_NUMBER_INVALID });
      return z.NEVER;
    }
    return digits;
  });

/** Firmatype: mangler den (eller er tom), blir den meglerforetak. */
const firmType = z
  .string({ error: FIRM_TYPE })
  .nullish()
  .transform((value) => emptyToNull(value) ?? "broker_firm")
  .pipe(z.enum(FIRM_TYPES, { error: FIRM_TYPE }));

/** Et firma. Organisasjonsnummeret er unikt blant aktive firma (sjekkes av databasen). */
export const firmInputSchema = z.object({
  name: requiredText(200, NAME, NAME_TOO_LONG),
  orgNumber,
  firmType,
  notes: optionalPersonText(1000, NOTES_TOO_LONG),
});
export type FirmInput = z.input<typeof firmInputSchema>;
export type FirmValues = z.output<typeof firmInputSchema>;

/** En kontakt. `source` settes av kjernen, aldri fra skjemaet. */
export const contactInputSchema = z.object({
  firstName: requiredText(100, FIRST_NAME, FIRST_NAME_TOO_LONG),
  lastName: optionalPersonText(100, LAST_NAME_TOO_LONG),
  email: optionalText(254, EMAIL).refine(
    (value) => value === null || emailFormat.safeParse(value).success,
    { error: EMAIL },
  ),
  phone: optionalText(20, PHONE_TOO_LONG).refine(
    (value) => value === null || /^[0-9 +]*$/.test(value),
    { error: PHONE },
  ),
  firmId: z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || isUuid(value), {
      error: FIRM_NOT_FOUND,
    }),
  notes: optionalPersonText(1000, NOTES_TOO_LONG),
});
export type ContactInput = z.input<typeof contactInputSchema>;
export type ContactValues = z.output<typeof contactInputSchema>;
