import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { readDevMailbox } from "@/core/email";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { auth } from "./auth";
import { revokeAllEmployeeSessions } from "./sessions-list";

/*
 * Better Auths egne økt-endepunkter er stengt over HTTP, også med gyldig økt
 * (docs/funksjoner/fase2a-mine-innlogginger-testplan.md avsnitt 7.2), og «Logg ut av alle enheter»
 * gjør økten ugyldig med en gang (avsnitt 4.4.2). Innlogging med koden fra utviklings-postkassen.
 * Testdata er oppdiktet (example.com, user-agent med merket `Oppdiktet/9.9`).
 * Støtter hovedmål: de ansatte (token, IP og user-agent når aldri klienten).
 */

const BASE_URL = getEnv().BETTER_AUTH_URL;
const MARK = "Oppdiktet/9.9";
const UA = `Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0 ${MARK}`;

beforeEach(resetDatabase);

function request(route: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { origin: BASE_URL, "user-agent": UA };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.cookie) headers.cookie = init.cookie;
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${route}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

async function logIn(email: string) {
  await request("/email-otp/send-verification-otp", {
    method: "POST",
    body: { email, type: "sign-in" },
  });
  const mail = readDevMailbox().find((entry) => entry.to.toLowerCase() === email);
  const otp = /: (\d{6})$/.exec(mail?.subject ?? "")?.[1];
  if (!otp) throw new Error("Fant ingen kode i utviklings-postkassen");
  const response = await request("/sign-in/email-otp", { method: "POST", body: { email, otp } });
  expect(response.status).toBe(200);
  const cookie = /(better-auth\.session_token=[^;]+)/.exec(
    response.headers.get("set-cookie") ?? "",
  )?.[1];
  if (!cookie) throw new Error("Fikk ingen økt-cookie");
  return cookie;
}

async function person(roles: ("admin" | "inspector")[] = ["inspector"]) {
  const org = await createOrganization();
  const email = `person-${randomUUID()}@example.com`;
  const user = await createUser({ email, name: "Oppdiktet Person" });
  const employee = await createEmployee(user, org.id, roles);
  return { org, user, employee, email };
}

async function userSessions(userId: string) {
  return db.select().from(sessions).where(eq(sessions.userId, userId));
}

describe("7.2 Better Auths økt-stier over HTTP", () => {
  it("de fire stiene gir 404 med gyldig cookie, øktene står, og svaret har ingen persondata", async () => {
    const { user, email } = await person();
    const first = await logIn(email);
    await logIn(email);
    const before = await userSessions(user.id);
    expect(before).toHaveLength(2);
    const token = before[0]?.token ?? "";

    const responses = [
      await request("/list-sessions", { cookie: first }),
      await request("/revoke-session", { method: "POST", cookie: first, body: { token } }),
      await request("/revoke-sessions", { method: "POST", cookie: first, body: {} }),
      await request("/revoke-other-sessions", { method: "POST", cookie: first, body: {} }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(404);
      const text = await response.text();
      for (const row of before) expect(text).not.toContain(row.token);
      expect(text).not.toContain(MARK);
      expect(text).not.toMatch(/127\.0\.0\.1|::1|192\.0\.2/);
    }
    expect((await userSessions(user.id)).map((s) => s.id).sort()).toEqual(
      before.map((s) => s.id).sort(),
    );
  });

  it("/get-session og /sign-out virker fortsatt", async () => {
    const { user, email } = await person();
    const cookie = await logIn(email);
    const session = await request("/get-session", { cookie });
    expect(session.status).toBe(200);
    expect(((await session.json()) as { user?: { id?: string } }).user?.id).toBe(user.id);
    const signOut = await request("/sign-out", { method: "POST", cookie, body: {} });
    expect(signOut.status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });
});

describe("4.4.2 «Logg ut av alle enheter» gjør økten ugyldig med en gang", () => {
  it("getSession med samme cookie gir ingen økt etter revokeAllEmployeeSessions", async () => {
    const { org, employee, email } = await person();
    const admin = await createUser();
    await createEmployee(admin, org.id, ["admin"]);
    const cookie = await logIn(email);
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();

    expect(
      await revokeAllEmployeeSessions(admin, org.id, employee.id, { reason: "manual" }),
    ).toEqual({ ok: true, count: 1 });
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
  });

  it("admin som logger ut seg selv, kan logge inn igjen", async () => {
    const { org, user, employee, email } = await person(["admin"]);
    const cookie = await logIn(email);
    expect(
      await revokeAllEmployeeSessions(user, org.id, employee.id, {
        reason: "manual",
        confirmSelf: true,
      }),
    ).toEqual({ ok: true, count: 1 });
    expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    const again = await logIn(email);
    expect((await auth.api.getSession({ headers: new Headers({ cookie: again }) }))?.user.id).toBe(
      user.id,
    );
  });
});
