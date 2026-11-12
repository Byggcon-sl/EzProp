import type { ThresholdSet } from "../types";

/**
 * Tersklene for våtrom (docs/funksjoner/fase2a-regler-bad.md, Omfang 3). Kodedata nå, tabell i
 * 2a-3 med samme koder. Kodene endres aldri (regel 6). Utkast, ikke godkjent av fagrådet.
 */

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
      source_ref: "bransjepraksis, ikke bekreftet mot kilde – fagrådet må bekrefte (spørsmål 71)",
      status: "draft",
    },
  ],
};
