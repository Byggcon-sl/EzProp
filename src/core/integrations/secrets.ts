/*
 * Den eneste veien til hemmelighetene for tilkoblingene. Nå leses de fra miljøvariabler.
 * Byttes ut med nøkkelboksen (Azure Key Vault, eget punkt i fase 0b); resten av laget merker
 * ikke byttet. Verdien står aldri i en feilmelding eller i loggen, bare navnet.
 *
 * Dette er den eneste filen i `src/core/integrations` og `src/core/email` som leser miljøet
 * direkte.
 */

const SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;

/** Appens egne hemmeligheter. Kan aldri leses gjennom tilkoblingslaget. */
export const DENIED_SECRET_REFS: readonly string[] = [
  "BETTER_AUTH_SECRET",
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "POWERSYNC_JWT_SECRET",
  "FILE_STORAGE_AZURE_CONNECTION_STRING",
];

/** Navnet på hemmeligheten er ugyldig eller står på nektlisten. */
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

/** Store bokstaver, tall og «_», 2–128 tegn, og ikke på nektlisten. */
export function isValidSecretRef(name: string): boolean {
  return SECRET_REF_PATTERN.test(name) && !DENIED_SECRET_REFS.includes(name);
}

/** Leser hemmeligheten med navnet `secretRef`. Navnet sjekkes før miljøet leses. */
export function readSecret(secretRef: string): string {
  if (typeof secretRef !== "string" || !isValidSecretRef(secretRef)) {
    throw new InvalidSecretRefError();
  }
  const value = process.env[secretRef];
  if (value === undefined || value === "") throw new SecretNotFoundError(secretRef);
  return value;
}
