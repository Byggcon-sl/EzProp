/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Den lokale lagringen for ElectricSQL-kandidaten: IndexedDB-databasen `offline-trial-electric`,
 * åpnet med `createLocalDb` fra den lokale kjernen (`sync/local/idb.ts`). Samme navn, versjon og
 * tilstandslager (`shape_state`, nøkkel `table`) som før, så ingen data på enheten flyttes.
 */
import { createLocalDb } from "../local/idb";
import { ELECTRIC_DB_NAME, ELECTRIC_DB_VERSION, ELECTRIC_STORES } from "./types";

/** Databasen for Electric. Én instans per side. */
export const electricDb = createLocalDb({
  name: ELECTRIC_DB_NAME,
  version: ELECTRIC_DB_VERSION,
  stateStore: { name: ELECTRIC_STORES.shapeState, keyPath: "table" },
});

/** Tømmer hele `offline-trial-electric` (ved organisasjonsbytte). Bildene tømmes av `photo-store.ts`. */
export function clearElectricStorage(): Promise<void> {
  return electricDb.clear();
}
