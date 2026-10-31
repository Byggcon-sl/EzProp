/*
 * Sertifisering med utløpsdato (funksjonskart H5, A29–A31). Ren datoregel uten database, slik at
 * den kan testes med faste datoer og brukes både i tilgangssjekken og i adminlisten.
 */

/** Faste koder for område (regel 6: en kode endres aldri, den arkiveres). */
export const certificationAreas = ["condition_report"] as const;
export type CertificationArea = (typeof certificationAreas)[number];

/** Etikett i grensesnittet per område. */
export const certificationAreaLabels: Record<CertificationArea, string> = {
  condition_report: "Tilstandsrapport bolig",
};

/**
 * Hvor mange dager før utløp en sertifisering vises i listen «går ut snart» (A31). Blir en
 * innstilling sammen med varslene i fase 3.
 */
export const CERTIFICATION_EXPIRY_WARNING_DAYS = 60;

const osloDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Datoen i dag i norsk tid, som `YYYY-MM-DD`. */
export function todayInOslo(now: Date = new Date()): string {
  return osloDate.format(now);
}

/** Legger dager til en dato `YYYY-MM-DD` (kalenderdager, uten tidssone). */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Gyldig betyr: ikke slettet, `validFrom` er tom eller i dag eller tidligere, og `validTo` er i
 * dag eller senere. Utløpsdagen er siste gyldige dag. Datoene er `YYYY-MM-DD`, så de kan
 * sammenlignes som tekst.
 */
export function isCertificationValid(
  cert: { validFrom: string | null; validTo: string; deletedAt: Date | null },
  today: string,
): boolean {
  if (cert.deletedAt !== null) return false;
  if (cert.validFrom !== null && cert.validFrom > today) return false;
  return cert.validTo >= today;
}
