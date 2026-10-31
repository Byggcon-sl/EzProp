import { createHash, createHmac } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import type { LOGIN_ATTEMPT_KINDS } from "@/db/schema/login-attempts";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";

/*
 * Sperre etter mange feil ved innlogging (docs/funksjoner/fase0b-sperre-innlogging.md, A35–A37).
 *
 * Telles per e-postadresse (som HMAC), i databasen, så sperren virker likt på alle servere og
 * etter omstart. Den leser aldri roller, gjelder alle (også admin) og går ut av seg selv.
 * Det finnes ingen bryter som slår den av.
 *
 * Den rene delen (`decideThrottle`, `throttleMessage`, `hashEmail`) bruker ikke databasen.
 * Databasedelen laster `@/db/client` først når den kalles.
 */

/** Feil koder som gir sperre. */
export const MAX_FAILED_CODES = 5;
/** Kodebestillinger per vindu. */
export const MAX_CODE_REQUESTS = 5;
/** Vinduet for tellingen, og hvor lenge sperren varer. */
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

export type LoginAttemptKind = (typeof LOGIN_ATTEMPT_KINDS)[number];

export type LoginAttempt = { kind: LoginAttemptKind; createdAt: Date };

export type ThrottleAction = "request_code" | "sign_in";

export type ThrottleReason = "failed_codes" | "code_requests";

export type ThrottleDecision =
  { blocked: false } | { blocked: true; reason: ThrottleReason; retryAt: Date };

/** Samme normalisering som Better Auth: `trim()`, så små bokstaver. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * HMAC-SHA256 (hex) av den normaliserte adressen. Nøkkelen avledes fra hemmeligheten med et
 * eget prefiks, så den rå hemmeligheten aldri brukes direkte.
 */
export function hashEmail(email: string, secret: string): string {
  const key = createHash("sha256").update(`login-throttle:${secret}`).digest();
  return createHmac("sha256", key).update(normalizeEmail(email)).digest("hex");
}

/**
 * Avgjør om forsøket skal stoppes. Radene kan komme i vilkårlig rekkefølge. Bare rader strengt
 * etter siste `login_succeeded` telles (en feil med samme tid som suksessen er samme forsøk).
 */
export function decideThrottle(
  attempts: readonly LoginAttempt[],
  action: ThrottleAction,
  now: Date,
): ThrottleDecision {
  const lastSuccess = attempts
    .filter((a) => a.kind === "login_succeeded")
    .reduce((max, a) => Math.max(max, a.createdAt.getTime()), Number.NEGATIVE_INFINITY);
  const counted = attempts.filter((a) => a.createdAt.getTime() > lastSuccess);
  const nowMs = now.getTime();

  // Feil koder: de siste MAX_FAILED_CODES feilene innen ett vindu gir sperre fra den nyeste.
  const failures = counted
    .filter((a) => a.kind === "code_failed")
    .map((a) => a.createdAt.getTime())
    .sort((a, b) => a - b);
  if (failures.length >= MAX_FAILED_CODES) {
    const lastFive = failures.slice(-MAX_FAILED_CODES);
    const oldest = lastFive[0]!;
    const newest = lastFive[lastFive.length - 1]!;
    const lockedUntil = newest + THROTTLE_WINDOW_MS;
    if (newest - oldest <= THROTTLE_WINDOW_MS && nowMs < lockedUntil) {
      return { blocked: true, reason: "failed_codes", retryAt: new Date(lockedUntil) };
    }
  }

  // Bestillinger: glidende vindu, bare ved ny kode.
  if (action === "request_code") {
    const windowStart = nowMs - THROTTLE_WINDOW_MS;
    const requests = counted
      .filter((a) => a.kind === "code_requested")
      .map((a) => a.createdAt.getTime())
      .filter((t) => t > windowStart)
      .sort((a, b) => a - b);
    if (requests.length >= MAX_CODE_REQUESTS) {
      return {
        blocked: true,
        reason: "code_requests",
        retryAt: new Date(requests[0]! + THROTTLE_WINDOW_MS),
      };
    }
  }

  return { blocked: false };
}

const osloTime = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Klokkeslett i norsk tid som HH:MM, uavhengig av serverens tidssone. */
function formatOsloTime(date: Date): string {
  const parts = osloTime.formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

/** Meldingen brukeren ser når sperren slår inn. */
export function throttleMessage(reason: ThrottleReason, retryAt: Date): string {
  const time = formatOsloTime(retryAt);
  return reason === "failed_codes"
    ? `For mange feil koder. Du kan prøve igjen kl. ${time}.`
    : `For mange koder bestilt. Du kan be om ny kode kl. ${time}.`;
}

const ACTION_ROUTE: Record<ThrottleAction, string> = {
  request_code: "/email-otp/send-verification-otp",
  sign_in: "/sign-in/email-otp",
};

const ACTION_KIND: Record<ThrottleAction, LoginAttemptKind> = {
  request_code: "code_requested",
  sign_in: "code_failed",
};

/**
 * Sjekker sperren og lagrer forsøket, i én transaksjon med lås per adresse, så samtidige
 * forsøk ikke kommer forbi grensen. Sperret: ingenting lagres (sperren forlenges ikke).
 * Ikke sperret: `code_requested` eller `code_failed` lagres. En innlogging som lykkes,
 * følges av `recordLoginSucceeded`, og da teller ikke feilen lenger.
 */
export async function checkAndRecordAttempt(
  email: string,
  action: ThrottleAction,
  now: Date = new Date(),
): Promise<ThrottleDecision> {
  const { db } = await import("@/db/client");
  const { loginAttempts } = await import("@/db/schema/login-attempts");
  const emailHash = hashEmail(email, getEnv().BETTER_AUTH_SECRET);
  // Feilsperren kan bygge på rader opptil to vinduer tilbake; eldre rader påvirker ikke svaret.
  const since = new Date(now.getTime() - 2 * THROTTLE_WINDOW_MS);

  const decision = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`login-throttle:${emailHash}`}))`);
    const rows = await tx
      .select({ kind: loginAttempts.kind, createdAt: loginAttempts.createdAt })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.emailHash, emailHash), gte(loginAttempts.createdAt, since)));
    const result = decideThrottle(rows, action, now);
    if (!result.blocked) {
      await tx
        .insert(loginAttempts)
        .values({ emailHash, kind: ACTION_KIND[action], createdAt: now });
    }
    return result;
  });

  if (decision.blocked) {
    // Aldri e-post eller hash i loggen.
    logger.warn("Innloggingssperre slo inn", {
      route: ACTION_ROUTE[action],
      action,
      reason: decision.reason,
      at: now.toISOString(),
      retryAt: decision.retryAt.toISOString(),
    });
  }
  return decision;
}

/** Riktig kode: nullstiller feil og bestillinger for adressen, uten å slette noe. */
export async function recordLoginSucceeded(email: string, now: Date = new Date()): Promise<void> {
  const { db } = await import("@/db/client");
  const { loginAttempts } = await import("@/db/schema/login-attempts");
  const emailHash = hashEmail(email, getEnv().BETTER_AUTH_SECRET);
  await db.insert(loginAttempts).values({ emailHash, kind: "login_succeeded", createdAt: now });
}
