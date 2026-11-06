import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { organizations, type EmployeeRole } from "@/db/schema";
import {
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import {
  AccessDeniedError,
  effectivePermissions,
  grantablePermissions,
  permissions,
  requireOrganizationAccess,
} from "./index";

/*
 * Rettigheten `statistics.read` (docs/funksjoner/fase2a-tidsmaling-testplan.md avsnitt 9.1 og
 * 9.2). Fasit skrevet for hånd: leder og admin ja, takstmann og kontor nei, uansett
 * `access.inspectors_edit_all`. Kan ikke gis enkeltvis (A21). Hele matrisen står i
 * guards.test.ts og permissions.test.ts; denne filen låser bare den nye rettigheten.
 *
 * Støtter hovedmål: tid (leder ser om vi nærmer oss målet) og arbeidsmiljøloven kapittel 9
 * (takstmenn og kontor ser ikke statistikken).
 */

beforeEach(resetDatabase);

const PERMISSION = "statistics.read";
const FASIT: Record<EmployeeRole, boolean> = {
  inspector: false,
  office: false,
  manager: true,
  admin: true,
};

const CASES = (["inspector", "office", "manager", "admin"] as const).flatMap((role) =>
  [true, false].map((setting) => ({ role, setting, allowed: FASIT[role] })),
);

describe("9.1 statistics.read per rolle", () => {
  it("statistics.read finnes i listen over rettigheter", () => {
    expect(permissions as readonly string[]).toContain(PERMISSION);
  });

  it.each(CASES)(
    "$role med inspectors_edit_all = $setting → $allowed",
    async ({ role, setting, allowed }) => {
      const org = await createOrganization();
      await db
        .update(organizations)
        .set({ settings: { "access.inspectors_edit_all": setting } })
        .where(eq(organizations.id, org.id));
      const actor = await createUser();
      await createEmployee(actor, org.id, [role]);

      const call = requireOrganizationAccess(actor, org.id, PERMISSION as never);
      if (allowed) await expect(call).resolves.toBeDefined();
      else await expect(call).rejects.toBeInstanceOf(AccessDeniedError);

      // Den rene funksjonen gir samme svar
      const effective = effectivePermissions([role], [], { inspectorsEditAll: setting });
      expect((effective as readonly string[]).includes(PERMISSION)).toBe(allowed);
    },
  );

  it("admin med bare adminrollen har statistics.read (regel 11, skal aldri fjernes)", async () => {
    const org = await createOrganization();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false } })
      .where(eq(organizations.id, org.id));
    const actor = await createUser();
    await createEmployee(actor, org.id, ["admin"]);
    await expect(
      requireOrganizationAccess(actor, org.id, PERMISSION as never),
    ).resolves.toBeDefined();
  });
});

describe("9.2 statistics.read kan ikke gis enkeltvis (A21)", () => {
  it("står ikke i grantablePermissions", () => {
    expect(grantablePermissions as readonly string[]).not.toContain(PERMISSION);
  });

  it.each(["inspector", "office"] as const)(
    "rad i employee_permissions gir ingen rettighet for %s",
    async (role) => {
      const org = await createOrganization();
      const admin = await createUser({ name: "Test Admin" });
      await createEmployee(admin, org.id, ["admin"]);
      const actor = await createUser();
      const employee = await createEmployee(actor, org.id, [role]);
      await grantPermission(employee, PERMISSION, admin.id);

      await expect(
        requireOrganizationAccess(actor, org.id, PERMISSION as never),
      ).rejects.toBeInstanceOf(AccessDeniedError);
      const grant = await requireOrganizationAccess(actor, org.id);
      expect(grant.permissions as readonly string[]).not.toContain(PERMISSION);
    },
  );

  it("den rene funksjonen ignorerer enkeltrettigheten", () => {
    for (const role of ["inspector", "office"] as const) {
      const effective = effectivePermissions([role], [PERMISSION], { inspectorsEditAll: true });
      expect(effective as readonly string[]).not.toContain(PERMISSION);
    }
  });
});
