import { z } from "zod";
import { isUuid } from "@/shared/lib/uuid";

/*
 * Validering av avtale med oppdragsgiver. Samme skjema brukes av kjernen og skjermene, slik at
 * feltnavn og feilmeldinger er like. Tom valgfri tekst blir `null`. `organizationId` finnes
 * ikke i skjemaet: kjernen tar organisasjonen fra tilgangssjekken. Ukjente felt tas bort av Zod.
 */

export const AGREEMENT_NAME_MAX = 120;
export const PREMISE_TEXT_MAX = 10_000;
export const REPORT_PROFILE_CODE_MAX = 60;

const FIRM = "Velg et firma.";
const NAME = "Skriv inn navnet på avtalen.";
const NAME_TOO_LONG = `Navnet kan ha høyst ${AGREEMENT_NAME_MAX} tegn.`;
const VALID_FROM = "Skriv inn en gyldig fra-dato.";
const VALID_TO = "Til-datoen er ikke en gyldig dato.";
const RANGE = "Til-datoen kan ikke være før fra-datoen.";
const PREMISE_TOO_LONG = "Premisseteksten kan ha høyst 10 000 tegn.";
const PROFILE_TOO_LONG = `Rapportprofilen kan ha høyst ${REPORT_PROFILE_CODE_MAX} tegn.`;

/** Sjekker at `YYYY-MM-DD` er en dato som finnes (ikke 2026-02-30). */
function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const agreementSchema = z
  .object({
    firmId: z
      .string({ error: FIRM })
      .trim()
      .refine((value) => isUuid(value), { error: FIRM }),
    name: z
      .string({ error: NAME })
      .trim()
      .min(1, { error: NAME })
      .max(AGREEMENT_NAME_MAX, { error: NAME_TOO_LONG }),
    validFrom: z.string({ error: VALID_FROM }).trim().refine(isRealIsoDate, { error: VALID_FROM }),
    validTo: z
      .string({ error: VALID_TO })
      .nullish()
      .transform(trimToNull)
      .refine((value) => value === null || isRealIsoDate(value), { error: VALID_TO }),
    // Premisseteksten trimmes ikke inni; bare tom tekst (eller bare mellomrom) blir `null`.
    premiseText: z
      .string()
      .nullish()
      .transform((value) => (value && value.trim() ? value : null))
      .refine((value) => value === null || value.length <= PREMISE_TEXT_MAX, {
        error: PREMISE_TOO_LONG,
      }),
    reportProfileCode: z
      .string()
      .nullish()
      .transform(trimToNull)
      .refine((value) => value === null || value.length <= REPORT_PROFILE_CODE_MAX, {
        error: PROFILE_TOO_LONG,
      }),
  })
  .superRefine((value, ctx) => {
    // Bare når begge datoene er gyldige; ellers har feltet selv allerede en feilmelding.
    if (
      value.validTo !== null &&
      isRealIsoDate(value.validFrom) &&
      isRealIsoDate(value.validTo) &&
      value.validTo < value.validFrom
    ) {
      ctx.addIssue({ code: "custom", message: RANGE, path: ["validTo"] });
    }
  });

export type AgreementInput = z.input<typeof agreementSchema>;
export type AgreementValues = z.output<typeof agreementSchema>;
