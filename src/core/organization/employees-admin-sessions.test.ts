import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import * as audit from "@/core/audit";
import { db } from "@/db/client";
import { employees, sessions } from "@/db/schema";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { countEmployeeActiveSessions, deactivateEmployee } from "./employees-admin";
import { LastAdminError } from "./errors";

/*
 * «Har sluttet» logger ut alle enheter (docs/funksjoner/fase2a-mine-innlogginger-testplan.md
 * avsnitt 6, A430), i samme transaksjon som deaktiveringen. Testdata er oppdiktet (example.com).
 * Støtter hovedmål: de ansatte (en som slutter, er stengt ute fra alle enheter uten ekstra steg).
 */

const DAY = 24 * 60 * 60 * 1000;

beforeEach(resetDatabase);
afterEach(() => vi.restoreAllMocks());

async function insertSession(userId: string, expiresAt = new Date(Date.now() + DAY)) {
  await db.insert(sessions).values({
    id: randomUUID(),
    token: `token-${randomUUID()}`,
    userId,
    userAgent: "Oppdiktet/9.9 (iPad)",
    ipAddress: "192.0.2.10",
    expiresAt,
  });
}

async function countSessions(userId: string) {
  return (await db.select().from(sessions).where(eq(sessions.userId, userId))).length;
}

async function setup() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Anne Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const t = await createUser({ name: "Tore Takst" });
  const tEmployee = await createEmployee(t, org.id, ["inspector"]);
  await insertSession(t.id);
  await insertSession(t.id);
  await insertSession(admin.id);
  return { org, admin, adminEmployee, t, tEmployee };
}

describe("6 deaktivering logger ut alle enheter", () => {
  it("1. økter slettes, og revisjonsrad med reason deactivated kommer etter deaktiveringsraden", async () => {
    const { org, admin, t, tEmployee } = await setup();
    await deactivateEmployee(admin, org.id, tEmployee.id);
    expect(await countSessions(t.id)).toBe(0);
    const rows = await auditRows(org.id);
    expect(rows.map((r) => r.action)).toEqual(["deactivate", "employee.sessions_revoked_all"]);
    expect(rows[1]).toMatchObject({
      entityType: "employee",
      entityId: tEmployee.id,
      changes: { sessionCount: 2, reason: "deactivated" },
    });
  });

  it("2. feiler utloggingen, rulles alt tilbake: ikke sluttet, øktene står", async () => {
    const { org, admin, t, tEmployee } = await setup();
    const original = audit.recordAuditEvent;
    vi.spyOn(audit, "recordAuditEvent").mockImplementation(async (executor, grant, event) => {
      if (event.action === "employee.sessions_revoked_all") throw new Error("oppdiktet feil");
      return original(executor, grant, event);
    });
    await expect(deactivateEmployee(admin, org.id, tEmployee.id)).rejects.toThrow("oppdiktet feil");
    const [row] = await db.select().from(employees).where(eq(employees.id, tEmployee.id));
    expect(row?.deactivatedAt).toBeNull();
    expect(await countSessions(t.id)).toBe(2);
    expect(await auditRows(org.id)).toEqual([]);
  });

  it("3 og 4. siste admin kan ikke markere seg selv som sluttet, og øktene står", async () => {
    const { org, admin, adminEmployee } = await setup();
    await expect(deactivateEmployee(admin, org.id, adminEmployee.id)).rejects.toThrow(
      LastAdminError,
    );
    expect(await countSessions(admin.id)).toBe(1);
    await expect(
      requireOrganizationAccess(admin, org.id, "organization.manage"),
    ).resolves.toBeTruthy();
  });

  it("admin som markerer seg selv som sluttet (med en annen admin igjen), logges også ut", async () => {
    const { org, admin, adminEmployee } = await setup();
    const other = await createUser({ name: "Bente Admin" });
    await createEmployee(other, org.id, ["admin"]);
    await deactivateEmployee(admin, org.id, adminEmployee.id);
    expect(await countSessions(admin.id)).toBe(0);
    await expect(
      requireOrganizationAccess(other, org.id, "organization.manage"),
    ).resolves.toBeTruthy();
  });

  it("5. deaktivert ansatt får ikke tilgang etter ny innlogging", async () => {
    const { org, admin, t, tEmployee } = await setup();
    await deactivateEmployee(admin, org.id, tEmployee.id);
    await insertSession(t.id);
    await expect(requireOrganizationAccess(t, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("allerede sluttet: ingenting skjer, ingen ny revisjonsrad", async () => {
    const { org, admin, tEmployee } = await setup();
    await deactivateEmployee(admin, org.id, tEmployee.id);
    const before = await auditRows(org.id);
    await deactivateEmployee(admin, org.id, tEmployee.id);
    expect(await auditRows(org.id)).toHaveLength(before.length);
  });
});

describe("countEmployeeActiveSessions (N i bekreftelsen)", () => {
  it("teller aktive økter; utløpte telles ikke", async () => {
    const { org, admin, t, tEmployee } = await setup();
    await insertSession(t.id, new Date(Date.now() - 1000));
    expect(await countEmployeeActiveSessions(admin, org.id, tEmployee.id)).toBe(2);
  });

  it("takstmann får AccessDeniedError; fremmed og ugyldig id gir AccessDeniedError", async () => {
    const { org, admin, t, tEmployee } = await setup();
    await expect(countEmployeeActiveSessions(t, org.id, tEmployee.id)).rejects.toThrow(
      AccessDeniedError,
    );
    const orgB = await createOrganization("Organisasjon B");
    const tb = await createUser();
    const tbEmployee = await createEmployee(tb, orgB.id, ["inspector"]);
    await expect(countEmployeeActiveSessions(admin, org.id, tbEmployee.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(countEmployeeActiveSessions(admin, org.id, "x")).rejects.toThrow(
      AccessDeniedError,
    );
  });
});
