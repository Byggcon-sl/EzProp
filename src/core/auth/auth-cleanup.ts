/*
 * Rydding av innloggingsdata (ADR 0014, oppgavekort `docs/agenter/oppgaver/rydd-innloggingsdata.md`).
 *
 * Eneste sted i systemet som sletter rader for godt. Unntaket fra myk sletting gjelder bare de
 * tre tekniske innloggingstabellene `login_attempts`, `verifications` og `sessions`. De har ingen
 * `organization_id` og er ikke fagdata. `users`, `accounts` og alt med `organization_id` røres
 * aldri her.
 *
 * Filen importerer bare `@/db/client`, `@/db/schema` og loggeren. Aldri `./auth`: Better Auth
 * skal ikke startes for å rydde.
 */

/** Tellere for innloggingssperren slettes 24 timer etter `created_at`. Svar 10.11.2026, nr. 15. */
export const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Koder og innloggingsrunder slettes 24 timer etter `expires_at`. Svar 10.11.2026, nr. 18. */
export const EXPIRED_VERIFICATION_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Økter slettes 30 dager etter `expires_at`. Svar 10.11.2026, nr. 18. */
export const EXPIRED_SESSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Antall slettede rader per tabell og tidsbruk. Ingenting annet går ut av funksjonen. */
export type AuthCleanupResult = {
  loginAttempts: number;
  verifications: number;
  sessions: number;
  durationMs: number;
};

/**
 * Sletter utløpte innloggingsdata i én transaksjon:
 * - `login_attempts` med `created_at` strengt eldre enn `now − LOGIN_ATTEMPT_RETENTION_MS`
 * - `verifications` med `expires_at` strengt eldre enn `now − EXPIRED_VERIFICATION_RETENTION_MS`
 * - `sessions` med `expires_at` strengt eldre enn `now − EXPIRED_SESSION_RETENTION_MS`
 *
 * En rad nøyaktig på grensen står. Bare faste vilkår på tid; aldri vilkår på bruker, e-post-hash
 * eller organisasjon. Idempotent: andre kjøring sletter 0.
 *
 * Logger én infolinje med antall og tidsbruk. Ved feil: én feillinje med referansekode, uten
 * parametre fra databasefeilen, og feilen kastes videre.
 *
 * @param now Bare for tester. Endepunktet sender aldri inn tid.
 */
export async function purgeExpiredAuthData(now: Date = new Date()): Promise<AuthCleanupResult> {
  void now;
  // Grensesnittet er satt av arkitekten; slettingen bygges av utvikleren i samme PR.
  throw new Error("purgeExpiredAuthData er ikke bygd");
}
