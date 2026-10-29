/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Takten for hentingen i den egenbygde kandidaten (docs/funksjoner/fase1-kandidat-egenbygd.md
 * pkt. 6). Ren funksjon: ingen tidtakere, ingen `Date`, ingen nettleser-API. Ventetiden er relativ
 * (ms fra nå), så funksjonen trenger ingen klokke; leseren eier tidtakeren.
 */
import {
  PULL_BACKOFF_MAX_MS,
  PULL_INTERVAL_MS,
  type PullEvent,
  type PullOutcome,
  type PullScheduleState,
} from "./types";

/** Starttilstand: ingen feil på rad. */
export const INITIAL_PULL_SCHEDULE: PullScheduleState = { failures: 0 };

/**
 * Følger kontrakten `NextPullDelay` i `types.ts` (to overlaster: utfallene gir alltid et tall).
 * `ok` og `acked`: neste henting om 5 s, feiltelleren nullstilles.
 * `more` og `invalid-cursor`: neste henting med en gang, feiltelleren står.
 * `failed`: 5, 10, 20, 40, 60 s (tak 60 s), feiltelleren øker.
 * `sync-now`: med en gang, feiltelleren står; uten nett `null`.
 * `wake`: med en gang, feiltelleren nullstilles. `offline`: `null`.
 */
export function nextPullDelay(
  state: PullScheduleState,
  outcome: PullOutcome,
): { state: PullScheduleState; delayMs: number };
export function nextPullDelay(
  state: PullScheduleState,
  event: PullEvent,
): { state: PullScheduleState; delayMs: number | null };
export function nextPullDelay(
  state: PullScheduleState,
  event: PullEvent,
): { state: PullScheduleState; delayMs: number | null } {
  // Feiltelleren og nett-merket følger med, men tilstanden som kom inn, endres aldri.
  const keep = (): PullScheduleState =>
    state.offline ? { failures: state.failures, offline: true } : { failures: state.failures };
  switch (event) {
    case "ok":
    case "acked":
      return { state: { failures: 0 }, delayMs: PULL_INTERVAL_MS };
    case "more":
    case "invalid-cursor":
      return { state: keep(), delayMs: 0 };
    case "failed": {
      const failures = Math.max(0, state.failures);
      // Eksponenten holdes liten, så tallet aldri vokser seg uendelig før taket.
      const delayMs = Math.min(PULL_INTERVAL_MS * 2 ** Math.min(failures, 16), PULL_BACKOFF_MAX_MS);
      return { state: { ...keep(), failures: failures + 1 }, delayMs };
    }
    case "sync-now":
      return { state: keep(), delayMs: state.offline ? null : 0 };
    case "wake":
      return { state: { failures: 0 }, delayMs: 0 };
    case "offline":
      return { state: { failures: state.failures, offline: true }, delayMs: null };
  }
}
