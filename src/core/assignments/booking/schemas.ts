import { z } from "zod";
import { parseOsloDateTime } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";
import { assignmentScheduleSchema } from "../schemas";

/*
 * Felles Zod-regler for bestillingen (ADR 0011). Samme regler for ordren (`orderInputSchema` i
 * `@/core/orders`) og oppdraget («Nytt oppdrag» og endring på oppdragssiden), slik at feltnavn og
 * feilmeldinger er like. Tom tekst blir `null`. Ukjente felt (også `organizationId`, `number`,
 * `status`, `source`, `issuingCompanyId` og `orderedByFirmId`) tas bort av Zod; kjernen setter dem.
 *
 * Personvern: meldingene har aldri verdien som ble skrevet inn.
 */

const ADDRESS = "Skriv inn adressen.";
const ADDRESS_TOO_LONG = "Adressen kan ha høyst 300 tegn.";
const TEXT_TOO_LONG = "Teksten kan ha høyst 200 tegn.";
const GNR = "Gårdsnummer kan bare ha sifre.";
const BNR = "Bruksnummer kan bare ha sifre.";
const SNR = "Seksjonsnummer kan bare ha sifre.";
const RECEIVED_IN_FUTURE = "Mottatt kan ikke være frem i tid.";
const RECEIVED_INVALID = "Mottatt må være en dato og et klokkeslett.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";
const OFFICE = "Velg kontor.";
const RESPONSIBLE = "Velg ansvarlig takstmann.";
const REPORT_TYPE = "Velg rapporttype.";
const CREATION_KEY = "Skjemaet er ugyldig. Last siden på nytt.";

/**
 * Elleve sifre på rad ligner et fødselsnummer (A299). Mellomrom mellom sifrene teller ikke
 * («010190 12345» stoppes), heller ikke hardt, smalt eller tynt mellomrom fra innliming (`\s`).
 * Ti sifre (telefon) og tolv eller flere (lange ordrenummer) godtas.
 */
const DIGIT_SPACES = /(?<=\d)\s+(?=\d)/g;
const ELEVEN_DIGIT_RUN = /(?<!\d)\d{11}(?!\d)/;

/** Sann når teksten ikke har elleve sifre på rad. Tom tekst er greit. */
export function hasNoElevenDigitRun(value: string | null): boolean {
  return value === null || !ELEVEN_DIGIT_RUN.test(value.replace(DIGIT_SPACES, ""));
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Valgfri fritekst: trimmes, tom blir `null`, høyst `max` tegn, uten elleve sifre på rad. */
function optionalFreeText(max: number, message: string) {
  return z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || value.length <= max, { error: message })
    .refine(hasNoElevenDigitRun, { error: NATIONAL_ID });
}

/** Gnr, bnr og snr: bare sifre, høyst 10. Tom blir `null`. */
function digitsOnly(message: string) {
  return z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || /^\d{1,10}$/.test(value), { error: message });
}

/** Valgfri uuid: tom blir `null`, ellers må det være en uuid. */
function optionalUuid(message: string) {
  return z
    .string({ error: message })
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || isUuid(value), { error: message });
}

/** Påkrevd uuid: tom eller ugyldig gir `message`. */
function requiredUuid(message: string) {
  return z
    .string({ error: message })
    .trim()
    .refine((value) => isUuid(value), { error: message });
}

/** Feltene som er felles for ordre og oppdrag, uten «Mottatt» (som avhenger av `now`). */
const bookingFieldShape = {
  addressText: z
    .string({ error: ADDRESS })
    .trim()
    .min(1, { error: ADDRESS })
    .max(300, { error: ADDRESS_TOO_LONG })
    .refine(hasNoElevenDigitRun, { error: NATIONAL_ID }),
  externalRef: optionalFreeText(200, TEXT_TOO_LONG),
  orderedByText: optionalFreeText(200, TEXT_TOO_LONG),
  gnr: digitsOnly(GNR),
  bnr: digitsOnly(BNR),
  snr: digitsOnly(SNR),
  housingAssociationName: optionalFreeText(200, TEXT_TOO_LONG),
  /**
   * Bestilleren i kontaktregisteret (valgfri). Tom, bare mellomrom og manglende blir `null`.
   * Kjernen slår den opp og setter firmaet fra kontakten.
   */
  orderedByContactId: optionalUuid(CONTACT_NOT_FOUND),
};

/** «Mottatt»: tom blir `now`, tekst er norsk tid, aldri frem i tid. */
function receivedAtSchema(now: Date) {
  return z
    .union([z.string(), z.date()], { error: RECEIVED_INVALID })
    .nullish()
    .transform((value, ctx) => {
      if (value === null || value === undefined || value === "") return now;
      const parsed = parseOsloDateTime(value);
      if (!parsed) {
        ctx.addIssue({ code: "custom", message: RECEIVED_INVALID });
        return z.NEVER;
      }
      return parsed;
    })
    .refine((value) => value.getTime() <= now.getTime(), { error: RECEIVED_IN_FUTURE });
}

/**
 * Bestillingen slik ordreskjemaet og «Endre» på oppdraget sender den (`BookingInput`). `now`
 * sendes inn, så «frem i tid» kan testes med fast tid. Tom «Mottatt» blir `now`; tjenestene for
 * endring tolker tom som uendret.
 */
export function bookingInputSchema(now: Date) {
  return z
    .object({
      ...bookingFieldShape,
      receivedAt: receivedAtSchema(now),
      /** Avkrysningen sender `"on"` når den er krysset av, og ingenting ellers. */
      sellerDeclarationReceived: z
        .union([z.boolean(), z.string()])
        .nullish()
        .transform((value) => value === true || value === "on" || value === "true"),
    })
    .strip();
}
export type BookingValues = z.output<ReturnType<typeof bookingInputSchema>>;

/**
 * Skjemaet «Nytt oppdrag» (`CreateAssignmentInput`). Bestillingsfeltene som over, uten
 * egenerklæringen, pluss kontor, ansvarlig, befaring og engangsnøkkel. Rapporttypen kan sendes,
 * men bare `condition_report` godtas. Tom «Mottatt» blir `now`.
 */
export function createAssignmentInputSchema(now: Date) {
  return z
    .object({
      ...bookingFieldShape,
      receivedAt: receivedAtSchema(now),
      officeId: requiredUuid(OFFICE),
      responsibleEmployeeId: requiredUuid(RESPONSIBLE),
      inspectionAt: assignmentScheduleSchema.shape.inspectionAt,
      creationKey: optionalUuid(CREATION_KEY),
      reportType: z
        .literal("condition_report", { error: REPORT_TYPE })
        .nullish()
        .transform(() => "condition_report" as const),
    })
    .strip();
}
export type CreateAssignmentValues = z.output<ReturnType<typeof createAssignmentInputSchema>>;
