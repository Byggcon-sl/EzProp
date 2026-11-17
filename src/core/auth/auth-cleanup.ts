import { randomUUID } from "node:crypto";
import { lt } from "drizzle-orm";
import { db } from "@/db/client";
import { loginAttempts, sessions, verifications } from "@/db/schema";
import { logger } from "@/shared/lib/logger";

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
 *
 * Kilde: svar 10.11.2026 nr. 15 (tellere for innloggingssperren slettes etter 24 timer) og nr. 18
 * (utløpte koder etter 24 timer, utløpte økter etter 30 dager). Beslutning A419 og A421, ADR 0014.
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
  const started = performance.now();
  const loginAttemptLimit = new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_MS);
  const verificationLimit = new Date(now.getTime() - EXPIRED_VERIFICATION_RETENTION_MS);
  const sessionLimit = new Date(now.getTime() - EXPIRED_SESSION_RETENTION_MS);

  try {
    const counts = await db.transaction(async (tx) => {
      const deletedLoginAttempts = await tx
        .delete(loginAttempts)
        .where(lt(loginAttempts.createdAt, loginAttemptLimit))
        .returning({ id: loginAttempts.id });
      const deletedVerifications = await tx
        .delete(verifications)
        .where(lt(verifications.expiresAt, verificationLimit))
        .returning({ id: verifications.id });
      const deletedSessions = await tx
        .delete(sessions)
        .where(lt(sessions.expiresAt, sessionLimit))
        .returning({ id: sessions.id });
      return {
        loginAttempts: deletedLoginAttempts.length,
        verifications: deletedVerifications.length,
        sessions: deletedSessions.length,
      };
    });

    const result: AuthCleanupResult = {
      ...counts,
      durationMs: Math.round(performance.now() - started),
    };
    logger.info("Rydding av innloggingsdata fullført", { outcome: "ok", ...result });
    return result;
  } catch {
    // Databasefeilen kan ha parametre (e-post-hash, token, IP). Den logges aldri; bare koden.
    const ref = randomUUID();
    logger.error("Rydding av innloggingsdata feilet", {
      outcome: "failed",
      ref,
      durationMs: Math.round(performance.now() - started),
    });
    throw new Error(`Rydding av innloggingsdata feilet (referanse ${ref})`);
  }
}
