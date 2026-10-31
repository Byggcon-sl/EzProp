import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import { resetDatabase } from "../../../tests/factories";
import {
  MAX_CODE_REQUESTS,
  MAX_FAILED_CODES,
  THROTTLE_WINDOW_MS,
  checkAndRecordAttempt,
  hashEmail,
  recordLoginSucceeded,
} from "./login-throttle";

/*
 * Databasedelen av sperren (utviklerens egne tester). Regeltestene og testene gjennom Better
 * Auth ligger i `login-throttle.test.ts` og `login-throttle.integration.test.ts`.
 *
 * Isolasjon: tabellen har ingen organisasjons-ID (A36), så `expectTenantIsolation` passer ikke.
 * Testen «adresse A påvirker ikke adresse B» erstatter den.
 */

const T0 = new Date("2026-10-31T13:20:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

async function countRows(kind?: "code_requested" | "code_failed" | "login_succeeded") {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(kind ? eq(loginAttempts.kind, kind) : undefined);
  return rows[0]!.n;
}

describe("login-throttle mot databasen", () => {
  beforeEach(resetDatabase);

  it("tabellen har nøyaktig fire kolonner, uten adresse, organisasjon eller IP", async () => {
    const rows = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'login_attempts' order by column_name`,
    );
    expect(rows.map((r) => r.column_name)).toEqual(["created_at", "email_hash", "id", "kind"]);
  });

  it("lagrer hash, aldri adressen, og samme hash for store bokstaver og mellomrom", async () => {
    await checkAndRecordAttempt("Ola@Eksempel.no ", "request_code", T0);
    await checkAndRecordAttempt("ola@eksempel.no", "request_code", minutes(1));
    const rows = await db.select().from(loginAttempts);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.emailHash)).size).toBe(1);
    expect(rows[0]!.emailHash).toBe(hashEmail("ola@eksempel.no", getEnv().BETTER_AUTH_SECRET));
    expect(JSON.stringify(rows).toLowerCase()).not.toContain("ola@eksempel.no");
  });

  it("5 feil sperrer, og forsøk under sperren lagres ikke", async () => {
    for (let i = 0; i < MAX_FAILED_CODES; i++) {
      expect(await checkAndRecordAttempt("ola@eksempel.no", "sign_in", minutes(i))).toEqual({
        blocked: false,
      });
    }
    const blocked = await checkAndRecordAttempt("ola@eksempel.no", "sign_in", minutes(5));
    expect(blocked).toEqual({
      blocked: true,
      reason: "failed_codes",
      retryAt: new Date(minutes(4).getTime() + THROTTLE_WINDOW_MS),
    });
    await checkAndRecordAttempt("ola@eksempel.no", "request_code", minutes(6));
    expect(await countRows("code_failed")).toBe(MAX_FAILED_CODES);
    expect(await countRows("code_requested")).toBe(0);
    // Går ut av seg selv
    expect(await checkAndRecordAttempt("ola@eksempel.no", "sign_in", minutes(19))).toEqual({
      blocked: false,
    });
  });

  it("riktig kode nullstiller uten å slette", async () => {
    for (let i = 0; i < MAX_CODE_REQUESTS; i++) {
      await checkAndRecordAttempt("ola@eksempel.no", "request_code", minutes(i));
    }
    expect(
      (await checkAndRecordAttempt("ola@eksempel.no", "request_code", minutes(5))).blocked,
    ).toBe(true);
    await recordLoginSucceeded("ola@eksempel.no", minutes(6));
    expect(
      (await checkAndRecordAttempt("ola@eksempel.no", "request_code", minutes(7))).blocked,
    ).toBe(false);
    expect(await countRows()).toBe(MAX_CODE_REQUESTS + 2);
    expect(await countRows("login_succeeded")).toBe(1);
  });

  it("samtidige forsøk kommer ikke forbi grensen", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkAndRecordAttempt("ola@eksempel.no", "sign_in", T0)),
    );
    expect(results.filter((r) => !r.blocked)).toHaveLength(MAX_FAILED_CODES);
    expect(await countRows("code_failed")).toBe(MAX_FAILED_CODES);
  });

  it("sperre på én adresse påvirker ikke en annen", async () => {
    for (let i = 0; i < MAX_FAILED_CODES; i++) {
      await checkAndRecordAttempt("ola@eksempel.no", "sign_in", minutes(i));
    }
    expect((await checkAndRecordAttempt("ola@eksempel.no", "sign_in", minutes(5))).blocked).toBe(
      true,
    );
    expect((await checkAndRecordAttempt("kari@eksempel.no", "sign_in", minutes(5))).blocked).toBe(
      false,
    );
    expect(
      (await checkAndRecordAttempt("kari@eksempel.no", "request_code", minutes(5))).blocked,
    ).toBe(false);
  });

  it("logger sperren uten adresse og hash, og logger ikke når forsøket slipper gjennom", async () => {
    const warn = vi.spyOn(logger, "warn");
    try {
      for (let i = 0; i < MAX_FAILED_CODES; i++) {
        await checkAndRecordAttempt("Ola@Eksempel.no", "sign_in", minutes(i));
      }
      expect(warn).not.toHaveBeenCalled();
      await checkAndRecordAttempt("Ola@Eksempel.no", "sign_in", minutes(5));
      expect(warn).toHaveBeenCalledTimes(1);
      const logged = JSON.stringify(warn.mock.calls).toLowerCase();
      expect(logged).toContain("/sign-in/email-otp");
      expect(logged).not.toContain("ola@eksempel.no");
      expect(logged).not.toContain(hashEmail("ola@eksempel.no", getEnv().BETTER_AUTH_SECRET));
    } finally {
      warn.mockRestore();
    }
  });
});
