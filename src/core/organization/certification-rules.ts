import { addDays } from "@/shared/lib/dates";

/**
 * Datoregelen for sertifiseringer (A29–A31). Ren kode uten database, slik at den kan testes med
 * fast dato og brukes likt overalt. Alle datoer er «ÅÅÅÅ-MM-DD» i norsk tid (`todayInOslo`), og
 * sammenlignes som tekst (det gir riktig rekkefølge for dette formatet).
 */

/** Områdene en sertifisering kan gjelde. Faste koder (regel 6): nye områder er nye koder. */
export const CERTIFICATION_AREAS = [
  { key: "condition_report", label: "Tilstandsrapport bolig" },
] as const;
export type CertificationArea = (typeof CERTIFICATION_AREAS)[number]["key"];
/** Kodene som tuppel, til `z.enum`. */
export const CERTIFICATION_AREA_KEYS = CERTIFICATION_AREAS.map((area) => area.key) as [
  CertificationArea,
  ...CertificationArea[],
];

/** Hvor mange dager før utløp en sertifisering regnes som «går ut snart» (A31). */
export const EXPIRING_SOON_DAYS = 60;

type CertificationDates = {
  validFrom: string | null;
  validTo: string;
  deletedAt?: Date | null;
};

export type CertificationStatus = "valid" | "expiring" | "expired" | "not_started";

/** Gyldig på `today`: ikke slettet, startet (eller uten startdato), og utløpsdagen ikke passert. */
export function isCertificationValid(cert: CertificationDates, today: string): boolean {
  if (cert.deletedAt) return false;
  if (cert.validFrom !== null && cert.validFrom > today) return false;
  return cert.validTo >= today;
}

/** Går ut innen `days` dager fra `today` (eller har gått ut). Slettede rader teller ikke. */
export function expiresWithin(cert: CertificationDates, today: string, days: number): boolean {
  if (cert.deletedAt) return false;
  return cert.validTo <= addDays(today, days);
}

/** Status til merkene i skjermen: utgått, ikke startet, går ut snart eller gyldig. */
export function certificationStatus(cert: CertificationDates, today: string): CertificationStatus {
  if (cert.validTo < today) return "expired";
  if (cert.validFrom !== null && cert.validFrom > today) return "not_started";
  if (cert.validTo <= addDays(today, EXPIRING_SOON_DAYS)) return "expiring";
  return "valid";
}
