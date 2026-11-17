/**
 * Hodet `src/proxy.ts` setter med stien til siden som ble bedt om (bare `pathname`). Proxyen
 * sletter alltid et hode med samme navn fra klienten. Egen fil uten `server-only` og uten
 * innloggingskoden, slik at proxyen ikke drar med seg databasen.
 */
export const REQUEST_PATH_HEADER = "x-request-path";
