/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * `TrialSyncStore` for den egenbygde kandidaten (docs/funksjoner/fase1-kandidat-egenbygd.md pkt. 5):
 * den lokale kjernen (`sync/local/trial-store.ts`: lagring, kø, sending, innfletting) over
 * IndexedDB-databasen `offline-trial-custom`, med hente-leseren (`reader.ts`). En bunt tas ut av
 * køen bare ved 200. `readRows` tar også `"sync_state"` (uten `outbox_next_seq`) og `"outbox"`.
 */
import { createLocalDb } from "../local/idb";
import { createLocalTrialStore } from "../local/trial-store";
import type { LocalTrialStore } from "../local/types";
import { createPullReader } from "./reader";
import { CUSTOM_DB_OPTIONS, type ClearCustomStorage, type CreateCustomTrialStore } from "./types";

/** Databasen for egenbygd. Én instans per side. */
const customDb = createLocalDb(CUSTOM_DB_OPTIONS);

export const createCustomTrialStore: CreateCustomTrialStore = (
  deviceId: string,
  organizationId: string,
): Promise<LocalTrialStore> =>
  createLocalTrialStore({
    db: customDb,
    deviceId,
    organizationId,
    reader: createPullReader(),
  });

/** Tømmer hele `offline-trial-custom`, også hentemarkøren. Bildene tømmes av `photo-store.ts`. */
export const clearCustomStorage: ClearCustomStorage = () => customDb.clear();
