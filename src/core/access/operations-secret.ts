/*
 * Driftshemmeligheten: tilgang for planlagte driftsjobber som ikke har en innlogget bruker
 * (ADR 0014). Ligger i `src/core/access` fordi tilgang bare sjekkes her (regel 2).
 *
 * Filen har ingen databaseimport og leser hemmeligheten via `getEnv()`, aldri via `readSecret`,
 * slik at `src/core/access` ikke blir avhengig av `src/core/integrations`.
 */

/** Kortere hemmelighet enn dette regnes som feil oppsett, og endepunktet er av. */
export const OPERATIONS_SECRET_MIN_LENGTH = 32;

/**
 * Sann bare når `Authorization`-headeren er `Bearer <AUTH_CLEANUP_SECRET>`.
 *
 * Begge sider hashes (SHA-256) og sammenlignes med `timingSafeEqual`, så verken lengde eller
 * innhold lekker gjennom tidsbruken.
 *
 * Usann når hemmeligheten ikke er satt, er kortere enn `OPERATIONS_SECRET_MIN_LENGTH` eller er en
 * uløst nøkkelboks-referanse (`isUnresolvedSecretReference`). Feil oppsett gir én advarsel i
 * loggen med bare navnet `AUTH_CLEANUP_SECRET`, aldri verdien. Funksjonen kaster aldri.
 *
 * @param authorizationHeader Verdien av `Authorization`-headeren, eller `null` når den mangler.
 */
export function verifyOperationsSecret(authorizationHeader: string | null): boolean {
  void authorizationHeader;
  // Grensesnittet er satt av arkitekten; sjekken bygges av utvikleren i samme PR. Stengt til da.
  return false;
}
