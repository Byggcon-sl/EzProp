import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { emailTransport, readDevMailbox } from "@/core/email";
import { db } from "@/db/client";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { auth } from "./auth";
import { hashEmail, MAX_CODE_REQUESTS, MAX_FAILED_CODES, throttleMessage } from "./login-throttle";

/*
 * Integrasjonstester for sperren ved innlogging, gjennom Better Auth (`auth.handler`), så det er
 * vist at krokene er koblet inn (docs/funksjoner/fase0b-sperre-innlogging-testplan.md avsnitt 2).
 * Tiden flyttes ved å tilbakedatere `created_at` i `login_attempts`, ikke ved å vente.
 * Testdata er oppdiktet (eksempel.no). Bare utviklings-postkassen brukes.
 *
 * Støtter hovedmål reklamasjoner (ingen kan gjette seg til koden og endre eller publisere
 * rapporter i en takstmanns navn) og tid (riktig kode nullstiller, takstmannen merker ingenting).
 */

const BASE_URL = getEnv().BETTER_AUTH_URL;
const SECRET = getEnv().BETTER_AUTH_SECRET;

const FAILED_MESSAGE = /^For mange feil koder\. Du kan prøve igjen kl\. \d{2}:\d{2}\.$/;
const REQUESTS_MESSAGE = /^For mange koder bestilt\. Du kan be om ny kode kl\. \d{2}:\d{2}\.$/;

async function post(route: string, body: unknown): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify(body),
    }),
  );
}

async function get(route: string): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${route}`, { headers: { origin: BASE_URL } }),
  );
}

const requestCode = (email: string) =>
  post("/email-otp/send-verification-otp", { email, type: "sign-in" });
const signIn = (email: string, otp: string) => post("/sign-in/email-otp", { email, otp });

/** Siste kode sendt til adressen, fra utviklings-postkassen. */
function latestCode(email: string): string {
  const to = email.trim().toLowerCase();
  const mail = readDevMailbox().find((entry) => entry.to.toLowerCase() === to);
  const code = /: (\d{6})$/.exec(mail?.subject ?? "")?.[1];
  if (!code) throw new Error("Fant ingen kode i utviklings-postkassen");
  return code;
}

function mailsTo(email: string): number {
  const to = email.trim().toLowerCase();
  return readDevMailbox().filter((entry) => entry.to.toLowerCase() === to).length;
}

/** En kode som garantert er feil. */
function wrongCode(real?: string): string {
  return real === "000000" ? "111111" : "000000";
}

async function message(response: Response): Promise<string> {
  const body = (await response.clone().json()) as { message?: string };
  return body.message ?? "";
}

async function countRows(table: "sessions" | "verifications"): Promise<number> {
  const rows = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(table)}`,
  );
  return Array.from(rows)[0]?.count ?? 0;
}

async function attempts(email?: string) {
  const rows = await db.execute<{
    id: unknown;
    email_hash: string;
    kind: string;
    created_at: Date;
  }>(
    email
      ? sql`select id, email_hash, kind, created_at from login_attempts where email_hash = ${hashEmail(email, SECRET)} order by created_at, id`
      : sql`select id, email_hash, kind, created_at from login_attempts order by created_at, id`,
  );
  return Array.from(rows);
}

async function countKind(email: string, kind: string): Promise<number> {
  return (await attempts(email)).filter((row) => row.kind === kind).length;
}

/** Flytter tiden: alle rader i `login_attempts` blir `minutes` minutter eldre. */
async function backdateAttempts(minutes: number) {
  await db.execute(
    sql`update login_attempts set created_at = created_at - make_interval(mins => ${minutes})`,
  );
}

/** En kjent adresse: bruker og ansatt i en organisasjon. */
async function knownPerson(
  email: string,
  options: { roles?: ("admin" | "inspector")[]; organizationId?: string } = {},
) {
  const organizationId = options.organizationId ?? (await createOrganization()).id;
  const user = await createUser({ email, name: "Oppdiktet Person" });
  await createEmployee(user, organizationId, options.roles ?? ["inspector"]);
  return { user, organizationId };
}

/**
 * 5 feil koder på en kjent adresse. Better Auth gir 3 forsøk per kode, så det bestilles ny kode
 * underveis: kode 1 får 3 feil, kode 2 får 2 feil (og har fortsatt ett forsøk igjen).
 * Returnerer kode 2, som fortsatt er gyldig hos Better Auth.
 */
async function fiveWrongCodesKnown(email: string): Promise<string> {
  expect((await requestCode(email)).status).toBe(200);
  const first = latestCode(email);
  for (let i = 0; i < 3; i += 1) {
    const response = await signIn(email, wrongCode(first));
    expect(response.status).not.toBe(429);
  }
  expect((await requestCode(email)).status).toBe(200);
  const second = latestCode(email);
  for (let i = 0; i < 2; i += 1) {
    const response = await signIn(email, wrongCode(second));
    expect(response.status).not.toBe(429);
  }
  return second;
}

/** 5 feil koder uten bestilling (fungerer for kjente og ukjente adresser). */
async function fiveWrongCodes(email: string) {
  for (let i = 0; i < MAX_FAILED_CODES; i += 1) {
    const response = await signIn(email, "000000");
    expect(response.status).not.toBe(429);
  }
}

async function fiveRequests(email: string) {
  for (let i = 0; i < MAX_CODE_REQUESTS; i += 1) {
    const response = await requestCode(email);
    expect(response.status).not.toBe(429);
  }
}

function clearDevMailbox() {
  (globalThis as unknown as { ezpropDevMailbox?: unknown[] }).ezpropDevMailbox = [];
}

// n) Vakt: e-post går aldri til ekte mottakere i disse testene.
beforeAll(() => {
  expect(emailTransport()).toBe("devMailbox");
});

beforeEach(async () => {
  await resetDatabase();
  clearDevMailbox();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sperre ved innlogging gjennom Better Auth", () => {
  it("n) e-post sendes bare til utviklings-postkassen", () => {
    expect(emailTransport()).toBe("devMailbox");
  });

  it("a) 5 feil koder gir 429 med norsk melding på innlogging og bestilling", async () => {
    const email = "ola@eksempel.no";
    await knownPerson(email);
    await fiveWrongCodesKnown(email);

    const failed = (await attempts(email)).filter((row) => row.kind === "code_failed");
    expect(failed).toHaveLength(MAX_FAILED_CODES);
    const fifth = new Date(failed[failed.length - 1]!.created_at);
    const expectedMessage = throttleMessage(
      "failed_codes",
      new Date(fifth.getTime() + 15 * 60 * 1000),
    );

    const blockedSignIn = await signIn(email, "123456");
    expect(blockedSignIn.status).toBe(429);
    expect(await message(blockedSignIn)).toMatch(FAILED_MESSAGE);
    expect(await message(blockedSignIn)).toBe(expectedMessage);

    const blockedRequest = await requestCode(email);
    expect(blockedRequest.status).toBe(429);
    expect(await message(blockedRequest)).toBe(expectedMessage);
  });

  it("b) riktig kode mens sperren gjelder gir 429 og ingen innlogging", async () => {
    const email = "kari@eksempel.no";
    await knownPerson(email);
    const stillValidCode = await fiveWrongCodesKnown(email);

    const sessionsBefore = await countRows("sessions");
    const response = await signIn(email, stillValidCode);
    expect(response.status).toBe(429);
    expect(await message(response)).toMatch(FAILED_MESSAGE);
    expect(await countRows("sessions")).toBe(sessionsBefore);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toMatch(/session_token=[^;]+/);
  });

  it("c) 6. bestilling gir 429, ingen ny kode og ingen e-post", async () => {
    const email = "per@eksempel.no";
    await knownPerson(email);
    await fiveRequests(email);
    expect(mailsTo(email)).toBe(MAX_CODE_REQUESTS);

    const verificationsBefore = await countRows("verifications");
    const mailboxBefore = readDevMailbox().length;
    const response = await requestCode(email);
    expect(response.status).toBe(429);
    expect(await message(response)).toMatch(REQUESTS_MESSAGE);
    expect(await countRows("verifications")).toBe(verificationsBefore);
    expect(readDevMailbox()).toHaveLength(mailboxBefore);
    expect(mailsTo(email)).toBe(MAX_CODE_REQUESTS);
  });

  // Regel 11: admin stenges aldri ute for godt. Denne testen skal aldri fjernes.
  it("d) admin sperres og kommer inn igjen av seg selv etter 15 minutter", async () => {
    const email = "admin.test@eksempel.no";
    await knownPerson(email, { roles: ["admin"] });
    await fiveWrongCodesKnown(email);

    expect((await signIn(email, "123456")).status).toBe(429);
    expect((await requestCode(email)).status).toBe(429);

    await backdateAttempts(15);

    const sessionsBefore = await countRows("sessions");
    expect((await requestCode(email)).status).toBe(200);
    const response = await signIn(email, latestCode(email));
    expect(response.status).toBe(200);
    expect(await countRows("sessions")).toBe(sessionsBefore + 1);
  });

  it("e) riktig kode nullstiller feil og bestillinger, uten å slette rader", async () => {
    const email = "lise@eksempel.no";
    await knownPerson(email);

    // 4 bestillinger og 4 feil
    expect((await requestCode(email)).status).toBe(200);
    const first = latestCode(email);
    for (let i = 0; i < 3; i += 1)
      expect((await signIn(email, wrongCode(first))).status).not.toBe(429);
    for (let i = 0; i < 3; i += 1) expect((await requestCode(email)).status).toBe(200);
    const code = latestCode(email);
    expect((await signIn(email, wrongCode(code))).status).not.toBe(429);
    expect(await countKind(email, "code_requested")).toBe(4);
    expect(await countKind(email, "code_failed")).toBe(4);

    const rowsBefore = (await attempts(email)).length;
    expect((await signIn(email, code)).status).toBe(200);
    const rowsAfterSuccess = (await attempts(email)).length;
    expect(rowsAfterSuccess).toBeGreaterThan(rowsBefore);
    expect(await countKind(email, "login_succeeded")).toBe(1);

    // 4 nye feil og 4 nye bestillinger slipper gjennom
    expect((await requestCode(email)).status).toBe(200);
    const next = latestCode(email);
    for (let i = 0; i < 3; i += 1)
      expect((await signIn(email, wrongCode(next))).status).not.toBe(429);
    for (let i = 0; i < 3; i += 1) expect((await requestCode(email)).status).toBe(200);
    expect((await signIn(email, wrongCode(latestCode(email)))).status).not.toBe(429);

    // Ingen rader er slettet: bare økt med de 8 nye
    expect((await attempts(email)).length).toBe(rowsAfterSuccess + 8);
    expect(await countKind(email, "login_succeeded")).toBe(1);
  });

  it("f) kjent og ukjent adresse gir likt 429-svar ved feilsperre", async () => {
    const known = "kjent@eksempel.no";
    const unknown = "ukjent.f@eksempel.no";
    await knownPerson(known);

    await fiveWrongCodes(known);
    await fiveWrongCodes(unknown);
    // Lik tid for begge, så klokkeslettet i meldingen blir det samme
    await db.execute(
      sql`update login_attempts set created_at = date_trunc('minute', now()) - interval '1 minute'`,
    );

    const knownResponse = await signIn(known, "123456");
    const unknownResponse = await signIn(unknown, "123456");
    expect(knownResponse.status).toBe(429);
    expect(unknownResponse.status).toBe(429);
    const knownBody = (await knownResponse.json()) as Record<string, unknown>;
    const unknownBody = (await unknownResponse.json()) as Record<string, unknown>;
    expect(unknownBody).toEqual(knownBody);
    expect(Object.keys(unknownBody).sort()).toEqual(Object.keys(knownBody).sort());
    expect(String(knownBody.message)).toMatch(FAILED_MESSAGE);
    expect(await countKind(unknown, "code_failed")).toBe(MAX_FAILED_CODES);
  });

  it("f) kjent og ukjent adresse gir likt 429-svar ved bestillingsgrensen", async () => {
    const known = "kjent@eksempel.no";
    const unknown = "ukjent.f@eksempel.no";
    await knownPerson(known);

    await fiveRequests(known);
    await fiveRequests(unknown);
    await db.execute(
      sql`update login_attempts set created_at = date_trunc('minute', now()) - interval '1 minute'`,
    );

    const knownResponse = await requestCode(known);
    const unknownResponse = await requestCode(unknown);
    expect(knownResponse.status).toBe(429);
    expect(unknownResponse.status).toBe(429);
    const knownBody = (await knownResponse.json()) as Record<string, unknown>;
    const unknownBody = (await unknownResponse.json()) as Record<string, unknown>;
    expect(unknownBody).toEqual(knownBody);
    expect(String(knownBody.message)).toMatch(REQUESTS_MESSAGE);
    expect(await countKind(unknown, "code_requested")).toBe(MAX_CODE_REQUESTS);
    // Ukjent adresse får aldri e-post
    expect(mailsTo(unknown)).toBe(0);
  });

  it("g) login_attempts har bare id, email_hash, kind og created_at", async () => {
    const rows = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'login_attempts'`,
    );
    const columns = Array.from(rows)
      .map((row) => row.column_name)
      .sort();
    expect(columns).toEqual(["created_at", "email_hash", "id", "kind"]);
    expect(columns).not.toContain("organization_id");
    expect(columns).not.toContain("email");
    expect(columns).not.toContain("ip");
  });

  it("g) adressen står ikke i klartekst, og store bokstaver og mellomrom teller som samme adresse", async () => {
    const email = "ola@eksempel.no";
    await knownPerson(email);

    for (let i = 0; i < 3; i += 1) {
      expect((await requestCode("Ola@Eksempel.no ")).status).not.toBe(429);
    }
    for (let i = 0; i < 2; i += 1) {
      expect((await requestCode(email)).status).not.toBe(429);
    }
    const sixth = await requestCode(email);
    expect(sixth.status).toBe(429);
    expect(await message(sixth)).toMatch(REQUESTS_MESSAGE);

    const all = await attempts();
    const hashes = new Set(all.map((row) => row.email_hash));
    expect(hashes).toEqual(new Set([hashEmail(email, SECRET)]));
    expect(hashEmail("Ola@Eksempel.no ", SECRET)).toBe(hashEmail(email, SECRET));

    const cells = await db.execute<{ row: string }>(
      sql`select t::text as row from login_attempts t`,
    );
    for (const { row } of Array.from(cells)) {
      expect(row.toLowerCase()).not.toContain("ola@eksempel.no");
      expect(row.toLowerCase()).not.toContain("eksempel");
    }
  });

  it("h) testene kjører med Better Auths rateLimit av", () => {
    expect(auth.options.rateLimit?.enabled).toBe(false);
  });

  it("h) sperren og krokene har ingen bryter i miljøet (DEV_MAILBOX, NODE_ENV)", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const throttle = readFileSync(path.join(dir, "login-throttle.ts"), "utf8");
    expect(throttle).not.toMatch(/DEV_MAILBOX|NODE_ENV/);

    const authSource = readFileSync(path.join(dir, "auth.ts"), "utf8");
    const hooks = hooksBlock(authSource);
    expect(hooks).toMatch(/before/);
    expect(hooks).toMatch(/after/);
    expect(hooks).not.toMatch(/DEV_MAILBOX|NODE_ENV/);
  });

  it("i) forsøk under sperren forlenger den ikke", async () => {
    const email = "nils@eksempel.no";
    await knownPerson(email);
    await fiveWrongCodes(email);

    for (let i = 0; i < 3; i += 1) {
      expect((await signIn(email, "123456")).status).toBe(429);
    }
    expect((await requestCode(email)).status).toBe(429);
    expect(await countKind(email, "code_failed")).toBe(MAX_FAILED_CODES);
    expect(await countKind(email, "code_requested")).toBe(0);

    await backdateAttempts(15);
    expect((await signIn(email, "123456")).status).not.toBe(429);
  });

  it("j) 10 samtidige feil innlogginger: nøyaktig 5 slipper gjennom til Better Auth", async () => {
    const email = "samtidig@eksempel.no";
    await knownPerson(email);
    expect((await requestCode(email)).status).toBe(200);
    const code = latestCode(email);

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => signIn(email, wrongCode(code))),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    expect(statuses.filter((status) => status !== 429)).toHaveLength(5);
    expect(await countKind(email, "code_failed")).toBe(MAX_FAILED_CODES);
  });

  it("j) 10 samtidige bestillinger: 5 får kode, 5 får 429", async () => {
    const email = "samtidig.kode@eksempel.no";
    await knownPerson(email);

    const responses = await Promise.all(Array.from({ length: 10 }, () => requestCode(email)));
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(5);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    expect(await countKind(email, "code_requested")).toBe(MAX_CODE_REQUESTS);
    expect(mailsTo(email)).toBeLessThanOrEqual(MAX_CODE_REQUESTS);
  });

  it("l) sperre på A rører ikke B, når A og B er i hver sin organisasjon", async () => {
    const a = "anne@eksempel.no";
    const b = "bjorn@eksempel.no";
    await knownPerson(a);
    await knownPerson(b);
    await expectOnlyFirstLocked(a, b);
  });

  it("l) sperre på B rører ikke A, når A og B er i hver sin organisasjon", async () => {
    const a = "anne@eksempel.no";
    const b = "bjorn@eksempel.no";
    await knownPerson(a);
    await knownPerson(b);
    await expectOnlyFirstLocked(b, a);
  });

  it("l) sperre på A rører ikke B, når A og B er i samme organisasjon", async () => {
    const a = "anne@eksempel.no";
    const b = "bjorn@eksempel.no";
    const { organizationId } = await knownPerson(a);
    await knownPerson(b, { organizationId });
    await expectOnlyFirstLocked(a, b);
  });

  it("m) loggen har én linje med rute når sperren slår inn, uten adresse og hash", async () => {
    const email = "Logg.Test@Eksempel.no";
    await knownPerson(email.toLowerCase());
    const spies = [
      vi.spyOn(logger, "debug"),
      vi.spyOn(logger, "info"),
      vi.spyOn(logger, "warn"),
      vi.spyOn(logger, "error"),
    ];
    const calls = () => spies.flatMap((spy) => spy.mock.calls);

    await fiveWrongCodes(email);
    expect(calls()).toHaveLength(0);

    expect((await signIn(email, "123456")).status).toBe(429);
    expect(calls()).toHaveLength(1);
    const logged = JSON.stringify(calls());
    expect(logged).toContain("/sign-in/email-otp");
    expect(logged.toLowerCase()).not.toContain(email.toLowerCase());
    expect(logged).not.toContain(hashEmail(email, SECRET));
  });
});

/** Sperrer `locked` (feil og bestillinger) og viser at `free` kan bestille og logge inn. */
async function expectOnlyFirstLocked(locked: string, free: string) {
  await fiveRequests(locked);
  await fiveWrongCodes(locked);
  expect((await requestCode(locked)).status).toBe(429);
  expect((await signIn(locked, "123456")).status).toBe(429);

  const sessionsBefore = await countRows("sessions");
  expect((await requestCode(free)).status).toBe(200);
  expect((await signIn(free, latestCode(free))).status).toBe(200);
  expect(await countRows("sessions")).toBe(sessionsBefore + 1);

  // Den andre er fortsatt sperret
  expect((await signIn(locked, "123456")).status).toBe(429);
}

/** Teksten i `hooks: { … }` i auth.ts (balanserte klammer). Tom tekst hvis den mangler. */
function hooksBlock(source: string): string {
  const start = source.search(/\bhooks\s*:\s*\{/);
  if (start < 0) return "";
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

describe("k) stengte kode-endepunkter i Better Auth", () => {
  const closed = [
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/email-otp/reset-password",
    "/email-otp/request-password-reset",
    "/forget-password/email-otp",
    "/email-otp/finnes-ikke",
  ];

  it.each(closed)("%s gir 404", async (route) => {
    const response = await post(route, {
      email: "ola@eksempel.no",
      otp: "123456",
      type: "sign-in",
      password: "oppdiktet-passord-123",
    });
    expect(response.status).toBe(404);
  });

  it("en gyldig kode sendt til de stengte stiene virker fortsatt på /sign-in/email-otp", async () => {
    const email = "ola@eksempel.no";
    await knownPerson(email);
    expect((await requestCode(email)).status).toBe(200);
    const code = latestCode(email);
    for (const route of closed) {
      const response = await post(route, {
        email,
        otp: code,
        type: "sign-in",
        password: "oppdiktet-passord-123",
      });
      expect(response.status).toBe(404);
    }
    expect((await signIn(email, code)).status).toBe(200);
  });

  it("motprøve: de åpne stiene gir ikke 404", async () => {
    expect((await requestCode("ola@eksempel.no")).status).not.toBe(404);
    expect((await signIn("ola@eksempel.no", "123456")).status).not.toBe(404);
    expect((await get("/get-session")).status).not.toBe(404);
    expect((await post("/sign-out", {})).status).not.toBe(404);
  });
});
