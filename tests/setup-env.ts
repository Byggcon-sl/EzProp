import { testDatabaseUrl } from "./test-env";

const env = process.env as Record<string, string | undefined>;
env.DATABASE_URL = testDatabaseUrl();
env.NODE_ENV = "test";
env.DEV_MAILBOX = "1";
env.BETTER_AUTH_SECRET ??= "test-secret-som-er-lang-nok-for-better-auth";

/*
 * Ingen nettkall til Anthropic fra testene (docs/funksjoner/fase2a-ki-leverandor-testplan.md S2).
 * Nøkkelen fjernes fra miljøet, så en ekte nøkkel på maskinen aldri brukes; testene setter en
 * oppdiktet nøkkel med `vi.stubEnv`. Den innebygde `fetch` pakkes inn, så et kall til Anthropics
 * vertsnavn kaster før noe går ut. Testene som trenger HTTP, sender inn falsk `fetch` eller bruker
 * `vi.stubGlobal("fetch", ...)`; `vi.unstubAllGlobals` gir tilbake denne innpakningen.
 */
delete env.ANTHROPIC_API_KEY;

export const BLOCKED_HOST_MESSAGE = "Testene skal aldri gjøre nettkall til Anthropic.";

function hostOf(input: RequestInfo | URL): string {
  try {
    const url = input instanceof Request ? input.url : String(input);
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const realFetch = globalThis.fetch;
if (typeof realFetch === "function") {
  const guardedFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const host = hostOf(input);
    if (host === "anthropic.com" || host.endsWith(".anthropic.com")) {
      return Promise.reject(new Error(BLOCKED_HOST_MESSAGE));
    }
    return realFetch(input, init);
  };
  globalThis.fetch = guardedFetch as typeof fetch;
}
