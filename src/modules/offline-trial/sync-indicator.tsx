"use client";

/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Måleindikatoren (oppgavekortet pkt. 9): én linje som viser om alt er lagret på serveren. Trengs
 * for å måle «tid til synk ferdig» i prøve A. Byttes ut når punktet «Synkstatus som alltid vises»
 * bygges.
 */
import { useEffect, useState } from "react";
import type { TrialSyncStatus } from "./sync/types";

/** Teksten i indikatoren. Entall og flertall: «1 endring», «2 endringer», «1 bilde», «0 bilder». */
export function syncIndicatorText(status: TrialSyncStatus): string {
  if (!status.online) return "Uten nett";
  if (status.pendingChanges === 0 && status.pendingPhotos === 0) {
    return "Alt er lagret på serveren";
  }
  const changes = `${status.pendingChanges} ${status.pendingChanges === 1 ? "endring" : "endringer"}`;
  const photos = `${status.pendingPhotos} ${status.pendingPhotos === 1 ? "bilde" : "bilder"}`;
  return `Venter: ${changes}, ${photos}`;
}

const POLL_MS = 2000;

interface SyncIndicatorProps {
  getStatus: () => Promise<TrialSyncStatus>;
  /** Kaller `onChange` når køen eller synkstatusen kan ha endret seg. Returnerer avmelding. */
  subscribe?: (onChange: () => void) => () => void;
}

export function SyncIndicator({ getStatus, subscribe }: SyncIndicatorProps) {
  const [text, setText] = useState("");

  useEffect(() => {
    let active = true;
    let latest = 0;
    async function refresh() {
      const call = ++latest;
      try {
        const status = await getStatus();
        if (active && call === latest) setText(syncIndicatorText(status));
      } catch {
        // Databasen er ikke klar ennå; neste runde prøver igjen.
      }
    }
    const onNetwork = () => void refresh();
    window.addEventListener("online", onNetwork);
    window.addEventListener("offline", onNetwork);
    const unsubscribe = subscribe?.(() => void refresh());
    const interval = setInterval(() => void refresh(), POLL_MS);
    void refresh();
    return () => {
      active = false;
      window.removeEventListener("online", onNetwork);
      window.removeEventListener("offline", onNetwork);
      unsubscribe?.();
      clearInterval(interval);
    };
  }, [getStatus, subscribe]);

  return (
    <p data-testid="sync-indicator" className="text-sm text-slate-700" aria-live="polite">
      {text}
    </p>
  );
}
