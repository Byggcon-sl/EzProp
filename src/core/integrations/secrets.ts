/*
 * Hemmeligheter for tilkoblingene leses bare her. Nå fra miljøvariablene; når nøkkelboksen
 * (Azure Key Vault, eget punkt i fase 0b) kommer, byttes bare denne filen. Verdien logges aldri,
 * og feilmeldingene har bare navnet.
 */

/** Gyldig navn: store bokstaver, tall og `_`, starter med bokstav, 2–128 tegn. */
const SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;

/**
 * Appens egne hemmeligheter. De kan aldri leses gjennom laget, heller ikke når en tilkobling
 * peker på dem. Samme liste gjelder når nøkkelboksen kommer.
 */
const DENYLIST: ReadonlySet<string> = new Set([
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "POWERSYNC_JWT_SECRET",
  "FILE_STORAGE_AZURE_CONNECTION_STRING",
]);

/** Navnet på hemmeligheten er ugyldig eller står på nektlisten. Meldingen har aldri navnet. */
export class InvalidSecretRefError extends Error {
  constructor() {
    super("Navnet på hemmeligheten er ugyldig.");
    this.name = "InvalidSecretRefError";
  }
}

/** Hemmeligheten finnes ikke (eller er tom). Meldingen har bare navnet, aldri en verdi. */
export class SecretNotFoundError extends Error {
  constructor(secretRef: string) {
    super(`Fant ikke hemmeligheten ${secretRef}.`);
    this.name = "SecretNotFoundError";
  }
}

/** Om navnet kan brukes som `secretRef` (riktig form og ikke på nektlisten). */
export function isValidSecretRef(secretRef: unknown): secretRef is string {
  return (
    typeof secretRef === "string" && SECRET_REF_PATTERN.test(secretRef) && !DENYLIST.has(secretRef)
  );
}

/**
 * Leser hemmeligheten med navnet `secretRef`. Ugyldig navn eller navn på nektlisten gir
 * `InvalidSecretRefError` før noe leses; mangler verdien, gir det `SecretNotFoundError`.
 */
export async function readSecret(secretRef: string): Promise<string> {
  if (!isValidSecretRef(secretRef)) throw new InvalidSecretRefError();
  const value = process.env[secretRef];
  if (value === undefined || value === "") throw new SecretNotFoundError(secretRef);
  return value;
}
