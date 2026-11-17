import { z } from "zod";
import { bookingInputSchema } from "@/core/assignments/booking/schemas";
import { addDays, todayInOslo } from "@/shared/lib/dates";
import { ELEVEN_DIGITS, NATIONAL_ID_MESSAGE } from "@/shared/validation/free-text";
import {
  OFFER_REJECTION_OTHER,
  isOfferRejectionReasonKey,
  type OfferRejectionReasonKey,
} from "./codes";
import { OFFER_VALID_DAYS, OFFER_VALID_UNTIL_MAX_DAYS } from "./contract";

/*
 * Validering av tilbudsskjemaet (ordre i koden, ADR 0012) og avslagsgrunnen. Bestillingsfeltene
 * har de felles reglene for ordre og oppdrag (`bookingInputSchema` i `@/core/assignments/booking/schemas`, ADR 0011), slik
 * at ordre og oppdrag godtar og avviser det samme. Tom tekst blir `null`.
 *
 * `source` og `requestedReportType` finnes ikke i skjemaet: kjernen setter `manual` og
 * `condition_report`. Ukjente felt (også `organizationId`) tas bort av Zod.
 */

const REASON_KEY = "Velg en grunn.";
const REASON_TEXT = "Skriv grunnen.";
const REASON_TOO_LONG = "Grunnen kan ha høyst 500 tegn.";
const VALID_UNTIL_INVALID = "Gyldig til må være en dato.";
const VALID_UNTIL_PAST = "Gyldig til kan ikke være før i dag.";
const VALID_UNTIL_TOO_LATE = "Gyldig til kan være høyst ett år fram.";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Er teksten en dato som finnes, i formen «ÅÅÅÅ-MM-DD»? */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** «Gyldig til»: tom eller utelatt blir `null`, ellers en dato som finnes. Ingen grenser her. */
const validUntilFormatSchema = z
  .string({ error: VALID_UNTIL_INVALID })
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  })
  .refine((value) => value === null || isIsoDate(value), { error: VALID_UNTIL_INVALID });

/**
 * Grensene for «Gyldig til» (A328): ikke før `today`, høyst `OFFER_VALID_UNTIL_MAX_DAYS` dager
 * fram. Datoen må alt være en gyldig «ÅÅÅÅ-MM-DD».
 */
export function validUntilBoundsSchema(today: string) {
  const latest = addDays(today, OFFER_VALID_UNTIL_MAX_DAYS);
  return z
    .string()
    .refine((value) => value >= today, { error: VALID_UNTIL_PAST })
    .refine((value) => value <= latest, { error: VALID_UNTIL_TOO_LATE });
}

/**
 * Skjemaet for et nytt tilbud: bestillingsfeltene (`bookingInputSchema`, felles med oppdraget)
 * og «Gyldig til». `now` sendes inn, så «frem i tid» og dagens dato kan testes med fast tid.
 * Mangler mottatt, blir det `now`. Mangler «Gyldig til», blir det i dag + `OFFER_VALID_DAYS`;
 * ellers må datoen ligge mellom i dag og i dag + `OFFER_VALID_UNTIL_MAX_DAYS`.
 */
export function orderInputSchema(now: Date) {
  const today = todayInOslo(now);
  const bounds = validUntilBoundsSchema(today);
  return bookingInputSchema(now).extend({
    validUntil: validUntilFormatSchema.pipe(
      z
        .string()
        .nullable()
        .transform((value) => value ?? addDays(today, OFFER_VALID_DAYS))
        .pipe(bounds),
    ),
  });
}
export type OrderInput = z.input<ReturnType<typeof orderInputSchema>>;
export type OrderValues = z.output<ReturnType<typeof orderInputSchema>>;

/**
 * Skjemaet for endring av et lagret tilbud. Som `orderInputSchema`, men tom eller utelatt
 * «Gyldig til» blir `null` (uendret), og grensene sjekkes ikke her: `updateOrder` sjekker dem
 * bare når datoen er ulik den lagrede (A328), med `validUntilBoundsSchema`.
 */
export function orderUpdateInputSchema(now: Date) {
  return bookingInputSchema(now).extend({ validUntil: validUntilFormatSchema });
}
export type OrderUpdateValues = z.output<ReturnType<typeof orderUpdateInputSchema>>;

/** Friteksten til avslaget: trimmes, tom blir `null`, høyst 500 tegn, uten fødselsnummer. */
const reasonTextSchema = z
  .string({ error: REASON_TEXT })
  .nullish()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  })
  .refine((value) => value === null || value.length <= 500, { error: REASON_TOO_LONG })
  .refine((value) => value === null || !ELEVEN_DIGITS.test(value), { error: NATIONAL_ID_MESSAGE });

/**
 * Grunnen for å avslå et tilbud (F4, A361): en av de faste kodene, og fritekst som er påkrevd
 * bare ved «Annet» (`other`). Uten kode: «Velg en grunn.». «Annet» uten tekst: «Skriv grunnen.».
 */
export const rejectReasonSchema = z
  .object({
    reasonKey: z
      .unknown()
      .refine(isOfferRejectionReasonKey, { error: REASON_KEY })
      .transform((value) => value as OfferRejectionReasonKey),
    reasonText: reasonTextSchema,
  })
  .strip()
  .superRefine((value, ctx) => {
    if (value.reasonKey === OFFER_REJECTION_OTHER && value.reasonText === null) {
      ctx.addIssue({ code: "custom", path: ["reasonText"], message: REASON_TEXT });
    }
  });
export type RejectReasonValues = z.output<typeof rejectReasonSchema>;
