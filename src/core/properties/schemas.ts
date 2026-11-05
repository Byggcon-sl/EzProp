import { z } from "zod";
import { HOUSING_TYPES, OWNERSHIP_FORMS, YES_NO_UNKNOWN } from "./codes";

/*
 * Validering av eiendommen og fellesdelene. Samme skjema brukes av kjernen og skjermen, slik at
 * feltnavn og feilmeldinger er like. Verdiene trimmes, og tom valgfri tekst blir `null`.
 * Ukjente felt (også `organizationId`, `id`, `propertyId` og `dataSource`) tas bort av Zod.
 */

const ADDRESS = "Skriv inn adressen.";
const ADDRESS_TOO_LONG = "Adressen kan ha høyst 200 tegn.";
const POSTAL_CODE = "Postnummeret må ha fire sifre.";
const CITY_TOO_LONG = "Poststedet kan ha høyst 100 tegn.";
const MUNICIPALITY_NUMBER = "Kommunenummeret må ha fire sifre.";
const MUNICIPALITY_NAME_TOO_LONG = "Kommunenavnet kan ha høyst 100 tegn.";
const HOUSING_TYPE = "Velg boligtype.";
const OWNERSHIP_FORM = "Velg eierform.";
const GNR = "Skriv inn gårdsnummer.";
const BNR = "Skriv inn bruksnummer.";
const ASSOCIATION_NAME_TOO_LONG = "Navnet kan ha høyst 200 tegn.";
const ORG_NUMBER = "Organisasjonsnummeret må ha ni sifre.";
const SHARE_NUMBER = "Andelsnummeret kan bare ha sifre og bindestrek.";
const SHARE_NUMBER_TOO_LONG = "Andelsnummeret kan ha høyst 20 tegn.";
const MANAGING_AGENT_TOO_LONG = "Forretningsfører kan ha høyst 200 tegn.";
const NOTES_TOO_LONG = "Teksten kan ha høyst 2000 tegn.";
const YES_NO = "Velg ja, nei eller vet ikke.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";

/** Elleve sifre på rad ligner et fødselsnummer. Ti godtas (samme mønster som ordren). */
const ELEVEN_DIGITS = /\d{11}/;

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hasNoNationalId(value: string | null): boolean {
  return value === null || !ELEVEN_DIGITS.test(value);
}

/** Valgfri fritekst: trimmes, tom blir `null`, høyst `max` tegn, ikke fødselsnummer. */
function optionalText(max: number, message: string) {
  return z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || value.length <= max, { error: message })
    .refine(hasNoNationalId, { error: NATIONAL_ID });
}

/** Valgfritt nummer med nøyaktig `length` sifre. Tom blir `null`. */
function optionalFixedDigits(length: number, message: string) {
  const pattern = new RegExp(`^\\d{${length}}$`);
  return z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || pattern.test(value), { error: message });
}

/** Matrikkelnummer (gnr, bnr, fnr, snr): 1–5 sifre. Tom blir `null`. */
function cadastralNumber(name: string) {
  return z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || /^\d+$/.test(value), {
      error: `${name} kan bare ha sifre.`,
    })
    .refine((value) => value === null || !/^\d+$/.test(value) || value.length <= 5, {
      error: `${name} kan ha høyst fem sifre.`,
    });
}

/** Påkrevd matrikkelnummer: som over, men tomt gir `required`. */
function requiredCadastralNumber(name: string, required: string) {
  return cadastralNumber(name)
    .refine((value) => value !== null, { error: required })
    .transform((value) => value as string);
}

/** Ja, nei eller vet ikke. Mangler eller tom gir `unknown`. */
const yesNoUnknown = z.preprocess(
  (value) => (value === undefined || value === null || value === "" ? "unknown" : value),
  z.enum(YES_NO_UNKNOWN, { error: YES_NO }),
);

/** Eiendommen med én matrikkelrad (A65). */
export const propertyInputSchema = z.object({
  address: z
    .string({ error: ADDRESS })
    .trim()
    .min(1, { error: ADDRESS })
    .max(200, { error: ADDRESS_TOO_LONG })
    .refine((value) => !ELEVEN_DIGITS.test(value), { error: NATIONAL_ID }),
  postalCode: optionalFixedDigits(4, POSTAL_CODE),
  city: optionalText(100, CITY_TOO_LONG),
  municipalityNumber: optionalFixedDigits(4, MUNICIPALITY_NUMBER),
  municipalityName: optionalText(100, MUNICIPALITY_NAME_TOO_LONG),
  housingType: z.enum(HOUSING_TYPES, { error: HOUSING_TYPE }),
  ownershipForm: z.enum(OWNERSHIP_FORMS, { error: OWNERSHIP_FORM }),
  gnr: requiredCadastralNumber("Gårdsnummer", GNR),
  bnr: requiredCadastralNumber("Bruksnummer", BNR),
  fnr: cadastralNumber("Festenummer"),
  snr: cadastralNumber("Seksjonsnummer"),
  associationName: optionalText(200, ASSOCIATION_NAME_TOO_LONG),
  associationOrgNumber: optionalFixedDigits(9, ORG_NUMBER),
  shareNumber: z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || /^[0-9-]+$/.test(value), { error: SHARE_NUMBER })
    .refine((value) => value === null || value.length <= 20, { error: SHARE_NUMBER_TOO_LONG }),
});
/**
 * Det kjernen tar imot. Boligtype og eierform kan være hvilken som helst tekst fra skjemaet;
 * Zod avviser ukjente koder med norsk melding.
 */
export type PropertyInput = Omit<
  z.input<typeof propertyInputSchema>,
  "housingType" | "ownershipForm"
> & { housingType?: string | null; ownershipForm?: string | null };
export type PropertyValues = z.output<typeof propertyInputSchema>;

/** Fellesdelene for leilighet (A66). */
export const commonAreasInputSchema = z.object({
  managingAgent: optionalText(200, MANAGING_AGENT_TOO_LONG),
  conditionReportStatus: yesNoUnknown,
  maintenancePlanStatus: yesNoUnknown,
  notes: optionalText(2000, NOTES_TOO_LONG),
});
export type CommonAreasInput = z.input<typeof commonAreasInputSchema>;
export type CommonAreasValues = z.output<typeof commonAreasInputSchema>;
