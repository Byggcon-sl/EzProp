/*
 * Logg inn med Microsoft 365 (ADR 0008, docs/funksjoner/fase2a-microsoft-innlogging.md).
 *
 * Grensesnittet utvikleren bygger mot. Better Auth sin Microsoft-leverandør er adapteren; denne
 * filen kaller aldri Microsoft selv. Filen importerer bare fra `@/shared` og bladfilen
 * `@/core/integrations/secrets` (ikke indeksen: den gir sirkelen integrations → access → auth).
 */

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
] as const;
export type MicrosoftRejectionReason = (typeof MICROSOFT_REJECTION_REASONS)[number];

/** Feltene vi leser fra ID-tokenet. Alt annet i tokenet ses bort fra. */
export type MicrosoftIdTokenClaims = {
  readonly tid?: unknown;
  readonly oid?: unknown;
  readonly idp?: unknown;
  readonly email?: unknown;
  readonly preferred_username?: unknown;
  readonly upn?: unknown;
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

/**
 * Oppsettet for Microsoft-innlogging, eller `null` når det ikke er komplett og gyldig.
 *
 * «Alle eller ingen», og kaster aldri (regel 11, A219): mangler en av de tre verdiene, er
 * tenant-id ikke en GUID, eller er hemmeligheten en nøkkelboks-referanse som ikke ble hentet,
 * gis `null` og én advarsel med bare navnene. Er ingen av de tre satt, gis `null` uten advarsel.
 * `MS_LOGIN_CLIENT_SECRET` leses bare med `readSecret`.
 */
export function getMicrosoftLoginConfig(): MicrosoftLoginConfig | null {
  throw new Error("Ikke bygget: getMicrosoftLoginConfig (fase2a-microsoft-innlogging)");
}

/** Om Microsoft-knappen skal vises. Den eneste verdien innloggingssiden får fra serveren. */
export function isMicrosoftLoginEnabled(): boolean {
  throw new Error("Ikke bygget: isMicrosoftLoginEnabled (fase2a-microsoft-innlogging)");
}

/**
 * Vår egen sperre, kjørt på serveren før noe slås opp (ADR 0008 punkt 3). Ren funksjon.
 *
 * Rekkefølge: `tid` lik `tenantId` (ellers `wrong_tenant`) → ikke gjest: `idp` finnes og er ulik
 * egen tenant, eller `#EXT#` i `preferred_username`/`upn` (`guest_account`) → `oid` er en
 * ikke-tom tekst (`missing_oid`) → e-post fra `email`, ellers `preferred_username`, trimmet og
 * med små bokstaver (tom gir `missing_email`). Kaster aldri.
 */
export function checkMicrosoftProfile(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  claims: MicrosoftIdTokenClaims,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tenantId: string,
): MicrosoftProfileCheck {
  throw new Error("Ikke bygget: checkMicrosoftProfile (fase2a-microsoft-innlogging)");
}
