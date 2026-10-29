/** Verter som regnes som lokale. `URL.hostname` gir IPv6 med klammer. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Stopper e2e før den kobler til en database som ikke er lokal eller testdatabasen.
 * Godtar lokal vert, eller nøyaktig samme adresse som `testUrl` (`TEST_DATABASE_URL`).
 * Feilmeldingen viser aldri adressen, verten eller passordet.
 */
export function assertLocalOrTestDatabase(url: string, testUrl: string | undefined): void {
  if (typeof testUrl === "string" && testUrl !== "" && url === testUrl) return;
  let hostname: string | null = null;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = null;
  }
  if (hostname !== null && LOCAL_HOSTS.has(hostname)) return;
  throw new Error(
    "e2e skriver bare til lokal database eller testdatabasen. Sett DATABASE_URL til en lokal database.",
  );
}
