/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Testkroken `window.__offlineTrial` for e2e, bare med `NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS=1`
 * (aldri i Azure). Lageret bruker den lokale kjernen som `TrialSyncTestable`: `readRows` tar også
 * tilstandslageret (`sync_state`, uten `outbox_next_seq`) og `"outbox"`, og `applySyncedRows` går
 * samme vei som synken (`mergeIncoming`).
 */
import { createTextState } from "../text-merge";
import {
  TRIAL_LAST_ORGANIZATION_KEY,
  type OpenedTrialStore,
  type TrialSyncTestable,
  type TrialTestHooks,
} from "./types";

export type InstalledTrialTestHooks = TrialTestHooks & {
  createTextState(text: string): string;
};

declare global {
  interface Window {
    __offlineTrial?: InstalledTrialTestHooks;
  }
}

export function trialTestHooksEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS === "1";
}

/** Setter `window.__offlineTrial`. Gjør ingenting uten miljøvariabelen. */
export function installTrialTestHooks(opened: OpenedTrialStore, testable: TrialSyncTestable): void {
  if (!trialTestHooksEnabled() || typeof window === "undefined") return;
  const { store } = opened;
  const hooks: InstalledTrialTestHooks = {
    store,
    deviceId: opened.deviceId,
    organizationId: opened.organizationId,
    applySyncedRows: (table, rows) => testable.applySyncedRows(table, rows),
    readRows: (table, formId) => testable.readRows(table, formId),
    simulateOrganizationChange(organizationId: string) {
      localStorage.setItem(TRIAL_LAST_ORGANIZATION_KEY, organizationId);
    },
    createTextState,
  };
  window.__offlineTrial = hooks;
}
