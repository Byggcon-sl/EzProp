/*
 * Faste koder for reklamasjonssaker (regel 6: endres aldri, arkiveres). CHECK-reglene i
 * `src/db/schema/claims.ts` har de samme kodene. Etikettene er norske og vises i grensesnittet.
 */

/** Typen krav. `internal` (intern avviksregistrering) kommer i fase 4 (A128). */
export const CLAIM_TYPES = ["complaint", "insurance_claim", "other"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** Utfallet. `open` er åpen sak; alle andre betyr lukket (A127). */
export const CLAIM_OUTCOMES = ["open", "rejected", "upheld", "settled", "withdrawn"] as const;
export type ClaimOutcome = (typeof CLAIM_OUTCOMES)[number];

/** Utfallene der et beløp er lov (A129). */
export const CLAIM_OUTCOMES_WITH_AMOUNT = [
  "upheld",
  "settled",
] as const satisfies readonly ClaimOutcome[];

const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  complaint: "Reklamasjon",
  insurance_claim: "Forsikringskrav",
  other: "Annet",
};

const CLAIM_OUTCOME_LABELS: Record<ClaimOutcome, string> = {
  open: "Åpen",
  rejected: "Avvist",
  upheld: "Medhold",
  settled: "Forlik",
  withdrawn: "Trukket",
};

export function isClaimType(value: string): value is ClaimType {
  return (CLAIM_TYPES as readonly string[]).includes(value);
}

export function isClaimOutcome(value: string): value is ClaimOutcome {
  return (CLAIM_OUTCOMES as readonly string[]).includes(value);
}

/** Norsk navn på typen. Ukjent kode gir koden tilbake. */
export function claimTypeLabel(code: string): string {
  return isClaimType(code) ? CLAIM_TYPE_LABELS[code] : code;
}

/** Norsk navn på utfallet. Ukjent kode gir koden tilbake. */
export function claimOutcomeLabel(code: string): string {
  return isClaimOutcome(code) ? CLAIM_OUTCOME_LABELS[code] : code;
}
