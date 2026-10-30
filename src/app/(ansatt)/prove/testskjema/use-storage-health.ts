"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  requestPersistentStorage,
  type StorageHealth,
} from "@/modules/offline-trial/storage-health";
import { readStorageHealthForScreen } from "@/modules/offline-trial/storage-test-hook";

/**
 * Prøve C: plassen på iPaden for skjemaet og listen. Måler når siden åpnes, og igjen etter at
 * appen har bedt om varig lagring. `measure` måler på nytt (stabil mellom visninger). Siste svar
 * vinner, og ingenting settes etter at siden er lukket.
 */
export function useStorageHealth(): { health: StorageHealth | null; measure: () => void } {
  const [health, setHealth] = useState<StorageHealth | null>(null);
  const latestCall = useRef(0);
  const mounted = useRef(true);

  const measure = useCallback(() => {
    const call = ++latestCall.current;
    void readStorageHealthForScreen().then((next) => {
      if (mounted.current && call === latestCall.current) setHealth(next);
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    measure();
    void requestPersistentStorage().then(measure);
    return () => {
      mounted.current = false;
    };
  }, [measure]);

  return { health, measure };
}
