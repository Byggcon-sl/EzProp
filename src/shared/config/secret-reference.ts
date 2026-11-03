/*
 * Vakt mot referanser til nøkkelboksen som ikke ble hentet (ADR 0005).
 *
 * I Azure fylles miljøvariablene fra nøkkelboksen ved oppstart. Får ikke App Service hentet
 * verdien (identiteten mangler tilgang, boksen er borte), står referanseteksten igjen som verdi.
 * Den må aldri brukes som nøkkel eller tilkoblingsstreng. Dette er den eneste filen under `src/`
 * som kjenner formen på referansen; `readSecret` og `env.ts` bruker bare funksjonen under.
 *
 * Ligger i `shared` fordi `shared` aldri importerer fra `core`.
 */

/** Starten på en Key Vault-referanse slik App Service skriver den. */
export const KEY_VAULT_REFERENCE_PREFIX = "@Microsoft.KeyVault(";

/**
 * Sann når verdien er en referanse til nøkkelboksen som ikke ble løst til en ekte verdi.
 * Dekker begge formene App Service bruker (`SecretUri=` og `VaultName=…;SecretName=`),
 * uten hensyn til mellomrom rundt og store og små bokstaver. Tom streng er ikke en referanse.
 */
export function isUnresolvedSecretReference(value: string): boolean {
  return value.trim().toLowerCase().startsWith(KEY_VAULT_REFERENCE_PREFIX.toLowerCase());
}
