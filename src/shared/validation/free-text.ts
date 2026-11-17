/*
 * Felles sperre mot fødselsnummer i fritekst (CLAUDE.md regel 8, docs/funksjoner/fase2a-badet-pc.md
 * Omfang 10). Står ett sted, slik at tilbud, rapport og andre skjemaer stopper det samme.
 *
 * Elleve sifre på rad ligner et fødselsnummer. Ti godtas (for eksempel telefonnummer med 0).
 * Ingen kontrollsiffersjekk: heller for strengt enn for slapt.
 */

/** Meldingen når teksten ligner et fødselsnummer. */
export const NATIONAL_ID_MESSAGE = "Fødselsnummer skal ikke lagres her.";

/** Elleve sifre på rad. */
export const ELEVEN_DIGITS = /\d{11}/;

/** Mellomrom, punktum og bindestrek mellom sifre («010190 12345» stoppes også). */
const DIGIT_SEPARATORS = /(?<=\d)[\s.-]+(?=\d)/g;

/**
 * Sann når teksten ligner et fødselsnummer, også med mellomrom, punktum eller bindestrek mellom
 * sifrene. Tom tekst gir `false`.
 */
export function containsNationalId(value: string | null | undefined): boolean {
  if (!value) return false;
  return ELEVEN_DIGITS.test(value.replace(DIGIT_SEPARATORS, ""));
}
