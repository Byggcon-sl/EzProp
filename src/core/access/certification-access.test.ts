import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCertification as adminCreateCertification,
  listEmployeesForAdmin,
  listExpiringCertifications,
} from "@/core/organization";
import { db } from "@/db/client";
import { certifications, organizations, type EmployeeRole } from "@/db/schema";
import {
  createCertification,
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import {
  AccessDeniedError,
  effectivePermissions,
  permissions,
  requireOrganizationAccess,
  type Actor,
  type Permission,
} from "./index";

/*
 * Sjekken i tilgangsmodulen: report.publish krever gyldig sertifisering (A29), og bare den tas
 * bort. Admin stenges aldri ute (regel 11).
 * Testplan: docs/funksjoner/fase0b-sertifisering-testplan.md avsnitt 2.1 og 2.2.
 * Støtter hovedmål: reklamasjoner (ingen publiserer uten gyldig sertifisering).
 * Testdata er oppdiktet.
 */

const NOW = new Date("2026-10-31T10:00:00Z");
const SETTING = "access.inspectors_edit_all";

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

type Employee = Awaited<ReturnType<typeof createEmployee>>;

async function setSettings(organizationId: string, settings: Record<string, unknown>) {
  await db.update(organizations).set({ settings }).where(eq(organizations.id, organizationId));
}

async function person(roles: EmployeeRole[], name = "Kari Testdatter") {
  const org = await createOrganization();
  const user = await createUser({ name });
  const employee = await createEmployee(user, org.id, roles);
  return { org, user, employee };
}

async function grantOf(user: Actor, organizationId: string) {
  return requireOrganizationAccess(user, organizationId);
}

async function canPublish(user: Actor, organizationId: string): Promise<boolean> {
  try {
    await requireOrganizationAccess(user, organizationId, "report.publish");
    return true;
  } catch (error) {
    if (error instanceof AccessDeniedError) return false;
    throw error;
  }
}

/** Tilstandene uten gyldig sertifisering (2.1.1). */
const invalidStates: { navn: string; give: (employee: Employee) => Promise<unknown> }[] = [
  { navn: "uten sertifisering", give: async () => undefined },
  {
    navn: "utgått i går",
    give: (employee) => createCertification(employee, { validTo: "2026-10-30" }),
  },
  {
    navn: "starter i morgen",
    give: (employee) =>
      createCertification(employee, { validFrom: "2026-11-01", validTo: "2028-01-01" }),
  },
  {
    navn: "slettet",
    give: (employee) =>
      createCertification(employee, {
        validTo: "2027-10-31",
        deletedAt: new Date("2026-10-30T10:00:00Z"),
      }),
  },
];

const publishingRoles: EmployeeRole[] = ["inspector", "manager", "admin"];

describe("2.1 report.publish krever gyldig sertifisering", () => {
  const matrix = publishingRoles.flatMap((role) =>
    invalidStates.map((state) => ({ role, state: state.navn, give: state.give })),
  );

  it.each(matrix)("$role, $state: report.publish nektes", async ({ role, give }) => {
    const { org, user, employee } = await person([role]);
    await give(employee);
    await expect(requireOrganizationAccess(user, org.id, "report.publish")).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    const grant = await grantOf(user, org.id);
    expect(grant.permissions).not.toContain("report.publish");
  });

  it.each(
    publishingRoles.flatMap((role) => [
      { role, navn: "utløper i dag", validTo: "2026-10-31" },
      { role, navn: "ett år frem", validTo: "2027-10-31" },
    ]),
  )("$role, gyldig ($navn): report.publish lykkes", async ({ role, validTo }) => {
    const { org, user, employee } = await person([role]);
    await createCertification(employee, { validTo });
    const grant = await requireOrganizationAccess(user, org.id, "report.publish");
    expect(grant.permissions).toContain("report.publish");
  });

  it("enkeltrettighet: kontor med report.publish uten sertifisering nektes, med gyldig lykkes", async () => {
    const { org, user, employee } = await person(["office"]);
    await grantPermission(employee, "report.publish");
    expect(await canPublish(user, org.id)).toBe(false);

    await createCertification(employee, { validTo: "2027-10-31" });
    expect(await canPublish(user, org.id)).toBe(true);
  });

  it.each([true, false])(
    "innstillingen inspectors_edit_all = %s: report.publish følger sertifiseringen, report.edit og assignment.edit følger innstillingen",
    async (editAll) => {
      const { org, user, employee } = await person(["inspector"]);
      await setSettings(org.id, { [SETTING]: editAll });

      let grant = await grantOf(user, org.id);
      expect(grant.permissions).not.toContain("report.publish");
      expect(grant.permissions.includes("report.edit")).toBe(editAll);
      expect(grant.permissions.includes("assignment.edit")).toBe(editAll);

      await createCertification(employee, { validTo: "2027-10-31" });
      grant = await grantOf(user, org.id);
      expect(grant.permissions).toContain("report.publish");
      expect(grant.permissions.includes("report.edit")).toBe(editAll);
      expect(grant.permissions.includes("assignment.edit")).toBe(editAll);
    },
  );

  it.each<EmployeeRole>(["inspector", "office", "manager", "admin"])(
    "%s uten sertifisering: rettighetene er effectivePermissions minus report.publish, verken mer eller mindre",
    async (role) => {
      const { org, user } = await person([role]);
      const grant = await grantOf(user, org.id);
      const expected = effectivePermissions([role], [], { inspectorsEditAll: true }).filter(
        (p) => p !== "report.publish",
      );
      expect([...grant.permissions].sort()).toEqual([...expected].sort());
    },
  );

  it("fornyet: gammel utgått rad og ny gyldig rad gir report.publish", async () => {
    const { org, user, employee } = await person(["inspector"]);
    await createCertification(employee, { validTo: "2026-10-30" });
    await createCertification(employee, { validTo: "2028-10-31" });
    expect(await canPublish(user, org.id)).toBe(true);
  });

  it("gammel gyldig rad og ny slettet rad gir fortsatt report.publish", async () => {
    const { org, user, employee } = await person(["inspector"]);
    await createCertification(employee, { validTo: "2027-06-30" });
    await createCertification(employee, {
      validTo: "2028-10-31",
      deletedAt: new Date("2026-10-31T09:00:00Z"),
    });
    expect(await canPublish(user, org.id)).toBe(true);
  });

  it("sertifisering i en annen organisasjon teller ikke", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const user = await createUser({ name: "Kari Testdatter" });
    await createEmployee(user, orgA.id, ["inspector"]);
    const inB = await createEmployee(user, orgB.id, ["inspector"]);
    await createCertification(inB, { validTo: "2027-10-31" });

    expect((await grantOf(user, orgA.id)).permissions).not.toContain("report.publish");
    expect((await grantOf(user, orgB.id)).permissions).toContain("report.publish");
    expect(await canPublish(user, orgA.id)).toBe(false);
  });

  it("en kollegas gyldige sertifisering i samme organisasjon gir meg ikke report.publish", async () => {
    const { org, user } = await person(["inspector"]);
    const colleague = await createUser({ name: "Ola Testesen" });
    const colleagueEmployee = await createEmployee(colleague, org.id, ["inspector"]);
    await createCertification(colleagueEmployee, { validTo: "2027-10-31" });

    expect(await canPublish(user, org.id)).toBe(false);
    expect(await canPublish(colleague, org.id)).toBe(true);
  });

  it.each([
    { now: "2026-10-31T22:59:59Z", forventet: true },
    { now: "2026-10-31T23:00:00Z", forventet: false },
  ])(
    "utløp ved midnatt i Oslo: validTo 2026-10-31 kl. $now → $forventet",
    async ({ now, forventet }) => {
      const { org, user, employee } = await person(["inspector"]);
      await createCertification(employee, { validTo: "2026-10-31" });
      vi.setSystemTime(new Date(now));
      expect(await canPublish(user, org.id)).toBe(forventet);
    },
  );
});

// Admin stenges aldri ute (regel 11). Testene i denne blokken skal aldri fjernes eller svekkes.
describe("2.2 Admin stenges aldri ute, skal aldri fjernes", () => {
  /** Alle rettigheter unntatt report.publish (fast liste, så en ny rettighet må tas stilling til). */
  const ADMIN_WITHOUT_PUBLISH: Permission[] = [
    "organization.read",
    "organization.manage",
    "claims.read",
    "staff.manage",
    "assignment.edit",
    "report.edit",
    "template.edit_structure",
    "invoice.send",
  ];

  it("den faste listen er alle rettigheter unntatt report.publish", () => {
    expect([...ADMIN_WITHOUT_PUBLISH].sort()).toEqual(
      permissions.filter((p) => p !== "report.publish").sort(),
    );
  });

  it("admin uten sertifisering har alle admin-rettigheter unntatt report.publish", async () => {
    const { org, user } = await person(["admin"], "Admin Testesen");
    const grant = await grantOf(user, org.id);
    expect([...grant.permissions].sort()).toEqual([...ADMIN_WITHOUT_PUBLISH].sort());
    for (const p of ADMIN_WITHOUT_PUBLISH) {
      await expect(requireOrganizationAccess(user, org.id, p)).resolves.toBeTruthy();
    }
  });

  it("admin med utgått sertifisering har det samme", async () => {
    const { org, user, employee } = await person(["admin"], "Admin Testesen");
    await createCertification(employee, { validTo: "2026-10-30" });
    const grant = await grantOf(user, org.id);
    expect([...grant.permissions].sort()).toEqual([...ADMIN_WITHOUT_PUBLISH].sort());
    await expect(
      requireOrganizationAccess(user, org.id, "organization.manage"),
    ).resolves.toBeTruthy();
    await expect(requireOrganizationAccess(user, org.id, "staff.manage")).resolves.toBeTruthy();
  });

  it("admin uten sertifisering kan kjøre adminfunksjonene", async () => {
    const { org, user, employee } = await person(["admin"], "Admin Testesen");
    await expect(listEmployeesForAdmin(user, org.id)).resolves.toBeInstanceOf(Array);
    await expect(
      adminCreateCertification(user, org.id, {
        employeeId: employee.id,
        validTo: "2026-11-10",
      }),
    ).resolves.toMatchObject({ employeeId: employee.id });
    await expect(listExpiringCertifications(user, org.id)).resolves.toBeInstanceOf(Array);
  });

  it("admin uten sertifisering kan gi seg selv sertifisering, og får så report.publish", async () => {
    const { org, user, employee } = await person(["admin"], "Admin Testesen");
    expect(await canPublish(user, org.id)).toBe(false);

    await adminCreateCertification(user, org.id, {
      employeeId: employee.id,
      validTo: "2027-10-31",
    });
    const rows = await db
      .select()
      .from(certifications)
      .where(eq(certifications.employeeId, employee.id));
    expect(rows).toHaveLength(1);
    await expect(requireOrganizationAccess(user, org.id, "report.publish")).resolves.toMatchObject({
      employeeId: employee.id,
    });
  });

  it("leder uten sertifisering beholder leder-rettighetene unntatt report.publish", async () => {
    const { org, user } = await person(["manager"], "Leder Testesen");
    const grant = await grantOf(user, org.id);
    expect([...grant.permissions].sort()).toEqual(
      [
        "organization.read",
        "claims.read",
        "staff.manage",
        "assignment.edit",
        "report.edit",
        "invoice.send",
      ].sort(),
    );
    await expect(requireOrganizationAccess(user, org.id, "claims.read")).resolves.toBeTruthy();
  });
});
