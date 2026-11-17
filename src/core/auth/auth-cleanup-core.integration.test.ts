import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { loginAttempts, sessions, users, verifications } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  EXPIRED_SESSION_RETENTION_MS,
  EXPIRED_VERIFICATION_RETENTION_MS,
  LOGIN_ATTEMPT_RETENTION_MS,
  purgeExpiredAuthData,
} from "./auth-cleanup";

/*
 * Utviklerens egne tester for ryddefunksjonen (ADR 0014). Testskriverens fulle sett (R/I/T/L)
 * ligger i `auth-cleanup.integration.test.ts`. Oppdiktede data, fast tid.
 * Støtter hovedmål: best for de ansatte (gyldige økter og koder står, sperren virker som før).
 */

const NOW = new Date("2000-01-01T00:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function addSession(userId: string, expiresAt: Date) {
  const id = randomUUID();
  await db.insert(sessions).values({ id, userId, token: randomUUID(), expiresAt });
  return id;
}

async function addVerification(expiresAt: Date) {
  const id = randomUUID();
  await db
    .insert(verifications)
    .values({ id, identifier: `otp-${id}`, value: "123456", expiresAt });
  return id;
}

async function addAttempt(
  createdAt: Date,
  kind: "code_requested" | "code_failed" | "login_succeeded",
) {
  const [row] = await db
    .insert(loginAttempts)
    .values({ emailHash: `hash-${randomUUID()}`, kind, createdAt })
    .returning({ id: loginAttempts.id });
  return row!.id;
}

describe("purgeExpiredAuthData", () => {
  beforeEach(resetDatabase);
  afterEach(() => vi.restoreAllMocks());

  it("deletes only rows strictly older than the limits, in both organizations", async () => {
    const orgA = await createOrganization("Org A");
    const orgB = await createOrganization("Org B");
    const userA = await createUser();
    const userB = await createUser();
    await createEmployee(userA, orgA.id, ["inspector"]);
    await createEmployee(userB, orgB.id, ["inspector"]);

    const oldSessionA = await addSession(userA.id, ago(EXPIRED_SESSION_RETENTION_MS + 1));
    const oldSessionB = await addSession(userB.id, ago(EXPIRED_SESSION_RETENTION_MS + 1));
    const edgeSession = await addSession(userA.id, ago(EXPIRED_SESSION_RETENTION_MS));
    const validSession = await addSession(userB.id, new Date(NOW.getTime() + 60_000));

    const oldCode = await addVerification(ago(EXPIRED_VERIFICATION_RETENTION_MS + 1));
    const edgeCode = await addVerification(ago(EXPIRED_VERIFICATION_RETENTION_MS));

    const oldAttempts = await Promise.all(
      (["code_requested", "code_failed", "login_succeeded"] as const).map((kind) =>
        addAttempt(ago(LOGIN_ATTEMPT_RETENTION_MS + 1), kind),
      ),
    );
    const edgeAttempt = await addAttempt(ago(LOGIN_ATTEMPT_RETENTION_MS), "code_failed");

    const result = await purgeExpiredAuthData(NOW);
    expect(result).toEqual({
      loginAttempts: 3,
      verifications: 1,
      sessions: 2,
      durationMs: expect.any(Number),
    });

    const sessionIds = (await db.select({ id: sessions.id }).from(sessions)).map((r) => r.id);
    expect(sessionIds.sort()).toEqual([edgeSession, validSession].sort());
    expect(sessionIds).not.toContain(oldSessionA);
    expect(sessionIds).not.toContain(oldSessionB);

    const codeIds = (await db.select({ id: verifications.id }).from(verifications)).map(
      (r) => r.id,
    );
    expect(codeIds).toEqual([edgeCode]);
    expect(codeIds).not.toContain(oldCode);

    const attemptIds = (await db.select({ id: loginAttempts.id }).from(loginAttempts)).map(
      (r) => r.id,
    );
    expect(attemptIds).toEqual([edgeAttempt]);
    expect(attemptIds.some((id) => oldAttempts.includes(id))).toBe(false);

    const remainingUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, [userA.id, userB.id]));
    expect(remainingUsers).toHaveLength(2);

    expect(await purgeExpiredAuthData(NOW)).toMatchObject({
      loginAttempts: 0,
      verifications: 0,
      sessions: 0,
    });
  });

  it("logs one info line with counts and no personal data", async () => {
    const user = await createUser({ email: "rydd.test@example.com" });
    await addSession(user.id, ago(EXPIRED_SESSION_RETENTION_MS + 1));
    const info = vi.spyOn(logger, "info");

    await purgeExpiredAuthData(NOW);

    expect(info).toHaveBeenCalledTimes(1);
    const [, fields] = info.mock.calls[0]!;
    expect(fields).toMatchObject({ outcome: "ok", sessions: 1 });
    const text = JSON.stringify(info.mock.calls);
    expect(text).not.toContain("rydd.test@example.com");
    expect(text).not.toContain(user.id);
  });

  it("logs a reference code only and throws a generic error when the database fails", async () => {
    const leaked = "kari@example.com hash-abc token-xyz 10.0.0.1";
    vi.spyOn(db, "transaction").mockRejectedValueOnce(
      new Error(`insert failed, params: ${leaked}`),
    );
    const error = vi.spyOn(logger, "error");

    await expect(purgeExpiredAuthData(NOW)).rejects.toThrow(/^Rydding av innloggingsdata feilet/);

    expect(error).toHaveBeenCalledTimes(1);
    const [, fields] = error.mock.calls[0]!;
    expect(fields).toMatchObject({ outcome: "failed", ref: expect.any(String) });
    expect(fields).not.toHaveProperty("error");
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/kari@|hash-abc|token-xyz|10\.0\.0\.1/);
  });
});
