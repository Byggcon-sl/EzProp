"use client";

import { useSyncExternalStore } from "react";

/*
 * Om nettleseren er på nett (`navigator.onLine` og hendelsene `online` og `offline`). Samme kilde
 * som lagringskøen på badet bruker. På serveren og ved første tegning regnes det som på nett, så
 * siden ikke blinker for dem som har nett.
 */

function subscribe(notify: () => void): () => void {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
