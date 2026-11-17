import type { MergeFieldSources } from "./logic";

/*
 * Hvor flettefeltene i badmalens standardtekster henter verdien (docs/funksjoner/fase2a-badet-pc.md
 * Omfang 5). Feltkodene står her i tjenesten og aldri i `logic/` (A396), som kodene i
 * `signals.ts`. Kodene er faste (regel 6). Per kontrollpunkt, fordi `{måleverdi}` er fallet på
 * gulvet, høyden ved terskelen eller fuktmålingen ved hulltaking.
 */

/** Årstallet gjelder hele våtrommet: sjiktets årstall, ellers byggeåret (som aldersregelen). */
const YEAR = { keys: ["wet_room.membrane_year", "wet_room.build_year"], pick: "first" } as const;

const BY_CHECKPOINT: Readonly<Record<string, MergeFieldSources>> = {
  "wet_room.floor": {
    måleverdi: { keys: ["wet_room.fall_direction_1", "wet_room.fall_direction_2"], pick: "all" },
  },
  "wet_room.membrane_drain": {
    måleverdi: { keys: ["wet_room.threshold_height_mm"], pick: "first" },
  },
  "wet_room.adjacent": {
    måleverdi: { keys: ["wet_room.hole_moisture_reading"], pick: "first" },
    enhet: { keys: ["wet_room.hole_moisture_unit"], pick: "first" },
    sted: { keys: ["wet_room.hole_moisture_location"], pick: "first" },
  },
};

/** Kildene for flettefeltene i et avvik på kontrollpunktet. Ukjent punkt gir bare årstallet. */
export function mergeSourcesFor(checkpointKey: string): MergeFieldSources {
  const own = Object.prototype.hasOwnProperty.call(BY_CHECKPOINT, checkpointKey);
  return { årstall: YEAR, ...(own ? BY_CHECKPOINT[checkpointKey] : {}) };
}
