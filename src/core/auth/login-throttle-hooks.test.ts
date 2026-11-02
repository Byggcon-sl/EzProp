import { count, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emailTransport, readDevMailbox } from "@/core/email";
import { db } from "@/db/client";
import { loginAttempts, sessions } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { auth } from "./auth";
import {
  MAX_CODE_REQUESTS,
  MAX_FAILED_CODES,
  THROTTLE_WINDOW_MS,
  decideThrottle,
  hashEmail,
} from "./login-throttle";

/*
 * Utviklerens egne tester av sperren: at krokene i auth.ts er koblet inn, og at sperren holder
 * adresser (og organisasjoner) fra hverandre. Testskriverens fulle tester ligger i
 * login-throttle.test.ts og login-throttle.integration.test.ts.
 */

if (emailTransport() !== "devMailbox")
  throw new Error("Testene skal bare bruke utviklings-postkassen.");

const BASE = getEnv().BETTER_AUTH_URL;

function post(path: string, body: unknown) {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify(body),
    }),
  );
}

const requestCode = (email: string) =>
  post("/email-otp/send-verification-otp", { email, type: "sign-in" });
const signIn = (email: string, otp: string) => post("/sign-in/email-otp", { email, otp });

function latestCode(email: string): string {
  // Postkassen har nyeste først
  const mail = readDevMailbox().find((m) => m.to === email.trim().toLowerCase());
  const otp = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!otp) throw new Error("fant ingen kode");
  return otp;
}

async function sessionCount() {
  const [row] = await db.select({ n: count() }).from(sessions);
  return row?.n ?? 0;
}

async function knownEmployee(email: string, organizationId?: string) {
  const orgId = organizationId ?? (await createOrganization()).id;
  const user = await createUser({ email });
  await createEmployee(user, orgId, ["inspector"]);
  return orgId;
}

/** 5 feil koder (ny kode etter 3, fordi Better Auth gir 3 forsøk per kode). */
async function failFiveTimes(email: string) {
  for (let i = 0; i < MAX_FAILED_CODES; i++) {
    if (i % 3 === 0) expect((await requestCode(email)).status).toBe(200);
    const response = await signIn(email, "000000");
    expect(response.status).not.toBe(429);
  }
}

describe("innloggingssperre gjennom Better Auth", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rateLimit er av i testene, så det er sperren som virker", () => {
    expect(auth.options.rateLimit?.enabled).toBe(false);
  });

  it("6. forsøk etter 5 feil gir 429 med norsk melding, og riktig kode slipper ikke inn", async () => {
    const email = "ola.sperre@eksempel.no";
    await knownEmployee(email);
    await failFiveTimes(email);
    const code = latestCode(email);
    const before = await sessionCount();

    const blocked = await signIn(email, code);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { message: string };
    expect(body.message).toMatch(/^For mange feil koder\. Du kan prøve igjen kl\. \d{2}:\d{2}\.$/);
    expect(await sessionCount()).toBe(before);

    const blockedRequest = await requestCode(email);
    expect(blockedRequest.status).toBe(429);
    expect(((await blockedRequest.json()) as { message: string }).message).toBe(body.message);

    // Forsøk under sperren lagres ikke
    const [failed] = await db
      .select({ n: count() })
      .from(loginAttempts)
      .where(eq(loginAttempts.kind, "code_failed"));
    expect(failed?.n).toBe(MAX_FAILED_CODES);
  });

  it("sperren går ut av seg selv, også for admin (skal aldri fjernes)", async () => {
    const email = "admin.sperre@eksempel.no";
    const orgId = (await createOrganization()).id;
    const admin = await createUser({ email });
    await createEmployee(admin, orgId, ["admin"]);
    await failFiveTimes(email);
    expect((await requestCode(email)).status).toBe(429);

    // Tilbakedaterer i stedet for å vente
    await db.execute(
      sql`update login_attempts set created_at = created_at - make_interval(secs => ${THROTTLE_WINDOW_MS / 1000})`,
    );
    expect((await requestCode(email)).status).toBe(200);
    const before = await sessionCount();
    expect((await signIn(email, latestCode(email))).status).toBe(200);
    expect(await sessionCount()).toBe(before + 1);
  });

  it("riktig kode nullstiller feil og bestillinger uten å slette rader", async () => {
    const email = "kari.nullstill@eksempel.no";
    await knownEmployee(email);
    for (let i = 0; i < MAX_CODE_REQUESTS - 1; i++) await requestCode(email);
    expect((await signIn(email, latestCode(email))).status).toBe(200);
    const [rows] = await db.select({ n: count() }).from(loginAttempts);
    for (let i = 0; i < MAX_CODE_REQUESTS; i++) {
      expect((await requestCode(email)).status).toBe(200);
    }
    expect((await requestCode(email)).status).toBe(429);
    const [after] = await db.select({ n: count() }).from(loginAttempts);
    expect(after!.n).toBeGreaterThan(rows!.n);
  });

  it("6. bestilling gir 429 og ingen ny e-post", async () => {
    const email = "ukjent.bestill@eksempel.no";
    for (let i = 0; i < MAX_CODE_REQUESTS; i++) expect((await requestCode(email)).status).toBe(200);
    const mails = readDevMailbox().length;
    const response = await requestCode(email);
    expect(response.status).toBe(429);
    expect(((await response.json()) as { message: string }).message).toMatch(
      /^For mange koder bestilt\. Du kan be om ny kode kl\. \d{2}:\d{2}\.$/,
    );
    expect(readDevMailbox()).toHaveLength(mails);
  });

  it("kjent og ukjent adresse får samme 429-svar", async () => {
    await knownEmployee("kjent.likt@eksempel.no");
    const bodies: unknown[] = [];
    for (const email of ["kjent.likt@eksempel.no", "ukjent.likt@eksempel.no"]) {
      for (let i = 0; i < MAX_CODE_REQUESTS; i++) await requestCode(email);
      const response = await requestCode(email);
      expect(response.status).toBe(429);
      bodies.push(Object.keys((await response.json()) as object).sort());
    }
    expect(bodies[0]).toEqual(bodies[1]);
  });

  it("samtidige feil forsøk kommer ikke forbi grensen", async () => {
    const email = "samtidig@eksempel.no";
    const statuses = await Promise.all(
      Array.from({ length: 10 }, () => signIn(email, "000000").then((r) => r.status)),
    );
    expect(statuses.filter((s) => s === 429)).toHaveLength(10 - MAX_FAILED_CODES);
  });

  it.each([
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/forget-password/email-otp",
  ])("%s er stengt (404)", async (path) => {
    const response = await post(path, { email: "ola@eksempel.no", otp: "123456", type: "sign-in" });
    expect(response.status).toBe(404);
  });

  it("get-session og sign-out virker fortsatt", async () => {
    const session = await auth.handler(new Request(`${BASE}/api/auth/get-session`));
    expect(session.status).toBe(200);
    const signOut = await post("/sign-out", {});
    expect(signOut.status).not.toBe(404);
  });

  it("sperre på én adresse rører ikke en annen, heller ikke i en annen organisasjon", async () => {
    const a = "a.org1@eksempel.no";
    const b = "b.org2@eksempel.no";
    await knownEmployee(a);
    await knownEmployee(b);
    await failFiveTimes(a);
    expect((await requestCode(a)).status).toBe(429);
    expect((await requestCode(b)).status).toBe(200);
    expect((await signIn(b, latestCode(b))).status).toBe(200);
  });

  it("logger sperren uten adresse og hash, og logger ikke når forsøket slipper", async () => {
    const warn = vi.spyOn(logger, "warn");
    const email = "Logg.Sperre@Eksempel.no";
    for (let i = 0; i < MAX_CODE_REQUESTS; i++) await requestCode(email);
    expect(warn).not.toHaveBeenCalled();
    await requestCode(email);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(warn.mock.calls).toLowerCase();
    expect(logged).not.toContain("logg.sperre@eksempel.no");
    expect(logged).not.toContain(hashEmail(email, getEnv().BETTER_AUTH_SECRET));
    warn.mockRestore();
  });
});

describe("decideThrottle", () => {
  const T0 = new Date("2026-10-31T13:20:00Z");
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

  it("feil med samme tid som riktig kode telles ikke", () => {
    const attempts = [
      { kind: "code_failed" as const, createdAt: at(0) },
      { kind: "login_succeeded" as const, createdAt: at(0) },
      ...[1, 2, 3, 4].map((m) => ({ kind: "code_failed" as const, createdAt: at(m) })),
    ];
    expect(decideThrottle(attempts, "sign_in", at(5))).toEqual({ blocked: false });
  });
});
