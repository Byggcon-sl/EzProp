import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { readDevMailbox } from "@/core/email";
import { db } from "@/db/client";
import { sessions } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { auth } from "./auth";
import { listOwnSessions, revokeOtherOwnSessions, revokeOwnSession } from "./sessions-list";

/*
 * Kjernen for egne økter (docs/funksjoner/fase2a-mine-innlogginger-testplan.md avsnitt 4).
 * Økter legges direkte i `sessions` med oppdiktet user-agent (merket `Oppdiktet/9.9`) og
 * dokumentasjons-IP 192.0.2.10. Avsnitt 4.4 logger inn gjennom Better Auth med koden fra
 * utviklings-postkassen. Testdata er oppdiktet (example.com).
 * Støtter hovedmål: de ansatte (ser og stenger egne enheter, og ingen andre kan gjøre det).
 */

const MARK = "Oppdiktet/9.9";
const IP = "192.0.2.10";
const UA_IPAD = `Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Version/18.0 Safari/604.1 ${MARK}`;
const UA_WINDOWS_EDGE = `Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0 ${MARK}`;
const HOUR = 60 * 60 * 1000;

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

async function insertSession(
  userId: string,
  overrides: Partial<typeof sessions.$inferInsert> = {},
) {
  const [row] = await db
    .insert(sessions)
    .values({
      id: randomUUID(),
      token: `token-${randomUUID()}`,
      userId,
      userAgent: UA_IPAD,
      ipAddress: IP,
      expiresAt: new Date(Date.now() + 24 * HOUR),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("kunne ikke lage økt");
  return row;
}

async function sessionIds(userId: string) {
  const rows = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  return rows.map((row) => row.id).sort();
}

/** Organisasjon A med takstmann T (økter s1 = nåværende og s2), kontor K; B med takstmann TB. */
async function setup() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const t = await createUser({ name: "Tore Takst" });
  const k = await createUser({ name: "Kari Kontor" });
  const tb = await createUser({ name: "Tina Annen" });
  await createEmployee(t, orgA.id, ["inspector"]);
  await createEmployee(k, orgA.id, ["office"]);
  await createEmployee(tb, orgB.id, ["inspector"]);
  const s1 = await insertSession(t.id, { updatedAt: new Date(Date.now() - 5 * HOUR) });
  const s2 = await insertSession(t.id, {
    userAgent: UA_WINDOWS_EDGE,
    updatedAt: new Date(Date.now() - HOUR),
  });
  const ks = await insertSession(k.id);
  const tbs = await insertSession(tb.id);
  const actorT: Actor = { ...t, sessionId: s1.id };
  return { orgA, orgB, t, k, tb, s1, s2, ks, tbs, actorT };
}

describe("4.1 listOwnSessions", () => {
  it("1 og 4. bare egne økter, isCurrent bare på s1", async () => {
    const { actorT, s1, s2 } = await setup();
    const rows = await listOwnSessions(actorT);
    expect(rows.map((r) => r.id).sort()).toEqual([s1.id, s2.id].sort());
    expect(rows.filter((r) => r.isCurrent).map((r) => r.id)).toEqual([s1.id]);
  });

  it("2. utløpte vises ikke", async () => {
    const { actorT, t } = await setup();
    const expired = await insertSession(t.id, { expiresAt: new Date(Date.now() - 1000) });
    const soon = await insertSession(t.id, { expiresAt: new Date(Date.now() + 5000) });
    const ids = (await listOwnSessions(actorT)).map((r) => r.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).toContain(soon.id);
  });

  it("3. denne enheten først, så sist brukt først", async () => {
    const { actorT, t, s1, s2 } = await setup();
    const s3 = await insertSession(t.id, { updatedAt: new Date(Date.now() - 3 * HOUR) });
    const rows = await listOwnSessions(actorT);
    // s1 er eldst, men er denne enheten
    expect(rows.map((r) => r.id)).toEqual([s1.id, s2.id, s3.id]);
  });

  it("5 og 6. nøyaktig de avtalte feltene, uten token, IP og rå user-agent", async () => {
    const { actorT, s1, s2 } = await setup();
    const rows = await listOwnSessions(actorT);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["browser", "createdAt", "device", "id", "isCurrent", "lastUsed"].sort(),
      );
    }
    const json = JSON.stringify(rows);
    expect(json).not.toContain(s1.token);
    expect(json).not.toContain(s2.token);
    expect(json).not.toContain(IP);
    expect(json).not.toContain(MARK);
    expect(rows.find((r) => r.id === s2.id)).toMatchObject({
      device: "Windows-PC",
      browser: "Edge",
    });
  });

  it("7. merket følger bare actor.sessionId (ingen parameter for økt-id)", async () => {
    const { t, s1, s2 } = await setup();
    expect(listOwnSessions.length).toBe(1);
    const rows = await listOwnSessions({ ...t, sessionId: s1.id });
    expect(rows.find((r) => r.id === s2.id)?.isCurrent).toBe(false);
    const withoutSession = await listOwnSessions(t);
    expect(withoutSession.some((r) => r.isCurrent)).toBe(false);
  });

  it("8. bruker uten økter gir tom liste", async () => {
    const lonely = await createUser();
    expect(await listOwnSessions(lonely)).toEqual([]);
  });
});

describe("4.2 revokeOwnSession", () => {
  it("1. egen annen økt slettes, nåværende står", async () => {
    const { actorT, t, s1, s2 } = await setup();
    expect(await revokeOwnSession(actorT, s2.id)).toEqual({ ok: true, count: 1 });
    expect(await sessionIds(t.id)).toEqual([s1.id]);
  });

  it("2 og 3. annens økt, ukjent id og utløpt økt gir samme «finnes ikke»", async () => {
    const { actorT, t, k, tb, ks, tbs } = await setup();
    const expired = await insertSession(t.id, { expiresAt: new Date(Date.now() - 1000) });
    for (const id of [ks.id, tbs.id, randomUUID(), expired.id]) {
      expect(await revokeOwnSession(actorT, id)).toEqual({ ok: false, reason: "not_found" });
    }
    expect(await sessionIds(k.id)).toEqual([ks.id]);
    expect(await sessionIds(tb.id)).toEqual([tbs.id]);
    expect(await sessionIds(t.id)).toContain(expired.id);
  });

  it("4. allerede utlogget gir «finnes ikke» andre gang", async () => {
    const { actorT, s2 } = await setup();
    expect((await revokeOwnSession(actorT, s2.id)).ok).toBe(true);
    expect(await revokeOwnSession(actorT, s2.id)).toEqual({ ok: false, reason: "not_found" });
  });

  it.each([
    ["tom", ""],
    ["1 000 tegn", "a".repeat(1000)],
    ["null", null],
    ["tall", 42],
    ["objekt", { id: "x" }],
  ])("5. ugyldig id (%s) avvises før spørringen", async (_, value) => {
    const { actorT } = await setup();
    const spy = vi.spyOn(db, "delete");
    await expect(revokeOwnSession(actorT, value)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  it("6. SQL-tekst som id sletter ingenting", async () => {
    const { actorT, t, s1, s2 } = await setup();
    expect(await revokeOwnSession(actorT, "' or 1=1 --")).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await sessionIds(t.id)).toEqual([s1.id, s2.id].sort());
  });

  it("7. nåværende økt avvises (current_session) og står (avklart før bygging nr. 1)", async () => {
    const { actorT, t, s1, s2 } = await setup();
    expect(await revokeOwnSession(actorT, s1.id)).toEqual({
      ok: false,
      reason: "current_session",
    });
    expect(await sessionIds(t.id)).toEqual([s1.id, s2.id].sort());
  });
});

describe("4.3 revokeOtherOwnSessions", () => {
  it("1. alle andre slettes, nåværende står", async () => {
    const { actorT, t, s1 } = await setup();
    await insertSession(t.id);
    expect(await revokeOtherOwnSessions(actorT)).toEqual({ ok: true, count: 2 });
    expect(await sessionIds(t.id)).toEqual([s1.id]);
  });

  it("2. ingen andre gir 0", async () => {
    const { actorT } = await setup();
    await revokeOtherOwnSessions(actorT);
    expect(await revokeOtherOwnSessions(actorT)).toEqual({ ok: true, count: 0 });
  });

  it("3. andres økter står", async () => {
    const { actorT, k, tb, ks, tbs } = await setup();
    await revokeOtherOwnSessions(actorT);
    expect(await sessionIds(k.id)).toEqual([ks.id]);
    expect(await sessionIds(tb.id)).toEqual([tbs.id]);
  });

  it("4. utløpte egne økter telles ikke og står til ryddingen (avklart nr. 2)", async () => {
    const { actorT, t } = await setup();
    const expired = await insertSession(t.id, { expiresAt: new Date(Date.now() - 1000) });
    expect(await revokeOtherOwnSessions(actorT)).toEqual({ ok: true, count: 1 });
    expect(await sessionIds(t.id)).toContain(expired.id);
  });
});

describe("4.5 driftsloggen for egen utlogging", () => {
  it("én linje per handling, uten persondata, og ingen revisjonsrad", async () => {
    const { actorT, orgA, t, s1, s2 } = await setup();
    const third = await insertSession(t.id);
    const lines: unknown[] = [];
    vi.spyOn(logger, "info").mockImplementation((...args: unknown[]) => {
      lines.push(args);
    });

    await revokeOwnSession(actorT, s2.id);
    await revokeOtherOwnSessions(actorT);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([
      "Egen utlogging av enheter",
      { action: "revoke_own_session", count: 1 },
    ]);
    expect(lines[1]).toEqual([
      "Egen utlogging av enheter",
      { action: "revoke_other_own_sessions", count: 1 },
    ]);
    const json = JSON.stringify(lines);
    for (const secret of [t.id, t.email, s1.id, s2.id, third.id, s1.token, IP, MARK]) {
      expect(json).not.toContain(secret);
    }
    expect(await auditRows(orgA.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4.4 Tilbakekalling virker med en gang, gjennom Better Auth
// ---------------------------------------------------------------------------------------------

const BASE_URL = getEnv().BETTER_AUTH_URL;

async function post(route: string, body: unknown): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${route}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, "user-agent": UA_IPAD },
      body: JSON.stringify(body),
    }),
  );
}

/** Logger inn med koden fra utviklings-postkassen og gir cookien og økt-id-en. */
async function logIn(email: string) {
  await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
  const mail = readDevMailbox().find((entry) => entry.to.toLowerCase() === email);
  const otp = /: (\d{6})$/.exec(mail?.subject ?? "")?.[1];
  if (!otp) throw new Error("Fant ingen kode i utviklings-postkassen");
  const response = await post("/sign-in/email-otp", { email, otp });
  expect(response.status).toBe(200);
  const cookie = /(better-auth\.session_token=[^;]+)/.exec(
    response.headers.get("set-cookie") ?? "",
  )?.[1];
  if (!cookie) throw new Error("Fikk ingen økt-cookie");
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("Fikk ingen økt");
  return { cookie, sessionId: session.session.id };
}

async function sessionFor(cookie: string) {
  return auth.api.getSession({ headers: new Headers({ cookie }) });
}

describe("4.4 tilbakekalling virker med en gang", () => {
  async function loggedInTwice() {
    const org = await createOrganization();
    const email = `tore-${randomUUID()}@example.com`;
    const user = await createUser({ email, name: "Tore Takst" });
    await createEmployee(user, org.id, ["inspector"]);
    const first = await logIn(email);
    const second = await logIn(email);
    return { user, first, second, actor: { ...user, sessionId: first.sessionId } };
  }

  it("1. getSession etter revokeOwnSession gir ingen økt", async () => {
    const { first, second, actor } = await loggedInTwice();
    expect(await sessionFor(second.cookie)).not.toBeNull();
    expect(await revokeOwnSession(actor, second.sessionId)).toEqual({ ok: true, count: 1 });
    expect(await sessionFor(second.cookie)).toBeNull();
    expect((await sessionFor(first.cookie))?.user.id).toBe(actor.id);
  });

  it("2 og 3. etter revokeOtherOwnSessions: den andre er ute, nåværende lever", async () => {
    const { first, second, actor } = await loggedInTwice();
    expect(await revokeOtherOwnSessions(actor)).toEqual({ ok: true, count: 1 });
    expect(await sessionFor(second.cookie)).toBeNull();
    expect((await sessionFor(first.cookie))?.user.id).toBe(actor.id);
  });
});
