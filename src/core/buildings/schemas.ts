import { z } from "zod";
import { isUuid } from "@/shared/lib/uuid";
import { AREA_TYPES, MEASURING_METHODS, ROOM_TYPE_KEYS } from "./codes";

/*
 * Validering av bygninger, etasjer, areal og rom. Samme skjema brukes av kjernen og skjermen, slik
 * at feltnavn og feilmeldinger er like. Tekst trimmes, og tom valgfri tekst blir `null`. Ukjente
 * felt (også `organizationId`, `id`, `assignmentId` og `floorId`) tas bort av Zod.
 */

const BUILDING_NAME = "Skriv inn navnet på bygningen.";
const BUILDING_NAME_TOO_LONG = "Navnet kan ha høyst 100 tegn.";
const FLOOR_NAME = "Skriv inn navnet på etasjen.";
const FLOOR_NAME_TOO_LONG = "Navnet kan ha høyst 50 tegn.";
const LEVEL = "Etasjenummeret må være mellom −3 og 20.";
const AREA = "Arealet må være et tall mellom 0 og 9999,9 med høyst én desimal.";
const MEASURED_BY = "Velg hvem som målte.";
const METHOD = "Velg metode fra listen.";
const COMMENT_TOO_LONG = "Kommentaren kan ha høyst 1000 tegn.";
const ROOM_TYPE = "Velg romtype.";
const ROOM_NAME_TOO_LONG = "Navnet kan ha høyst 100 tegn.";
const AREA_TYPE = "Velg arealtype.";
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";

/** Elleve sifre på rad ligner et fødselsnummer. Ti godtas (samme mønster som eiendommen). */
const ELEVEN_DIGITS = /\d{11}/;

const MAX_AREA_TENTHS = 99_999;

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hasNoNationalId(value: string | null): boolean {
  return value === null || !ELEVEN_DIGITS.test(value);
}

/** Tom verdi fra skjemaet (mangler, `null` eller bare mellomrom). */
function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

/** Påkrevd navn: trimmes, 1 til `max` tegn, ikke fødselsnummer. */
function requiredName(max: number, required: string, tooLong: string) {
  return z
    .string({ error: required })
    .trim()
    .min(1, { error: required })
    .max(max, { error: tooLong })
    .refine((value) => !ELEVEN_DIGITS.test(value), { error: NATIONAL_ID });
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

/** Avkrysning fra skjemaet: `true`, `"on"` og `"true"` er sann. */
function isChecked(value: unknown): boolean {
  return value === true || value === "on" || value === "true";
}

/**
 * Areal i m²: tall eller tekst med komma eller punktum, 0–9999,9, høyst én desimal. Tom blir
 * `null`. Regnes i tideler, så tallet kommer ut uten flyttallsfeil.
 */
const area = z
  .union([z.string(), z.number()], { error: AREA })
  .nullish()
  .transform((value, ctx): number | null => {
    if (isBlank(value)) return null;
    let tenths: number;
    if (typeof value === "number") {
      tenths = Math.round(value * 10);
      if (!Number.isFinite(value) || Math.abs(value * 10 - tenths) > 1e-6) tenths = -1;
    } else {
      const match = /^(\d{1,4})(?:[.,](\d))?$/.exec((value as string).trim());
      tenths = match ? Number(match[1]) * 10 + Number(match[2] ?? 0) : -1;
    }
    if (tenths < 0 || tenths > MAX_AREA_TENTHS) {
      ctx.addIssue({ code: "custom", message: AREA });
      return z.NEVER;
    }
    return tenths / 10;
  });

/** Bygningen: bare navnet nå. */
export const buildingInputSchema = z.object({
  name: requiredName(100, BUILDING_NAME, BUILDING_NAME_TOO_LONG),
});
export type BuildingInput = z.input<typeof buildingInputSchema>;
export type BuildingValues = z.output<typeof buildingInputSchema>;

/** Etasjen: navn, etasjenummer (−3 til 20) og om den er under terreng. */
export const floorInputSchema = z.object({
  name: requiredName(50, FLOOR_NAME, FLOOR_NAME_TOO_LONG),
  level: z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value.trim()) : value),
    z
      .number({ error: LEVEL })
      .int({ error: LEVEL })
      .min(-3, { error: LEVEL })
      .max(20, { error: LEVEL }),
  ),
  belowGround: z.unknown().optional().transform(isChecked),
});
export type FloorInput = {
  name?: string | null;
  level?: number | string | null;
  belowGround?: boolean | string | null;
};
export type FloorValues = z.output<typeof floorInputSchema>;

/** Arealet i én etasje (A86). «Målt av» sjekkes i kjernen mot ansatte i organisasjonen. */
export const floorAreaInputSchema = z.object({
  braI: area,
  braE: area,
  braB: area,
  alh: area,
  measuredBy: z
    .string({ error: MEASURED_BY })
    .nullish()
    .transform(emptyToNull)
    .refine((value) => value === null || isUuid(value), { error: MEASURED_BY }),
  method: z.preprocess(
    (value) => (isBlank(value) ? null : value),
    z.enum(MEASURING_METHODS, { error: METHOD }).nullable(),
  ),
  comment: optionalText(1000, COMMENT_TOO_LONG),
});
export type FloorAreaInput = {
  braI?: number | string | null;
  braE?: number | string | null;
  braB?: number | string | null;
  alh?: number | string | null;
  measuredBy?: string | null;
  method?: string | null;
  comment?: string | null;
};
export type FloorAreaValues = z.output<typeof floorAreaInputSchema>;

/**
 * Rommet. Mangler arealtype eller «under terreng», brukes forslagene fra romtypen og etasjen i
 * kjernen (A87); da er verdien `undefined` her.
 */
export const roomInputSchema = z.object({
  roomType: z.enum(ROOM_TYPE_KEYS, { error: ROOM_TYPE }),
  name: optionalText(100, ROOM_NAME_TOO_LONG),
  areaType: z.preprocess(
    (value) => (isBlank(value) ? undefined : value),
    z.enum(AREA_TYPES, { error: AREA_TYPE }).optional(),
  ),
  belowGround: z
    .unknown()
    .optional()
    .transform((value) => (isBlank(value) ? undefined : isChecked(value))),
});
export type RoomInput = {
  roomType?: string | null;
  name?: string | null;
  areaType?: string | null;
  belowGround?: boolean | string | null;
};
export type RoomValues = z.output<typeof roomInputSchema>;
