/**
 * Gjelder avtalen i dag? `today` er en ren dato fra `todayInOslo(now)`. `validTo` er siste
 * gyldige dag; tom betyr løpende. Ren funksjon, brukes både av kjernen og av siden.
 */
export function isAgreementActive(
  { validFrom, validTo }: { validFrom: string; validTo: string | null },
  today: string,
): boolean {
  return validFrom <= today && (validTo === null || validTo >= today);
}
