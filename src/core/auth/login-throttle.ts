import { createHash, createHmac } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";

/*
 * Innloggingssperre per e-postadresse (fase 0b, innspill P12). Fast regel uten skjønn:
 * - 5 feil koder der eldste og nyeste er høyst 15 minutter fra hverandre gir sperre til den
 *   nyeste feilen + 15 minutter, både for innlogging og ny kode.
 * - Høyst 5 kodebestillinger per 15 minutter (glidende vindu).
 * - Riktig kode nullstiller (rad `login_succeeded`, ingenting slettes).
 * Sperren går alltid ut av seg selv. Den leser aldri roller, så admin stenges aldri ute for godt.
 * Det finnes ingen bryter som slår den av.
 */

export const MAX_FAILED_CODES = 5;
export const MAX_CODE_REQUESTS = 5;
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;

/** Hvor langt tilbake raden leses. Mer enn nok til begge reglene over. */
const LOOKBACK_MS = 2 * 60 * 60 * 1000;

export type LoginAttemptKind = "code_requested" | "code_failed" | "login_succeeded";
export type LoginAction = "request_code" | "sign_in";
export type ThrottleReason = "failed_codes" | "code_requests";
export type ThrottleDecision =
  { blocked: false } | { blocked: true; reason: ThrottleReason; retryAt: Date };

type Attempt = { kind: LoginAttemptKind; createdAt: Date };

/** Samme normalisering som Better Auth: `trim()`, så små bokstaver. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** HMAC-SHA256 av adressen (hex). Nøkkelen avledes fra hemmeligheten, den rå brukes ikke. */
export function hashEmail(email: string, secret: string): string {
  const key = createHash("sha256").update(`login-throttle:${secret}`).digest();
  return createHmac("sha256", key).update(normalizeEmail(email)).digest("hex");
}

/** Avgjør om forsøket skal sperres. Ren funksjon; radene kan komme i vilkårlig rekkefølge. */
export function decideThrottle(
  attempts: Attempt[],
  action: LoginAction,
  now: Date,
): ThrottleDecision {
  const lastSuccess = attempts
    .filter((a) => a.kind === "login_succeeded")
    .reduce<number | null>((max, a) => Math.max(max ?? -Infinity, a.createdAt.getTime()), null);
  // Bare rader strengt etter siste riktige kode telles (lik tid er samme forsøk)
  const counted =
    lastSuccess === null ? attempts : attempts.filter((a) => a.createdAt.getTime() > lastSuccess);
  const nowMs = now.getTime();

  const failed = counted
    .filter((a) => a.kind === "code_failed")
    .map((a) => a.createdAt.getTime())
    .sort((a, b) => a - b);
  if (failed.length >= MAX_FAILED_CODES) {
    const lastFailures = failed.slice(-MAX_FAILED_CODES);
    const oldest = lastFailures[0]!;
    const newest = lastFailures[lastFailures.length - 1]!;
    if (newest - oldest <= THROTTLE_WINDOW_MS) {
      const retryAt = newest + THROTTLE_WINDOW_MS;
      if (nowMs < retryAt)
        return { blocked: true, reason: "failed_codes", retryAt: new Date(retryAt) };
    }
  }

  if (action === "request_code") {
    const requests = counted
      .filter((a) => a.kind === "code_requested")
      .map((a) => a.createdAt.getTime())
      .filter((t) => t > nowMs - THROTTLE_WINDOW_MS)
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

function formatOsloTime(date: Date): string {
  const parts = osloTime.formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

/** Norsk melding med klokkeslett (norsk tid) for når man kan prøve igjen. */
export function throttleMessage(reason: ThrottleReason, retryAt: Date): string {
  const time = formatOsloTime(retryAt);
  return reason === "failed_codes"
    ? `For mange feil koder. Du kan prøve igjen kl. ${time}.`
    : `For mange koder bestilt. Du kan be om ny kode kl. ${time}.`;
}

const ROUTE: Record<LoginAction, string> = {
  request_code: "/api/auth/email-otp/send-verification-otp",
  sign_in: "/api/auth/sign-in/email-otp",
};

function emailHashFor(email: string): string {
  return hashEmail(email, getEnv().BETTER_AUTH_SECRET);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Låser adressen til transaksjonen er ferdig, så samtidige forsøk ikke kommer forbi grensen. */
async function lockAndRead(tx: Tx, emailHash: string, now: Date): Promise<Attempt[]> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${emailHash}, 0))`);
  return tx
    .select({ kind: loginAttempts.kind, createdAt: loginAttempts.createdAt })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.emailHash, emailHash),
        gt(loginAttempts.createdAt, new Date(now.getTime() - LOOKBACK_MS)),
      ),
    );
}

function latest(attempts: Attempt[], kind?: LoginAttemptKind): number | null {
  const times = attempts
    .filter((a) => kind === undefined || a.kind === kind)
    .map((a) => a.createdAt.getTime());
  return times.length === 0 ? null : Math.max(...times);
}

/**
 * Sjekker sperren og lagrer forsøket i samme transaksjon. Sperret: ingenting lagres (sperren
 * forlenges ikke). Ikke sperret: `code_requested` eller `code_failed` lagres. Et forsøk på
 * innlogging teller som feil til `recordLoginSucceeded` viser at det lyktes.
 */
export async function checkAndRecordAttempt(
  email: string,
  action: LoginAction,
  now: Date = new Date(),
): Promise<ThrottleDecision> {
  const emailHash = emailHashFor(email);
  const decision = await db.transaction(async (tx) => {
    const attempts = await lockAndRead(tx, emailHash, now);
    const result = decideThrottle(attempts, action, now);
    if (result.blocked) return result;
    // Nye rader skal ligge strengt etter siste riktige kode, ellers telles de ikke
    const lastSuccess = latest(attempts, "login_succeeded");
    const createdAt =
      lastSuccess !== null && lastSuccess >= now.getTime() ? lastSuccess + 1 : now.getTime();
    await tx.insert(loginAttempts).values({
      emailHash,
      kind: action === "request_code" ? "code_requested" : "code_failed",
      createdAt: new Date(createdAt),
    });
    return result;
  });
  if (decision.blocked) {
    // Aldri adresse eller hash i loggen
    logger.warn("Innloggingssperre slo inn", {
      route: ROUTE[action],
      at: now.toISOString(),
      reason: decision.reason,
    });
  }
  return decision;
}

/** Riktig kode: nullstiller feil og bestillinger for adressen (uten å slette noe). */
export async function recordLoginSucceeded(email: string, now: Date = new Date()): Promise<void> {
  const emailHash = emailHashFor(email);
  await db.transaction(async (tx) => {
    const attempts = await lockAndRead(tx, emailHash, now);
    // Minst like sent som forsøket som lyktes, så det forsøket ikke telles som feil
    const newest = latest(attempts);
    const createdAt = newest !== null && newest > now.getTime() ? newest : now.getTime();
    await tx.insert(loginAttempts).values({
      emailHash,
      kind: "login_succeeded",
      createdAt: new Date(createdAt),
    });
  });
}
