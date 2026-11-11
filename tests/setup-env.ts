import { testDatabaseUrl } from "./test-env";

const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = testDatabaseUrl();
env.NODE_ENV = "test";
env.DEV_MAILBOX = "1";
env.BETTER_AUTH_SECRET ??= "test-secret-som-er-lang-nok-for-better-auth";

/*
 * Ingen test når KI-leverandøren (docs/funksjoner/fase2a-ki-leverandor.md Omfang 11, testplan S2).
 * Nøkkelen fjernes fra miljøet, så en nøkkel i en lokal .env aldri brukes i en test. Testene som
 * trenger en nøkkel, setter en oppdiktet med `vi.stubEnv` og rydder med `vi.unstubAllEnvs`.
 * Kall til leverandørens vertsnavn avvises før noe sendes. `vi.stubGlobal("fetch", ...)`
 * overstyrer fortsatt, fordi sperren bare pakker den opprinnelige `fetch`.
 *
 * Støtter hovedmål: KI i bunnen uten kostnad og uten risiko.
 */
delete env.ANTHROPIC_API_KEY;

export const BLOCKED_AI_FETCH_MESSAGE = "Ekte nettkall til KI-leverandøren er sperret i testene.";

/** Sant for vertsnavnet til KI-leverandøren og alle underdomener. */
export function isBlockedAiHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "anthropic.com" || host.endsWith(".anthropic.com");
}

function hostOf(input: Parameters<typeof fetch>[0]): string | null {
  try {
    if (typeof input === "string") return new URL(input).hostname;
    if (input instanceof URL) return input.hostname;
    return new URL(input.url).hostname;
  } catch {
    return null;
  }
}

const originalFetch = globalThis.fetch;
if (typeof originalFetch === "function") {
  const guardedFetch: typeof fetch = (input, init) => {
    const host = hostOf(input);
    if (host !== null && isBlockedAiHost(host)) {
      return Promise.reject(new Error(BLOCKED_AI_FETCH_MESSAGE));
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = guardedFetch;
}

/** Samme melding under navnet testplanen bruker (tests/no-network.test.ts). */
export const BLOCKED_HOST_MESSAGE = BLOCKED_AI_FETCH_MESSAGE;
