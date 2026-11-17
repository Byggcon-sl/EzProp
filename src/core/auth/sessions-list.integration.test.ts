import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { db } from "@/db/client";
import { getEnv } from "@/shared/config/env";
import { logger } from "@/shared/lib/logger";
import {
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
  allSessionIds,
  clearDevMailbox,
  createSession,
  FAKE_UA,
  SESSION_IP,
  SESSION_UA_MARK,
  sessionExists,
  sessionForCookie,
  sessionIdsOf,
  signInThroughAuth,
  withSession,
} from "../../../tests/sessions";
import { listOwnSessions, revokeOtherOwnSessions, revokeOwnSession } from "./sessions-list";

/*
 * Kjernen for egne økter i «Mine innlogginger» (docs/funksjoner/fase2a-mine-innlogginger.md
 * Omfang 1, «Avklart før bygging» 1, 2, 6 og 7; testplan avsnitt 4). Mot testdatabasen.
 *
 * Oppsett: organisasjon A med takstmann T (økter s1 = nåværende og s2), kontor K, leder L og admin
 * AD; organisasjon B med takstmann TB. Økter settes rett inn med oppdiktet user-agent og IP
 * 192.0.2.10. Avsnitt 4.4 logger inn på ekte gjennom Better Auth med kode fra
 * utviklings-postkassen.
 *
 * Støtter hovedmål: de ansatte (den ansatte ser og stenger egne enheter, og kan aldri se eller
 * stenge en annens) og KI i bunnen (token, IP og rå user-agent forlater aldri serveren).
 */

type OwnRow = Awaited<ReturnType<typeof listOwnSessions>>[number];

const DAY = 86_400_000;

async function setup() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const t = await createUser({ name: "Tora Takstmann", email: "tora.takst@example.com" });
  const k = await createUser({ name: "Kai Kontor", email: "kai.kontor@example.com" });
  const l = await createUser({ name: "Lise Leder", email: "lise.leder@example.com" });
  const ad = await createUser({ name: "Ada Admin", email: "ada.admin@example.com" });
  const tb = await createUser({ name: "Tor B", email: "tor.b@example.com" });
  await createEmployee(t, orgA.id, ["inspector"]);
  await createEmployee(k, orgA.id, ["office"]);
  await createEmployee(l, orgA.id, ["manager"]);
  await createEmployee(ad, orgA.id, ["admin"]);
  await createEmployee(tb, orgB.id, ["inspector"]);

  const now = Date.now();
  const s1 = await createSession(t.id, {
    userAgent: FAKE_UA.iPadSafari,
    createdAt: new Date(now - 10 * DAY),
    updatedAt: new Date(now - 5 * DAY),
  });
  const s2 = await createSession(t.id, {
    userAgent: FAKE_UA.windowsEdge,
    createdAt: new Date(now - 3 * DAY),
    updatedAt: new Date(now - 1 * DAY),
  });
  const ks = await createSession(k.id);
  const ads = await createSession(ad.id);
  const tbs = await createSession(tb.id);
  return { orgA, orgB, t, k, l, ad, tb, s1, s2, ks, ads, tbs, actor: withSession(t, s1.id) };
}

/** Svaret er `{ ok: false, reason }` (avklart punkt 6). */
function expectNotFound(result: unknown) {
  expect(result).toEqual({ ok: false, reason: "not_found" });
}

/** Spion på alle databasekall som kan nå `sessions`. */
function spyOnDb() {
  const names = ["select", "delete", "update", "insert", "execute", "transaction"] as const;
  return names.map((name) => vi.spyOn(db, name as never));
}

function loggerSpies() {
  return (["debug", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(logger, level).mockImplementation(() => {}),
  );
}

async function auditCount(): Promise<number> {
  // Hele tabellen: egen utlogging skal ikke skrive i revisjonsloggen
  const rows = await db.execute<{ count: number }>(sql`select count(*)::int as count from audit_log`);
  return Array.from(rows)[0]?.count ?? 0;
}

beforeAll(() => {
  expect(getEnv().DEV_MAILBOX).toBe(true);
});

beforeEach(async () => {
  await resetDatabase();
  clearDevMailbox();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("4.1 listOwnSessions", () => {
  it("1. bare egne økter", async () => {
    const { actor, s1, s2 } = await setup();
    const rows = await listOwnSessions(actor);
    expect(rows.map((row) => row.id).sort()).toEqual([s1.id, s2.id].sort());
  });

  it("2. utløpte vises ikke, økt som går ut om ett sekund vises", async () => {
    const { actor, t, s1, s2 } = await setup();
    const expired = await createSession(t.id, { expiresAt: new Date(Date.now() - 1_000) });
    const almost = await createSession(t.id, { expiresAt: new Date(Date.now() + 5_000) });
    const ids = (await listOwnSessions(actor)).map((row) => row.id);
    expect(ids).not.toContain(expired.id);
    expect(ids.sort()).toEqual([s1.id, s2.id, almost.id].sort());
  });

  it("3. «denne enheten» først, så etter updated_at synkende", async () => {
    const { actor, t, s1, s2 } = await setup();
    const now = Date.now();
    const newest = await createSession(t.id, { updatedAt: new Date(now - 60_000) });
    const oldest = await createSession(t.id, { updatedAt: new Date(now - 20 * DAY) });
    const ids = (await listOwnSessions(actor)).map((row) => row.id);
    // s1 er nåværende, selv om den ikke er sist brukt; s2 (1 dag) før oldest (20 dager)
    expect(ids).toEqual([s1.id, newest.id, s2.id, oldest.id]);
  });

  it("4. isCurrent bare på s1", async () => {
    const { actor, s1 } = await setup();
    const rows = await listOwnSessions(actor);
    expect(rows.filter((row) => row.isCurrent).map((row) => row.id)).toEqual([s1.id]);
  });

  it("4. uten sessionId på aktøren er ingen rad isCurrent", async () => {
    const { t } = await setup();
    const rows = await listOwnSessions(t);
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.isCurrent)).toBe(false);
  });

  it("5. hvitliste: nøyaktig id, device, browser, lastUsed, createdAt, isCurrent", async () => {
    const { actor } = await setup();
    const rows = await listOwnSessions(actor);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["browser", "createdAt", "device", "id", "isCurrent", "lastUsed"].sort(),
      );
    }
  });

  it("5. enhet og nettleser er tolket på serveren", async () => {
    const { actor, s1, s2 } = await setup();
    const rows = await listOwnSessions(actor);
    const byId = new Map<string, OwnRow>(rows.map((row) => [row.id, row]));
    expect(byId.get(s1.id)).toMatchObject({ device: "iPad", browser: "Safari" });
    expect(byId.get(s2.id)).toMatchObject({ device: "Windows-PC", browser: "Edge" });
    expect(new Date(byId.get(s2.id)!.lastUsed).getTime()).toBe(s2.updatedAt.getTime());
    expect(new Date(byId.get(s2.id)!.createdAt).getTime()).toBe(s2.createdAt.getTime());
  });

  it("6. svaret har verken token, IP eller rå user-agent", async () => {
    const { actor, s1, s2 } = await setup();
    const json = JSON.stringify(await listOwnSessions(actor));
    for (const secret of [s1.token, s2.token, SESSION_IP, SESSION_UA_MARK, "Mozilla/5.0"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("7. merket kan ikke flyttes: funksjonen tar ingen økt-id inn", async () => {
    const { actor, s1, s2 } = await setup();
    expect(listOwnSessions.length).toBe(1);
    // Et ekstra argument (som fra et skjema) ignoreres
    const call = listOwnSessions as unknown as (actor: Actor, extra: string) => Promise<OwnRow[]>;
    const rows = await call(actor, s2.id);
    expect(rows.find((row) => row.isCurrent)?.id).toBe(s1.id);
  });

  it("8. bruker uten økter gir tom liste", async () => {
    const { l } = await setup();
    expect(await listOwnSessions(withSession(l, "finnes-ikke"))).toEqual([]);
  });
});

describe("4.2 revokeOwnSession", () => {
  it("1. egen annen økt slettes, nåværende står", async () => {
    const { actor, s1, s2 } = await setup();
    const result = await revokeOwnSession(actor, s2.id);
    expect(result).toEqual({ ok: true, count: 1 });
    expect(await sessionExists(s2.id)).toBe(false);
    expect(await sessionExists(s1.id)).toBe(true);
  });

  it("2. en annens økt-id gir «finnes ikke», og raden står", async () => {
    const { actor, ks, tbs, ads } = await setup();
    for (const foreign of [ks, tbs, ads]) {
      expectNotFound(await revokeOwnSession(actor, foreign.id));
      expect(await sessionExists(foreign.id)).toBe(true);
    }
  });

  it("3. ukjent id og utløpt egen økt gir samme svar som en annens", async () => {
    const { actor, t, ks } = await setup();
    const expired = await createSession(t.id, { expiresAt: new Date(Date.now() - 1_000) });
    const foreign = await revokeOwnSession(actor, ks.id);
    const unknown = await revokeOwnSession(actor, "00000000-0000-4000-8000-000000000000");
    const old = await revokeOwnSession(actor, expired.id);
    expect(unknown).toEqual(foreign);
    expect(old).toEqual(foreign);
    expectNotFound(old);
  });

  it("4. allerede utlogget: andre kall gir «finnes ikke», ingen krasj", async () => {
    const { actor, s2 } = await setup();
    expect(await revokeOwnSession(actor, s2.id)).toEqual({ ok: true, count: 1 });
    expectNotFound(await revokeOwnSession(actor, s2.id));
  });

  it.each([
    ["tom tekst", ""],
    ["1 000 tegn", "a".repeat(1_000)],
    ["null", null],
    ["tall", 42],
    ["objekt", { id: "x" }],
  ])("5. %s avvises før spørringen", async (_name, bad) => {
    const { actor } = await setup();
    const before = await allSessionIds();
    const spies = spyOnDb();
    let result: unknown;
    try {
      result = await revokeOwnSession(actor, bad as never);
    } catch (error) {
      result = error;
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // Enten en valideringsfeil eller et svar som ikke er ok; aldri «ok»
    expect((result as { ok?: boolean } | undefined)?.ok).not.toBe(true);
    vi.restoreAllMocks();
    expect(await allSessionIds()).toEqual(before);
  });

  it("6. SQL-tekst som id gir «finnes ikke», ingen rader slettes", async () => {
    const { actor } = await setup();
    const before = await allSessionIds();
    expectNotFound(await revokeOwnSession(actor, "' or 1=1 --"));
    expectNotFound(await revokeOwnSession(actor, "%"));
    expect(await allSessionIds()).toEqual(before);
  });

  it("7. egen nåværende økt avvises med current_session og står (avklart punkt 1)", async () => {
    const { actor, s1 } = await setup();
    expect(await revokeOwnSession(actor, s1.id)).toEqual({
      ok: false,
      reason: "current_session",
    });
    expect(await sessionExists(s1.id)).toBe(true);
  });
});

describe("4.3 revokeOtherOwnSessions", () => {
  it("1. alle andre slettes, nåværende står", async () => {
    const { actor, t, s1 } = await setup();
    await createSession(t.id, { userAgent: FAKE_UA.macChrome });
    const result = await revokeOtherOwnSessions(actor);
    expect(result).toMatchObject({ count: 2 });
    expect(await sessionIdsOf(t.id)).toEqual([s1.id]);
  });

  it("2. ingen andre: count 0 og ingen feil", async () => {
    const { actor, s2 } = await setup();
    await revokeOwnSession(actor, s2.id);
    expect(await revokeOtherOwnSessions(actor)).toMatchObject({ count: 0 });
  });

  it("3. andres økter står", async () => {
    const { actor, ks, tbs, ads } = await setup();
    await revokeOtherOwnSessions(actor);
    for (const other of [ks, tbs, ads]) expect(await sessionExists(other.id)).toBe(true);
  });

  it("4. utløpte egne økter telles ikke og står til ryddingen (avklart punkt 2)", async () => {
    const { actor, t, s1 } = await setup();
    const expired = await createSession(t.id, { expiresAt: new Date(Date.now() - 1_000) });
    const result = await revokeOtherOwnSessions(actor);
    expect(result).toMatchObject({ count: 1 });
    expect(await sessionIdsOf(t.id)).toEqual([s1.id, expired.id].sort());
  });

  it("uten sessionId på aktøren slettes ingenting (nåværende kan ikke avgjøres)", async () => {
    const { t } = await setup();
    const before = await sessionIdsOf(t.id);
    let result: unknown;
    try {
      result = await revokeOtherOwnSessions(t);
    } catch (error) {
      result = error;
    }
    expect((result as { count?: number }).count ?? 0).toBe(0);
    expect(await sessionIdsOf(t.id)).toEqual(before);
  });
});

describe("4.4 tilbakekalling virker med en gang gjennom Better Auth", () => {
  async function inspectorWithTwoLogins() {
    const org = await createOrganization("Organisasjon A");
    const t = await createUser({ name: "Tora Takstmann", email: "tora.takst@example.com" });
    await createEmployee(t, org.id, ["inspector"]);
    const first = await signInThroughAuth(t.email, FAKE_UA.iPadSafari);
    const second = await signInThroughAuth(t.email, FAKE_UA.windowsEdge);
    expect(first.sessionId).not.toBe(second.sessionId);
    return { t, first, second, actor: withSession(t, first.sessionId) };
  }

  it("1. getSession med kapselen gir null etter revokeOwnSession", async () => {
    const { actor, first, second } = await inspectorWithTwoLogins();
    expect(await sessionForCookie(second.cookie)).not.toBeNull();
    expect(await revokeOwnSession(actor, second.sessionId)).toEqual({ ok: true, count: 1 });
    expect(await sessionForCookie(second.cookie)).toBeNull();
    // 3. nåværende lever
    expect((await sessionForCookie(first.cookie))?.user.id).toBe(actor.id);
  });

  it("2 og 3. revokeOtherOwnSessions: de andre er ugyldige, nåværende lever", async () => {
    const { actor, t, first, second } = await inspectorWithTwoLogins();
    const third = await signInThroughAuth(t.email, FAKE_UA.macChrome);
    expect(await revokeOtherOwnSessions(actor)).toMatchObject({ count: 2 });
    expect(await sessionForCookie(second.cookie)).toBeNull();
    expect(await sessionForCookie(third.cookie)).toBeNull();
    expect((await sessionForCookie(first.cookie))?.user.id).toBe(t.id);
  });

  it("listen fra ekte innlogging har riktig enhet og «denne enheten»", async () => {
    const { actor, first, second } = await inspectorWithTwoLogins();
    const rows = await listOwnSessions(actor);
    expect(rows.map((row) => row.id)).toEqual([first.sessionId, second.sessionId]);
    expect(rows[0]).toMatchObject({ isCurrent: true, device: "iPad", browser: "Safari" });
    expect(rows[1]).toMatchObject({ isCurrent: false, device: "Windows-PC", browser: "Edge" });
    const json = JSON.stringify(rows);
    expect(json).not.toContain(first.token);
    expect(json).not.toContain(second.token);
    expect(json).not.toContain(SESSION_UA_MARK);
  });
});

describe("4.5 driftsloggen for egen utlogging", () => {
  function logged(spies: ReturnType<typeof loggerSpies>): string {
    return JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
  }

  it("1 og 2. én linje for revokeOwnSession, uten persondata", async () => {
    const { actor, t, s1, s2 } = await setup();
    const spies = loggerSpies();
    await revokeOwnSession(actor, s2.id);
    const calls = spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    expect(calls).toBe(1);
    const text = logged(spies);
    for (const secret of [t.id, t.email, t.name, s1.id, s2.id, s2.token, SESSION_IP, SESSION_UA_MARK]) {
      expect(text).not.toContain(secret);
    }
  });

  it("1 og 2. én linje for revokeOtherOwnSessions med antall, uten persondata", async () => {
    const { actor, t, s1, s2 } = await setup();
    const spies = loggerSpies();
    await revokeOtherOwnSessions(actor);
    const calls = spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    expect(calls).toBe(1);
    const text = logged(spies);
    expect(text).toMatch(/1/);
    for (const secret of [t.id, t.email, t.name, s1.id, s2.id, s2.token, SESSION_IP, SESSION_UA_MARK]) {
      expect(text).not.toContain(secret);
    }
  });

  it("3. ingen revisjonsrad for egen utlogging", async () => {
    const { actor, s2 } = await setup();
    const before = await auditCount();
    await revokeOwnSession(actor, s2.id);
    await revokeOtherOwnSessions(actor);
    expect(await auditCount()).toBe(before);
  });
});
