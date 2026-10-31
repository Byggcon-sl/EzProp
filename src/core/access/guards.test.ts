import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { employeePermissions, employees, organizations, type EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  createCertification,
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { AccessDeniedError } from "./errors";
import { listOrganizationsForActor, requireOrganizationAccess } from "./guards";
import {
  effectivePermissions,
  grantHasPermission,
  isAdmin,
  permissions,
  type Permission,
} from "./permissions";

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

describe("requireOrganizationAccess", () => {
  it("gir en ansatt tilgang til egen organisasjon med rollene sine", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);
    // report.publish krever gyldig sertifisering (A29)
    await createCertification(employee);

    const grant = await requireOrganizationAccess(user, org.id);
    expect(grant).toEqual({
      employeeId: employee.id,
      organizationId: org.id,
      roles: ["inspector"],
      permissions: expect.arrayContaining([
        "organization.read",
        "assignment.edit",
        "report.edit",
        "report.publish",
        "invoice.send",
      ]),
    });
    expect(grant.permissions).toHaveLength(5);
  });

  it("nekter en ansatt i organisasjon A tilgang til organisasjon B (tenant-isolasjon)", async () => {
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const user = await createUser();
    await createEmployee(user, orgA.id, ["admin"]);

    await expect(requireOrganizationAccess(user, orgB.id)).rejects.toThrow(AccessDeniedError);
    // Heller ikke admin i A ser B
    for (const permission of permissions) {
      await expect(requireOrganizationAccess(user, orgB.id, permission)).rejects.toThrow(
        AccessDeniedError,
      );
    }
  });

  it("nekter noen som ikke er ansatt, ukjent id og ugyldig id", async () => {
    const org = await createOrganization();
    const outsider = await createUser();
    await expect(requireOrganizationAccess(outsider, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(
      requireOrganizationAccess(outsider, "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(AccessDeniedError);
    await expect(requireOrganizationAccess(outsider, "ikke-en-id")).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("nekter når den ansatte er fjernet (myk sletting) eller har sluttet", async () => {
    const org = await createOrganization();
    const removed = await createUser();
    const gone = await createUser();
    const a = await createEmployee(removed, org.id, ["inspector"]);
    const b = await createEmployee(gone, org.id, ["inspector"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, a.id));
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, b.id));

    await expect(requireOrganizationAccess(removed, org.id)).rejects.toThrow(AccessDeniedError);
    await expect(requireOrganizationAccess(gone, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("nekter tilgang til slettet organisasjon, også for admin", async () => {
    const org = await createOrganization();
    const admin = await createUser();
    await createEmployee(admin, org.id, ["admin"]);
    await db
      .update(organizations)
      .set({ deletedAt: new Date() })
      .where(eq(organizations.id, org.id));

    await expect(requireOrganizationAccess(admin, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("en ansatt uten roller kan ingenting, heller ikke lese", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, []);
    await expect(requireOrganizationAccess(user, org.id)).rejects.toThrow(AccessDeniedError);
  });
});

// --- Fase 0b: roller og rettigheter (testplan docs/funksjoner/fase0b-roller-rettigheter-testplan.md) ---

const SETTING = "access.inspectors_edit_all";

const allNine: readonly Permission[] = [
  "organization.read",
  "organization.manage",
  "claims.read",
  "staff.manage",
  "assignment.edit",
  "report.edit",
  "report.publish",
  "template.edit_structure",
  "invoice.send",
];

/** Fasit per rolle med innstillingen på. Skrevet ut for hånd, ikke regnet ut fra koden. */
const allowedWithSettingOn: Record<EmployeeRole, readonly Permission[]> = {
  inspector: [
    "organization.read",
    "assignment.edit",
    "report.edit",
    "report.publish",
    "invoice.send",
  ],
  office: ["organization.read", "assignment.edit", "invoice.send"],
  manager: [
    "organization.read",
    "claims.read",
    "staff.manage",
    "assignment.edit",
    "report.edit",
    "report.publish",
    "invoice.send",
  ],
  admin: allNine,
};

/** Fasit med innstillingen av: bare takstmann endres (mister assignment.edit og report.edit). */
const allowedWithSettingOff: Record<EmployeeRole, readonly Permission[]> = {
  ...allowedWithSettingOn,
  inspector: ["organization.read", "report.publish", "invoice.send"],
};

const roles: EmployeeRole[] = ["inspector", "office", "manager", "admin"];

function matrixCases(fasit: Record<EmployeeRole, readonly Permission[]>) {
  return roles.flatMap((role) =>
    allNine.map((permission) => ({ role, permission, allowed: fasit[role].includes(permission) })),
  );
}

type TestActor = Parameters<typeof requireOrganizationAccess>[0];

async function setSettings(organizationId: string, settings: Record<string, unknown>) {
  await db.update(organizations).set({ settings }).where(eq(organizations.id, organizationId));
}

async function expectAllowed(
  actor: TestActor,
  organizationId: string,
  permission: Permission,
  allowed: boolean,
) {
  if (allowed) {
    await expect(
      requireOrganizationAccess(actor, organizationId, permission),
    ).resolves.toBeDefined();
  } else {
    await expect(requireOrganizationAccess(actor, organizationId, permission)).rejects.toThrow(
      AccessDeniedError,
    );
  }
}

describe("tilgang per rolle", () => {
  it.each(matrixCases(allowedWithSettingOn))(
    "1. innstillingen på: $role på $permission = $allowed",
    async ({ role, permission, allowed }) => {
      const org = await createOrganization();
      await setSettings(org.id, { [SETTING]: true });
      const user = await createUser();
      const employee = await createEmployee(user, org.id, [role]);
      // Gyldig sertifisering, slik at matrisen viser rollene (report.publish krever den, A29)
      await createCertification(employee);
      await expectAllowed(user, org.id, permission, allowed);
    },
  );

  it.each(matrixCases(allowedWithSettingOff))(
    "2. innstillingen av: $role på $permission = $allowed",
    async ({ role, permission, allowed }) => {
      const org = await createOrganization();
      await setSettings(org.id, { [SETTING]: false });
      const user = await createUser();
      const employee = await createEmployee(user, org.id, [role]);
      // Gyldig sertifisering, slik at matrisen viser rollene (report.publish krever den, A29)
      await createCertification(employee);
      await expectAllowed(user, org.id, permission, allowed);
    },
  );

  it("3. innstillingen mangler: takstmann kan endre oppdrag og rapport", async () => {
    const org = await createOrganization();
    const user = await createUser();
    await createEmployee(user, org.id, ["inspector"]);
    await expectAllowed(user, org.id, "assignment.edit", true);
    await expectAllowed(user, org.id, "report.edit", true);
  });

  it("4. grant.permissions er lik effectivePermissions", async () => {
    const org = await createOrganization();
    await setSettings(org.id, { [SETTING]: false });
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);
    await createCertification(employee);
    await grantPermission(employee, "report.edit");

    const grant = await requireOrganizationAccess(user, org.id);
    expect([...grant.permissions].sort()).toEqual(
      [
        ...effectivePermissions(["inspector"], ["report.edit"], { inspectorsEditAll: false }),
      ].sort(),
    );
    expect(grant.permissions).toContain("report.edit");
    expect(grant.permissions).not.toContain("assignment.edit");
  });
});

describe("Admin stenges aldri ute, skal aldri fjernes", () => {
  async function expectAdminHasEverything(actor: TestActor, organizationId: string) {
    expect([...permissions].sort()).toEqual([...allNine].sort());
    for (const permission of permissions) {
      const grant = await requireOrganizationAccess(actor, organizationId, permission);
      expect(isAdmin(grant)).toBe(true);
      for (const p of permissions) expect(grantHasPermission(grant, p)).toBe(true);
    }
  }

  it("5. innstillingen av og bare slettede rader i employee_permissions: admin har alt", async () => {
    const org = await createOrganization();
    await setSettings(org.id, { [SETTING]: false });
    const user = await createUser();
    const admin = await createEmployee(user, org.id, ["admin"]);
    await createCertification(admin);
    for (const p of ["template.edit_structure", "report.edit", "organization.manage"]) {
      await grantPermission(admin, p);
    }
    await db
      .update(employeePermissions)
      .set({ deletedAt: new Date() })
      .where(eq(employeePermissions.employeeId, admin.id));

    await expectAdminHasEverything(user, org.id);
  });

  it("6. innstillingen av og ingen rader i employee_permissions: admin har alt", async () => {
    const org = await createOrganization();
    await setSettings(org.id, { [SETTING]: false });
    const user = await createUser();
    const admin = await createEmployee(user, org.id, ["admin"]);
    await createCertification(admin);

    await expectAdminHasEverything(user, org.id);
  });
});

describe("enkeltrettigheter", () => {
  it("7. virker i neste kall", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const manager = await createEmployee(user, org.id, ["manager"]);
    await expectAllowed(user, org.id, "template.edit_structure", false);

    await grantPermission(manager, "template.edit_structure");
    await expectAllowed(user, org.id, "template.edit_structure", true);
  });

  it("8. forsvinner etter myk sletting", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const manager = await createEmployee(user, org.id, ["manager"]);
    const row = await grantPermission(manager, "template.edit_structure");
    await expectAllowed(user, org.id, "template.edit_structure", true);

    await db
      .update(employeePermissions)
      .set({ deletedAt: new Date() })
      .where(eq(employeePermissions.id, row.id));
    await expectAllowed(user, org.id, "template.edit_structure", false);
  });

  it("9. rader med ukjent eller ikke-tillatt navn gir ingen tilgang og ingen krasj", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const inspector = await createEmployee(user, org.id, ["inspector"]);
    for (const name of ["organization.manage", "claims.read", "finnes.ikke"]) {
      await grantPermission(inspector, name);
    }
    await expectAllowed(user, org.id, "organization.manage", false);
    await expectAllowed(user, org.id, "claims.read", false);
    await expectAllowed(user, org.id, "organization.read", true);
    const grant = await requireOrganizationAccess(user, org.id);
    expect(grant.permissions as readonly string[]).not.toContain("finnes.ikke");
  });

  it("10. ansatt uten roller med template.edit_structure: godtas på den, avvises på lesing", async () => {
    const org = await createOrganization();
    const user = await createUser();
    const employee = await createEmployee(user, org.id, []);
    await grantPermission(employee, "template.edit_structure");

    await expectAllowed(user, org.id, "template.edit_structure", true);
    await expect(requireOrganizationAccess(user, org.id)).rejects.toThrow(AccessDeniedError);
  });

  it("11. enkeltrettighet for slettet eller deaktivert ansatt gir ingen tilgang", async () => {
    const org = await createOrganization();
    const removed = await createUser();
    const gone = await createUser();
    const a = await createEmployee(removed, org.id, ["inspector"]);
    const b = await createEmployee(gone, org.id, ["inspector"]);
    await grantPermission(a, "template.edit_structure");
    await grantPermission(b, "template.edit_structure");
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, a.id));
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, b.id));

    await expectAllowed(removed, org.id, "template.edit_structure", false);
    await expectAllowed(gone, org.id, "template.edit_structure", false);
  });
});

describe("tenant-isolasjon for rettigheter og innstilling", () => {
  it("12. rettighet gitt i A virker ikke i B", async () => {
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const user = await createUser();
    const inA = await createEmployee(user, orgA.id, ["inspector"]);
    await createEmployee(user, orgB.id, ["inspector"]);
    await grantPermission(inA, "template.edit_structure");

    await expectAllowed(user, orgA.id, "template.edit_structure", true);
    await expectAllowed(user, orgB.id, "template.edit_structure", false);
  });

  it("13. innstillingen av i B påvirker ikke A", async () => {
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    await setSettings(orgB.id, { [SETTING]: false });
    const user = await createUser();
    await createEmployee(user, orgA.id, ["inspector"]);
    await createEmployee(user, orgB.id, ["inspector"]);

    await expectAllowed(user, orgA.id, "assignment.edit", true);
    await expectAllowed(user, orgB.id, "assignment.edit", false);
  });

  it("14. rad med feil organisasjon avvises av databasen (sammensatt fremmednøkkel)", async () => {
    const orgA = await createOrganization("A");
    const orgB = await createOrganization("B");
    const user = await createUser();
    const inA = await createEmployee(user, orgA.id, ["inspector"]);

    await expect(
      db.insert(employeePermissions).values({
        organizationId: orgB.id,
        employeeId: inA.id,
        permission: "template.edit_structure",
      }),
    ).rejects.toThrow();
    expect(await db.select().from(employeePermissions)).toEqual([]);
  });
});

describe("innstilling med ugyldig verdi", () => {
  it("16. tekst «false» gir på, og én advarsel uten persondata", async () => {
    const org = await createOrganization();
    await setSettings(org.id, { [SETTING]: "false" });
    const user = await createUser({ name: "Test Takstmann Advarsel" });
    await createEmployee(user, org.id, ["inspector"]);
    const warn = vi.spyOn(logger, "warn");

    await expectAllowed(user, org.id, "report.edit", true);

    expect(warn).toHaveBeenCalledTimes(1);
    const call = JSON.stringify(warn.mock.calls[0]);
    expect(call).toContain(org.id);
    expect(call).toContain(SETTING);
    expect(call).not.toContain(user.email);
    expect(call).not.toContain(user.name);
    expect(call).not.toContain(user.id);
  });
});

describe("listOrganizationsForActor", () => {
  it("viser bare organisasjonene personen er ansatt i", async () => {
    const orgA = await createOrganization("A");
    await createOrganization("B");
    const user = await createUser();
    await createEmployee(user, orgA.id, ["inspector"]);
    const stranger = await createUser();

    expect(await listOrganizationsForActor(user)).toEqual([{ id: orgA.id, name: "A" }]);
    expect(await listOrganizationsForActor(stranger)).toEqual([]);
  });
});
