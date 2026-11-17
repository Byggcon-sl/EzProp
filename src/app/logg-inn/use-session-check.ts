"use client";

import { useEffect, useRef } from "react";
import { authClient } from "@/core/auth/auth-client";

/** Høyst ett kall per 60 sekunder, uansett hvor mange skjemaer som lytter. */
export const SESSION_CHECK_INTERVAL_MS = 60_000;

/** Det som trengs av `document`: synlighet og hendelsen `visibilitychange`. */
export type VisibilityTarget = {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
};

export type SessionWatcherDeps = {
  target: VisibilityTarget;
  isOnline: () => boolean;
  /** `true` med gyldig økt, `false` uten økt. Kaster eller gir `null` når svaret er ukjent. */
  hasSession: () => Promise<boolean | null>;
  now: () => number;
  intervalMs?: number;
};

/**
 * Sjekker økten når siden blir synlig igjen, med nett, høyst én gang per intervall. Uten økt
 * får alle som lytter beskjed. Feil, tidsavbrudd og ukjent svar gir ingen beskjed. Lytteren på
 * `visibilitychange` finnes bare så lenge noen abonnerer.
 */
export function createSessionWatcher(deps: SessionWatcherDeps) {
  const interval = deps.intervalMs ?? SESSION_CHECK_INTERVAL_MS;
  const listeners = new Set<() => void>();
  let lastCheck: number | null = null;

  async function check() {
    if (deps.target.visibilityState !== "visible" || !deps.isOnline()) return;
    const now = deps.now();
    if (lastCheck !== null && now - lastCheck < interval) return;
    lastCheck = now;
    let signedIn: boolean | null;
    try {
      signedIn = await deps.hasSession();
    } catch {
      return;
    }
    if (signedIn !== false) return;
    for (const listener of [...listeners]) listener();
  }

  function onVisibilityChange() {
    void check();
  }

  return {
    subscribe(onSignedOut: () => void): () => void {
      if (listeners.size === 0) {
        deps.target.addEventListener("visibilitychange", onVisibilityChange);
      }
      listeners.add(onSignedOut);
      return () => {
        listeners.delete(onSignedOut);
        if (listeners.size === 0) {
          deps.target.removeEventListener("visibilitychange", onVisibilityChange);
        }
      };
    },
    /** Til testene: venter på sjekken en hendelse startet. */
    check,
  };
}

/** Lett kall til Better Auth. Bare informasjonskapselen sendes, ingen persondata. */
async function hasSession(): Promise<boolean | null> {
  const { data, error } = await authClient.getSession();
  if (error) return null;
  return data !== null;
}

let sharedWatcher: ReturnType<typeof createSessionWatcher> | null = null;

function watcher() {
  sharedWatcher ??= createSessionWatcher({
    target: document,
    isOnline: () => navigator.onLine,
    hasSession,
    now: () => Date.now(),
  });
  return sharedWatcher;
}

/**
 * Når siden får fokus igjen og økten er ute, kalles `onSignedOut` (skjemaet viser «Du er logget
 * ut. Logg inn før du lagrer.»). Én felles sjekk for alle skjemaene på siden.
 */
export function useSessionCheck(onSignedOut: () => void, enabled = true) {
  const callback = useRef(onSignedOut);
  useEffect(() => {
    callback.current = onSignedOut;
  });
  useEffect(() => {
    if (!enabled) return;
    return watcher().subscribe(() => callback.current());
  }, [enabled]);
}

/*
 * Innlogging i én dialog gjelder hele siden. De andre skjemaene og den felles meldingen på siden
 * får beskjed, så «Du er logget ut» ikke blir stående der.
 */
const signedInListeners = new Set<() => void>();

/** Kalles av innloggingsdialogen etter riktig kode. */
export function announceSignedIn() {
  for (const listener of [...signedInListeners]) listener();
}

/** `onSignedIn` kalles når den ansatte har logget inn igjen i en dialog på siden. */
export function useSignedInAnnouncement(onSignedIn: () => void) {
  const callback = useRef(onSignedIn);
  useEffect(() => {
    callback.current = onSignedIn;
  });
  useEffect(() => {
    const listener = () => callback.current();
    signedInListeners.add(listener);
    return () => {
      signedInListeners.delete(listener);
    };
  }, []);
}
