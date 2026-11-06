import { z } from "zod";
import { isUuid } from "@/shared/lib/uuid";
import {
  CLAIM_OUTCOMES_WITH_AMOUNT,
  isClaimOutcome,
  isClaimType,
  type ClaimOutcome,
  type ClaimType,
} from "./codes";

/*
 * Validering av reklamasjonssak (docs/funksjoner/fase2a-reklamasjoner.md, «Regler»). Samme skjema
 * brukes ved registrering og endring, av kjernen og skjermene.
 *
 * Regelkoder: hver feil fra skjemaet er en `custom`-feil med regelkoden i `params.rule`, slik at
 * testsakene kan peke på regelen uten å lese meldingsteksten. Kodene er:
 * - `enum_values`: type eller utfall er ikke en kjent kode.
 * - `received_at_date`: mottatt dato mangler eller er ikke en gyldig dato.
 * - `received_at_not_future`: mottatt dato er etter dagens dato i Europe/Oslo.
 * - `claimant_party_id`: part-id-en har feil format.
 * - `claimant_required`: verken part eller fritekst for klager er fylt.
 * - `text_limits`: beskrivelsen er tom eller over 2 000 tegn, klager eller bygningsdel over 200.
 * - `no_national_id`: klager, beskrivelse eller bygningsdel har elleve sifre på rad (ligner et
 *   fødselsnummer). Mellomrom, punktum og bindestrek mellom sifrene teller ikke.
 * - `amount_only_upheld_or_settled`: beløp er ikke et heltall fra 0, eller er satt uten at
 *   utfallet er medhold eller forlik. Gjelder også gjenåpning: beløpet nullstilles aldri i
 *   stillhet, endringen avvises.
 *
 * Dagens dato sendes inn (`todayInOslo(now)` fra `@/shared/lib/dates`), så testene kan sette
 * tiden. Tom valgfri tekst blir `null`. Ukjente felt (`organizationId`, `closedAt`, `createdBy`
 * og andre) tas bort: kjernen setter dem selv.
 */

export const CLAIMANT_TEXT_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const BUILDING_PART_TEXT_MAX = 200;
/** Største beløp databasen tar (integer). */
const AMOUNT_MAX = 2_147_483_647;

export type ClaimRule =
  | "enum_values"
  | "received_at_date"
  | "received_at_not_future"
  | "claimant_party_id"
  | "claimant_required"
  | "text_limits"
  | "no_national_id"
  | "amount_only_upheld_or_settled";

const TYPE = "Velg type krav.";
const OUTCOME = "Velg et gyldig utfall.";
const RECEIVED_AT = "Skriv inn en gyldig dato for når kravet kom.";
const RECEIVED_AT_FUTURE = "Datoen kan ikke være fram i tid.";
const PARTY = "Velg en part fra oppdraget.";
const CLAIMANT_REQUIRED = "Velg en part eller skriv hvem som klaget.";
const CLAIMANT_TOO_LONG = `Hvem som klaget kan ha høyst ${CLAIMANT_TEXT_MAX} tegn.`;
const DESCRIPTION = "Skriv kort hva som påstås.";
const DESCRIPTION_TOO_LONG = "Beskrivelsen kan ha høyst 2 000 tegn.";
const BUILDING_PART_TOO_LONG = `Bygningsdelen kan ha høyst ${BUILDING_PART_TEXT_MAX} tegn.`;
const NATIONAL_ID = "Fødselsnummer skal ikke lagres her.";
const AMOUNT_INVALID = "Beløpet må være et helt antall kroner, 0 eller mer.";
const AMOUNT_NOT_ALLOWED = "Beløp kan bare fylles ut ved medhold eller forlik.";

function rule(name: ClaimRule, error: string) {
  return { error, params: { rule: name } };
}

/**
 * Elleve sifre på rad ligner et fødselsnummer (samme regel som i oppdrag, kontakter og eiendom).
 * Mellomrom, punktum og bindestrek mellom sifrene teller ikke («010190 12345» stoppes også).
 */
const ELEVEN_DIGITS = /\d{11}/;
const DIGIT_SEPARATORS = /(?<=\d)[\s.-]+(?=\d)/g;

function hasNoNationalId(value: string | null): boolean {
  return value === null || !ELEVEN_DIGITS.test(value.replace(DIGIT_SEPARATORS, ""));
}

/** Sjekker at `YYYY-MM-DD` er en dato som finnes (ikke 2026-02-30). */
function isRealIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isOptionalString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function trimToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Valgfri fritekst: trimmes, tom blir `null`, høyst `max` tegn. */
function optionalText(max: number, tooLong: string) {
  return z
    .custom<string | null>(isOptionalString, rule("text_limits", tooLong))
    .optional()
    .transform(trimToNull)
    .refine((value) => value === null || value.length <= max, rule("text_limits", tooLong))
    .refine(hasNoNationalId, rule("no_national_id", NATIONAL_ID));
}

/** Skjemaet for registrering og endring. `today` er dagens dato i Europe/Oslo (`YYYY-MM-DD`). */
export function claimInputSchema(today: string) {
  return z
    .object({
      claimType: z.custom<ClaimType>(
        (value) => typeof value === "string" && isClaimType(value),
        rule("enum_values", TYPE),
      ),
      receivedAt: z
        .custom<string>(
          (value) => typeof value === "string" && isRealIsoDate(value.trim()),
          rule("received_at_date", RECEIVED_AT),
        )
        .transform((value) => value.trim())
        // Ren tekstsammenligning virker fordi begge er `YYYY-MM-DD`.
        .refine((value) => value <= today, rule("received_at_not_future", RECEIVED_AT_FUTURE)),
      claimantPartyId: z
        .custom<string | null>(isOptionalString, rule("claimant_party_id", PARTY))
        .optional()
        .transform(trimToNull)
        .refine((value) => value === null || isUuid(value), rule("claimant_party_id", PARTY)),
      claimantText: optionalText(CLAIMANT_TEXT_MAX, CLAIMANT_TOO_LONG),
      description: z
        .custom<string>((value) => typeof value === "string", rule("text_limits", DESCRIPTION))
        .transform((value) => value.trim())
        .refine((value) => value.length >= 1, rule("text_limits", DESCRIPTION))
        .refine(
          (value) => value.length <= DESCRIPTION_MAX,
          rule("text_limits", DESCRIPTION_TOO_LONG),
        )
        .refine(hasNoNationalId, rule("no_national_id", NATIONAL_ID)),
      buildingPartText: optionalText(BUILDING_PART_TEXT_MAX, BUILDING_PART_TOO_LONG),
      outcome: z
        .custom<ClaimOutcome>(
          (value) => typeof value === "string" && isClaimOutcome(value),
          rule("enum_values", OUTCOME),
        )
        .optional()
        .transform((value): ClaimOutcome => value ?? "open"),
      amount: z
        .custom<number | null>(
          (value) =>
            value === null ||
            (typeof value === "number" &&
              Number.isInteger(value) &&
              value >= 0 &&
              value <= AMOUNT_MAX),
          rule("amount_only_upheld_or_settled", AMOUNT_INVALID),
        )
        .optional()
        .transform((value) => value ?? null),
    })
    .superRefine((value, ctx) => {
      if (value.claimantPartyId === null && value.claimantText === null) {
        ctx.addIssue({
          code: "custom",
          message: CLAIMANT_REQUIRED,
          path: ["claimantText"],
          params: { rule: "claimant_required" },
        });
      }
      const amountAllowed = (CLAIM_OUTCOMES_WITH_AMOUNT as readonly ClaimOutcome[]).includes(
        value.outcome,
      );
      if (value.amount !== null && !amountAllowed) {
        ctx.addIssue({
          code: "custom",
          message: AMOUNT_NOT_ALLOWED,
          path: ["amount"],
          params: { rule: "amount_only_upheld_or_settled" },
        });
      }
    });
}

export type ClaimInput = z.input<ReturnType<typeof claimInputSchema>>;
export type ClaimValues = z.output<ReturnType<typeof claimInputSchema>>;
