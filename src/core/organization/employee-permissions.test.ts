import { and, eq, isNull, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AccessDeniedError,
  permissions,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employeePermissions, employees, users, type EmployeeRole } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import { grantEmployeePermission, revokeEmployeePermission } from "./index";

// Testplan: docs/funksjoner/fase0b-roller-rettigheter-testplan.md, seksjon 2.
// Testdata er oppdiktet.

beforeEach(resetDatabase);

const PERMISSION = "template.edit_structure";

type GrantArgs = Parameters<typeof grantEmployeePermission>;
type PermissionArg = GrantArgs[3];

/** Organisasjon med en admin og en takstmann som får eller mister rettigheter. */
async function setup() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const inspector = await createUser({ name: "Test Takstmann" });
  const inspectorEmployee = await createEmployee(inspector, org.id, ["inspector"]);
  return { org, admin, adminEmployee, inspector, inspectorEmployee };
}

/** Innloggingen bak en tilgang (tenant-hjelperen gir bare `EmployeeGrant`). */
async function actorFor(grant: EmployeeGrant): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .innerJoin(employees, eq(employees.userId, users.id))
    .where(eq(employees.id, grant.employeeId));
  if (!row) throw new Error("fant ikke innloggingen til den ansatte");
  return row;
}

async function permissionRows(employeeId?: string) {
  const rows = await db.select().from(employeePermissions);
  return employeeId ? rows.filter((r) => r.employeeId === employeeId) : rows;
}

async function activeRows(employeeId: string, permission: string = PERMISSION) {
  return db
    .select()
    .from(employeePermissions)
    .where(
      and(
        eq(employeePermissions.employeeId, employeeId),
        eq(employeePermissions.permission, permission),
        isNull(employeePermissions.deletedAt),
      ),
    );
}

async function auditRows() {
  return db.select().from(auditLog).where(eq(auditLog.action, "permission_change"));
}

describe("tenant-isolasjon (regel 2)", () => {
  it("1. grantEmployeePermission gir aldri rader fra en annen organisasjon", async () => {
    const targetByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const person = await createUser({ name: `Test Takstmann ${side.toUpperCase()}` });
          const employee = await createEmployee(person, grant.organizationId, ["inspector"]);
          targetByOrg.set(grant.organizationId, employee.id);
          const row = await grantEmployeePermission(
            await actorFor(grant),
            grant.organizationId,
            employee.id,
            PERMISSION,
          );
          ids[side].push(row.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => [
        await grantEmployeePermission(
          actor,
          organizationId,
          targetByOrg.get(organizationId)!,
          PERMISSION,
        ),
      ],
      idOf: (row) => row.id,
    });
    // Idempotens: fortsatt én aktiv rad per organisasjon
    for (const employeeId of targetByOrg.values()) {
      expect(await activeRows(employeeId)).toHaveLength(1);
    }
  });

  it("2. revokeEmployeePermission rører aldri rader i en annen organisasjon", async () => {
    const targetByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const person = await createUser({ name: `Test Takstmann ${side.toUpperCase()}` });
          const employee = await createEmployee(person, grant.organizationId, ["inspector"]);
          targetByOrg.set(grant.organizationId, employee.id);
          const row = await grantEmployeePermission(
            await actorFor(grant),
            grant.organizationId,
            employee.id,
            PERMISSION,
          );
          ids[side].push(row.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const employeeId = targetByOrg.get(organizationId)!;
        // Kallet selv skal avvise fremmed organisasjon, derfor først
        await revokeEmployeePermission(actor, organizationId, employeeId, PERMISSION);
        const grant = await requireOrganizationAccess(actor, organizationId);
        const rows = await db
          .select()
          .from(employeePermissions)
          .where(
            and(
              eq(employeePermissions.organizationId, grant.organizationId),
              eq(employeePermissions.employeeId, employeeId),
            ),
          );
        for (const row of rows) expect(row.deletedAt).not.toBeNull();
        return rows;
      },
      idOf: (row) => row.id,
    });
  });

  it("2b. admin i A kan ikke ta bort en rettighet i B; raden i B er urørt", async () => {
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const adminA = await createUser({ name: "Test Admin A" });
    await createEmployee(adminA, orgA.id, ["admin"]);
    const personB = await createUser({ name: "Test Takstmann B" });
    const employeeB = await createEmployee(personB, orgB.id, ["inspector"]);
    const row = await grantPermission(employeeB, PERMISSION);

    await expect(
      revokeEmployeePermission(adminA, orgB.id, employeeB.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      grantEmployeePermission(adminA, orgB.id, employeeB.id, "report.edit"),
    ).rejects.toThrow(AccessDeniedError);

    const [after] = await db
      .select()
      .from(employeePermissions)
      .where(eq(employeePermissions.id, row.id));
    expect(after!.deletedAt).toBeNull();
    expect(await permissionRows()).toHaveLength(1);
    expect(await auditRows()).toEqual([]);
  });

  it("3. ansatt i en annen organisasjon avvises (organizationId = A, employeeId fra B)", async () => {
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const adminA = await createUser({ name: "Test Admin A" });
    await createEmployee(adminA, orgA.id, ["admin"]);
    const personB = await createUser({ name: "Test Takstmann B" });
    const employeeB = await createEmployee(personB, orgB.id, ["inspector"]);

    await expect(
      grantEmployeePermission(adminA, orgA.id, employeeB.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    expect(await permissionRows()).toEqual([]);

    const row = await grantPermission(employeeB, PERMISSION);
    await expect(
      revokeEmployeePermission(adminA, orgA.id, employeeB.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    const [after] = await db
      .select()
      .from(employeePermissions)
      .where(eq(employeePermissions.id, row.id));
    expect(after!.deletedAt).toBeNull();

    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe("tilgang per rolle", () => {
  it.each([
    { name: "takstmann", roles: ["inspector"] as EmployeeRole[], extra: [] as string[] },
    { name: "kontor", roles: ["office"] as EmployeeRole[], extra: [] as string[] },
    { name: "leder", roles: ["manager"] as EmployeeRole[], extra: [] as string[] },
    {
      name: "leder med template.edit_structure",
      roles: ["manager"] as EmployeeRole[],
      extra: [PERMISSION],
    },
    {
      name: "takstmann med organization.manage satt rett inn (5)",
      roles: ["inspector"] as EmployeeRole[],
      extra: ["organization.manage"],
    },
  ])("4/5. $name kan verken gi eller ta bort", async ({ roles, extra }) => {
    const { org, inspectorEmployee } = await setup();
    const caller = await createUser({ name: "Test Ansatt" });
    const callerEmployee = await createEmployee(caller, org.id, roles);
    for (const p of extra) await grantPermission(callerEmployee, p);
    const existing = await grantPermission(inspectorEmployee, "report.edit");
    const rowsBefore = (await permissionRows()).length;

    await expect(
      grantEmployeePermission(caller, org.id, inspectorEmployee.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      grantEmployeePermission(caller, org.id, callerEmployee.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      revokeEmployeePermission(caller, org.id, inspectorEmployee.id, "report.edit"),
    ).rejects.toThrow(AccessDeniedError);

    expect(await permissionRows()).toHaveLength(rowsBefore);
    const [after] = await db
      .select()
      .from(employeePermissions)
      .where(eq(employeePermissions.id, existing.id));
    expect(after!.deletedAt).toBeNull();
    expect(await auditRows()).toEqual([]);
  });

  it("6. admin gir og tar bort, også til en annen admin og til seg selv, og stenges aldri ute", async () => {
    const { org, admin, adminEmployee } = await setup();
    const other = await createUser({ name: "Test Admin To" });
    const otherEmployee = await createEmployee(other, org.id, ["admin"]);

    await grantEmployeePermission(admin, org.id, otherEmployee.id, PERMISSION);
    expect(await activeRows(otherEmployee.id)).toHaveLength(1);
    await revokeEmployeePermission(admin, org.id, otherEmployee.id, PERMISSION);
    expect(await activeRows(otherEmployee.id)).toHaveLength(0);

    await grantEmployeePermission(admin, org.id, adminEmployee.id, PERMISSION);
    expect(await activeRows(adminEmployee.id)).toHaveLength(1);
    await revokeEmployeePermission(admin, org.id, adminEmployee.id, PERMISSION);
    expect(await activeRows(adminEmployee.id)).toHaveLength(0);

    // Admin stenges aldri ute, skal aldri fjernes
    const grant = await requireOrganizationAccess(admin, org.id, "organization.manage");
    expect([...grant.permissions].sort()).toEqual([...permissions].sort());
    for (const p of permissions) {
      await expect(requireOrganizationAccess(admin, org.id, p)).resolves.toBeDefined();
    }
  });
});

describe("validering", () => {
  it.each([
    "organization.manage",
    "staff.manage",
    "claims.read",
    "organization.read",
    "invoice.send",
    "finnes.ikke",
    "",
  ])("7. ikke-tillatt rettighet %j avvises med Zod", async (name) => {
    const { org, admin, inspectorEmployee } = await setup();
    await expect(
      grantEmployeePermission(admin, org.id, inspectorEmployee.id, name as PermissionArg),
    ).rejects.toBeInstanceOf(z.ZodError);
    await expect(
      revokeEmployeePermission(admin, org.id, inspectorEmployee.id, name as PermissionArg),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(await permissionRows()).toEqual([]);
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("8. slettet ansatt avvises", async () => {
    const { org, admin, inspectorEmployee } = await setup();
    await db
      .update(employees)
      .set({ deletedAt: new Date() })
      .where(eq(employees.id, inspectorEmployee.id));
    await expect(
      grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    expect(await permissionRows()).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });

  it("9. deaktivert ansatt avvises", async () => {
    const { org, admin, inspectorEmployee } = await setup();
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, inspectorEmployee.id));
    await expect(
      grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION),
    ).rejects.toThrow(AccessDeniedError);
    expect(await permissionRows()).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });

  it.each(["ikke-en-id", "00000000-0000-4000-8000-000000000000"])(
    "10. ugyldig employeeId %j gir AccessDeniedError, ikke databasefeil",
    async (employeeId) => {
      const { org, admin } = await setup();
      await expect(grantEmployeePermission(admin, org.id, employeeId, PERMISSION)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(revokeEmployeePermission(admin, org.id, employeeId, PERMISSION)).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await permissionRows()).toEqual([]);
    },
  );
});

describe("revisjonslogg", () => {
  it("11. gi skriver én linje med bare tillatt innhold", async () => {
    const { org, admin, adminEmployee, inspectorEmployee } = await setup();
    await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);

    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBe(org.id);
    expect(rows[0]!.actorEmployeeId).toBe(adminEmployee.id);
    expect(rows[0]!.changes).toEqual({
      permission: PERMISSION,
      employeeId: inspectorEmployee.id,
      granted: true,
    });
  });

  it("12. ta bort skriver én linje med revoked: true", async () => {
    const { org, admin, adminEmployee, inspectorEmployee } = await setup();
    await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    await revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);

    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    const revoked = rows.filter((r) => (r.changes as Record<string, unknown>).revoked === true);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]!.organizationId).toBe(org.id);
    expect(revoked[0]!.actorEmployeeId).toBe(adminEmployee.id);
    expect(revoked[0]!.changes).toEqual({
      permission: PERMISSION,
      employeeId: inspectorEmployee.id,
      revoked: true,
    });
  });

  it("13. feiler revisjonsloggen, finnes heller ingen ny rad (samme transaksjon)", async () => {
    const { org, admin, inspectorEmployee } = await setup();
    // Databasen nekter alle nye linjer i revisjonsloggen mens testen går.
    // Produktkoden er urørt; feilen kommer fra en midlertidig utløser i testdatabasen.
    await db.execute(sql`
      create or replace function test_fail_audit_insert() returns trigger as $$
      begin
        raise exception 'revisjonsloggen feiler i testen';
      end;
      $$ language plpgsql`);
    await db.execute(sql`
      create trigger test_fail_audit_insert before insert on audit_log
      for each row execute function test_fail_audit_insert()`);
    try {
      await expect(
        grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION),
      ).rejects.toThrow();
      expect(await permissionRows()).toEqual([]);
    } finally {
      await db.execute(sql`drop trigger if exists test_fail_audit_insert on audit_log`);
      await db.execute(sql`drop function if exists test_fail_audit_insert()`);
    }

    // Samme for å ta bort: raden er fortsatt aktiv når loggen feiler
    const row = await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    await db.execute(sql`
      create or replace function test_fail_audit_insert() returns trigger as $$
      begin
        raise exception 'revisjonsloggen feiler i testen';
      end;
      $$ language plpgsql`);
    await db.execute(sql`
      create trigger test_fail_audit_insert before insert on audit_log
      for each row execute function test_fail_audit_insert()`);
    try {
      await expect(
        revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION),
      ).rejects.toThrow();
      const [after] = await db
        .select()
        .from(employeePermissions)
        .where(eq(employeePermissions.id, row.id));
      expect(after!.deletedAt).toBeNull();
    } finally {
      await db.execute(sql`drop trigger if exists test_fail_audit_insert on audit_log`);
      await db.execute(sql`drop function if exists test_fail_audit_insert()`);
    }
  });
});

describe("idempotens og myk sletting", () => {
  it("14. gi to ganger: samme rad, én aktiv rad, én linje i revisjonsloggen", async () => {
    const { org, admin, inspectorEmployee } = await setup();
    const first = await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    const second = await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);

    expect(second.id).toBe(first.id);
    expect(await activeRows(inspectorEmployee.id)).toHaveLength(1);
    expect(await auditRows()).toHaveLength(1);
  });

  it("15. to samtidige kall: ingen feil, én rad, én linje, samme rad-id", async () => {
    const { org, admin, inspectorEmployee } = await setup();
    const [a, b] = await Promise.all([
      grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION),
      grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION),
    ]);

    expect(a.id).toBe(b.id);
    expect(await permissionRows(inspectorEmployee.id)).toHaveLength(1);
    expect(await auditRows()).toHaveLength(1);
  });

  it("16. ta bort en rettighet som ikke er gitt: ingen feil, ingen endring, ingen logg", async () => {
    const { org, admin, inspectorEmployee } = await setup();
    const other = await grantPermission(inspectorEmployee, "report.edit");

    await revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);

    const rows = await permissionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(other.id);
    expect(rows[0]!.deletedAt).toBeNull();
    expect(await auditRows()).toEqual([]);
  });

  it("17. ta bort to ganger: andre kall gir ingen feil og ingen ny linje", async () => {
    const { org, admin, inspectorEmployee } = await setup();
    await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    await revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    const [first] = await permissionRows();
    await revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);

    expect(await auditRows()).toHaveLength(2);
    const rows = await permissionRows();
    expect(rows).toHaveLength(1);
    // Andre kall endrer ikke den slettede raden
    expect(rows[0]!.deletedAt).toEqual(first!.deletedAt);
  });

  it("18. gi, ta bort, gi igjen: ny rad, den gamle står med deleted_at og deleted_by", async () => {
    const { org, admin, inspectorEmployee } = await setup();
    const first = await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    expect(await permissionRows()).toHaveLength(1);
    await revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    expect(await permissionRows()).toHaveLength(1);
    const second = await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);

    expect(second.id).not.toBe(first.id);
    const rows = await permissionRows(inspectorEmployee.id);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.id === first.id)!;
    const current = rows.find((r) => r.id === second.id)!;
    expect(old.deletedAt).not.toBeNull();
    expect(old.deletedBy).not.toBeNull();
    expect(current.deletedAt).toBeNull();
  });

  it("19. effekten vises i neste tilgangssjekk", async () => {
    const { org, admin, inspector, inspectorEmployee } = await setup();
    await expect(requireOrganizationAccess(inspector, org.id, PERMISSION)).rejects.toThrow(
      AccessDeniedError,
    );
    await grantEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    await expect(requireOrganizationAccess(inspector, org.id, PERMISSION)).resolves.toBeDefined();
    await revokeEmployeePermission(admin, org.id, inspectorEmployee.id, PERMISSION);
    await expect(requireOrganizationAccess(inspector, org.id, PERMISSION)).rejects.toThrow(
      AccessDeniedError,
    );
  });
});

describe("skjema: delvis unik indeks", () => {
  it("to aktive like rader avvises, en aktiv og en slettet godtas", async () => {
    const { org, inspectorEmployee } = await setup();
    const values = {
      organizationId: org.id,
      employeeId: inspectorEmployee.id,
      permission: PERMISSION,
    };
    await db.insert(employeePermissions).values({ ...values, deletedAt: new Date() });
    await db.insert(employeePermissions).values(values);
    await expect(db.insert(employeePermissions).values(values)).rejects.toThrow();
    expect(await permissionRows()).toHaveLength(2);
  });
});
