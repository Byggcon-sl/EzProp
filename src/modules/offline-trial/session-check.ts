/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Sjekker om innloggingen fortsatt gjelder (docs/funksjoner/fase1-prove-f-innlogging.md, punkt 1).
 * Leser bare om serveren har en økt, aldri e-post, navn eller andre felt. Kaster aldri og skriver
 * aldri til konsollen. Ren fil: ingen React, ingen `window` (fetch sendes inn).
 */
import { singleFlight } from "./sync/sync-now";

export type SessionCheckResult = "valid" | "expired" | "unknown";

/** Hva som utløser en sjekk. «poll» er vanlig statuslesing uten overgang. */
export type SessionCheckTrigger = "online" | "cameOnline" | "visible" | "syncFailed" | "poll";

export const SESSION_CHECK_PATH = "/api/auth/get-session";
export const SESSION_CHECK_TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * 200 med en økt gir `valid`, 200 med `null` gir `expired`. Alt annet (200 uten økt, 401, 403,
 * 5xx, nettverksfeil, ugyldig JSON, tidsavbrudd) gir `unknown`: heller ingen melding enn feil
 * melding.
 */
export async function checkSession(
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  timeoutMs: number = SESSION_CHECK_TIMEOUT_MS,
): Promise<SessionCheckResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SessionCheckResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("unknown");
    }, timeoutMs);
  });
  const attempt = (async (): Promise<SessionCheckResult> => {
    try {
      const response = await fetchImpl(SESSION_CHECK_PATH, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status !== 200) return "unknown";
      const body: unknown = await response.json();
      if (body === null) return "expired";
      if (typeof body === "object" && !Array.isArray(body)) {
        const session = (body as { session?: unknown }).session;
        if (session !== null && typeof session === "object") return "valid";
      }
      return "unknown";
    } catch {
      return "unknown";
    }
  })();
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Høyst én sjekk om gangen: en sjekk som pågår, gjenbrukes. */
export function createSessionChecker(
  check: () => Promise<SessionCheckResult> = () => checkSession(),
): () => Promise<SessionCheckResult> {
  return singleFlight(check);
}

/**
 * Om sjekken skal kjøres: aldri uten nett, aldri ved vanlig statuslesing uten overgang. Ellers ja
 * (`online`, overgang fra «Uten nett» til nett, synlig igjen, feilet synkrunde).
 */
export function shouldCheckSession(trigger: SessionCheckTrigger, online: boolean): boolean {
  if (!online) return false;
  return trigger !== "poll";
}

/** `unknown` endrer ingenting, `expired` gir meldingen, `valid` fjerner den. */
export function nextSignInRequired(previous: boolean, result: SessionCheckResult): boolean {
  if (result === "expired") return true;
  if (result === "valid") return false;
  return previous;
}
