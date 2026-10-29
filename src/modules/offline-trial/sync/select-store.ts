/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Det eneste stedet sidene velger synkløsning (docs/funksjoner/fase1-kandidat-electricsql.md
 * pkt. 7, avgjørelse E og «Avgjørelser før bygging» 5). Valget ligger i `localStorage`; bytte =
 * skriv nøkkelen og last siden på nytt. Kandidaten lastes med dynamisk `import()`, så bare den
 * valgte SDK-en kommer med. Organisasjonsbytte på samme enhet tømmer lokal lagring for alle
 * kandidater (også hentemarkøren til egenbygd) og bildene før noe lager åpnes.
 */
import { getTrialDeviceId } from "./device";
import { clearLocalPhotos } from "./photo-store";
import { createSqlTestable, installTrialTestHooks } from "./test-hooks";
import {
  DEFAULT_TRIAL_SYNC_CANDIDATE,
  TRIAL_LAST_ORGANIZATION_KEY,
  TRIAL_SYNC_CANDIDATE_KEY,
  TRIAL_SYNC_CANDIDATES,
  type OpenedTrialStore,
  type TrialSyncCandidate,
} from "./types";

export {
  DEFAULT_TRIAL_SYNC_CANDIDATE,
  TRIAL_SYNC_CANDIDATE_KEY,
  TRIAL_SYNC_CANDIDATES,
  type OpenedTrialStore,
  type TrialSyncCandidate,
} from "./types";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

function isCandidate(value: unknown): value is TrialSyncCandidate {
  return (TRIAL_SYNC_CANDIDATES as readonly unknown[]).includes(value);
}

/** Lagret kandidat; ukjent eller manglende verdi gir standardverdien (`powersync`). */
export function readSyncCandidate(storage?: ReadableStorage): TrialSyncCandidate {
  try {
    const value = (storage ?? globalThis.localStorage)?.getItem(TRIAL_SYNC_CANDIDATE_KEY);
    return isCandidate(value) ? value : DEFAULT_TRIAL_SYNC_CANDIDATE;
  } catch {
    return DEFAULT_TRIAL_SYNC_CANDIDATE;
  }
}

/** Skriver valget. Den som kaller, laster siden på nytt etterpå. */
export function writeSyncCandidate(candidate: TrialSyncCandidate, storage?: WritableStorage): void {
  (storage ?? globalThis.localStorage).setItem(TRIAL_SYNC_CANDIDATE_KEY, candidate);
}

/** Neste person på samme iPad skal ikke se en annen organisasjons data, uansett kandidat. */
async function clearIfOtherOrganization(organizationId: string): Promise<void> {
  const last = localStorage.getItem(TRIAL_LAST_ORGANIZATION_KEY);
  if (last && last !== organizationId) {
    const [electric, powersync, custom] = await Promise.all([
      import("./electricsql/storage"),
      import("./powersync/database"),
      import("./custom/store"),
    ]);
    await electric.clearElectricStorage();
    await powersync.clearPowerSyncStorage();
    await custom.clearCustomStorage();
    await clearLocalPhotos();
  }
  localStorage.setItem(TRIAL_LAST_ORGANIZATION_KEY, organizationId);
}

async function openPowerSync(organizationId: string): Promise<OpenedTrialStore> {
  const [{ openTrialDatabase }, { createPowerSyncTrialStore }] = await Promise.all([
    import("./powersync/database"),
    import("./powersync/store"),
  ]);
  const { db, deviceId } = await openTrialDatabase(organizationId);
  const store = createPowerSyncTrialStore(db, deviceId, organizationId);
  const opened: OpenedTrialStore = { store, deviceId, organizationId, candidate: "powersync" };
  installTrialTestHooks(opened, createSqlTestable(db), { db, pendingOverride: true });
  return opened;
}

async function openElectric(organizationId: string): Promise<OpenedTrialStore> {
  const { createElectricTrialStore } = await import("./electricsql/store");
  const deviceId = getTrialDeviceId();
  const store = await createElectricTrialStore(deviceId, organizationId);
  const opened: OpenedTrialStore = { store, deviceId, organizationId, candidate: "electricsql" };
  installTrialTestHooks(opened, store);
  return opened;
}

async function openCustom(organizationId: string): Promise<OpenedTrialStore> {
  const { createCustomTrialStore } = await import("./custom/store");
  const deviceId = getTrialDeviceId();
  const store = await createCustomTrialStore(deviceId, organizationId);
  const opened: OpenedTrialStore = { store, deviceId, organizationId, candidate: "custom" };
  installTrialTestHooks(opened, store);
  return opened;
}

let current: {
  candidate: TrialSyncCandidate;
  organizationId: string;
  promise: Promise<OpenedTrialStore>;
} | null = null;

/** Lageret for kandidaten og organisasjonen. Samme instans for hele siden. Aldri under SSR. */
export function openTrialStore(
  candidate: TrialSyncCandidate,
  organizationId: string,
): Promise<OpenedTrialStore> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Lagringen på enheten finnes bare i nettleseren."));
  }
  if (current && current.candidate === candidate && current.organizationId === organizationId) {
    return current.promise;
  }
  const previous = current?.promise;
  const promise = (async () => {
    if (previous) {
      const old = await previous.catch(() => null);
      await old?.store.close();
    }
    await clearIfOtherOrganization(organizationId);
    switch (candidate) {
      case "electricsql":
        return openElectric(organizationId);
      case "custom":
        return openCustom(organizationId);
      default:
        return openPowerSync(organizationId);
    }
  })();
  current = { candidate, organizationId, promise };
  promise.catch(() => {
    if (current?.promise === promise) current = null;
  });
  return promise;
}
