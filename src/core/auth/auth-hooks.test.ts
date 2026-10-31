import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { readDevMailbox } from "@/core/email";
import { db } from "@/db/client";
import { loginAttempts, sessions } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { auth } from "./auth";
import { MAX_FAILED_CODES } from "./login-throttle";

/*
 * Krokene i auth.ts: stengte kode-stier og sperren koblet inn i Better Auth.
 * Den fulle testplanen ligger i login-throttle.integration.test.ts.
 * login_attempts har ingen organisasjons-ID (før innlogging), så expectTenantIsolation passer
 * ikke her; isolasjon mellom adresser vises i siste test.
 */

const BASE = "http://localhost:3000/api/auth";

function post(path: string, body: unknown) {
  return auth.handler(
    new Request(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify(body),
    }),
  );
}

function requestCode(email: string) {
  return post("/email-otp/send-verification-otp", { email, type: "sign-in" });
}

function signIn(email: string, otp: string) {
  return post("/sign-in/email-otp", { email, otp });
}

function latestCode(email: string): string {
  const mail = readDevMailbox().find((m) => m.to === email);
  const code = mail?.text.match(/\d{6}/)?.[0];
  if (!code) throw new Error("fant ingen kode i utviklings-postkassen");
  return code;
}

async function knownEmail(email: string) {
  const organization = await createOrganization();
  const actor = await createUser({ email });
  await createEmployee(actor, organization.id, ["inspector"]);
  return actor;
}

/** 5 feil koder: Better Auth gir 3 forsøk per kode, så det bestilles ny kode underveis. */
async function failFiveTimes(email: string) {
  for (let i = 0; i < MAX_FAILED_CODES; i++) {
    if (i % 3 === 0) expect((await requestCode(email)).status).toBe(200);
    const response = await signIn(email, "000000");
    expect(response.status).not.toBe(429);
  }
}

async function sessionCount() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions);
  return row?.n ?? 0;
}

describe("kroker i auth.ts", () => {
  beforeEach(resetDatabase);

  it.each([
    "/email-otp/check-verification-otp",
    "/email-otp/verify-email",
    "/email-otp/reset-password",
    "/email-otp/request-password-reset",
    "/forget-password/email-otp",
    "/email-otp/finnes-ikke",
  ])("stengt sti %s gir 404", async (path) => {
    const response = await post(path, {
      email: "ola@eksempel.no",
      otp: "123456",
      type: "sign-in",
      password: "oppdiktet-passord-123",
    });
    expect(response.status).toBe(404);
  });

  it("stengt sti bruker ikke opp koden", async () => {
    const email = "ola@eksempel.no";
    await knownEmail(email);
    await requestCode(email);
    const otp = latestCode(email);
    const closed = await post("/email-otp/check-verification-otp", { email, otp, type: "sign-in" });
    expect(closed.status).toBe(404);
    expect((await signIn(email, otp)).status).toBe(200);
  });

  it("åpne stier gir ikke 404", async () => {
    expect((await requestCode("ola@eksempel.no")).status).not.toBe(404);
    expect((await signIn("ola@eksempel.no", "000000")).status).not.toBe(404);
    const session = await auth.handler(new Request(`${BASE}/get-session`));
    expect(session.status).not.toBe(404);
    expect((await post("/sign-out", {})).status).not.toBe(404);
  });

  it("6. forsøk etter 5 feil gir 429 med norsk melding, også ved riktig kode og ny bestilling", async () => {
    const email = "kari@eksempel.no";
    await knownEmail(email);
    await failFiveTimes(email);
    // Gyldig kode bestilt før sperren slo inn (bestilling 2 av 2)
    const otp = latestCode(email);
    const before = await sessionCount();

    const blocked = await signIn(email, otp);
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).message).toMatch(
      /^For mange feil koder\. Du kan prøve igjen kl\. \d{2}:\d{2}\.$/,
    );
    expect(blocked.headers.get("set-cookie") ?? "").not.toContain("session_token");
    expect(await sessionCount()).toBe(before);

    const request = await requestCode(email);
    expect(request.status).toBe(429);
    expect((await request.json()).message).toMatch(/^For mange feil koder\./);
  });

  it("ukjent adresse får samme 429-svar som kjent", async () => {
    await knownEmail("kari@eksempel.no");
    await failFiveTimes("kari@eksempel.no");
    await failFiveTimes("ukjent.hooks@eksempel.no");
    const known = await signIn("kari@eksempel.no", "000000");
    const unknown = await signIn("ukjent.hooks@eksempel.no", "000000");
    expect(unknown.status).toBe(known.status);
    expect(Object.keys(await unknown.json()).sort()).toEqual(
      Object.keys(await known.json()).sort(),
    );
  });

  it("riktig kode lagrer login_succeeded og nullstiller feilene", async () => {
    const email = "ola@eksempel.no";
    await knownEmail(email);
    await requestCode(email);
    for (let i = 0; i < 2; i++) await signIn(email, "000000");
    expect((await signIn(email, latestCode(email))).status).toBe(200);
    const kinds = await db.select({ kind: loginAttempts.kind }).from(loginAttempts);
    expect(kinds.filter((k) => k.kind === "login_succeeded")).toHaveLength(1);
    // Etter nullstilling slipper 4 nye feil gjennom
    await requestCode(email);
    for (let i = 0; i < 2; i++) expect((await signIn(email, "000000")).status).not.toBe(429);
    await requestCode(email);
    for (let i = 0; i < 2; i++) expect((await signIn(email, "000000")).status).not.toBe(429);
  });

  it("mangler e-post i kroppen, avviser Better Auth selv og ingenting lagres", async () => {
    const response = await post("/sign-in/email-otp", { otp: "000000" });
    expect(response.status).toBe(400);
    expect(await db.select().from(loginAttempts)).toHaveLength(0);
  });

  it("sperre på én adresse rører ikke en annen", async () => {
    await knownEmail("kari@eksempel.no");
    await failFiveTimes("kari@eksempel.no");
    const other = "per@eksempel.no";
    await knownEmail(other);
    expect((await requestCode(other)).status).toBe(200);
    expect((await signIn(other, latestCode(other))).status).toBe(200);
    const rows = await db
      .select()
      .from(loginAttempts)
      .where(eq(loginAttempts.kind, "login_succeeded"));
    expect(rows).toHaveLength(1);
  });

  it("krokene og sperren har ingen bryter på miljøet", () => {
    const hooks = readFileSync(new URL("./auth.ts", import.meta.url), "utf8").split("hooks: {")[1]!;
    const hooksBlock = hooks.split("session: {")[0]!;
    expect(hooksBlock).not.toMatch(/DEV_MAILBOX|NODE_ENV/);
    const throttle = readFileSync(new URL("./login-throttle.ts", import.meta.url), "utf8");
    expect(throttle).not.toMatch(/DEV_MAILBOX|NODE_ENV/);
  });
});
