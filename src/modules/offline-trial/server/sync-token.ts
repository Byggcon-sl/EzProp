/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Utsteder JWT-en iPaden bruker mot synktjenesten (PowerSync). HS256 med delt hemmelighet; claims
 * bare `sub`, `organization_id` (= `grant.organizationId`), `aud`, `iat` og `exp`. Aldri e-post
 * eller navn. Synkreglene i `powersync/sync-rules.yaml` filtrerer bøtta på `organization_id`.
 */
import { SignJWT } from "jose";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import {
  SYNC_TOKEN_AUDIENCE,
  SYNC_TOKEN_SECRET_MIN_BYTES,
  SYNC_TOKEN_TTL_SECONDS,
  type IssueSyncToken,
  type SyncTokenResult,
} from "./types";

/** Nøkkel-id i JWT-hodet. Samme `kid` står i `powersync/config.yaml`. */
export const SYNC_TOKEN_KEY_ID = "trial";

/**
 * Utviklingsverdien fra `.env.example`. Den er ikke hemmelig og nektes derfor når appen ikke kjører
 * på localhost (samme mønster som `DEV_MAILBOX`). Må være lik verdien i `.env.example`.
 */
export const DEVELOPMENT_SYNC_SECRET = "utvikling-ikke-hemmelig-synknokkel-bare-for-mac-0123456789";

function isLocalhost(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Leser hemmeligheten ved hvert kall (ikke ved modul-last), så testene kan bytte den. */
function readSecret(): Uint8Array {
  const secret = process.env.POWERSYNC_JWT_SECRET ?? "";
  const bytes = new TextEncoder().encode(secret);
  if (secret.trim() === "" || bytes.length < SYNC_TOKEN_SECRET_MIN_BYTES) {
    throw new Error(
      `POWERSYNC_JWT_SECRET mangler eller er kortere enn ${SYNC_TOKEN_SECRET_MIN_BYTES} byte. Se .env.example.`,
    );
  }
  const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
  if (secret === DEVELOPMENT_SYNC_SECRET && !isLocalhost(appUrl)) {
    throw new Error(
      "POWERSYNC_JWT_SECRET har utviklingsverdien fra .env.example. Den kan bare brukes når BETTER_AUTH_URL er localhost.",
    );
  }
  return bytes;
}

function readEndpoint(): string {
  const endpoint = process.env.POWERSYNC_URL ?? "";
  if (endpoint.trim() === "") throw new Error("POWERSYNC_URL mangler. Se .env.example.");
  return endpoint;
}

export const issueSyncToken: IssueSyncToken = async (
  actor: Actor,
  organizationId: string,
): Promise<SyncTokenResult> => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  const key = readSecret();
  const endpoint = readEndpoint();
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ organization_id: grant.organizationId })
    .setProtectedHeader({ alg: "HS256", kid: SYNC_TOKEN_KEY_ID })
    .setSubject(actor.id)
    .setAudience(SYNC_TOKEN_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + SYNC_TOKEN_TTL_SECONDS)
    .sign(key);
  return { token, endpoint };
};
