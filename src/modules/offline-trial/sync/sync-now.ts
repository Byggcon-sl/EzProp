/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Felles regler for «Synk nå» (docs/funksjoner/fase1-synkstatus.md pkt. 3–5 og 8), brukt av alle
 * tre kandidatenes `syncNow`, så nett-sjekk, tidsavbrudd og «kaster aldri» er likt. Ren fil: ingen
 * `window`, React eller SDK.
 */
import type { TrialSyncRoundResult } from "./types";

/** Knappen blir aldri hengende på «Synker …» lenger enn dette. */
export const SYNC_NOW_TIMEOUT_MS = 15_000;

export interface RunSyncNowOptions {
  isOnline: () => boolean;
  /** Kandidatens runde: send køen og hent med en gang. Avvises ved feil. */
  round: () => Promise<void>;
  timeoutMs?: number;
}

/**
 * Uten nett: `"offline"` straks, `round` kalles ikke. Ellers `"ok"` når runden lyktes, og
 * `"failed"` ved feil (også synkron) eller etter `timeoutMs`. Kaster aldri.
 */
export async function runSyncNow({
  isOnline,
  round,
  timeoutMs = SYNC_NOW_TIMEOUT_MS,
}: RunSyncNowOptions): Promise<TrialSyncRoundResult> {
  if (!isOnline()) return "offline";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TrialSyncRoundResult>((resolve) => {
    timer = setTimeout(() => resolve("failed"), timeoutMs);
  });
  const attempt = (async (): Promise<TrialSyncRoundResult> => {
    try {
      await round();
      return "ok";
    } catch {
      return "failed";
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bare én runde om gangen: kall mens en runde pågår, får samme løfte. Låsen slippes når runden er
 * ferdig, også ved feil.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    if (running) return running;
    const current = (async () => {
      try {
        return await fn();
      } finally {
        running = null;
      }
    })();
    running = current;
    return current;
  };
}
