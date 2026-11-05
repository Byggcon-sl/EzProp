/*
 * Faste koder for eiendommen (docs/05-domenemodell.md 4.4). Kodene står bare her og i
 * CHECK-reglene i `src/db/schema/properties.ts` og `common-areas.ts`. En kode endres aldri; skal
 * den få ny betydning, arkiveres den og det lages en ny (regel 6). Nye koder legges til sist.
 */

/** Boligtype. Godkjent av Ståle 27.10.2026 (spørsmål 2, innspill D15). */
export const HOUSING_TYPES = [
  "detached",
  "semi_detached",
  "terraced",
  "apartment",
  "apartment_in_house",
  "holiday_home",
  "farm",
  "other",
] as const;
export type HousingType = (typeof HOUSING_TYPES)[number];

const HOUSING_TYPE_LABELS: Record<HousingType, string> = {
  detached: "Enebolig",
  semi_detached: "Tomannsbolig",
  terraced: "Rekkehus",
  apartment: "Leilighet",
  apartment_in_house: "Leilighet i tomannsbolig eller flermannsbolig uten sameie",
  holiday_home: "Fritidsbolig",
  farm: "Våningshus",
  other: "Annet",
};

/** Norsk navn på boligtypen. Ukjent kode gis tilbake som den er. */
export function housingTypeLabel(code: string): string {
  return HOUSING_TYPE_LABELS[code as HousingType] ?? code;
}

/**
 * Eierform. De fire kodene Ståle godkjente 27.10.2026 (spørsmål 2, innspill D15).
 * Obligasjonsleilighet er ikke med (A64).
 */
export const OWNERSHIP_FORMS = ["freehold", "section", "cooperative", "share"] as const;
export type OwnershipForm = (typeof OWNERSHIP_FORMS)[number];

const OWNERSHIP_FORM_LABELS: Record<OwnershipForm, string> = {
  freehold: "Selveier",
  section: "Eierseksjon i sameie",
  cooperative: "Andel i borettslag",
  share: "Aksjeleilighet",
};

/** Norsk navn på eierformen. Ukjent kode gis tilbake som den er. */
export function ownershipFormLabel(code: string): string {
  return OWNERSHIP_FORM_LABELS[code as OwnershipForm] ?? code;
}

/** Svar på «finnes …?» for fellesdelene. */
export const YES_NO_UNKNOWN = ["yes", "no", "unknown"] as const;
export type YesNoUnknown = (typeof YES_NO_UNKNOWN)[number];

const YES_NO_UNKNOWN_LABELS: Record<YesNoUnknown, string> = {
  yes: "Ja",
  no: "Nei",
  unknown: "Vet ikke",
};

/** Norsk tekst for ja, nei og vet ikke. Ukjent kode gis tilbake som den er. */
export function yesNoUnknownLabel(code: string): string {
  return YES_NO_UNKNOWN_LABELS[code as YesNoUnknown] ?? code;
}

/** Eierformene som alltid har fellesdeler (A67). */
const SHARED_OWNERSHIP_FORMS: readonly string[] = ["section", "cooperative", "share"];

/**
 * Dataregel (A67): om eiendommen har fellesdeler som skal vurderes. Sann for leilighet, og for
 * eierseksjon, borettslag og aksjeleilighet uansett boligtype (også rekkehus i borettslag).
 * «Leilighet i tomannsbolig uten sameie» med selveier har ikke fellesdeler.
 */
export function hasCommonAreas({
  housingType,
  ownershipForm,
}: {
  housingType: string;
  ownershipForm: string;
}): boolean {
  return housingType === "apartment" || SHARED_OWNERSHIP_FORMS.includes(ownershipForm);
}
