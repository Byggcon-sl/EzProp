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
 */
import { PowerSyncDatabase } from "@powersync/web";
import { getTrialDeviceId } from "../device";
import { clearLocalPhotos } from "../photo-store";
import { TrialSyncConnector } from "./connector";
import { trialSchema } from "./schema";

export const TRIAL_DB_FILENAME = "offline-trial.sqlite";
export const TRIAL_LAST_ORGANIZATION_KEY = "trial_last_organization_id";
const WORKER_URL = "/@powersync/worker.js";

export interface TrialDatabase {
  db: PowerSyncDatabase;
  deviceId: string;
  organizationId: string;
}

interface TrialTestHooks {
  db: PowerSyncDatabase;
  deviceId: string;
  organizationId: string;
  /** Later som om en annen organisasjon brukte enheten sist; neste lasting tømmer databasen. */
  simulateOrganizationChange(organizationId: string): void;
}

declare global {
  interface Window {
    __offlineTrial?: TrialTestHooks;
  }
}

let opened: { organizationId: string; promise: Promise<TrialDatabase> } | null = null;

async function open(organizationId: string): Promise<TrialDatabase> {
  const db = new PowerSyncDatabase({
    schema: trialSchema,
    database: { dbFilename: TRIAL_DB_FILENAME, worker: WORKER_URL, enableMultiTabs: false },
    sync: { worker: WORKER_URL },
  });
  await db.init();

  // Neste person på samme iPad skal ikke se en annen organisasjons data.
  const last = localStorage.getItem(TRIAL_LAST_ORGANIZATION_KEY);
  if (last && last !== organizationId) {
    await db.disconnectAndClear();
    await clearLocalPhotos();
  }
  localStorage.setItem(TRIAL_LAST_ORGANIZATION_KEY, organizationId);

  const deviceId = getTrialDeviceId();
  // Kobler til i bakgrunnen. Uten nett eller uten tjeneste prøver SDK-en igjen selv.
  db.connect(new TrialSyncConnector(organizationId)).catch(() => {
    console.warn("Synk: kunne ikke koble til nå. Prøver igjen senere.");
  });

  if (process.env.NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS === "1") {
    window.__offlineTrial = {
      db,
      deviceId,
      organizationId,
      simulateOrganizationChange(otherOrganizationId: string) {
        localStorage.setItem(TRIAL_LAST_ORGANIZATION_KEY, otherOrganizationId);
      },
    };
  }

  return { db, deviceId, organizationId };
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
