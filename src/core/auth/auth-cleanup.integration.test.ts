import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { accounts, employees, loginAttempts, sessions, users, verifications } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import { formatLogLine, logger, type LogFields, type LogLevel } from "@/shared/lib/logger";
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
import { checkAndRecordAttempt, hashEmail, MAX_FAILED_CODES } from "./login-throttle";

/*
 * Testplan docs/agenter/oppgaver/rydd-innloggingsdata-testplan.md, avsnitt 1 og 2 (R1–R13,
 * I1–I12, T1–T4, L1–L3). Ryddingen kalles alltid med fast `NOW` (1. januar 2000), og testene
 * sjekker bare egne rader (på id). Alle e-poster, tokener, IP-er og nettlesere er oppdiktet.
 *
 * Støtter hovedmål: de ansatte (ryddingen sletter aldri en gyldig økt eller kode, og sperren
 * virker som før). KI i bunnen: ikke berørt (I12 viser at ingenting går gjennom `src/core/ai`).
 */

const NOW = new Date("2000-01-01T00:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const MINUTE = 60 * 1000;

const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const FAKE_IP = "203.0.113.47";
const FAKE_USER_AGENT = "Oppdiktet-nettleser/1.0 (testmaskin)";

let counter = 0;
function fakeEmail(): string {
  counter += 1;
  return `oppdiktet.rydding.${counter}.${randomUUID().slice(0, 8)}@example.com`;
}

function emailHashOf(email: string): string {
  return hashEmail(email, getEnv().BETTER_AUTH_SECRET);
}

// ---------- Radbyggere (bare egne rader, alltid rundt NOW) ----------

async function insertAttempt(
  createdAt: Date,
  kind: "code_requested" | "code_failed" | "login_succeeded" = "code_failed",
  email = fakeEmail(),
): Promise<string> {
  const [row] = await db
    .insert(loginAttempts)
    .values({ emailHash: emailHashOf(email), kind, createdAt })
    .returning({ id: loginAttempts.id });
  return row!.id;
}

async function insertVerification(
  expiresAt: Date,
  options: { createdAt?: Date; identifier?: string; value?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(verifications).values({
    id,
    identifier: options.identifier ?? `sign-in-otp-${fakeEmail()}`,
    value: options.value ?? "123456:0",
    expiresAt,
    createdAt: options.createdAt ?? new Date(expiresAt.getTime() - 5 * MINUTE),
    updatedAt: options.createdAt ?? new Date(expiresAt.getTime() - 5 * MINUTE),
  });
  return id;
}

async function insertSession(
  userId: string,
  expiresAt: Date,
  options: { createdAt?: Date; updatedAt?: Date } = {},
): Promise<{ id: string; token: string }> {
  const id = randomUUID();
  const token = `oppdiktet-token-${randomUUID()}`;
  await db.insert(sessions).values({
    id,
    userId,
    token,
    expiresAt,
    ipAddress: FAKE_IP,
    userAgent: FAKE_USER_AGENT,
    createdAt: options.createdAt ?? new Date(expiresAt.getTime() - 30 * DAY),
    updatedAt: options.updatedAt ?? new Date(expiresAt.getTime() - 30 * DAY),
  });
  return { id, token };
}

async function insertAccount(userId: string) {
  const id = randomUUID();
  const values = {
    id,
    accountId: `oppdiktet-konto-${randomUUID()}`,
    providerId: "microsoft",
    userId,
    accessToken: `oppdiktet-tilgang-${randomUUID()}`,
    refreshToken: `oppdiktet-oppfrisk-${randomUUID()}`,
    idToken: `oppdiktet-id-${randomUUID()}`,
    accessTokenExpiresAt: at(-400 * DAY),
    refreshTokenExpiresAt: at(-300 * DAY),
    scope: "openid email",
    createdAt: at(-500 * DAY),
    updatedAt: at(-500 * DAY),
  };
  await db.insert(accounts).values(values);
  return values;
}

async function newUserId(): Promise<string> {
  return (await createUser({ email: fakeEmail(), name: "Oppdiktet Person" })).id;
}

// ---------- Oppslag på egne rader ----------

async function attemptExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: loginAttempts.id })
    .from(loginAttempts)
    .where(inArray(loginAttempts.id, [id]));
  return rows.length === 1;
}

async function verificationExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: verifications.id })
    .from(verifications)
    .where(inArray(verifications.id, [id]));
  return rows.length === 1;
}

async function sessionExists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(inArray(sessions.id, [id]));
  return rows.length === 1;
}

// ---------- Logg ----------

type Captured = { level: LogLevel; msg: string; fields: LogFields | undefined };

function captureLogs(): Captured[] {
  const lines: Captured[] = [];
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation((msg: string, fields?: LogFields) => {
      lines.push({ level, msg, fields });
    });
  }
  return lines;
}

/** Linjen slik loggeren faktisk skriver den. */
function written(line: Captured): string {
  return JSON.stringify(formatLogLine(line.level, line.msg, line.fields));
}

/** Finner verdien til nøkkelen hvor som helst i feltene (også nestet). */
function findKey(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  if (key in (value as Record<string, unknown>)) return (value as Record<string, unknown>)[key];
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

beforeEach(async () => {
  await resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// =====================================================================================
// 1. Regeltester: grensene som data
// =====================================================================================

describe("rydding av innloggingsdata: grensene (R1–R13)", () => {
  it("R1 retention constants match decision 10.11.2026", () => {
    expect(LOGIN_ATTEMPT_RETENTION_MS).toBe(86_400_000);
    expect(EXPIRED_VERIFICATION_RETENTION_MS).toBe(86_400_000);
    expect(EXPIRED_SESSION_RETENTION_MS).toBe(2_592_000_000);
  });

  type Table = "login_attempts" | "verifications" | "sessions";
  type BoundaryCase = {
    id: string;
    name: string;
    table: Table;
    /** Tidspunktet raden måles fra (`created_at` for tellere, `expires_at` ellers). */
    time: () => Date;
    /** Ekstra `created_at` for koder og økter (grensen skal ikke måles fra den). */
    createdAt?: () => Date;
    deleted: boolean;
  };

  const BOUNDARY_CASES: BoundaryCase[] = [
    {
      id: "R2",
      name: "login_attempts: created_at 1 ms before the 24 h limit is deleted",
      table: "login_attempts",
      time: () => at(-LOGIN_ATTEMPT_RETENTION_MS - 1),
      deleted: true,
    },
    {
      id: "R3",
      name: "login_attempts: created_at exactly on the limit is kept",
      table: "login_attempts",
      time: () => at(-LOGIN_ATTEMPT_RETENTION_MS),
      deleted: false,
    },
    {
      id: "R4",
      name: "login_attempts: created_at 1 ms after the limit is kept",
      table: "login_attempts",
      time: () => at(-LOGIN_ATTEMPT_RETENTION_MS + 1),
      deleted: false,
    },
    {
      id: "R6",
      name: "verifications: expires_at 1 ms before the 24 h limit is deleted",
      table: "verifications",
      time: () => at(-EXPIRED_VERIFICATION_RETENTION_MS - 1),
      deleted: true,
    },
    {
      id: "R7",
      name: "verifications: expires_at exactly on the limit is kept",
      table: "verifications",
      time: () => at(-EXPIRED_VERIFICATION_RETENTION_MS),
      deleted: false,
    },
    {
      id: "R8",
      name: "verifications: old created_at but valid expires_at is kept",
      table: "verifications",
      time: () => at(10 * MINUTE),
      createdAt: () => at(-10 * DAY),
      deleted: false,
    },
    {
      id: "R9",
      name: "sessions: expires_at 1 ms before the 30 d limit is deleted",
      table: "sessions",
      time: () => at(-EXPIRED_SESSION_RETENTION_MS - 1),
      deleted: true,
    },
    {
      id: "R10",
      name: "sessions: expires_at exactly on the limit is kept",
      table: "sessions",
      time: () => at(-EXPIRED_SESSION_RETENTION_MS),
      deleted: false,
    },
    {
      id: "R11",
      name: "sessions: expired less than 30 days ago is kept",
      table: "sessions",
      time: () => at(-29 * DAY),
      deleted: false,
    },
    {
      id: "R13",
      name: "sessions: old created_at but valid expires_at is kept",
      table: "sessions",
      time: () => at(5 * DAY),
      createdAt: () => at(-200 * DAY),
      deleted: false,
    },
  ];

  it.each(BOUNDARY_CASES)("$id $name", async (testCase) => {
    let exists: () => Promise<boolean>;
    if (testCase.table === "login_attempts") {
      const id = await insertAttempt(testCase.time());
      exists = () => attemptExists(id);
    } else if (testCase.table === "verifications") {
      const id = await insertVerification(testCase.time(), { createdAt: testCase.createdAt?.() });
      exists = () => verificationExists(id);
    } else {
      const created = testCase.createdAt?.();
      const { id } = await insertSession(await newUserId(), testCase.time(), {
        createdAt: created,
        updatedAt: created,
      });
      exists = () => sessionExists(id);
    }
    expect(await exists()).toBe(true);
    await purgeExpiredAuthData(NOW);
    expect(await exists()).toBe(!testCase.deleted);
  });

  it("R5 login_attempts: all kinds are deleted when old", async () => {
    const old = at(-LOGIN_ATTEMPT_RETENTION_MS - HOUR);
    const email = fakeEmail();
    const ids = [
      await insertAttempt(old, "code_requested", email),
      await insertAttempt(old, "code_failed", email),
      await insertAttempt(old, "login_succeeded", email),
    ];
    await purgeExpiredAuthData(NOW);
    for (const id of ids) expect(await attemptExists(id)).toBe(false);
  });

  it("R12 sessions: renewed session is kept", async () => {
    // Laget for 90 dager siden, fornyet i går: utløpstiden er flyttet 30 dager fram
    const { id } = await insertSession(await newUserId(), at(29 * DAY), {
      createdAt: at(-90 * DAY),
      updatedAt: at(-1 * DAY),
    });
    await purgeExpiredAuthData(NOW);
    expect(await sessionExists(id)).toBe(true);
  });
});

// =====================================================================================
// 2. Integrasjonstester: ryddefunksjonen
// =====================================================================================

describe("rydding av innloggingsdata: ryddefunksjonen (I1–I12)", () => {
  it("I1 valid one-time codes are kept", async () => {
    const id = await insertVerification(at(5 * MINUTE));
    await purgeExpiredAuthData(NOW);
    expect(await verificationExists(id)).toBe(true);
  });

  it("I2 valid Microsoft login state row is kept", async () => {
    // Slik en pågående Microsoft-runde ser ut: tilfeldig state som identifikator, JSON som verdi
    const id = await insertVerification(at(10 * MINUTE), {
      identifier: randomUUID().replace(/-/g, ""),
      value: JSON.stringify({
        callbackURL: "/",
        codeVerifier: `oppdiktet-verifier-${randomUUID()}`,
        expiresAt: at(10 * MINUTE).getTime(),
      }),
      createdAt: at(-1 * MINUTE),
    });
    await purgeExpiredAuthData(NOW);
    expect(await verificationExists(id)).toBe(true);
  });

  it("I3 valid sessions are kept", async () => {
    const { id } = await insertSession(await newUserId(), at(20 * DAY));
    await purgeExpiredAuthData(NOW);
    expect(await sessionExists(id)).toBe(true);
  });

  it("I4 counters younger than 24 h are kept", async () => {
    const ids = [
      await insertAttempt(at(-1 * MINUTE), "code_requested"),
      await insertAttempt(at(-2 * HOUR), "code_failed"),
      await insertAttempt(at(-23 * HOUR), "login_succeeded"),
    ];
    await purgeExpiredAuthData(NOW);
    for (const id of ids) expect(await attemptExists(id)).toBe(true);
  });

  it("I5 active throttle still blocks after cleanup", async () => {
    const email = fakeEmail();
    // Gamle tellere for samme adresse (skal ryddes)
    const oldIds = [
      await insertAttempt(at(-2 * DAY), "code_failed", email),
      await insertAttempt(at(-2 * DAY), "login_succeeded", email),
    ];
    // Aktiv sperre: MAX_FAILED_CODES feil koder de siste minuttene før NOW
    for (let i = 0; i < MAX_FAILED_CODES; i += 1) {
      await insertAttempt(at(-(MAX_FAILED_CODES - i) * MINUTE), "code_failed", email);
    }
    await purgeExpiredAuthData(NOW);
    for (const id of oldIds) expect(await attemptExists(id)).toBe(false);

    const decision = await checkAndRecordAttempt(email, "sign_in", NOW);
    expect(decision.blocked).toBe(true);
    expect(decision.blocked && decision.reason).toBe("failed_codes");
  });

  it("I6 returns counts per table", async () => {
    const userId = await newUserId();
    await insertAttempt(at(-2 * DAY));
    await insertAttempt(at(-3 * DAY), "code_requested");
    await insertAttempt(at(-1 * HOUR)); // står
    await insertVerification(at(-2 * DAY));
    await insertVerification(at(1 * MINUTE)); // står
    await insertSession(userId, at(-31 * DAY));
    await insertSession(userId, at(-40 * DAY));
    await insertSession(userId, at(-50 * DAY));
    await insertSession(userId, at(1 * DAY)); // står

    const result = await purgeExpiredAuthData(NOW);
    expect(Object.keys(result).sort()).toEqual(
      ["durationMs", "loginAttempts", "sessions", "verifications"].sort(),
    );
    expect(result.loginAttempts).toBe(2);
    expect(result.verifications).toBe(1);
    expect(result.sessions).toBe(3);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("I7 second run deletes nothing", async () => {
    await insertAttempt(at(-2 * DAY));
    await insertVerification(at(-2 * DAY));
    await insertSession(await newUserId(), at(-60 * DAY));
    const first = await purgeExpiredAuthData(NOW);
    expect(first.loginAttempts + first.verifications + first.sessions).toBe(3);
    const second = await purgeExpiredAuthData(NOW);
    expect([second.loginAttempts, second.verifications, second.sessions]).toEqual([0, 0, 0]);
  });

  describe("I8 runs in one transaction", () => {
    const TRIGGER_FUNCTION = "test_auth_cleanup_fail";
    const TABLES = ["login_attempts", "verifications", "sessions"] as const;

    afterEach(async () => {
      for (const table of TABLES) {
        await db.execute(
          sql.raw(`drop trigger if exists test_auth_cleanup_fail_trigger on ${table}`),
        );
      }
      await db.execute(sql.raw(`drop function if exists ${TRIGGER_FUNCTION}()`));
    });

    it.each(TABLES)(
      "deleting from %s fails: no rows in the other tables are deleted",
      async (failing) => {
        const attemptId = await insertAttempt(at(-2 * DAY));
        const verificationId = await insertVerification(at(-2 * DAY));
        const { id: sessionId } = await insertSession(await newUserId(), at(-60 * DAY));

        // Ekte databasefeil ved sletting i én tabell
        await db.execute(
          sql.raw(`create or replace function ${TRIGGER_FUNCTION}() returns trigger
            language plpgsql as $$ begin raise exception 'oppdiktet feil ved sletting'; end $$`),
        );
        await db.execute(
          sql.raw(`create trigger test_auth_cleanup_fail_trigger before delete on ${failing}
            for each row execute function ${TRIGGER_FUNCTION}()`),
        );
        captureLogs();

        await expect(purgeExpiredAuthData(NOW)).rejects.toThrow();

        expect(await attemptExists(attemptId)).toBe(true);
        expect(await verificationExists(verificationId)).toBe(true);
        expect(await sessionExists(sessionId)).toBe(true);
      },
    );
  });

  it("I9 only the three auth tables are touched", async () => {
    const organization = await createOrganization("Oppdiktet Takst AS");
    const actor = await createUser({ email: fakeEmail(), name: "Oppdiktet Takstmann" });
    const employee = await createEmployee(actor, organization.id, ["inspector"]);
    const account = await insertAccount(actor.id);
    // Alle økter og koder for brukeren er gamle og slettes
    const { id: sessionId } = await insertSession(actor.id, at(-90 * DAY));
    const verificationId = await insertVerification(at(-5 * DAY), {
      identifier: `sign-in-otp-${actor.email}`,
    });

    await purgeExpiredAuthData(NOW);

    expect(await sessionExists(sessionId)).toBe(false);
    expect(await verificationExists(verificationId)).toBe(false);
    const userRows = await db
      .select()
      .from(users)
      .where(inArray(users.id, [actor.id]));
    expect(userRows).toHaveLength(1);
    const accountRows = await db
      .select()
      .from(accounts)
      .where(inArray(accounts.id, [account.id]));
    expect(accountRows).toHaveLength(1);
    const employeeRows = await db
      .select()
      .from(employees)
      .where(inArray(employees.id, [employee.id]));
    expect(employeeRows).toHaveLength(1);
    expect(employeeRows[0]!.deletedAt).toBeNull();
  });

  it("I10 accounts with tokens are kept", async () => {
    const userId = await newUserId();
    const account = await insertAccount(userId);
    await insertSession(userId, at(-90 * DAY));

    await purgeExpiredAuthData(NOW);

    const [row] = await db
      .select()
      .from(accounts)
      .where(inArray(accounts.id, [account.id]));
    expect(row).toBeDefined();
    expect(row!.accessToken).toBe(account.accessToken);
    expect(row!.refreshToken).toBe(account.refreshToken);
    expect(row!.idToken).toBe(account.idToken);
    expect(row!.accessTokenExpiresAt?.toISOString()).toBe(
      account.accessTokenExpiresAt.toISOString(),
    );
    expect(row!.updatedAt.toISOString()).toBe(account.updatedAt.toISOString());
  });

  it("I11 default now is the app clock", async () => {
    const userId = await newUserId();
    const oldAttempt = await insertAttempt(at(-LOGIN_ATTEMPT_RETENTION_MS - 1));
    const keptAttempt = await insertAttempt(at(-LOGIN_ATTEMPT_RETENTION_MS));
    const oldVerification = await insertVerification(at(-EXPIRED_VERIFICATION_RETENTION_MS - 1));
    const keptVerification = await insertVerification(at(-EXPIRED_VERIFICATION_RETENTION_MS));
    const { id: oldSession } = await insertSession(userId, at(-EXPIRED_SESSION_RETENTION_MS - 1));
    const { id: keptSession } = await insertSession(userId, at(-EXPIRED_SESSION_RETENTION_MS));

    // Bare Date flyttes; databasedriveren trenger ekte tidsur
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const result = await purgeExpiredAuthData();
    vi.useRealTimers();

    expect([result.loginAttempts, result.verifications, result.sessions]).toEqual([1, 1, 1]);
    expect(await attemptExists(oldAttempt)).toBe(false);
    expect(await attemptExists(keptAttempt)).toBe(true);
    expect(await verificationExists(oldVerification)).toBe(false);
    expect(await verificationExists(keptVerification)).toBe(true);
    expect(await sessionExists(oldSession)).toBe(false);
    expect(await sessionExists(keptSession)).toBe(true);
  });

  it("I12 does not import Better Auth", () => {
    const source = readFileSync(path.join(__dirname, "auth-cleanup.ts"), "utf8");
    const imports = [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
      (match) => match[1]!,
    );
    const allowed = new Set(["@/db/client", "@/db/schema", "@/shared/lib/logger", "drizzle-orm"]);
    for (const name of imports) {
      expect(allowed.has(name) || name.startsWith("node:"), `ulovlig import: ${name}`).toBe(true);
    }
    expect(imports).toContain("@/db/client");
    expect(imports).toContain("@/db/schema");
    for (const forbidden of ["./auth", "better-auth", "@/core/ai"]) {
      expect(imports.some((name) => name === forbidden || name.startsWith(`${forbidden}/`))).toBe(
        false,
      );
    }
  });
});

// =====================================================================================
// Tilgang og tenant-isolasjon (to organisasjoner)
// =====================================================================================

describe("rydding av innloggingsdata: to organisasjoner og admin (T1–T4)", () => {
  async function setupOrganization(name: string, role: "inspector" | "admin" = "inspector") {
    const organization = await createOrganization(name);
    const actor = await createUser({ email: fakeEmail(), name: `Oppdiktet ansatt ${name}` });
    const employee = await createEmployee(actor, organization.id, [role]);
    const account = await insertAccount(actor.id);
    const oldSession = await insertSession(actor.id, at(-45 * DAY));
    const validSession = await insertSession(actor.id, at(25 * DAY));
    return { organization, actor, employee, account, oldSession, validSession };
  }

  it("T1 two organizations: users, accounts and employees untouched", async () => {
    const a = await setupOrganization("Oppdiktet Takst A");
    const b = await setupOrganization("Oppdiktet Takst B");

    await purgeExpiredAuthData(NOW);

    for (const org of [a, b]) {
      const userRows = await db
        .select()
        .from(users)
        .where(inArray(users.id, [org.actor.id]));
      expect(userRows, org.organization.name).toHaveLength(1);
      const accountRows = await db
        .select()
        .from(accounts)
        .where(inArray(accounts.id, [org.account.id]));
      expect(accountRows, org.organization.name).toHaveLength(1);
      const employeeRows = await db
        .select()
        .from(employees)
        .where(inArray(employees.id, [org.employee.id]));
      expect(employeeRows, org.organization.name).toHaveLength(1);
      expect(employeeRows[0]!.organizationId).toBe(org.organization.id);
      expect(employeeRows[0]!.deletedAt).toBeNull();
    }
  });

  it("T2 two organizations: sessions are cleaned by time only", async () => {
    const a = await setupOrganization("Oppdiktet Takst A");
    const b = await setupOrganization("Oppdiktet Takst B");

    const result = await purgeExpiredAuthData(NOW);

    expect(result.sessions).toBe(2);
    for (const org of [a, b]) {
      expect(await sessionExists(org.oldSession.id), org.organization.name).toBe(false);
      expect(await sessionExists(org.validSession.id), org.organization.name).toBe(true);
    }
  });

  it("T3 cleanup has no condition on user, email hash or organization", () => {
    const source = readFileSync(path.join(__dirname, "auth-cleanup.ts"), "utf8");
    // Bare kode, ikke kommentarer
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const column of ["userId", "emailHash", "identifier", "organizationId"]) {
      expect(code, column).not.toMatch(
        new RegExp(`\\b(eq|ne|inArray|notInArray|like|ilike)\\(\\s*\\w+\\.${column}\\b`),
      );
      expect(code, column).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const forbidden of ["user_id", "email_hash", "organization_id", "identifier"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // Bare «strengt eldre enn» på tidskolonnene
    expect(code).toMatch(/\blt\(\s*loginAttempts\.createdAt\b/);
    expect(code).toMatch(/\blt\(\s*verifications\.expiresAt\b/);
    expect(code).toMatch(/\blt\(\s*sessions\.expiresAt\b/);
    for (const looser of ["lte(", "gt(", "gte("]) {
      expect(code, looser).not.toContain(looser);
    }
  });

  it("T4 admin keeps access after cleanup (regel 11)", async () => {
    const a = await setupOrganization("Oppdiktet Takst A", "admin");
    // Gamle feilforsøk for admin (mer enn nok til sperre om de hadde vært nye)
    const oldIds: string[] = [];
    for (let i = 0; i < MAX_FAILED_CODES + 2; i += 1) {
      oldIds.push(await insertAttempt(at(-3 * DAY + i * MINUTE), "code_failed", a.actor.email));
    }

    await purgeExpiredAuthData(NOW);

    for (const id of oldIds) expect(await attemptExists(id)).toBe(false);
    expect(await sessionExists(a.validSession.id)).toBe(true);
    expect(
      await db
        .select()
        .from(users)
        .where(inArray(users.id, [a.actor.id])),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(accounts)
        .where(inArray(accounts.id, [a.account.id])),
    ).toHaveLength(1);
    const decision = await checkAndRecordAttempt(a.actor.email, "sign_in", NOW);
    expect(decision.blocked).toBe(false);
  });
});

// =====================================================================================
// Logging
// =====================================================================================

describe("rydding av innloggingsdata: logging (L1–L3)", () => {
  it("L1 logs one info line with counts and duration", async () => {
    await insertAttempt(at(-2 * DAY));
    await insertAttempt(at(-2 * DAY));
    await insertVerification(at(-2 * DAY));
    await insertSession(await newUserId(), at(-60 * DAY));
    const lines = captureLogs();

    const result = await purgeExpiredAuthData(NOW);

    const info = lines.filter((line) => line.level === "info");
    expect(info).toHaveLength(1);
    expect(lines.filter((line) => line.level === "error")).toHaveLength(0);
    const parsed = JSON.parse(written(info[0]!)) as Record<string, unknown>;
    expect(findKey(parsed, "loginAttempts")).toBe(result.loginAttempts);
    expect(findKey(parsed, "verifications")).toBe(result.verifications);
    expect(findKey(parsed, "sessions")).toBe(result.sessions);
    expect(typeof findKey(parsed, "durationMs")).toBe("number");
    expect(result.loginAttempts).toBe(2);
  });

  it("L2 info log has no personal data", async () => {
    const email = fakeEmail();
    const actor = await createUser({ email, name: "Oppdiktet Loggperson" });
    await insertAttempt(at(-2 * DAY), "code_failed", email);
    await insertVerification(at(-2 * DAY), {
      identifier: `sign-in-otp-${email}`,
      value: "654321:0",
    });
    const { token } = await insertSession(actor.id, at(-60 * DAY));
    const lines = captureLogs();

    await purgeExpiredAuthData(NOW);

    expect(lines.length).toBeGreaterThan(0);
    const known = [email, emailHashOf(email), token, FAKE_IP, FAKE_USER_AGENT, actor.id, "654321"];
    for (const line of lines) {
      const raw = JSON.stringify(line);
      const out = written(line);
      for (const value of known) {
        expect(raw, value).not.toContain(value);
        expect(out, value).not.toContain(value);
      }
    }
  });

  it("L3 database error is logged with reference code only", async () => {
    const email = fakeEmail();
    const hash = emailHashOf(email);
    const token = `oppdiktet-token-${randomUUID()}`;
    const known = [email, hash, token, FAKE_IP, FAKE_USER_AGENT];
    // Slik en databasefeil fra Drizzle ser ut: parametrene til slutt i meldingen
    const cause = Object.assign(new Error(`duplicate key (${email}, ${token})`), {
      detail: `Key (email_hash)=(${hash}) ip ${FAKE_IP} agent ${FAKE_USER_AGENT}`,
      code: "23505",
    });
    const failure = Object.assign(
      new Error(
        `Failed query: delete from "sessions" where "sessions"."expires_at" < $1\nparams: ${email},${hash},${token},${FAKE_IP},${FAKE_USER_AGENT}`,
      ),
      { cause },
    );
    vi.spyOn(db, "transaction").mockRejectedValue(failure);
    const lines = captureLogs();

    await expect(purgeExpiredAuthData(NOW)).rejects.toBeDefined();

    const errors = lines.filter((line) => line.level === "error");
    expect(errors).toHaveLength(1);
    const out = written(errors[0]!);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(typeof parsed.ref).toBe("string");
    expect((parsed.ref as string).length).toBeGreaterThan(0);
    for (const line of lines) {
      const text = written(line);
      for (const value of known) expect(text, value).not.toContain(value);
    }
  });
});
