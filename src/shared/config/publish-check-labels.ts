/*
 * Korte, faste etiketter for sperrene og grunnene ved publisering
 * (docs/funksjoner/fase2a-overstyringer-leder-design.md avsnitt 9). Brukes som gruppeoverskrift på
 * siden «Overstyringer» og som etiketter i tallgrunnlaget til KI (A573). Funntekstene i
 * `@/core/reports/logic/publish-check-texts.ts` er lengre og gjelder ett funn; disse gjelder en
 * gruppe.
 *
 * Støtter hovedmål: de ansatte (leder ser mønstrene med korte, faste navn) og KI i bunnen (KI får
 * bare faste etiketter, aldri tekst fra en rad).
 *
 * Kodene er faste (regel 6); bare etikettene kan endres. En ukjent kode (for eksempel fra en egen
 * mal senere) gir en trygg tekst, aldri selve koden og aldri tekst fra data. TG står alltid som
 * tekst. Filen har ingen importer, så den kan lastes i nettleseren.
 */

/** Etikett per sperrekode (`PUBLISH_BLOCKER_CODES` i `@/db/schema`). */
export const PUBLISH_BLOCKER_LABELS = {
  wet_or_below_ground_missing_hole: "Hulltaking mangler",
  tg3_missing_cost: "TG3 uten kostnad",
  tg2_tg3_missing_cause_or_consequence: "TG2 eller TG3 uten årsak eller konsekvens",
  mandatory_without_tg: "Punkt uten TG",
  inspection_date_missing: "Befaringsdato mangler",
  bra_missing: "Bruksareal (BRA) mangler",
  electrical_missing: "Elektrisk anlegg ikke vurdert",
} as const satisfies Record<string, string>;

/** Teksten for en sperrekode som ikke står i listen. */
export const UNKNOWN_PUBLISH_CHECK_LABEL = "Annen sperre";

/** Etikett per grunn (`PUBLISH_OVERRIDE_REASON_CODES` i `@/db/schema`), i rekkefølgen knappene har. */
export const PUBLISH_OVERRIDE_REASON_LABELS = {
  no_access_or_refused: "Ikke tilgang eller nektet av eier",
  not_applicable_to_room: "Gjelder ikke dette rommet",
  described_elsewhere: "Beskrevet et annet sted i rapporten",
  other: "Annet",
} as const satisfies Record<string, string>;

/** Teksten for en grunn som ikke står i listen. */
export const UNKNOWN_OVERRIDE_REASON_LABEL = "Annen grunn";

function hasLabel<T extends Record<string, string>>(
  labels: T,
  code: string,
): code is keyof T & string {
  return Object.prototype.hasOwnProperty.call(labels, code);
}

/** Etiketten for sperrekoden, eller den trygge teksten når koden er ukjent. */
export function publishCheckLabel(code: string | null | undefined): string {
  return typeof code === "string" && hasLabel(PUBLISH_BLOCKER_LABELS, code)
    ? PUBLISH_BLOCKER_LABELS[code]
    : UNKNOWN_PUBLISH_CHECK_LABEL;
}

/** Etiketten for grunnen, eller den trygge teksten når koden er ukjent. */
export function publishOverrideReasonLabel(code: string | null | undefined): string {
  return typeof code === "string" && hasLabel(PUBLISH_OVERRIDE_REASON_LABELS, code)
    ? PUBLISH_OVERRIDE_REASON_LABELS[code]
    : UNKNOWN_OVERRIDE_REASON_LABEL;
}
