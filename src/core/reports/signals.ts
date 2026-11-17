/*
 * Kodene i badmalen som rapportkjernen leser for advarslene (docs/funksjoner/fase2a-badet-pc.md
 * Omfang 6 og 7, T-0059, A386). De står her i tjenesten og aldri i `logic/` (A396): de rene
 * funksjonene får bare sann/usann. Kodene er faste (regel 6), så de endres ikke; arkiveres en av
 * dem i malen, slutter advarselen å komme, og testene for badet blir røde.
 */

/** «Eier ga ikke samtykke» til hulltaking: TGIU krever da at eier er informert (A349). */
export const OWNER_REFUSED_SIGNAL = {
  elementKey: "wet_room.hole_drilling_reason",
  optionKey: "owner_refused",
} as const;

/**
 * T-0059: valget «utført uten funn» og regelen for forhøyet fukt slår til i serverens regelsvar.
 * Grensen og enheten står bare i regelen (A386), aldri her.
 */
export const NO_FINDINGS_OVER_LIMIT_SIGNAL = {
  ruleKey: "wet_room.hole_moisture_over_limit",
  elementKey: "wet_room.hole_drilling",
  optionKey: "done_no_findings",
} as const;
