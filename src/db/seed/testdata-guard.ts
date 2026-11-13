/**
 * Produksjonsvakten for `pnpm db:seed:testdata` (A302). Ren funksjon uten database: kalles før
 * databasen åpnes, og stopper med mindre begge sperrene holder.
 *
 * 1. `APP_ENVIRONMENT` er nøyaktig `development` eller `test`. `NODE_ENV` teller ikke, fordi
 *    testmiljøet også kjører med `NODE_ENV=production`.
 * 2. Verten i `DATABASE_URL` er lokal eller testserveren i Azure (`psql-ezprop-test.`, med
 *    punktum, slik at for eksempel `psql-ezprop-testprod…` stoppes).
 *
 * Meldingene viser aldri adressen, verten, brukernavnet eller passordet.
 */

const ALLOWED_ENVIRONMENTS: ReadonlySet<string> = new Set(["development", "test"]);
/** `URL.hostname` gir IPv6 med klammer. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Servernavnet er `psql-ezprop-${environmentName}` (infra/azure/main.bicep). */
const AZURE_TEST_HOST_PREFIX = "psql-ezprop-test.";

export class TestdataGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestdataGuardError";
  }
}

function databaseHost(url: string | undefined): string | null {
  if (typeof url !== "string" || url === "") return null;
  try {
    return new URL(url).hostname;
  } catch {
    // Den opprinnelige feilen kan inneholde adressen, og tas derfor ikke med.
    return null;
  }
}

export function assertTestdataAllowed(env: Record<string, string | undefined>): void {
  const environment = env.APP_ENVIRONMENT;
  if (typeof environment !== "string" || !ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new TestdataGuardError(
      "Testdata legges bare inn når APP_ENVIRONMENT er development eller test. Skriptet stoppet, og ingenting er skrevet.",
    );
  }

  const host = databaseHost(env.DATABASE_URL);
  const allowed =
    host !== null && (LOCAL_HOSTS.has(host) || host.startsWith(AZURE_TEST_HOST_PREFIX));
  if (!allowed) {
    throw new TestdataGuardError(
      "Testdata legges bare inn i en lokal database eller testdatabasen i Azure. DATABASE_URL peker et annet sted, mangler eller er ugyldig. Skriptet stoppet, og ingenting er skrevet.",
    );
  }
}
