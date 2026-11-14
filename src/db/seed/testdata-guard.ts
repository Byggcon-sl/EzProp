import { LOCAL_DATABASE_HOSTS, TEST_DATABASE_HOST } from "@/shared/config/database-hosts";
import { getEnv } from "@/shared/config/env";

/**
 * Produksjonsvakten for testdata (A302, docs/funksjoner/fase2a-testdata-arbeidshverdag.md).
 * To sperrer, begge før første skriving:
 *  1. `APP_ENVIRONMENT` er nøyaktig `development` eller `test` (ikke `NODE_ENV`, fordi
 *     testmiljøet i Azure også kjører med `NODE_ENV=production`).
 *  2. Verten i `DATABASE_URL` er lokal eller nøyaktig testdatabasen i Azure.
 *
 * Ren funksjon uten databasekall. Meldingene viser aldri adressen, verten, brukernavnet eller
 * passordet. Støtter hovedmål: færre reklamasjoner og trygghet for de ansatte, fordi oppdiktede
 * data aldri kan havne i produksjon.
 */

/** Feil når testdata ikke kan legges inn her. Meldingen er norsk og uten adresse eller vert. */
export class TestdataNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestdataNotAllowedError";
  }
}

export const TESTDATA_ENVIRONMENT_MESSAGE =
  "Testdata kan bare legges inn i utviklings- eller testmiljøet (APP_ENVIRONMENT).";
export const TESTDATA_HOST_MESSAGE =
  "Testdata kan bare legges inn i en lokal database eller testdatabasen i Azure.";
export const TESTDATA_ENV_INVALID_MESSAGE =
  "Testdata kan ikke legges inn fordi miljøvariablene er ugyldige. Sjekk DATABASE_URL og de andre verdiene i .env.";

const ALLOWED_ENVIRONMENTS: ReadonlySet<string> = new Set(["development", "test"]);

/** Parametre i spørredelen som kan bytte verten klienten kobler til. */
const HOST_QUERY_PARAMS: ReadonlySet<string> = new Set(["host", "pghost", "hostaddr"]);

/**
 * Vertsdelen slik databaseklienten (postgres.js) leser den: etter `://`, før `/` eller `?`,
 * etter `@`, og prosentkoding tolket. Gir `null` hvis den ikke kan tolkes.
 */
function rawHostPart(url: string): string | null {
  const start = url.indexOf("://");
  if (start < 0) return null;
  const authority = url.slice(start + 3).split(/[?/]/)[0] ?? "";
  // Første `@`, som postgres.js; da dekker kommasjekken også alt etter en `@` i passordet.
  const host = authority.slice(authority.indexOf("@") + 1);
  try {
    return decodeURIComponent(host);
  } catch {
    return null;
  }
}

/** Sant hvis verten i adressen er lokal eller nøyaktig testdatabasen. */
function isAllowedDatabaseUrl(url: string): boolean {
  if (url === "") return false;
  // Komma i vertsdelen betyr flere verter (postgres.js), sjekkes før URL-tolkning.
  const raw = rawHostPart(url);
  if (raw === null || raw.includes(",")) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  for (const name of parsed.searchParams.keys()) {
    if (HOST_QUERY_PARAMS.has(name.toLowerCase())) return false;
  }
  // `new URL` gjør ikke verten om til små bokstaver for `postgres:`; DNS skiller ikke på dem.
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "" || hostname.endsWith(".")) return false;
  return LOCAL_DATABASE_HOSTS.has(hostname) || hostname === TEST_DATABASE_HOST;
}

/**
 * Stopper med `TestdataNotAllowedError` hvis testdata ikke kan legges inn. Kalles først i
 * `seedTestdata`, før noen transaksjon åpnes. Leser samme `DATABASE_URL` som `src/db/client.ts`.
 */
export function assertTestdataAllowed(): void {
  const environment = process.env.APP_ENVIRONMENT;
  if (typeof environment !== "string" || !ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new TestdataNotAllowedError(TESTDATA_ENVIRONMENT_MESSAGE);
  }
  let databaseUrl: string;
  try {
    databaseUrl = getEnv().DATABASE_URL;
  } catch {
    // Meldingen fra getEnv kan inneholde verdier; den vises ikke.
    throw new TestdataNotAllowedError(TESTDATA_ENV_INVALID_MESSAGE);
  }
  if (!isAllowedDatabaseUrl(databaseUrl)) {
    throw new TestdataNotAllowedError(TESTDATA_HOST_MESSAGE);
  }
}
