/*
 * Logg inn med Microsoft 365 (ADR 0008, docs/funksjoner/fase2a-microsoft-innlogging.md).
 *
 * Grensesnittet utvikleren bygger mot. Better Auth sin Microsoft-leverandør er adapteren; denne
 * filen kaller aldri Microsoft selv. Filen importerer bare fra `@/shared` og bladfilen
 * `@/core/integrations/secrets` (ikke indeksen: den gir sirkelen integrations → access → auth).
 */

import { readSecret } from "@/core/integrations/secrets";
import { getEnv, type Env } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";

/** Leverandør-id i Better Auth og verdien i `accounts.provider_id`. Endres aldri. */
export const MICROSOFT_PROVIDER_ID = "microsoft";

/** Navnene på de tre verdiene. Bare navnene står i advarsler og logg, aldri verdiene. */
export const MS_LOGIN_ENV_NAMES = {
  tenantId: "MS_LOGIN_TENANT_ID",
  clientId: "MS_LOGIN_CLIENT_ID",
  clientSecret: "MS_LOGIN_CLIENT_SECRET",
} as const;

/** Det eneste vi ber Microsoft om. Ingen `offline_access`, ingen `User.Read`. */
export const MICROSOFT_LOGIN_SCOPES = ["openid", "profile", "email"] as const;

/** Der Better Auth sender nettleseren ved avvist innlogging (med `?error=…`). */
export const MICROSOFT_ERROR_CALLBACK_PATH = "/logg-inn";

/** Ferdig oppsett. `tenantId` er alltid en GUID, aldri `common`, `organizations` eller `consumers`. */
export type MicrosoftLoginConfig = {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

/**
 * Hvorfor en Microsoft-innlogging ble avvist. Bare til loggen (uten e-post, `oid` eller token).
 * Brukeren ser samme tekst for alle (A215). Kodene endres aldri; nye legges til.
 */
export const MICROSOFT_REJECTION_REASONS = [
  "wrong_tenant",
  "guest_account",
  "missing_email",
  "missing_oid",
  "no_active_employment",
  "invalid_token",
] as const;
export type MicrosoftRejectionReason = (typeof MICROSOFT_REJECTION_REASONS)[number];

/** Feltene vi leser fra ID-tokenet. Alt annet i tokenet ses bort fra. */
export type MicrosoftIdTokenClaims = {
  readonly aud?: unknown;
  readonly iss?: unknown;
  readonly exp?: unknown;
  readonly tid?: unknown;
  readonly oid?: unknown;
  readonly idp?: unknown;
  readonly email?: unknown;
  readonly preferred_username?: unknown;
  readonly upn?: unknown;
};

/** Det vi venter i tokenet: egen tenant, egen klient-id og tiden nå (sekunder). */
export type MicrosoftTokenExpectation = {
  readonly tenantId: string;
  readonly clientId: string;
  readonly nowSeconds: number;
};

export type MicrosoftProfileCheck =
  | {
      readonly ok: true;
      /** Microsofts `oid`. Blir `accounts.account_id`. */
      readonly oid: string;
      /** Trimmet og med små bokstaver. Brukes bare til første kobling. */
      readonly email: string;
    }
  | { readonly ok: false; readonly reason: MicrosoftRejectionReason };

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LoginEnv = Pick<Env, "MS_LOGIN_TENANT_ID" | "MS_LOGIN_CLIENT_ID">;

function readLoginEnv(): LoginEnv | null {
  try {
    return getEnv();
  } catch {
    // Feil i andre verdier stopper appen andre steder; her gir de bare «ikke satt opp».
    return null;
  }
}

function readClientSecret(): string | null {
  try {
    return readSecret(MS_LOGIN_ENV_NAMES.clientSecret);
  } catch {
    // Mangler, tom eller uløst nøkkelboks-referanse. Feilen har bare navnet og sendes ikke videre.
    return null;
  }
}

function warnInvalidConfig(names: readonly string[]) {
  logger.warn(
    `Microsoft-innlogging er slått av: oppsettet er ufullstendig eller ugyldig (${names.join(", ")}). Bare engangskoden virker.`,
  );
}

function resolveConfig(warn: boolean, env: LoginEnv | null): MicrosoftLoginConfig | null {
  try {
    const tenantId = env?.MS_LOGIN_TENANT_ID?.trim() || null;
    const clientId = env?.MS_LOGIN_CLIENT_ID?.trim() || null;
    const clientSecret = readClientSecret();
    if (!tenantId && !clientId && !clientSecret) return null;

    const invalid: string[] = [];
    if (!tenantId || !GUID.test(tenantId)) invalid.push(MS_LOGIN_ENV_NAMES.tenantId);
    if (!clientId) invalid.push(MS_LOGIN_ENV_NAMES.clientId);
    if (!clientSecret) invalid.push(MS_LOGIN_ENV_NAMES.clientSecret);
    if (invalid.length > 0 || !tenantId || !clientId || !clientSecret) {
      if (warn) warnInvalidConfig(invalid);
      return null;
    }
    // Microsoft skriver tenant-id med små bokstaver i `tid` og `iss`
    return { tenantId: tenantId.toLowerCase(), clientId, clientSecret };
  } catch {
    if (warn) warnInvalidConfig(Object.values(MS_LOGIN_ENV_NAMES));
    return null;
  }
}

/**
 * Oppsettet for Microsoft-innlogging, eller `null` når det ikke er komplett og gyldig.
 *
 * «Alle eller ingen», og kaster aldri (regel 11, A219): mangler en av de tre verdiene, er
 * tenant-id ikke en GUID, eller er hemmeligheten en nøkkelboks-referanse som ikke ble hentet,
 * gis `null` og én advarsel med bare navnene. Er ingen av de tre satt, gis `null` uten advarsel.
 * `MS_LOGIN_CLIENT_SECRET` leses bare med `readSecret`. Tenant-id gis med små bokstaver.
 * `env` kan sendes inn i tester; ellers leses `getEnv()`.
 */
export function getMicrosoftLoginConfig(env?: LoginEnv): MicrosoftLoginConfig | null {
  return resolveConfig(true, env ?? readLoginEnv());
}

/**
 * Om Microsoft-knappen skal vises. Den eneste verdien innloggingssiden får fra serveren.
 * Logger ikke (advarselen kommer én gang når innloggingen settes opp).
 */
export function isMicrosoftLoginEnabled(): boolean {
  return resolveConfig(false, readLoginEnv()) !== null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function hasGuestMarker(value: unknown): boolean {
  return typeof value === "string" && value.toUpperCase().includes("#EXT#");
}

/** `aud` er vår klient-id, `iss` er vår tenant, og tokenet er ikke utløpt (ADR 0008 punkt 17). */
function isTokenForUs(claims: MicrosoftIdTokenClaims, expected: MicrosoftTokenExpectation) {
  const { aud, iss, exp } = claims;
  const audOk =
    typeof aud === "string"
      ? aud === expected.clientId
      : Array.isArray(aud) && aud.includes(expected.clientId);
  const issOk = iss === `https://login.microsoftonline.com/${expected.tenantId}/v2.0`;
  const expOk = typeof exp === "number" && Number.isFinite(exp) && exp > expected.nowSeconds;
  return audOk && issOk && expOk;
}

/**
 * Vår egen sperre, kjørt på serveren før noe slås opp (ADR 0008 punkt 3 og 17). Ren funksjon.
 *
 * Rekkefølge: `aud` lik klient-id (tekst, eller liste som inneholder den), `iss` lik
 * `https://login.microsoftonline.com/<tenantId>/v2.0` og `exp` etter `nowSeconds` (ellers
 * `invalid_token`) → `tid` lik `tenantId` (ellers `wrong_tenant`) → ikke gjest: `idp` finnes og er
 * ulik egen tenant, eller `#EXT#` i `preferred_username`/`upn` (`guest_account`) → `oid` er en
 * ikke-tom tekst (`missing_oid`) → e-post fra `email`, ellers `preferred_username`, trimmet og
 * med små bokstaver (tom gir `missing_email`). Signaturen sjekkes ikke (ADR 0008 punkt 17).
 * Kaster aldri.
 */
export function checkMicrosoftProfile(
  claims: MicrosoftIdTokenClaims,
  expected: MicrosoftTokenExpectation,
): MicrosoftProfileCheck {
  try {
    if (!claims || typeof claims !== "object") return { ok: false, reason: "invalid_token" };
    if (!isTokenForUs(claims, expected)) return { ok: false, reason: "invalid_token" };

    if (typeof claims.tid !== "string" || claims.tid !== expected.tenantId) {
      return { ok: false, reason: "wrong_tenant" };
    }

    const idp = nonEmptyString(claims.idp);
    const ownIdps = [`https://sts.windows.net/${expected.tenantId}/`, expected.tenantId];
    if (
      (idp !== null && !ownIdps.includes(idp)) ||
      hasGuestMarker(claims.preferred_username) ||
      hasGuestMarker(claims.upn)
    ) {
      return { ok: false, reason: "guest_account" };
    }

    const oid = nonEmptyString(claims.oid);
    if (oid === null) return { ok: false, reason: "missing_oid" };

    const email = (
      nonEmptyString(claims.email) ?? nonEmptyString(claims.preferred_username)
    )?.toLowerCase();
    if (!email || !email.includes("@")) return { ok: false, reason: "missing_email" };

    return { ok: true, oid, email };
  } catch {
    return { ok: false, reason: "invalid_token" };
  }
}
