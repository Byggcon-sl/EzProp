import { createHash, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/shared/config/env";
import { isUnresolvedSecretReference } from "@/shared/config/secret-reference";
import { logger } from "@/shared/lib/logger";

/*
 * Driftshemmeligheten: tilgang for planlagte driftsjobber som ikke har en innlogget bruker
 * (ADR 0014). Ligger i `src/core/access` fordi tilgang bare sjekkes her (regel 2).
 *
 * Filen har ingen databaseimport og leser hemmeligheten via `getEnv()`, aldri via `readSecret`,
 * slik at `src/core/access` ikke blir avhengig av `src/core/integrations`.
 */

/** Kortere hemmelighet enn dette regnes som feil oppsett, og endepunktet er av. */
export const OPERATIONS_SECRET_MIN_LENGTH = 32;

const SECRET_NAME = "AUTH_CLEANUP_SECRET";
const BEARER_PREFIX = "Bearer ";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Hemmeligheten når den er gyldig satt, ellers `null` (med advarsel ved feil oppsett). */
function configuredSecret(): string | null {
  let secret: string | undefined;
  try {
    secret = getEnv().AUTH_CLEANUP_SECRET;
  } catch {
    // Ugyldig miljø ellers i appen: endepunktet holdes stengt, funksjonen kaster aldri.
    logger.warn("Driftshemmeligheten kan ikke leses", { setting: SECRET_NAME });
    return null;
  }
  if (!secret) return null;
  if (isUnresolvedSecretReference(secret)) {
    logger.warn("Driftshemmeligheten er en uløst nøkkelboks-referanse", { setting: SECRET_NAME });
    return null;
  }
  if (secret.length < OPERATIONS_SECRET_MIN_LENGTH) {
    logger.warn("Driftshemmeligheten er for kort", {
      setting: SECRET_NAME,
      minLength: OPERATIONS_SECRET_MIN_LENGTH,
    });
    return null;
  }
  return secret;
}

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
  const secret = configuredSecret();
  if (secret === null) return false;
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) return false;
  const token = authorizationHeader.slice(BEARER_PREFIX.length);
  if (token.length === 0) return false;
  return timingSafeEqual(sha256(token), sha256(secret));
}
