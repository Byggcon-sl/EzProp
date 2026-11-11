/*
 * Ingen nettkall til KI-leverandøren i testene (docs/funksjoner/fase2a-ki-leverandor-testplan.md
 * S2). Lagt inn av `tests/setup-env.ts` for hver testfil: `fetch` mot Anthropics vertsnavn
 * avvises med en tydelig feil, og nøkkelen fjernes fra miljøet. Testene setter en oppdiktet
 * nøkkel med `vi.stubEnv` og falsk HTTP med `vi.stubGlobal` eller `options.fetch`.
 */

/** Feilen testene får hvis noe prøver å nå KI-leverandøren. */
export const BLOCKED_AI_NETWORK_MESSAGE =
  "Testene gjør aldri nettkall til KI-leverandøren. Send inn falsk fetch.";

/** Om vertsnavnet er Anthropics (også underdomener). */
export function isAnthropicHost(input: unknown): boolean {
  let host = "";
  try {
    const url =
      input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  return host === "anthropic.com" || host.endsWith(".anthropic.com");
}

const GUARD_MARK = Symbol.for("ezprop.test.ai-network-guard");

/** Pakker `globalThis.fetch` og fjerner nøkkelen fra miljøet. Trygt å kalle flere ganger. */
export function installAiNetworkGuard() {
  delete (process.env as Record<string, string | undefined>).ANTHROPIC_API_KEY;
  const current = globalThis.fetch as typeof fetch & { [GUARD_MARK]?: true };
  if (typeof current !== "function" || current[GUARD_MARK]) return;
  const guarded = function fetch(input: RequestInfo | URL, init?: RequestInit) {
    if (isAnthropicHost(input)) return Promise.reject(new Error(BLOCKED_AI_NETWORK_MESSAGE));
    return current(input, init);
  } as typeof fetch & { [GUARD_MARK]?: true };
  guarded[GUARD_MARK] = true;
  globalThis.fetch = guarded;
}
