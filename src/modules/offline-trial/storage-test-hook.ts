/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Testkroken for lagring (prøve C, docs/funksjoner/fase1-prove-c-lagring.md pkt. 5), bare med
 * `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1` (aldri i Azure). E2e setter
 * `window.__offlineTrialStorage` med `addInitScript` før siden lastes, og kan endre det etterpå.
 * Objektet leses ved hver måling og hver lagring, aldri bufret. Ingen React og ingen kandidat.
 */
import {
  readStorageHealth,
  type StorageEstimateNumbers,
  type StorageHealth,
} from "./storage-health";

export type StorageFailHook = "answer" | "photo" | "both" | null;

export interface OfflineTrialStorageHook {
  /** Erstatter `navigator.storage.estimate()`; `persisted()` og `persist()` er ekte. */
  estimate?: { usage: number; quota: number };
  /** Lagring feiler med full plass til verdien settes tilbake til `null`. */
  fail?: StorageFailHook;
}

declare global {
  interface Window {
    __offlineTrialStorage?: OfflineTrialStorageHook;
  }
}

function storageTestHookEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS === "1";
}

function readHook(): OfflineTrialStorageHook | undefined {
  if (!storageTestHookEnabled() || typeof window === "undefined") return undefined;
  const hook = window.__offlineTrialStorage;
  return hook && typeof hook === "object" ? hook : undefined;
}

/** Måler plassen for skjermen. Med kroken brukes tallene derfra i stedet for `estimate()`. */
export function readStorageHealthForScreen(): Promise<StorageHealth> {
  const estimate = readHook()?.estimate;
  const override: StorageEstimateNumbers | undefined = estimate
    ? { usage: estimate.usage, quota: estimate.quota }
    : undefined;
  return readStorageHealth(override);
}

/** Kaster full plass når kroken sier at denne lagringen skal feile. Ellers ingenting. */
export function throwIfStorageFailHook(kind: "answer" | "photo"): void {
  const fail = readHook()?.fail;
  if (fail === kind || fail === "both") {
    throw new DOMException("Testkrok: lagring feilet", "QuotaExceededError");
  }
}
