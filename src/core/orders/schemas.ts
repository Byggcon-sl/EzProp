import { z } from "zod";
import { bookingInputSchema } from "@/core/assignments/booking/schemas";

/*
 * Validering av ordreskjemaet og avvisningsgrunnen. Bestillingsfeltene har de felles reglene for
 * ordre og oppdrag (`bookingInputSchema` i `@/core/assignments/booking/schemas`, ADR 0011), slik
 * at ordre og oppdrag godtar og avviser det samme. Tom tekst blir `null`.
 *
 * `source` og `requestedReportType` finnes ikke i skjemaet: kjernen setter `manual` og
 * `condition_report`. Ukjente felt (også `organizationId`) tas bort av Zod.
 */

const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const REASON = "Skriv inn en grunn.";
const REASON_TOO_LONG = "Grunnen kan ha høyst 500 tegn.";

/** Elleve sifre på rad ligner et fødselsnummer. Ti godtas (for eksempel telefonnummer med 0). */
const ELEVEN_DIGITS = /\d{11}/;

/**
 * Skjemaet for en ny eller endret ordre. `now` sendes inn, så «frem i tid» kan testes med fast
 * tid; mangler mottatt, blir det `now`.
 */
export const orderInputSchema = bookingInputSchema;
export type OrderInput = z.input<ReturnType<typeof orderInputSchema>>;
export type OrderValues = z.output<ReturnType<typeof orderInputSchema>>;

/** Grunnen for å avvise en ordre: 1–500 tegn, trimmet, uten fødselsnummer. */
export const rejectReasonSchema = z
  .string({ error: REASON })
  .trim()
  .min(1, { error: REASON })
  .max(500, { error: REASON_TOO_LONG })
  .refine((value) => !ELEVEN_DIGITS.test(value), { error: NATIONAL_ID });
