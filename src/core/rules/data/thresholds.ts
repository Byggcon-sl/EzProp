import type { ThresholdSet } from "../types";

/**
 * Tersklene for våtrom (docs/funksjoner/fase2a-regler-bad.md, Omfang 3). Kodedata nå, tabell i
 * 2a-3 med samme koder. Kodene endres aldri (regel 6). Utkast, ikke godkjent av fagrådet.
 */

/**
 * Kilden for fuktgrensen (Ståle 12.11.2026, F3). Bare navnet på standarden og tallet, ingen tekst
 * fra den. Tallet er ikke kontrollert mot standarden ennå (spørsmål 77).
 */
export const SOURCE_RULE_MOISTURE =
  "NS 3600:2025 (Ståle 12.11.2026, F3); tallene er ikke kontrollert mot standarden; utkast, ikke godkjent av fagrådet";

/** Fuktgrensen ved hulltaking i våtrom, målt i vekt-% i treverk. */
export const WET_ROOM_HOLE_MOISTURE_THRESHOLD_KEY = "wet_room_hole_moisture_weight_percent";

export const WET_ROOM_THRESHOLDS: ThresholdSet = {
  key: "wet_room_thresholds",
  entries: [
    {
      key: WET_ROOM_HOLE_MOISTURE_THRESHOLD_KEY,
      description: "Fukt i treverk målt ved hulltaking i tilliggende konstruksjon til våtrom",
      unit: "weight_percent",
      value: 15,
      comparator: "gte",
      source_ref: SOURCE_RULE_MOISTURE,
      status: "draft",
    },
  ],
};
