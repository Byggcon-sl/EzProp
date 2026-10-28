"use client";

import { useEffect } from "react";

/**
 * Registrerer service workeren (public/sw.js) slik at appen på hjemskjermen åpner testskjemaet
 * uten nett (prøve A i fase 1). Bare i produksjonsbygg eller med testkroken, så `pnpm dev` ikke
 * får et gammelt hurtiglager.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    const enabled =
      process.env.NODE_ENV === "production" ||
      process.env.NEXT_PUBLIC_OFFLINE_TRIAL_TEST_HOOKS === "1";
    if (!enabled || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Uten service worker virker appen som før, bare ikke uten nett etter omstart
    });
  }, []);
  return null;
}
