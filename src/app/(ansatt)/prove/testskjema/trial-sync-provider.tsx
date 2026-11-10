"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { storageErrorLog } from "@/modules/offline-trial/storage-health";
import { startPhotoUploader } from "@/modules/offline-trial/sync/photo-uploader";
import { openTrialStore } from "@/modules/offline-trial/sync/select-store";
import type { TrialSyncStore } from "@/modules/offline-trial/sync/types";

/** Prøve fase 1: synklageret for testskjemaet. */
export interface TrialSync {
  store: TrialSyncStore;
  deviceId: string;
  organizationId: string;
}

const TrialSyncContext = createContext<TrialSync | null>(null);

export function useTrialSync(): TrialSync {
  const value = useContext(TrialSyncContext);
  if (!value) throw new Error("useTrialSync brukes utenfor TrialSyncProvider.");
  return value;
}

/** Det synkstatusen trenger: status, varsel når den kan ha endret seg, og «Synk nå». */
export function useSyncStatusSource() {
  const { store } = useTrialSync();
  return useMemo(
    () => ({
      getStatus: () => store.status(),
      subscribe: (onChange: () => void) => store.onStatusChange(onChange),
      syncNow: () => store.syncNow(),
    }),
    [store],
  );
}

type State = { kind: "opening" } | { kind: "ready"; sync: TrialSync } | { kind: "failed" };

/**
 * Åpner lageret i nettleseren og starter bildekøen. Organisasjons-id-en
 * kommer fra serverkomponenten (tilgangssjekken); serveren stoler uansett bare på `grant`.
 */
export function TrialSyncProvider({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const [state, setState] = useState<State>({ kind: "opening" });

  useEffect(() => {
    let active = true;
    let stopUploader: (() => void) | undefined;
    let store: TrialSyncStore | undefined;
    const flush = () => void store?.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    openTrialStore(organizationId).then(
      (opened) => {
        if (!active) return;
        store = opened.store;
        stopUploader = startPhotoUploader(opened.store, organizationId);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", flush);
        setState({
          kind: "ready",
          sync: {
            store: opened.store,
            deviceId: opened.deviceId,
            organizationId: opened.organizationId,
          },
        });
      },
      (error: unknown) => {
        console.error("Kunne ikke åpne lagringen på enheten.", storageErrorLog(error));
        if (active) setState({ kind: "failed" });
      },
    );

    return () => {
      active = false;
      flush();
      stopUploader?.();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, [organizationId]);

  if (state.kind === "failed") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p role="alert" className="text-slate-900">
          Kunne ikke åpne lagringen på denne enheten. Last siden på nytt. Hjelper ikke det, si fra
          til den som har ansvar for prøven.
        </p>
      </main>
    );
  }
  if (state.kind === "opening") {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-slate-600">Åpner lagringen på enheten …</p>
      </main>
    );
  }
  return <TrialSyncContext.Provider value={state.sync}>{children}</TrialSyncContext.Provider>;
}
