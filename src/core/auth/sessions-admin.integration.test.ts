import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { listAuditEvents } from "@/core/audit";
import { db } from "@/db/client";
import { auditLog, employees } from "@/db/schema";
import { getEnv } from "@/shared/config/env";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import {
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
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { listEmployeeSessions, revokeAllEmployeeSessions } from "./sessions-list";

/*
 * Admin-delen av «Mine innlogginger» (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 1, 6 og
 * 8, «Avklart før bygging» 6; testplan avsnitt 5). Mot testdatabasen.
 *
 * Oppsett: organisasjon A med takstmann T (to økter), kontor K, leder L og admin AD; organisasjon
 * B med takstmann TB og admin ADB. Økter settes rett inn med oppdiktet user-agent og IP
 * 192.0.2.10. Revisjonsloggen kan feile på kommando (spion rundt `recordAuditEvent`) for å vise at
 * sletting og revisjonsrad skjer i samme transaksjon.
 *
 * Støtter hovedmål: de ansatte (admin stenger alle enheter for en som slutter eller mister iPaden
 * med én handling, og stenger aldri seg selv ute ved et uhell) og KI i bunnen (revisjonsraden og
 * admin-listen har ingen persondata).
 */

const mocks = vi.hoisted(() => ({ failAudit: false }));

vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return {
    ...actual,
    recordAuditEvent: vi.fn(async (...args: Parameters<typeof actual.recordAuditEvent>) => {
      if (mocks.failAudit) throw new Error("Oppdiktet feil i revisjonsloggen");
      return actual.recordAuditEvent(...args);
    }),
  };
});

const ACTION = /^(employee\.)?sessions_revoked_all$/;

type AdminList = { rows: Record<string, unknown>[]; count: number; raw: unknown };

/**
 * Leser admin-listen uansett om den er en liste eller `{ ok, sessions|rows, count }`. «Finnes
 * ikke» er `{ ok: false, reason: "not_found" }` (avklart punkt 6).
 */
function adminList(result: unknown): AdminList | "not_found" {
  if (Array.isArray(result)) return { rows: result, count: result.length, raw: result };
  const value = result as {
    ok?: boolean;
    reason?: string;
    sessions?: Record<string, unknown>[];
    rows?: Record<string, unknown>[];
    count?: number;
  };
  if (value?.ok === false) {
    expect(value).toEqual({ ok: false, reason: "not_found" });
    return "not_found";
  }
  const rows = value.sessions ?? value.rows;
  if (!Array.isArray(rows)) throw new Error("Admin-listen har verken liste, sessions eller rows");
  return { rows, count: value.count ?? rows.length, raw: result };
}

async function list(actor: Actor, organizationId: string, employeeId: string) {
  return adminList(await listEmployeeSessions(actor, organizationId, employeeId));
}

async function setup() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const t = await createUser({ name: "Tora Takstmann", email: "tora.takst@example.com" });
  const k = await createUser({ name: "Kai Kontor", email: "kai.kontor@example.com" });
  const l = await createUser({ name: "Lise Leder", email: "lise.leder@example.com" });
  const ad = await createUser({ name: "Ada Admin", email: "ada.admin@example.com" });
  const tb = await createUser({ name: "Tor B", email: "tor.b@example.com" });
  const adb = await createUser({ name: "Bent Admin", email: "bent.admin@example.com" });
  const te = await createEmployee(t, orgA.id, ["inspector"]);
  const ke = await createEmployee(k, orgA.id, ["office"]);
  const le = await createEmployee(l, orgA.id, ["manager"]);
  const ade = await createEmployee(ad, orgA.id, ["admin"]);
  const tbe = await createEmployee(tb, orgB.id, ["inspector"]);
  await createEmployee(adb, orgB.id, ["admin"]);
  const ts1 = await createSession(t.id, { userAgent: FAKE_UA.iPadSafari });
  const ts2 = await createSession(t.id, { userAgent: FAKE_UA.windowsEdge });
  const ads1 = await createSession(ad.id, { userAgent: FAKE_UA.macChrome });
  const tbs = await createSession(tb.id);
  return {
    orgA,
    orgB,
    t,
    k,
    l,
    ad: withSession(ad, ads1.id),
    tb,
    adb,
    te,
    ke,
    le,
    ade,
    tbe,
    ts1,
    ts2,
    ads1,
    tbs,
  };
}

async function sessionAudit(organizationId: string) {
  return (await auditRows(organizationId)).filter((row) => ACTION.test(row.action));
}

async function snapshot() {
  const tables = ["employees", "employee_roles", "users", "accounts"] as const;
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    const rows = await db.execute(sql`select * from ${sql.identifier(table)} order by id`);
    result[table] = Array.from(rows);
  }
  return result;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
}

beforeAll(() => {
  expect(getEnv().DEV_MAILBOX).toBe(true);
});

beforeEach(async () => {
  mocks.failAudit = false;
  await resetDatabase();
  clearDevMailbox();
});

afterEach(() => {
  mocks.failAudit = false;
  vi.clearAllMocks();
});

describe("5.1 tilgang per rolle", () => {
  it("1. admin lister T og logger ut alle Ts økter", async () => {
    const { orgA, ad, te, t } = await setup();
    const listed = await list(ad, orgA.id, te.id);
    expect(listed).not.toBe("not_found");
    expect((listed as AdminList).count).toBe(2);
    const result = await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" });
    expect(result).toEqual({ ok: true, count: 2 });
    expect(await sessionIdsOf(t.id)).toEqual([]);
  });

  it.each(["k", "l", "t"] as const)(
    "2. %s (kontor, leder, takstmann) får AccessDeniedError på liste og utlogging",
    async (who) => {
      const ctx = await setup();
      const actor = ctx[who];
      const ownEmployee = { k: ctx.ke, l: ctx.le, t: ctx.te }[who];
      for (const employeeId of [ctx.te.id, ownEmployee.id]) {
        await expect(listEmployeeSessions(actor, ctx.orgA.id, employeeId)).rejects.toBeInstanceOf(
          AccessDeniedError,
        );
        await expect(
          revokeAllEmployeeSessions(actor, ctx.orgA.id, employeeId, { reason: "manual" }),
        ).rejects.toBeInstanceOf(AccessDeniedError);
      }
      expect(await sessionIdsOf(ctx.t.id)).toEqual([ctx.ts1.id, ctx.ts2.id].sort());
      expect(await sessionAudit(ctx.orgA.id)).toEqual([]);
    },
  );

  it("3. bruker uten ansattforhold får AccessDeniedError", async () => {
    const { orgA, te, t } = await setup();
    const stranger = await createUser({ name: "Ola Utenfor", email: "ola.utenfor@example.com" });
    await expect(listEmployeeSessions(stranger, orgA.id, te.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(
      revokeAllEmployeeSessions(stranger, orgA.id, te.id, { reason: "manual" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await sessionIdsOf(t.id)).toHaveLength(2);
  });

  it("3. deaktivert admin får AccessDeniedError", async () => {
    const { orgA, te, t } = await setup();
    const former = await createUser({ name: "Frida Fratrådt", email: "frida.f@example.com" });
    const formerEmployee = await createEmployee(former, orgA.id, ["admin"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, formerEmployee.id));
    await expect(listEmployeeSessions(former, orgA.id, te.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    await expect(
      revokeAllEmployeeSessions(former, orgA.id, te.id, { reason: "manual" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await sessionIdsOf(t.id)).toHaveLength(2);
  });

  it("4. leder er bevisst utelatt (A423)", async () => {
    const { orgA, l, te } = await setup();
    const listed = await rejection(listEmployeeSessions(l, orgA.id, te.id));
    expect(
      listed instanceof AccessDeniedError,
      "A423: bare admin (organization.manage) ser og logger ut andres innlogginger, ikke leder",
    ).toBe(true);
  });
});

describe("5.2 tenant-isolasjon", () => {
  it("1. expectTenantIsolation for listEmployeeSessions", async () => {
    let employeeIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ua = await createUser({ name: "Anne A", email: "anne.a@example.com" });
        const ub = await createUser({ name: "Berit B", email: "berit.b@example.com" });
        const ea = await createEmployee(ua, grantA.organizationId, ["inspector"]);
        const eb = await createEmployee(ub, grantB.organizationId, ["inspector"]);
        await createSession(ua.id);
        await createSession(ub.id);
        employeeIds = [ea.id, eb.id];
        return { a: [ea.id], b: [eb.id] };
      },
      query: async (actor, organizationId) => {
        const found: { employeeId: string }[] = [];
        for (const employeeId of employeeIds) {
          const result = await list(actor, organizationId, employeeId);
          if (result === "not_found") continue;
          for (const _row of result.rows) found.push({ employeeId });
        }
        return found;
      },
      idOf: (row) => row.employeeId,
    });
  });

  it("2. expectTenantIsolation for revokeAllEmployeeSessions", async () => {
    let employeeIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ua = await createUser({ name: "Anne A", email: "anne.a@example.com" });
        const ub = await createUser({ name: "Berit B", email: "berit.b@example.com" });
        const ea = await createEmployee(ua, grantA.organizationId, ["inspector"]);
        const eb = await createEmployee(ub, grantB.organizationId, ["inspector"]);
        await createSession(ua.id);
        await createSession(ub.id);
        employeeIds = [ea.id, eb.id];
        return { a: [ea.id], b: [eb.id] };
      },
      query: async (actor, organizationId) => {
        const done: { employeeId: string }[] = [];
        for (const employeeId of employeeIds) {
          const result = (await revokeAllEmployeeSessions(actor, organizationId, employeeId, {
            reason: "manual",
          })) as { ok: boolean; reason?: string };
          if (result.ok) done.push({ employeeId });
          else expect(result).toEqual({ ok: false, reason: "not_found" });
        }
        return done;
      },
      idOf: (row) => row.employeeId,
    });
  });

  it("3. AD med TBs ansatt-id får «finnes ikke» på liste og utlogging; TBs økter står", async () => {
    const { orgA, ad, tbe, tbs } = await setup();
    expect(await list(ad, orgA.id, tbe.id)).toBe("not_found");
    expect(await revokeAllEmployeeSessions(ad, orgA.id, tbe.id, { reason: "manual" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await sessionExists(tbs.id)).toBe(true);
    expect(await sessionAudit(orgA.id)).toEqual([]);
  });

  it("4. AD med organisasjon B og egen ansatt-id får AccessDeniedError", async () => {
    const { orgB, ad, ade, te, ads1 } = await setup();
    for (const employeeId of [ade.id, te.id]) {
      await expect(listEmployeeSessions(ad, orgB.id, employeeId)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      await expect(
        revokeAllEmployeeSessions(ad, orgB.id, employeeId, { reason: "manual", confirmSelf: true }),
      ).rejects.toBeInstanceOf(AccessDeniedError);
    }
    expect(await sessionExists(ads1.id)).toBe(true);
  });

  it("5. ADB ser ikke Ts økter og ikke revisjonsraden i A", async () => {
    const { orgA, orgB, ad, adb, te } = await setup();
    await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" });
    await expect(listEmployeeSessions(adb, orgA.id, te.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await list(adb, orgB.id, te.id)).toBe("not_found");
    const events = await listAuditEvents(adb, orgB.id);
    expect(events.filter((event) => ACTION.test(event.action))).toEqual([]);
    expect((await listAuditEvents(ad, orgA.id)).some((event) => ACTION.test(event.action))).toBe(
      true,
    );
  });

  it("6. kjent begrensning A426: bruker ansatt i A og B mister øktene mot begge", async () => {
    const { orgA, orgB, ad } = await setup();
    const u = await createUser({ name: "Una Begge", email: "una.begge@example.com" });
    const ue = await createEmployee(u, orgA.id, ["inspector"]);
    await createEmployee(u, orgB.id, ["inspector"]);
    await createSession(u.id);
    await createSession(u.id);
    expect(await revokeAllEmployeeSessions(ad, orgA.id, ue.id, { reason: "manual" })).toEqual({
      ok: true,
      count: 2,
    });
    // Blir denne rød, har økter fått organisasjon: vurder A426 på nytt
    expect(await sessionIdsOf(u.id)).toEqual([]);
  });
});

describe("5.3 ansatte som har sluttet og ansatte uten bruker", () => {
  it("1. deaktivert ansatt med økter kan listes og logges ut", async () => {
    const { orgA, ad, te, t } = await setup();
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, te.id));
    const listed = await list(ad, orgA.id, te.id);
    expect(listed).not.toBe("not_found");
    expect((listed as AdminList).count).toBe(2);
    expect(await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" })).toEqual({
      ok: true,
      count: 2,
    });
    expect(await sessionIdsOf(t.id)).toEqual([]);
  });

  it("2. myk slettet ansatt gir «finnes ikke»", async () => {
    const { orgA, ad, te, t } = await setup();
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, te.id));
    expect(await list(ad, orgA.id, te.id)).toBe("not_found");
    expect(await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await sessionIdsOf(t.id)).toHaveLength(2);
  });

  it("3. user_id = null gir tom liste, count 0 og revisjonsrad med sessionCount 0", async () => {
    const { orgA, ad } = await setup();
    const [noLogin] = await db
      .insert(employees)
      .values({
        organizationId: orgA.id,
        userId: null,
        name: "Tidligere Testansatt",
        deactivatedAt: new Date(),
      })
      .returning();
    const listed = await list(ad, orgA.id, noLogin!.id);
    expect(listed).not.toBe("not_found");
    expect((listed as AdminList).rows).toEqual([]);
    expect((listed as AdminList).count).toBe(0);
    expect(await revokeAllEmployeeSessions(ad, orgA.id, noLogin!.id, { reason: "manual" })).toEqual(
      { ok: true, count: 0 },
    );
    const rows = await sessionAudit(orgA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toEqual({ sessionCount: 0, reason: "manual" });
  });

  it("4. hvitliste for admin-listen: bare device og browser per rad, og antallet", async () => {
    const { orgA, ad, te, ts1, ts2 } = await setup();
    const listed = (await list(ad, orgA.id, te.id)) as AdminList;
    expect(listed.rows).toHaveLength(2);
    for (const row of listed.rows) {
      expect(Object.keys(row).sort()).toEqual(["browser", "device"]);
    }
    expect(listed.rows.map((row) => `${row.device} · ${row.browser}`).sort()).toEqual(
      ["iPad · Safari", "Windows-PC · Edge"].sort(),
    );
    expect(listed.count).toBe(2);
    if (!Array.isArray(listed.raw)) {
      const allowedTop = ["ok", "sessions", "rows", "count"];
      for (const key of Object.keys(listed.raw as object)) expect(allowedTop).toContain(key);
    }
    const json = JSON.stringify(listed.raw);
    for (const secret of [
      ts1.id,
      ts2.id,
      ts1.token,
      ts2.token,
      SESSION_IP,
      SESSION_UA_MARK,
      "lastUsed",
      "createdAt",
      "isCurrent",
    ]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("5.4 admin stenges aldri ute (regel 11)", () => {
  it("1. admin som velger seg selv uten confirmSelf avvises; ingen økter slettet, ingen rad", async () => {
    const { orgA, ad, ade, ads1 } = await setup();
    const extra = await createSession(ad.id);
    expect(await revokeAllEmployeeSessions(ad, orgA.id, ade.id, { reason: "manual" })).toEqual({
      ok: false,
      reason: "confirm_self_required",
    });
    expect(await sessionIdsOf(ad.id)).toEqual([ads1.id, extra.id].sort());
    expect(await sessionAudit(orgA.id)).toEqual([]);
  });

  it.each([
    ["false", false],
    ["tekst «true»", "true"],
    ["1", 1],
  ])("2. confirmSelf %s avvises som manglende bekreftelse", async (_name, value) => {
    const { orgA, ad, ade, ads1 } = await setup();
    const result = await rejection(
      revokeAllEmployeeSessions(ad, orgA.id, ade.id, {
        reason: "manual",
        confirmSelf: value as never,
      }),
    );
    expect((result as { ok?: boolean } | undefined)?.ok).not.toBe(true);
    expect(await sessionExists(ads1.id)).toBe(true);
    expect(await sessionAudit(orgA.id)).toEqual([]);
  });

  it("3. admin med confirmSelf: true logger ut alle egne økter, og revisjonsraden skrives", async () => {
    const { orgA, ad, ade } = await setup();
    await createSession(ad.id);
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, ade.id, { reason: "manual", confirmSelf: true }),
    ).toEqual({ ok: true, count: 2 });
    expect(await sessionIdsOf(ad.id)).toEqual([]);
    const rows = await sessionAudit(orgA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entityId).toBe(ade.id);
  });

  it("4. etterpå kan admin logge inn igjen og har fortsatt tilgang", async () => {
    const { orgA, ad, ade } = await setup();
    const login = await signInThroughAuth(ad.email);
    await revokeAllEmployeeSessions(withSession(ad, login.sessionId), orgA.id, ade.id, {
      reason: "manual",
      confirmSelf: true,
    });
    expect(await sessionForCookie(login.cookie)).toBeNull();
    const again = await signInThroughAuth(ad.email);
    expect((await sessionForCookie(again.cookie))?.user.id).toBe(ad.id);
    const grant = await requireOrganizationAccess(ad, orgA.id, "organization.manage");
    expect(grant.organizationId).toBe(orgA.id);
  });

  it("5. confirmSelf mot en annen ansatt trengs ikke og endrer ingenting", async () => {
    const { orgA, ad, te, ads1 } = await setup();
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual", confirmSelf: true }),
    ).toEqual({ ok: true, count: 2 });
    expect(await sessionExists(ads1.id)).toBe(true);
  });

  it("6. ingen rader i employees, employee_roles, users eller accounts endres", async () => {
    const { orgA, ad, te, ade } = await setup();
    const before = await snapshot();
    await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" });
    await revokeAllEmployeeSessions(ad, orgA.id, ade.id, { reason: "manual", confirmSelf: true });
    expect(await snapshot()).toEqual(before);
  });
});

describe("5.5 revisjonsloggen", () => {
  it("1. raden har entityType employee, ansatt-id og changes nøyaktig { sessionCount, reason }", async () => {
    const { orgA, ad, te } = await setup();
    await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" });
    const rows = await sessionAudit(orgA.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.entityType).toBe("employee");
    expect(row.entityId).toBe(te.id);
    expect(Object.keys(row.changes as object).sort()).toEqual(["reason", "sessionCount"]);
    expect(row.changes).toEqual({ sessionCount: 2, reason: "manual" });
  });

  it("2. også ved 0 økter", async () => {
    const { orgA, ad, ke } = await setup();
    expect(await revokeAllEmployeeSessions(ad, orgA.id, ke.id, { reason: "manual" })).toEqual({
      ok: true,
      count: 0,
    });
    const rows = await sessionAudit(orgA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.changes).toEqual({ sessionCount: 0, reason: "manual" });
  });

  it("3. samme transaksjon: feiler revisjonsraden, står øktene", async () => {
    const { orgA, ad, te, ts1, ts2 } = await setup();
    mocks.failAudit = true;
    await expect(
      revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" }),
    ).rejects.toThrow();
    mocks.failAudit = false;
    expect(await sessionIdsOf(te.userId!)).toEqual([ts1.id, ts2.id].sort());
    expect(await sessionAudit(orgA.id)).toEqual([]);
  });

  it("3. med transaksjon utenfra: rulles den tilbake, står øktene og raden er borte", async () => {
    const { orgA, ad, te, ts1, ts2 } = await setup();
    await expect(
      db.transaction(async (tx) => {
        const result = await revokeAllEmployeeSessions(
          ad,
          orgA.id,
          te.id,
          { reason: "deactivated" },
          tx,
        );
        expect(result).toEqual({ ok: true, count: 2 });
        throw new Error("Oppdiktet feil etter utloggingen");
      }),
    ).rejects.toThrow("Oppdiktet feil etter utloggingen");
    expect(await sessionIdsOf(te.userId!)).toEqual([ts1.id, ts2.id].sort());
    expect(await sessionAudit(orgA.id)).toEqual([]);
  });

  it("4. raden har verken IP, user-agent, token, økt-id eller e-post", async () => {
    const { orgA, ad, te, t, ts1, ts2 } = await setup();
    await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" });
    const rows = await db.select().from(auditLog).where(eq(auditLog.organizationId, orgA.id));
    const json = JSON.stringify(rows.filter((row) => ACTION.test(row.action)));
    for (const secret of [
      SESSION_IP,
      SESSION_UA_MARK,
      "Mozilla",
      ts1.token,
      ts2.token,
      ts1.id,
      ts2.id,
      t.email,
      t.id,
      ad.email,
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it.each([["annen tekst", "oppdiktet"], ["tom", ""], ["store bokstaver", "MANUAL"]])(
    "5. reason %s avvises før spørringen",
    async (_name, reason) => {
      const { orgA, ad, te, t } = await setup();
      const result = await rejection(
        revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: reason as never }),
      );
      expect((result as { ok?: boolean } | undefined)?.ok).not.toBe(true);
      expect(await sessionIdsOf(t.id)).toHaveLength(2);
      expect(await sessionAudit(orgA.id)).toEqual([]);
    },
  );

  it("5. deactivated er en gyldig kode", async () => {
    const { orgA, ad, te } = await setup();
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "deactivated" }),
    ).toEqual({ ok: true, count: 2 });
    expect((await sessionAudit(orgA.id))[0]!.changes).toEqual({
      sessionCount: 2,
      reason: "deactivated",
    });
  });
});

describe("4.4.2 revokeAllEmployeeSessions virker med en gang gjennom Better Auth", () => {
  it("kapslene til den ansatte gir ingen økt etterpå", async () => {
    const { orgA, ad, te, t } = await setup();
    const first = await signInThroughAuth(t.email, FAKE_UA.iPadSafari);
    const second = await signInThroughAuth(t.email, FAKE_UA.windowsEdge);
    expect(await revokeAllEmployeeSessions(ad, orgA.id, te.id, { reason: "manual" })).toEqual({
      ok: true,
      count: 4,
    });
    expect(await sessionForCookie(first.cookie)).toBeNull();
    expect(await sessionForCookie(second.cookie)).toBeNull();
  });
});
