import { z } from "zod";
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

/** Klokkeslett fra skjemaet uten tidssone («2026-11-03T10:15»): leses som norsk tid. */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const osloParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Oslo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Hvor mange millisekunder norsk tid ligger foran UTC i øyeblikket `time`. */
function osloOffset(time: number): number {
  const parts = Object.fromEntries(
    osloParts.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(time / 1000) * 1000;
}

/** Gjør tekst eller dato om til et tidspunkt. Ugyldig gir `null`. */
function parseReceivedAt(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = value.trim();
  const local = LOCAL_DATE_TIME.exec(text);
  if (local) {
    const [year, month, day, hour, minute, second] = local.slice(1).map((v) => Number(v ?? 0));
    const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
    const check = new Date(wall);
    if (
      check.getUTCMonth() !== month! - 1 ||
      check.getUTCDate() !== day! ||
      hour! > 23 ||
      minute! > 59 ||
      second! > 59
    ) {
      return null;
    }
    // To runder, så tidspunkt rett ved bytte til og fra sommertid blir riktig.
    const first = wall - osloOffset(wall);
    return new Date(wall - osloOffset(first));
  }
  // Ellers bare ISO-tekst med dato først (med eller uten tidssone).
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  // Avvis datoer som ikke finnes, for eksempel 2026-02-30
  if (text.length === 10 && parsed.toISOString().slice(0, 10) !== text) return null;
  return parsed;
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
    receivedAt: z
      .union([z.string(), z.date()], { error: RECEIVED_INVALID })
      .nullish()
      .transform((value, ctx) => {
        if (value === null || value === undefined || value === "") return now;
        const parsed = parseReceivedAt(value);
        if (!parsed) {
          ctx.addIssue({ code: "custom", message: RECEIVED_INVALID });
          return z.NEVER;
        }
        return parsed;
      })
      .refine((value) => value.getTime() <= now.getTime(), { error: RECEIVED_IN_FUTURE }),
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

/** Grunnen for å avvise en ordre: 1–500 tegn, trimmet, uten fødselsnummer. */
export const rejectReasonSchema = z
  .string({ error: REASON })
  .trim()
  .min(1, { error: REASON })
  .max(500, { error: REASON_TOO_LONG })
  .refine((value) => !ELEVEN_DIGITS.test(value), { error: NATIONAL_ID });
