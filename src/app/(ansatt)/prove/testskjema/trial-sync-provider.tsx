"use client";

import { PowerSyncContext } from "@powersync/react";
import type { PowerSyncDatabase } from "@powersync/web";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { openTrialDatabase } from "@/modules/offline-trial/sync/powersync/database";
import {
  createPowerSyncTrialStore,
  type PowerSyncTrialStore,
} from "@/modules/offline-trial/sync/powersync/store";
import { startPhotoUploader } from "@/modules/offline-trial/sync/photo-uploader";

/** Prøve fase 1: den lokale databasen og synklageret for testskjemaet. */
export interface TrialSync {
  db: PowerSyncDatabase;
  store: PowerSyncTrialStore;
  deviceId: string;
  organizationId: string;
}

const TrialSyncContext = createContext<TrialSync | null>(null);

export function useTrialSync(): TrialSync {
  const value = useContext(TrialSyncContext);
  if (!value) throw new Error("useTrialSync brukes utenfor TrialSyncProvider.");
  return value;
}

/**
 * Det måleindikatoren trenger: status fra lageret, og et varsel når synkkøen, bilderadene eller
 * SDK-ens status endres.
 */
export function useIndicatorSource() {
  const { db, store } = useTrialSync();
  return useMemo(
    () => ({
      getStatus: () => store.status(),
      subscribe: (onChange: () => void) => {
        const disposeTables = db.onChange(
          { onChange },
          { tables: ["ps_crud", "trial_answers", "trial_photos"], throttleMs: 100 },
        );
        const disposeStatus = db.registerListener({ statusChanged: () => onChange() });
        return () => {
          disposeTables();
          disposeStatus();
        };
      },
    }),
    [db, store],
  );
}

type State = { kind: "opening" } | { kind: "ready"; sync: TrialSync } | { kind: "failed" };

/**
 * Åpner den lokale databasen i nettleseren og starter bildekøen. Organisasjons-id-en kommer fra
 * serverkomponenten (tilgangssjekken); serveren stoler uansett bare på `grant`.
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
    let store: PowerSyncTrialStore | undefined;
    const flush = () => void store?.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    openTrialDatabase(organizationId).then(
      ({ db, deviceId }) => {
        if (!active) return;
        store = createPowerSyncTrialStore(db, deviceId, organizationId);
        stopUploader = startPhotoUploader(db, deviceId, organizationId);
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", flush);
        setState({ kind: "ready", sync: { db, store, deviceId, organizationId } });
      },
      (error: unknown) => {
        console.error("Kunne ikke åpne den lokale databasen.", error);
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
  return (
    <PowerSyncContext.Provider value={state.sync.db}>
      <TrialSyncContext.Provider value={state.sync}>{children}</TrialSyncContext.Provider>
    </PowerSyncContext.Provider>
  );
}
