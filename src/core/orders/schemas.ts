import { z } from "zod";
import { parseOsloDateTime } from "@/shared/lib/dates";
import { isUuid } from "@/shared/lib/uuid";

/*
 * Validering av ordreskjemaet og avvisningsgrunnen. Samme skjema brukes av kjernen og skjermene,
 * slik at feltnavn og feilmeldinger er like. Tom tekst blir `null`.
 *
 * `source` og `requestedReportType` finnes ikke i skjemaet: kjernen setter `manual` og
 * `condition_report`. Ukjente felt (også `organizationId`) tas bort av Zod.
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
const REASON = "Skriv inn en grunn.";
const REASON_TOO_LONG = "Grunnen kan ha høyst 500 tegn.";
const CONTACT_NOT_FOUND = "Kontakten finnes ikke.";

/** Elleve sifre på rad ligner et fødselsnummer. Ti godtas (for eksempel telefonnummer med 0). */
const ELEVEN_DIGITS = /\d{11}/;

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

/** Gnr, bnr og snr: bare sifre, høyst 10. Tom blir `null`. */
function digitsOnly(message: string) {
  return z
    .string()
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || /^\d{1,10}$/.test(value), { error: message });
}

/**
 * Mottatt: dato og klokkeslett, ikke frem i tid. Tom eller manglende gir `whenEmpty` (`now` ved
 * oppretting, `null` = «behold verdien på raden» ved endring).
 */
function receivedAtField<T extends Date | null>(now: Date, whenEmpty: T) {
  return z
    .union([z.string(), z.date()], { error: RECEIVED_INVALID })
    .nullish()
    .transform((value, ctx): Date | T => {
      if (value === null || value === undefined || value === "") return whenEmpty;
      const parsed = parseOsloDateTime(value);
      if (!parsed) {
        ctx.addIssue({ code: "custom", message: RECEIVED_INVALID });
        return z.NEVER;
      }
      return parsed;
    })
    .refine((value) => value === null || value.getTime() <= now.getTime(), {
      error: RECEIVED_IN_FUTURE,
    });
}

/**
 * Skjemaet for en ny ordre. `now` sendes inn, så «frem i tid» kan testes med fast tid; mangler
 * mottatt, blir det `now`.
 */
export function orderInputSchema(now: Date) {
  return z.object({
    addressText: z
      .string({ error: ADDRESS })
      .trim()
      .min(1, { error: ADDRESS })
      .max(300, { error: ADDRESS_TOO_LONG }),
    receivedAt: receivedAtField(now, now),
    externalRef: optionalText(200, TEXT_TOO_LONG),
    orderedByText: optionalText(200, TEXT_TOO_LONG).refine(
      (value) => value === null || !ELEVEN_DIGITS.test(value),
      { error: NATIONAL_ID },
    ),
    gnr: digitsOnly(GNR),
    bnr: digitsOnly(BNR),
    snr: digitsOnly(SNR),
    housingAssociationName: optionalText(200, TEXT_TOO_LONG),
    /** Avkrysningen sender `"on"` når den er krysset av, og ingenting ellers. */
    sellerDeclarationReceived: z
      .union([z.boolean(), z.string()])
      .nullish()
      .transform((value) => value === true || value === "on" || value === "true"),
    /**
     * Bestilleren i kontaktregisteret (valgfri). Tom, bare mellomrom og manglende blir `null`.
     * Kjernen slår den opp og setter firmaet fra kontakten.
     */
    orderedByContactId: z
      .string({ error: CONTACT_NOT_FOUND })
      .nullish()
      .transform(emptyToNull)
      .refine((value) => value === null || isUuid(value), { error: CONTACT_NOT_FOUND }),
  });
}
export type OrderInput = z.input<ReturnType<typeof orderInputSchema>>;
export type OrderValues = z.output<ReturnType<typeof orderInputSchema>>;

/**
 * Skjemaet for å endre en lagret ordre (T1). Samme regler og meldinger som `orderInputSchema`;
 * eneste forskjell er at tom eller manglende mottatt gir `null`, som betyr «behold verdien på
 * raden». Tomme valgfrie felt betyr «tøm». Firma-id, status og andre felt utenfor
 * `ORDER_EDITABLE_FIELDS` tas bort av Zod og skrives aldri.
 */
export function orderUpdateSchema(now: Date) {
  return orderInputSchema(now).extend({ receivedAt: receivedAtField(now, null) });
}
export type OrderUpdateInput = z.input<ReturnType<typeof orderUpdateSchema>>;
export type OrderUpdateValues = z.output<ReturnType<typeof orderUpdateSchema>>;

/** Grunnen for å avvise en ordre: 1–500 tegn, trimmet, uten fødselsnummer. */
export const rejectReasonSchema = z
  .string({ error: REASON })
  .trim()
  .min(1, { error: REASON })
  .max(500, { error: REASON_TOO_LONG })
  .refine((value) => !ELEVEN_DIGITS.test(value), { error: NATIONAL_ID });
