/*
 * Kontroll av norsk organisasjonsnummer (ni sifre, siste siffer er kontrollsiffer etter
 * modulus 11). Ren funksjon uten database, så den kan kjøres både i skjemaet og i testene.
 */

const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

/** Fjerner alle mellomrom. Andre tegn (bindestrek, punktum) står igjen og gjør nummeret ugyldig. */
export function normalizeOrgNumber(value: string): string {
  return value.replace(/\s+/g, "");
}

/**
 * Sann når verdien (etter at mellomrom er fjernet) er nøyaktig ni sifre og kontrollsifferet
 * stemmer: summen av de åtte første sifrene ganget med vektene 3, 2, 7, 6, 5, 4, 3, 2 deles på
 * 11. Rest 0 gir kontrollsiffer 0; ellers er kontrollsifferet 11 minus resten. Blir det 10, er
 * nummeret ugyldig.
 */
export function isValidOrgNumber(value: string): boolean {
  const digits = normalizeOrgNumber(value);
  if (!/^\d{9}$/.test(digits)) return false;
  let sum = 0;
  WEIGHTS.forEach((weight, index) => {
    sum += Number(digits[index]) * weight;
  });
  const remainder = sum % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  if (check === 10) return false;
  return check === Number(digits[8]);
}
