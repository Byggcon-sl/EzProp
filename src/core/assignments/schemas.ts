import { z } from "zod";
import { ASSIGNMENT_STATUSES, PARTY_ROLES } from "./codes";

/*
 * Validering av partene og grunnen ved bytte i teamet. Samme skjema brukes av kjernen og
 * skjermen, slik at feltnavn og feilmeldinger er like. Tom valgfri tekst blir `null`.
 * Ukjente felt (også `organizationId` og `assignmentId`) tas bort av Zod.
 */

const ROLE = "Velg en rolle.";
const NAME = "Skriv inn navnet.";
const NAME_TOO_LONG = "Navnet kan ha høyst 200 tegn.";
const FIRM_TOO_LONG = "Firmanavnet kan ha høyst 200 tegn.";
const EMAIL = "E-postadressen er ikke gyldig.";
const PHONE = "Telefonnummeret kan bare ha sifre, mellomrom og +.";
const REASON_TOO_LONG = "Grunnen kan ha høyst 300 tegn.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";

/**
 * Elleve sifre på rad ligner et fødselsnummer. Ti godtas (for eksempel telefonnummer med 0).
 * Mellomrom, punktum og bindestrek mellom sifrene teller ikke («010190 12345» stoppes også).
 */
const ELEVEN_DIGITS = /\d{11}/;
const DIGIT_SEPARATORS = /(?<=\d)[\s.-]+(?=\d)/g;

/** Sann når teksten ikke ligner et fødselsnummer. Tom tekst er greit. */
export function hasNoNationalId(value: string | null): boolean {
  return value === null || !ELEVEN_DIGITS.test(value.replace(DIGIT_SEPARATORS, ""));
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Valgfri tekst: trimmes, tom tekst blir `null`, høyst `max` tegn. */
function optionalText(max: number, message: string) {
  return z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || value.length <= max, { error: message });
}

/** Avkrysningen sender `"on"` når den er krysset av, og ingenting ellers. */
const checkbox = z
  .union([z.boolean(), z.string()])
  .nullish()
  .transform((value) => value === true || value === "on" || value === "true");

const emailFormat = z.email();

/** En part på oppdraget (A60). Hva parten mottar, lagres slik det sendes. */
export const partyInputSchema = z.object({
  role: z.enum(PARTY_ROLES, { error: ROLE }),
  name: z
    .string({ error: NAME })
    .trim()
    .min(1, { error: NAME })
    .max(200, { error: NAME_TOO_LONG })
    .refine(hasNoNationalId, { error: NATIONAL_ID }),
  firmName: optionalText(200, FIRM_TOO_LONG).refine(hasNoNationalId, { error: NATIONAL_ID }),
  email: optionalText(254, EMAIL).refine(
    (value) => value === null || emailFormat.safeParse(value).success,
    { error: EMAIL },
  ),
  phone: optionalText(20, PHONE).refine((value) => value === null || /^[0-9 +]*$/.test(value), {
    error: PHONE,
  }),
  receivesReport: checkbox,
  receivesInvoice: checkbox,
  receivesMessages: checkbox,
});
export type PartyInput = z.input<typeof partyInputSchema>;
export type PartyValues = z.output<typeof partyInputSchema>;

/** Grunnen ved bytte i teamet: valgfri, trimmet, høyst 300 tegn, uten fødselsnummer. */
export const teamChangeReasonSchema = optionalText(300, REASON_TOO_LONG).refine(hasNoNationalId, {
  error: NATIONAL_ID,
});

/*
 * Statusflyten (A74, A76). Grunnen er påkrevd ved ett steg tilbake og ved kansellering, og
 * valgfri ellers. Den lagres bare i hendelsen, aldri i revisjonsloggen.
 */

const REASON_REQUIRED = "Skriv en grunn.";
const STATUS_REASON_TOO_LONG = "Grunnen kan være høyst 500 tegn.";
const STATUS = "Velg en gyldig status.";

/** Grunnen ved tilbake-steg og kansellering: trimmet, 1–500 tegn. */
export const statusChangeReasonSchema = z
  .string({ error: REASON_REQUIRED })
  .trim()
  .min(1, { error: REASON_REQUIRED })
  .max(500, { error: STATUS_REASON_TOO_LONG });

/** En av de fire oppdragsstatusene. */
export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES, { error: STATUS });

/** Valgfri grunn: tom eller bare mellomrom blir `undefined`, ellers som `statusChangeReasonSchema`. */
const optionalStatusChangeReason = z
  .string()
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  })
  .pipe(statusChangeReasonSchema.optional());

/** Input til `changeAssignmentStatus`. Ukjente felt (også `organizationId`) tas bort. */
export const changeAssignmentStatusInputSchema = z
  .object({
    expectedStatus: assignmentStatusSchema,
    toStatus: assignmentStatusSchema,
    reason: optionalStatusChangeReason,
  })
  .strip();
export type ChangeAssignmentStatusInput = z.input<typeof changeAssignmentStatusInputSchema>;

/** Input til `cancelAssignment`. Grunnen er påkrevd. Ukjente felt tas bort. */
export const cancelAssignmentInputSchema = z
  .object({
    expectedStatus: assignmentStatusSchema,
    reason: statusChangeReasonSchema,
  })
  .strip();
export type CancelAssignmentInput = z.input<typeof cancelAssignmentInputSchema>;
