import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashEmail } from "@/core/auth/login-throttle";
import { db } from "@/db/client";
import { loginAttempts, sessions, verifications } from "@/db/schema";
import { getEnv, resetEnvCache } from "@/shared/config/env";
import { logger, type LogFields } from "@/shared/lib/logger";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";
import * as route from "./route";

/*
 * Testplan docs/agenter/oppgaver/rydd-innloggingsdata-testplan.md, avsnitt 4 (E1–E11). Handleren
 * kalles direkte mot testdatabasen. Ruten tar ikke tid inn, så radene legges i forhold til
 * dagens tid med god margin (2 døgn / 60 dager gamle mot 1 time gamle). Alt er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (bare den planlagte driftsjobben kan rydde, og endepunktet røpes
 * ikke). KI i bunnen: ikke berørt.
 */

const state = vi.hoisted(() => ({ fail: false }));

vi.mock("@/core/auth/auth-cleanup", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/core/auth/auth-cleanup")>();
  return {
    ...original,
    purgeExpiredAuthData: vi.fn(
      async (...args: Parameters<typeof original.purgeExpiredAuthData>) => {
        if (state.fail) {
          throw new Error(
            'Failed query: delete from "sessions"\nparams: oppdiktet.feil@example.com,oppdiktet-token-feil',
          );
        }
        return original.purgeExpiredAuthData(...args);
      },
    ),
  };
});

const URL_PATH = "http://localhost/api/intern/rydd-innloggingsdata";
const NAME = "AUTH_CLEANUP_SECRET";
const SECRET = "oppdiktet-driftshemmelighet-for-tester-0123456789";
const REFERENCE =
  "@Microsoft.KeyVault(SecretUri=https://kv-oppdiktet.vault.azure.net/secrets/auth-cleanup-secret/)";
const FAKE_IP = "198.51.100.23";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function setSecret(value: string) {
  vi.stubEnv(NAME, value);
  resetEnvCache();
}

function call(
  options: { authorization?: string; body?: string; query?: string; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": FAKE_IP,
    "user-agent": "Oppdiktet-klient/1.0",
  };
  if (options.authorization !== undefined) headers.authorization = options.authorization;
  if (options.cookie !== undefined) headers.cookie = options.cookie;
  return route.POST(
    new Request(`${URL_PATH}${options.query ?? ""}`, {
      method: "POST",
      headers,
      body: options.body,
    }),
  );
}

function fakeEmail(): string {
  return `oppdiktet.rute.${randomUUID().slice(0, 8)}@example.com`;
}

/** Én gammel og én ny rad i hver tabell, i forhold til dagens tid. */
async function seedRows() {
  const now = Date.now();
  const hash = hashEmail(fakeEmail(), getEnv().BETTER_AUTH_SECRET);
  const [oldAttempt] = await db
    .insert(loginAttempts)
    .values({ emailHash: hash, kind: "code_failed", createdAt: new Date(now - 2 * DAY) })
    .returning({ id: loginAttempts.id });
  const [newAttempt] = await db
    .insert(loginAttempts)
    .values({ emailHash: hash, kind: "code_failed", createdAt: new Date(now - HOUR) })
    .returning({ id: loginAttempts.id });
  const oldVerification = randomUUID();
  const newVerification = randomUUID();
  await db.insert(verifications).values([
    {
      id: oldVerification,
      identifier: `sign-in-otp-${fakeEmail()}`,
      value: "111111:0",
      expiresAt: new Date(now - 2 * DAY),
    },
    {
      id: newVerification,
      identifier: `sign-in-otp-${fakeEmail()}`,
      value: "222222:0",
      expiresAt: new Date(now - HOUR),
    },
  ]);
  const user = await createUser({ email: fakeEmail(), name: "Oppdiktet Person" });
  const oldSession = randomUUID();
  const newSession = randomUUID();
  await db.insert(sessions).values([
    {
      id: oldSession,
      userId: user.id,
      token: `oppdiktet-${randomUUID()}`,
      expiresAt: new Date(now - 60 * DAY),
    },
    {
      id: newSession,
      userId: user.id,
      token: `oppdiktet-${randomUUID()}`,
      expiresAt: new Date(now - HOUR),
    },
  ]);
  return {
    old: { attempt: oldAttempt!.id, verification: oldVerification, session: oldSession },
    recent: { attempt: newAttempt!.id, verification: newVerification, session: newSession },
  };
}

async function exists(ids: { attempt: string; verification: string; session: string }) {
  const a = await db
    .select({ id: loginAttempts.id })
    .from(loginAttempts)
    .where(inArray(loginAttempts.id, [ids.attempt]));
  const v = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(inArray(verifications.id, [ids.verification]));
  const s = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(inArray(sessions.id, [ids.session]));
  return { attempt: a.length === 1, verification: v.length === 1, session: s.length === 1 };
}

const ALL = { attempt: true, verification: true, session: true };
const NONE = { attempt: false, verification: false, session: false };

type Logged = { level: string; msg: string; fields: LogFields | undefined };

function captureLogs(): Logged[] {
  const lines: Logged[] = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation((msg: string, fields?: LogFields) => {
      lines.push({ level, msg, fields });
    });
  }
  return lines;
}

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control") ?? "").toContain("no-store");
}

/** Svaret når endepunktet er av eller kallet ikke er godkjent. */
async function reference404(): Promise<{ status: number; body: string }> {
  setSecret("");
  const response = await call();
  return { status: response.status, body: await response.text() };
}

beforeEach(async () => {
  await resetDatabase();
  state.fail = false;
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetEnvCache();
  state.fail = false;
});

describe("POST /api/intern/rydd-innloggingsdata", () => {
  it("E1 404 when secret is not set", async () => {
    captureLogs();
    const rows = await seedRows();
    setSecret("");
    const response = await call({ authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await exists(rows.old)).toEqual(ALL);
  });

  it("E2 404 without Authorization header", async () => {
    captureLogs();
    const reference = await reference404();
    const rows = await seedRows();
    setSecret(SECRET);
    const response = await call();
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await response.text()).toBe(reference.body);
    expect(await exists(rows.old)).toEqual(ALL);
  });

  it.each([
    ["wrong value", `Bearer ${SECRET.replace(/0/, "9")}`],
    ["longer value", `Bearer ${SECRET}x`],
    ["other scheme", `Basic ${SECRET}`],
    ["value only", SECRET],
  ])("E3 404 with wrong secret (%s)", async (_label, authorization) => {
    captureLogs();
    const reference = await reference404();
    const rows = await seedRows();
    setSecret(SECRET);
    const response = await call({ authorization });
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await response.text()).toBe(reference.body);
    expect(await exists(rows.old)).toEqual(ALL);
  });

  it.each([
    ["too short", "kort-hemmelighet"],
    ["unresolved reference", REFERENCE],
  ])("E4 404 when secret is %s", async (_label, value) => {
    captureLogs();
    const reference = await reference404();
    const rows = await seedRows();
    setSecret(value);
    const response = await call({ authorization: `Bearer ${value}` });
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect(await response.text()).toBe(reference.body);
    expect(await exists(rows.old)).toEqual(ALL);
  });

  it("E5 200 with correct secret returns counts only", async () => {
    captureLogs();
    const rows = await seedRows();
    setSecret(SECRET);
    const response = await call({ authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(200);
    expectNoStore(response);
    const body = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["durationMs", "loginAttempts", "sessions", "verifications"].sort(),
    );
    expect(body.loginAttempts).toBe(1);
    expect(body.verifications).toBe(1);
    expect(body.sessions).toBe(1);
    expect(typeof body.durationMs).toBe("number");
    expect(await exists(rows.old)).toEqual(NONE);
    expect(await exists(rows.recent)).toEqual(ALL);
  });

  it("E6 ignores body and query parameters", async () => {
    captureLogs();
    const rows = await seedRows();
    setSecret(SECRET);
    const response = await call({
      authorization: `Bearer ${SECRET}`,
      body: JSON.stringify({ now: "2100-01-01", retentionMs: 0 }),
      query: "?now=2100-01-01&retentionMs=0",
    });
    expect(response.status).toBe(200);
    // Grensene kan ikke styres utenfra: de nye radene (1 time gamle) står
    expect(await exists(rows.recent)).toEqual(ALL);
    expect(await exists(rows.old)).toEqual(NONE);
  });

  it("E7 only POST is exported", () => {
    const exported = route as Record<string, unknown>;
    expect(typeof exported.POST).toBe("function");
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      expect(exported[method], method).toBeUndefined();
    }
    expect(exported.dynamic).toBe("force-dynamic");
  });

  it("E8 500 without details on failure", async () => {
    const lines = captureLogs();
    setSecret(SECRET);
    state.fail = true;
    const response = await call({ authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(500);
    expectNoStore(response);
    const text = await response.text();
    for (const part of [
      "Failed query",
      "params",
      "oppdiktet.feil@example.com",
      "oppdiktet-token",
      "stack",
      "sessions",
    ]) {
      expect(text, part).not.toContain(part);
    }
    for (const line of lines) expect(JSON.stringify(line)).not.toContain(SECRET);
  });

  it("E9 rejected call is logged without headers or IP", async () => {
    const lines = captureLogs();
    setSecret(SECRET);
    const wrong = `Bearer oppdiktet-feil-hemmelighet-${randomUUID()}`;
    const response = await call({ authorization: wrong });
    expect(response.status).toBe(404);
    const warnings = lines.filter((line) => line.level === "warn");
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      const text = JSON.stringify(line);
      for (const value of [
        SECRET,
        wrong,
        "authorization",
        "x-forwarded-for",
        FAKE_IP,
        "Oppdiktet-klient",
      ]) {
        expect(text.toLowerCase(), value).not.toContain(value.toLowerCase());
      }
    }
  });

  it("E10 logged-in admin without secret gets 404", async () => {
    captureLogs();
    const organization = await createOrganization("Oppdiktet Takst A");
    const admin = await createUser({ email: fakeEmail(), name: "Oppdiktet Admin" });
    await createEmployee(admin, organization.id, ["admin"]);
    const token = `oppdiktet-${randomUUID()}`;
    await db.insert(sessions).values({
      id: randomUUID(),
      userId: admin.id,
      token,
      expiresAt: new Date(Date.now() + 10 * DAY),
    });
    const rows = await seedRows();
    setSecret(SECRET);
    const response = await call({
      cookie: `better-auth.session_token=${token}; __Secure-better-auth.session_token=${token}`,
    });
    expect(response.status).toBe(404);
    expect(await exists(rows.old)).toEqual(ALL);
  });

  it("E11 route imports only access and auth-cleanup", () => {
    const source = readFileSync(path.join(__dirname, "route.ts"), "utf8");
    const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
      (match) => match[1]!,
    );
    const allowed = new Set([
      "@/core/access",
      "@/core/auth/auth-cleanup",
      "next/server",
      "@/shared/lib/logger",
    ]);
    for (const name of imports) expect(allowed.has(name), `ulovlig import: ${name}`).toBe(true);
    expect(imports).toContain("@/core/access");
    expect(imports).toContain("@/core/auth/auth-cleanup");
    expect(source).not.toMatch(/@\/db/);
    expect(source).not.toMatch(/getCurrentActor|requireOrganizationAccess/);
  });
});
