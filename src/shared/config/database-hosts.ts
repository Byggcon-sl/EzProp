/**
 * Databaseverter som vaktene godtar. Delt av e2e-vakten (`e2e/database-guard.ts`) og
 * produksjonsvakten for testdata (`src/db/seed/testdata-guard.ts`).
 */

/** Verter som regnes som lokale. `URL.hostname` gir IPv6 med klammer. */
export const LOCAL_DATABASE_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

/**
 * Databaseserveren i testmiljøet i Azure: `fullyQualifiedDomainName` for `psql-ezprop-${environmentName}`
 * i `infra/azure/main.bicep` med `environmentName` `test`. Nøyaktig vert, ingen mønster (A302).
 */
export const TEST_DATABASE_HOST = "psql-ezprop-test.postgres.database.azure.com";
