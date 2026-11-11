/*
 * Global sperre mot ekte KI-kall i testene (docs/funksjoner/fase2a-ki-leverandor.md Omfang 11,
 * testplanen S2). Lastes av Vitest før hver testfil (setupFiles i vitest.config.ts).
 *
 * `globalThis.fetch` pakkes inn: kall til Anthropics vertsnavn kaster en tydelig feil, alt annet
 * går videre til den vanlige `fetch`. Tester som trenger svar fra leverandøren, sender inn falsk
 * HTTP (adapteren tar `fetch` som valg) eller stubber `fetch` selv. Da brukes ikke denne.
 *
 * Støtter hovedmål: KI i bunnen, trygt. Ingen test kan bruke nøkkelen eller koste penger.
 */

/** Vertsnavnene som sperres: leverandørens domene og alle underdomener. */
const BLOCKED_HOST_SUFFIX = "anthropic.com";

export const BLOCKED_FETCH_MESSAGE =
  "Ekte kall til KI-leverandøren er sperret i testene. Send inn falsk fetch i testen.";

/** Vertsnavnet i det `fetch` får inn (tekst, URL eller Request), eller null hvis det ikke kan leses. */
function hostnameOf(input: unknown): string | null {
  try {
    if (typeof input === "string") return new URL(input).hostname.toLowerCase();
    if (input instanceof URL) return input.hostname.toLowerCase();
    if (typeof Request !== "undefined" && input instanceof Request) {
      return new URL(input.url).hostname.toLowerCase();
    }
  } catch {
    return null;
  }
  return null;
}

export function isBlockedHost(input: unknown): boolean {
  const host = hostnameOf(input)?.replace(/\.$/, "");
  if (!host) return false;
  return host === BLOCKED_HOST_SUFFIX || host.endsWith(`.${BLOCKED_HOST_SUFFIX}`);
}

const MARKER = Symbol.for("tests.blockExternalFetch");
type MarkedFetch = typeof fetch & { [MARKER]?: true };

export function installFetchBlock(): void {
  const current = globalThis.fetch as MarkedFetch | undefined;
  if (typeof current !== "function" || current[MARKER]) return;
  const original = current;
  const blocked: MarkedFetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (isBlockedHost(input)) return Promise.reject(new Error(BLOCKED_FETCH_MESSAGE));
      return original(input, init);
    },
    { [MARKER]: true as const },
  );
  globalThis.fetch = blocked;
}

installFetchBlock();
