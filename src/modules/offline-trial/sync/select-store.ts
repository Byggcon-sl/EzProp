/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Det eneste stedet sidene åpner synklageret. Synken er egenbygd (ADR 0004); lageret lastes med
 * dynamisk `import()`. Organisasjonsbytte på samme enhet tømmer lokal lagring (også hentemarkøren),
 * «Lagret kl.» og bildene før noe lager åpnes.
 */
import { getTrialDeviceId } from "./device";
import { clearLocalPhotos } from "./photo-store";
import { installTrialTestHooks } from "./test-hooks";
import { TRIAL_LAST_ORGANIZATION_KEY, type OpenedTrialStore } from "./types";

export type { OpenedTrialStore } from "./types";

/** Nøkkelen i `localStorage` for «Lagret kl.» (docs/funksjoner/fase1-synkstatus.md pkt. 7). */
export const TRIAL_SAVED_AT_KEY = "trial_saved_at";

/** Fjerner «Lagret kl.». */
export function clearSavedAt(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(TRIAL_SAVED_AT_KEY);
}

/** Neste person på samme iPad skal ikke se en annen organisasjons data. */
async function clearIfOtherOrganization(organizationId: string): Promise<void> {
  const last = localStorage.getItem(TRIAL_LAST_ORGANIZATION_KEY);
  if (last && last !== organizationId) {
    clearSavedAt(localStorage);
    const custom = await import("./custom/store");
    await custom.clearCustomStorage();
    await clearLocalPhotos();
  }
  localStorage.setItem(TRIAL_LAST_ORGANIZATION_KEY, organizationId);
}

async function openCustom(organizationId: string): Promise<OpenedTrialStore> {
  const { createCustomTrialStore } = await import("./custom/store");
  const deviceId = getTrialDeviceId();
  const store = await createCustomTrialStore(deviceId, organizationId);
  const opened: OpenedTrialStore = { store, deviceId, organizationId };
  installTrialTestHooks(opened, store);
  return opened;
}

let current: { organizationId: string; promise: Promise<OpenedTrialStore> } | null = null;

/** Lageret for organisasjonen. Samme instans for hele siden. Aldri under SSR. */
export function openTrialStore(organizationId: string): Promise<OpenedTrialStore> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Lagringen på enheten finnes bare i nettleseren."));
  }
  if (current && current.organizationId === organizationId) {
    return current.promise;
  }
  const previous = current?.promise;
  const promise = (async () => {
    if (previous) {
      const old = await previous.catch(() => null);
      await old?.store.close();
    }
    await clearIfOtherOrganization(organizationId);
    return openCustom(organizationId);
  })();
  current = { organizationId, promise };
  promise.catch(() => {
    if (current?.promise === promise) current = null;
  });
  return promise;
}
