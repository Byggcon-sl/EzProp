/**
 * Faste koder for firma og kontakter (docs/05-domenemodell.md 4.2). Kodene står bare her og i
 * CHECK-reglene i `src/db/schema/contacts.ts`. En kode endres aldri; skal den få ny betydning,
 * arkiveres den og det lages en ny (regel 6). Nye koder kan legges til.
 */

/** Hva slags firma det er. Standard er meglerforetak. */
export const FIRM_TYPES = ["broker_firm", "insurer", "housing_association", "other"] as const;
export type FirmType = (typeof FIRM_TYPES)[number];

/**
 * Hvor opplysningene om kontakten kom fra (D17). Skjermen setter alltid `manual`. `order` brukes
 * når ordre og parter kobles til kontakter. `broker_system` legges til når meglersystemet kobles på.
 */
export const CONTACT_SOURCES = ["manual", "order"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

const FIRM_TYPE_LABELS: Record<FirmType, string> = {
  broker_firm: "Meglerforetak",
  insurer: "Forsikringsselskap",
  housing_association: "Sameie eller borettslag",
  other: "Annet",
};

const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  manual: "Lagt inn for hånd",
  order: "Fra en ordre",
};

/** Norsk etikett for en firmatype. Ukjent kode gir koden tilbake. */
export function firmTypeLabel(code: string): string {
  return (FIRM_TYPE_LABELS as Record<string, string>)[code] ?? code;
}

/** Norsk etikett for kilden til en kontakt. Ukjent kode gir koden tilbake. */
export function contactSourceLabel(code: string): string {
  return (CONTACT_SOURCE_LABELS as Record<string, string>)[code] ?? code;
}
