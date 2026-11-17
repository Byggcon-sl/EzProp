import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, effectivePermissions, requireOrganizationAccess } from "@/core/access";
import * as audit from "@/core/audit";
import { db } from "@/db/client";
import { accounts, employeeRoleAssignments, employees, sessions, users } from "@/db/schema";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  listEmployeeSessions,
  revokeAllEmployeeSessions,
  SESSION_REVOKE_REASONS,
  SESSIONS_REVOKED_ALL_ACTION,
} from "./sessions-list";

/*
 * Kjernen for admin: «Logg ut av alle enheter» og listen per ansatt
 * (docs/funksjoner/fase2a-mine-innlogginger-testplan.md avsnitt 5). Økter legges direkte i
 * `sessions` med oppdiktet user-agent (merket `Oppdiktet/9.9`) og dokumentasjons-IP 192.0.2.10.
 * Testdata er oppdiktet (example.com).
 * Støtter hovedmål: de ansatte (admin stenger alle enheter med én handling, uten å stenge seg
 * selv ute ved et uhell).
 */

const MARK = "Oppdiktet/9.9";
const IP = "192.0.2.10";
const UA_IPAD = `Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Version/18.0 Safari/604.1 ${MARK}`;
const UA_WINDOWS_EDGE = `Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0 ${MARK}`;
const DAY = 24 * 60 * 60 * 1000;

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
      expiresAt: new Date(Date.now() + DAY),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("kunne ikke lage økt");
  return row;
}

async function countSessions(userId: string) {
  return (await db.select().from(sessions).where(eq(sessions.userId, userId))).length;
}

async function setup() {
  const orgA = await createOrganization("Organisasjon A");
  const orgB = await createOrganization("Organisasjon B");
  const ad = await createUser({ name: "Anne Admin" });
  const t = await createUser({ name: "Tore Takst" });
  const k = await createUser({ name: "Kari Kontor" });
  const l = await createUser({ name: "Lars Leder" });
  const adb = await createUser({ name: "Bente Admin" });
  const tb = await createUser({ name: "Tina Annen" });
  const adEmployee = await createEmployee(ad, orgA.id, ["admin"]);
  const tEmployee = await createEmployee(t, orgA.id, ["inspector"]);
  await createEmployee(k, orgA.id, ["office"]);
  await createEmployee(l, orgA.id, ["manager"]);
  await createEmployee(adb, orgB.id, ["admin"]);
  const tbEmployee = await createEmployee(tb, orgB.id, ["inspector"]);
  const s1 = await insertSession(t.id);
  const s2 = await insertSession(t.id, { userAgent: UA_WINDOWS_EDGE });
  const tbs = await insertSession(tb.id);
  const adSession = await insertSession(ad.id);
  return {
    orgA,
    orgB,
    ad: { ...ad, sessionId: adSession.id },
    adEmployee,
    t,
    tEmployee,
    k,
    l,
    adb,
    tb,
    tbEmployee,
    s1,
    s2,
    tbs,
  };
}

describe("5.1 tilgang per rolle", () => {
  it("1. admin lister og logger ut alle økter for takstmannen", async () => {
    const { ad, orgA, t, tEmployee } = await setup();
    const list = await listEmployeeSessions(ad, orgA.id, tEmployee.id);
    expect(list).toEqual({
      ok: true,
      count: 2,
      sessions: expect.arrayContaining([
        { device: "iPad", browser: "Safari" },
        { device: "Windows-PC", browser: "Edge" },
      ]),
    });
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "manual" }),
    ).toEqual({ ok: true, count: 2 });
    expect(await countSessions(t.id)).toBe(0);
  });

  it.each(["k", "l", "t"] as const)(
    "2. takstmann, kontor og leder (%s) får AccessDeniedError, også mot egen ansatt-id",
    async (who) => {
      const ctx = await setup();
      const actor = ctx[who];
      for (const employeeId of [ctx.tEmployee.id, ctx.adEmployee.id]) {
        await expect(listEmployeeSessions(actor, ctx.orgA.id, employeeId)).rejects.toThrow(
          AccessDeniedError,
        );
        await expect(
          revokeAllEmployeeSessions(actor, ctx.orgA.id, employeeId, { reason: "manual" }),
        ).rejects.toThrow(AccessDeniedError);
      }
      expect(await countSessions(ctx.t.id)).toBe(2);
    },
  );

  it("3. bruker uten ansattforhold og deaktivert admin får AccessDeniedError", async () => {
    const { orgA, tEmployee, t } = await setup();
    const stranger = await createUser();
    const former = await createUser();
    const formerEmployee = await createEmployee(former, orgA.id, ["admin"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, formerEmployee.id));
    for (const actor of [stranger, former]) {
      await expect(listEmployeeSessions(actor, orgA.id, tEmployee.id)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        revokeAllEmployeeSessions(actor, orgA.id, tEmployee.id, { reason: "manual" }),
      ).rejects.toThrow(AccessDeniedError);
    }
    expect(await countSessions(t.id)).toBe(2);
  });

  it("4. leder er bevisst utelatt (A423): leder har ikke organization.manage", () => {
    expect(
      effectivePermissions(["manager"], [], { inspectorsEditAll: true }),
      "Leder har fått organization.manage og ser da andres innlogginger. Se A423.",
    ).not.toContain("organization.manage");
  });
});

describe("5.2 tenant-isolasjon", () => {
  /** Ulik enhet per organisasjon, slik at radene kan skilles på enhet og nettleser. */
  async function seedEmployeeWithSession(organizationId: string, userAgent: string) {
    const user = await createUser();
    const employee = await createEmployee(user, organizationId, ["inspector"]);
    await insertSession(user.id, { userAgent });
    return employee;
  }

  it("1. expectTenantIsolation for listEmployeeSessions", async () => {
    const byOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        byOrg.set(
          grantA.organizationId,
          (await seedEmployeeWithSession(grantA.organizationId, UA_IPAD)).id,
        );
        byOrg.set(
          grantB.organizationId,
          (await seedEmployeeWithSession(grantB.organizationId, UA_WINDOWS_EDGE)).id,
        );
        return { a: ["iPad/Safari"], b: ["Windows-PC/Edge"] };
      },
      query: async (actor, organizationId) => {
        // Fremmed organisasjon: bruk en ansatt-id derfra, så tilgangssjekken er det som stopper
        const employeeId = byOrg.get(organizationId) ?? randomUUID();
        const result = await listEmployeeSessions(actor, organizationId, employeeId);
        return result.ok ? result.sessions : [];
      },
      idOf: (row) => `${row.device}/${row.browser}`,
    });
  });

  it("2. expectTenantIsolation for revokeAllEmployeeSessions", async () => {
    const byOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedEmployeeWithSession(grantA.organizationId, UA_IPAD);
        const b = await seedEmployeeWithSession(grantB.organizationId, UA_WINDOWS_EDGE);
        byOrg.set(grantA.organizationId, a.id);
        byOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const employeeId = byOrg.get(organizationId) ?? randomUUID();
        const result = await revokeAllEmployeeSessions(actor, organizationId, employeeId, {
          reason: "manual",
        });
        return result.ok ? [employeeId] : [];
      },
      idOf: (id) => id,
    });
  });

  it("3. admin i A med ansatt-id fra B får «finnes ikke», og øktene i B står", async () => {
    const { ad, orgA, tbEmployee, tb } = await setup();
    expect(await listEmployeeSessions(ad, orgA.id, tbEmployee.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, tbEmployee.id, { reason: "manual" }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await countSessions(tb.id)).toBe(1);
  });

  it("4. admin i A med organisasjons-id B og egen ansatt-id får AccessDeniedError", async () => {
    const { ad, orgB, tEmployee, t } = await setup();
    await expect(listEmployeeSessions(ad, orgB.id, tEmployee.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      revokeAllEmployeeSessions(ad, orgB.id, tEmployee.id, { reason: "manual" }),
    ).rejects.toThrow(AccessDeniedError);
    expect(await countSessions(t.id)).toBe(2);
  });

  it("5. admin i B ser ikke Ts økter og ikke revisjonsraden", async () => {
    const { ad, adb, orgA, orgB, tEmployee } = await setup();
    await revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "manual" });
    expect(await listEmployeeSessions(adb, orgB.id, tEmployee.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await audit.listAuditEvents(adb, orgB.id)).toEqual([]);
  });

  it("6. kjent begrensning A426: bruker ansatt i A og B mister alle økter", async () => {
    const { ad, orgA, orgB } = await setup();
    const u = await createUser();
    const uInA = await createEmployee(u, orgA.id, ["inspector"]);
    await createEmployee(u, orgB.id, ["inspector"]);
    await insertSession(u.id);
    await insertSession(u.id);
    expect(await revokeAllEmployeeSessions(ad, orgA.id, uInA.id, { reason: "manual" })).toEqual({
      ok: true,
      count: 2,
    });
    expect(await countSessions(u.id)).toBe(0);
  });
});

describe("5.3 ansatte som har sluttet og ansatte uten bruker", () => {
  it("1. deaktivert ansatt kan listes og logges ut", async () => {
    const { ad, orgA, t, tEmployee } = await setup();
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, tEmployee.id));
    expect(await listEmployeeSessions(ad, orgA.id, tEmployee.id)).toMatchObject({
      ok: true,
      count: 2,
    });
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "manual" }),
    ).toEqual({ ok: true, count: 2 });
    expect(await countSessions(t.id)).toBe(0);
  });

  it("2. myk slettet ansatt gir «finnes ikke»", async () => {
    const { ad, orgA, t, tEmployee } = await setup();
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, tEmployee.id));
    expect(await listEmployeeSessions(ad, orgA.id, tEmployee.id)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "manual" }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await countSessions(t.id)).toBe(2);
  });

  it("3. user_id = null gir tom liste, 0 og revisjonsrad med sessionCount 0", async () => {
    const { ad, orgA } = await setup();
    const [noUser] = await db
      .insert(employees)
      // Databasen krever at en ansatt uten innlogging er markert som sluttet
      .values({
        organizationId: orgA.id,
        userId: null,
        name: "Uten Innlogging",
        deactivatedAt: new Date(),
      })
      .returning();
    if (!noUser) throw new Error("ingen ansatt");
    expect(await listEmployeeSessions(ad, orgA.id, noUser.id)).toEqual({
      ok: true,
      sessions: [],
      count: 0,
    });
    expect(await revokeAllEmployeeSessions(ad, orgA.id, noUser.id, { reason: "manual" })).toEqual({
      ok: true,
      count: 0,
    });
    const rows = (await auditRows(orgA.id)).filter((r) => r.action === SESSIONS_REVOKED_ALL_ACTION);
    expect(rows.map((r) => r.changes)).toEqual([{ sessionCount: 0, reason: "manual" }]);
  });

  it("4. admin-listen har bare device og browser, uten token, IP og user-agent", async () => {
    const { ad, orgA, tEmployee, s1, s2 } = await setup();
    const result = await listEmployeeSessions(ad, orgA.id, tEmployee.id);
    if (!result.ok) throw new Error("forventet liste");
    expect(Object.keys(result).sort()).toEqual(["count", "ok", "sessions"]);
    for (const row of result.sessions)
      expect(Object.keys(row).sort()).toEqual(["browser", "device"]);
    const json = JSON.stringify(result);
    for (const secret of [MARK, IP, s1.token, s2.token, s1.id, s2.id]) {
      expect(json).not.toContain(secret);
    }
  });

  it("utløpte økter vises ikke i admin-listen", async () => {
    const { ad, orgA, t, tEmployee } = await setup();
    await insertSession(t.id, { expiresAt: new Date(Date.now() - 1000) });
    expect(await listEmployeeSessions(ad, orgA.id, tEmployee.id)).toMatchObject({ count: 2 });
  });

  it("ugyldig ansatt-id gir «finnes ikke»", async () => {
    const { ad, orgA } = await setup();
    expect(await listEmployeeSessions(ad, orgA.id, "../x")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("5.4 admin stenges aldri ute (regel 11)", () => {
  it("1. admin som velger seg selv uten confirmSelf avvises uten sletting og revisjonsrad", async () => {
    const { ad, orgA, adEmployee } = await setup();
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, adEmployee.id, { reason: "manual" }),
    ).toEqual({ ok: false, reason: "confirm_self_required" });
    expect(await countSessions(ad.id)).toBe(1);
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it.each([false, "true"])("2. confirmSelf %j avvises av Zod", async (value) => {
    const { ad, orgA, adEmployee } = await setup();
    await expect(
      revokeAllEmployeeSessions(ad, orgA.id, adEmployee.id, {
        reason: "manual",
        confirmSelf: value as never,
      }),
    ).rejects.toThrow();
    expect(await countSessions(ad.id)).toBe(1);
    expect(await auditRows(orgA.id)).toEqual([]);
  });

  it("3 og 4. med confirmSelf: true slettes øktene, og admin har fortsatt tilgang", async () => {
    const { ad, orgA, adEmployee } = await setup();
    await insertSession(ad.id);
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, adEmployee.id, {
        reason: "manual",
        confirmSelf: true,
      }),
    ).toEqual({ ok: true, count: 2 });
    expect(await countSessions(ad.id)).toBe(0);
    expect(await auditRows(orgA.id)).toHaveLength(1);
    const grant = await requireOrganizationAccess(ad, orgA.id, "organization.manage");
    expect(grant.roles).toContain("admin");
  });

  it("5 og 6. confirmSelf mot en annen ansatt endrer ingenting; ansatte, roller, brukere og kontoer er urørt", async () => {
    const { ad, orgA, tEmployee } = await setup();
    const snapshot = async () => ({
      employees: await db.select().from(employees),
      roles: await db.select().from(employeeRoleAssignments),
      users: await db.select().from(users),
      accounts: await db.select().from(accounts),
    });
    const before = await snapshot();
    expect(
      await revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, {
        reason: "manual",
        confirmSelf: true,
      }),
    ).toEqual({ ok: true, count: 2 });
    expect(await snapshot()).toEqual(before);
  });
});

describe("5.5 revisjonsloggen", () => {
  it("1 og 4. én rad med nøyaktig { sessionCount, reason }, uten persondata", async () => {
    const { ad, orgA, t, tEmployee, s1, s2 } = await setup();
    await revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "manual" });
    const rows = await auditRows(orgA.id);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({
      action: "employee.sessions_revoked_all",
      entityType: "employee",
      entityId: tEmployee.id,
    });
    expect(Object.keys(row?.changes ?? {}).sort()).toEqual(["reason", "sessionCount"]);
    expect(row?.changes).toEqual({ sessionCount: 2, reason: "manual" });
    const json = JSON.stringify(row);
    for (const secret of [IP, MARK, s1.token, s2.token, s1.id, s2.id, t.email]) {
      expect(json).not.toContain(secret);
    }
  });

  it("2. også ved 0 økter", async () => {
    const { ad, orgA, tEmployee } = await setup();
    await revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "manual" });
    await revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "manual" });
    expect((await auditRows(orgA.id)).map((r) => r.changes)).toEqual([
      { sessionCount: 2, reason: "manual" },
      { sessionCount: 0, reason: "manual" },
    ]);
  });

  it("3. feiler revisjonsraden, står øktene (samme transaksjon)", async () => {
    const { ad, orgA, t, tEmployee } = await setup();
    vi.spyOn(audit, "recordAuditEvent").mockRejectedValueOnce(new Error("oppdiktet feil"));
    await expect(
      revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "manual" }),
    ).rejects.toThrow("oppdiktet feil");
    expect(await countSessions(t.id)).toBe(2);
  });

  it("5. reason er en fast kode; annen tekst avvises før spørringen", async () => {
    expect(SESSION_REVOKE_REASONS).toEqual(["manual", "deactivated"]);
    const { ad, orgA, t, tEmployee } = await setup();
    const spy = vi.spyOn(db, "delete");
    await expect(
      revokeAllEmployeeSessions(ad, orgA.id, tEmployee.id, { reason: "fired" as never }),
    ).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
    expect(await countSessions(t.id)).toBe(2);
  });
});
