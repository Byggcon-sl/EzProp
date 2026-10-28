/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Åpner den lokale databasen (PowerSync web-SDK, SQLite i nettleseren) én gang per side og kobler
 * til synktjenesten i bakgrunnen (oppgavekortet pkt. 4). Aldri under SSR.
 *
 * Valg (står også i docs/funksjoner/fase1-prove-ab-powersync.md):
 * - Lagring: SDK-ens standard, `IDBBatchAtomicVFS` (IndexedDB). Den virker i Safari på iPad uten
 *   særskilte hoder; OPFS-variantene krever dedikert worker og er ikke prøvd.
 * - `enableMultiTabs: false` overalt, så Chromium i e2e oppfører seg som Safari (der er flerfane
 *   av som standard). Flere faner virker, men bare én synker om gangen.
 * - Worker-filene kopieres fra SDK-en til `public/@powersync/` av next.config.ts ved oppstart og
 *   bygg, og lastes fra `/@powersync/worker.js`.
 * - Organisasjonsbytte og testkroken ligger i `sync/select-store.ts` og `sync/test-hooks.ts`.
 */
import { PowerSyncDatabase } from "@powersync/web";
import { getTrialDeviceId } from "../device";
import { TrialSyncConnector } from "./connector";
import { trialSchema } from "./schema";

export const TRIAL_DB_FILENAME = "offline-trial.sqlite";
const WORKER_URL = "/@powersync/worker.js";

export interface TrialDatabase {
  db: PowerSyncDatabase;
  deviceId: string;
  organizationId: string;
}

let opened: { organizationId: string; promise: Promise<TrialDatabase> } | null = null;

function createDatabase(): PowerSyncDatabase {
  return new PowerSyncDatabase({
    schema: trialSchema,
    database: { dbFilename: TRIAL_DB_FILENAME, worker: WORKER_URL, enableMultiTabs: false },
    sync: { worker: WORKER_URL },
  });
}

async function open(organizationId: string): Promise<TrialDatabase> {
  // Organisasjonsbytte på samme enhet håndteres av select-store.ts før databasen åpnes.
  const db = createDatabase();
  await db.init();

  const deviceId = getTrialDeviceId();
  // Kobler til i bakgrunnen. Uten nett eller uten tjeneste prøver SDK-en igjen selv.
  db.connect(new TrialSyncConnector(organizationId)).catch(() => {
    console.warn("Synk: kunne ikke koble til nå. Prøver igjen senere.");
  });

  return { db, deviceId, organizationId };
}

/**
 * Tømmer den lokale databasen (synkede rader, synkposisjon og køen) ved organisasjonsbytte.
 * Åpner, `disconnectAndClear()`, lukker. Kalles av select-store.ts før noe lager åpnes.
 */
export async function clearPowerSyncStorage(): Promise<void> {
  const previous = opened?.promise;
  opened = null;
  if (previous) {
    const old = await previous.catch(() => null);
    await old?.db.close();
  }
  const db = createDatabase();
  await db.init();
  await db.disconnectAndClear();
  await db.close();
}

/** Den lokale databasen for organisasjonen. Samme instans for hele siden. */
export function openTrialDatabase(organizationId: string): Promise<TrialDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Den lokale databasen finnes bare i nettleseren."));
  }
  if (opened && opened.organizationId === organizationId) return opened.promise;
  const previous = opened?.promise;
  const promise = (async () => {
    if (previous) {
      const old = await previous.catch(() => null);
      await old?.db.close();
    }
    return open(organizationId);
  })();
  opened = { organizationId, promise };
  promise.catch(() => {
    if (opened?.promise === promise) opened = null;
  });
  return promise;
}
