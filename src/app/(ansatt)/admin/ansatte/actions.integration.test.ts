import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { employees } from "@/db/schema";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../../../tests/factories";
import { createSession, sessionIdsOf } from "../../../../../tests/sessions";
import { initialFormState } from "../../form-state";

/*
 * Deaktivering logger ut alle enheter (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 7,
 * «Avklart før bygging» 4; testplan avsnitt 6). `deactivateEmployeeAction` kjøres mot
 * testdatabasen med ekte kjerne; bare admin-konteksten (innlogget bruker og organisasjon) og
 * `redirect` er byttet ut. Revisjonsloggen kan feile på kommando for utloggingsraden, så det
 * vises at deaktivering og utlogging er én transaksjon.
 *
 * Støtter hovedmål: de ansatte (en som slutter, er logget ut av alle enheter uten et ekstra steg)
 * og regel 11 (admin kan fortsatt ikke stenge seg selv ute).
 */

const mocks = vi.hoisted(() => ({
  context: null as null | {
    actor: { id: string; email: string; name: string };
    organizationId: string;
  },
  failSessionAudit: false,
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../admin-context", () => ({ getAdminContext: vi.fn(async () => mocks.context) }));
vi.mock("@/core/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/audit")>();
  return {
    ...actual,
    recordAuditEvent: vi.fn(async (...args: Parameters<typeof actual.recordAuditEvent>) => {
      if (mocks.failSessionAudit && /sessions_revoked_all$/.test(args[2].action)) {
        throw new Error("Oppdiktet feil i revisjonsloggen");
      }
      return actual.recordAuditEvent(...args);
    }),
  };
});

const { deactivateEmployeeAction } = await import("./actions");

const ACTION = /^(employee\.)?sessions_revoked_all$/;

async function setup() {
  const org = await createOrganization("Organisasjon A");
  const ad = await createUser({ name: "Ada Admin", email: "ada.admin@example.com" });
  const ad2 = await createUser({ name: "Aksel Admin", email: "aksel.admin@example.com" });
  const t = await createUser({ name: "Tora Takstmann", email: "tora.takst@example.com" });
  const ade = await createEmployee(ad, org.id, ["admin"]);
  const ad2e = await createEmployee(ad2, org.id, ["admin"]);
  const te = await createEmployee(t, org.id, ["inspector"]);
  const ts1 = await createSession(t.id);
  const ts2 = await createSession(t.id);
  const ads = await createSession(ad.id);
  mocks.context = { actor: ad, organizationId: org.id };
  return { org, ad, ad2, t, ade, ad2e, te, ts1, ts2, ads };
}

async function deactivatedAt(employeeId: string): Promise<Date | null> {
  const [row] = await db.select().from(employees).where(eq(employees.id, employeeId));
  return row?.deactivatedAt ?? null;
}

async function runAction(employeeId: string): Promise<unknown> {
  try {
    return await deactivateEmployeeAction(employeeId, initialFormState);
  } catch (error) {
    return error;
  }
}

beforeEach(async () => {
  mocks.failSessionAudit = false;
  mocks.redirect.mockClear();
  await resetDatabase();
});

afterEach(() => {
  mocks.failSessionAudit = false;
});

describe("6. deaktivering logger ut alle enheter", () => {
  it("1. T med to økter deaktiveres: 0 økter igjen, rad med reason deactivated og antall", async () => {
    const { org, t, te } = await setup();
    const result = await runAction(te.id);
    expect(String((result as Error).message)).toBe("REDIRECT /admin/ansatte?lagret=sluttet");
    expect(await deactivatedAt(te.id)).not.toBeNull();
    expect(await sessionIdsOf(t.id)).toEqual([]);
    const rows = await auditRows(org.id);
    expect(rows.filter((row) => row.action === "deactivate")).toHaveLength(1);
    const revoked = rows.filter((row) => ACTION.test(row.action));
    expect(revoked).toHaveLength(1);
    expect(revoked[0]!.entityType).toBe("employee");
    expect(revoked[0]!.entityId).toBe(te.id);
    expect(revoked[0]!.changes).toEqual({ sessionCount: 2, reason: "deactivated" });
  });

  it("2. samme transaksjon: feiler utloggingen, er T ikke deaktivert og øktene står", async () => {
    const { org, t, te, ts1, ts2 } = await setup();
    mocks.failSessionAudit = true;
    const result = await runAction(te.id);
    expect(String((result as Error)?.message ?? "")).not.toContain("lagret=sluttet");
    expect(await deactivatedAt(te.id)).toBeNull();
    expect(await sessionIdsOf(t.id)).toEqual([ts1.id, ts2.id].sort());
    const rows = await auditRows(org.id);
    expect(rows.filter((row) => row.action === "deactivate")).toHaveLength(0);
    expect(rows.filter((row) => ACTION.test(row.action))).toHaveLength(0);
  });

  it("3. admin kan ikke deaktivere seg selv, også med en annen admin; øktene står", async () => {
    const { org, ad, ade, ads } = await setup();
    const result = await runAction(ade.id);
    expect(String((result as Error)?.message ?? "")).not.toContain("lagret=sluttet");
    expect(await deactivatedAt(ade.id)).toBeNull();
    expect(await sessionIdsOf(ad.id)).toEqual([ads.id]);
    const grant = await requireOrganizationAccess(ad as Actor, org.id, "organization.manage");
    expect(grant.organizationId).toBe(org.id);
    expect((await auditRows(org.id)).filter((row) => ACTION.test(row.action))).toEqual([]);
  });

  it("4. siste aktive admin kan ikke deaktiveres; øktene står", async () => {
    const { ad, ad2e, ade, ads } = await setup();
    // Aksel har sluttet, så Ada er eneste aktive admin
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, ad2e.id));
    const result = await runAction(ade.id);
    expect(String((result as Error)?.message ?? "")).not.toContain("lagret=sluttet");
    expect(await deactivatedAt(ade.id)).toBeNull();
    expect(await sessionIdsOf(ad.id)).toEqual([ads.id]);
  });

  it("5. deaktivert ansatt får ikke tilgang etter ny innlogging", async () => {
    const { org, t, te } = await setup();
    await runAction(te.id);
    await createSession(t.id);
    await expect(requireOrganizationAccess(t as Actor, org.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  it("6. ansatt uten user_id (alltid allerede sluttet) gir ingen feil og ingen ny rad", async () => {
    const { org } = await setup();
    // Databasen tillater bare ansatt uten innlogging når hen har sluttet
    // (employees_user_or_deactivated_check), så deaktivering er da allerede gjort
    const [former] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Tidligere Testansatt",
        deactivatedAt: new Date(),
      })
      .returning();
    const result = await runAction(former!.id);
    expect(String((result as Error)?.message ?? "")).toBe("REDIRECT /admin/ansatte?lagret=sluttet");
    expect(await deactivatedAt(former!.id)).not.toBeNull();
    expect((await auditRows(org.id)).filter((row) => ACTION.test(row.action))).toEqual([]);
  });
});
