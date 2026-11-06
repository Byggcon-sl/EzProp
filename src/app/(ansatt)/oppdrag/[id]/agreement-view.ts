import { isAgreementActive } from "@/core/agreements/active";

/*
 * Rene hjelpere til kortet «Avtale» på oppdragssiden. Ingen React og ingen database, så de kan
 * testes direkte. `today` er `todayInOslo(now)`.
 */

type AgreementPeriod = {
  validFrom: string;
  validTo: string | null;
  deletedAt: Date | string | null;
};

export type AgreementBadge = "Slettet" | "Utløpt" | "Ikke startet";

/** Merket på avtalen (A117). «Slettet» har forrang; gyldig avtale gir `null`. */
export function agreementBadge(agreement: AgreementPeriod, today: string): AgreementBadge | null {
  if (agreement.deletedAt !== null) return "Slettet";
  if (agreement.validTo !== null && agreement.validTo < today) return "Utløpt";
  if (agreement.validFrom > today) return "Ikke startet";
  return null;
}

/** Avtalene som kan velges: ikke fjernet og gjelder i dag. Samme regel som kjernen. */
export function selectableAgreements<T extends AgreementPeriod>(list: T[], today: string): T[] {
  return list.filter(
    (agreement) => agreement.deletedAt === null && isAgreementActive(agreement, today),
  );
}

/** Teksten over «Bruk avtalen». */
export function suggestionText(s: { agreementName: string; firmName: string }): string {
  return `Forslag: ${s.agreementName} (bestilleren er fra ${s.firmName})`;
}

/** «2026-03-01» blir «01.03.2026». */
function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : isoDate;
}

/** Perioden som tekst: «01.03.2026–31.10.2026» eller «Fra 01.03.2026» når den er løpende. */
export function agreementPeriodText(agreement: { validFrom: string; validTo: string | null }) {
  return agreement.validTo === null
    ? `Fra ${formatDate(agreement.validFrom)}`
    : `${formatDate(agreement.validFrom)}–${formatDate(agreement.validTo)}`;
}
