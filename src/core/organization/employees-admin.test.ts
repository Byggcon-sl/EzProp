import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import * as email from "@/core/email";
import { db } from "@/db/client";
import {
  auditLog,
  employeePermissions,
  employeeRoleAssignments,
  employees,
  sessions,
  users,
  type EmployeeRole,
} from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  auditRows,
  createCompany,
  createEmployee,
  createOffice,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  createEmployee as adminCreateEmployee,
  deactivateEmployee,
  findAdminOrganizationId,
  getEmployeeForAdmin,
  grantEmployeePermission,
  listEmployees,
  listEmployeesForAdmin,
  reactivateEmployee,
  revokeEmployeePermission,
  setEmployeeRoles,
  updateEmployee,
} from "./index";

// Testplan: docs/funksjoner/fase0b-admin-organisasjon-testplan.md, avsnitt 3 og 5.
// Testdata er oppdiktet: «Kari Testdatter», e-post på eksempel.no, org.nr. 000000001–000000009.

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const LAST_ADMIN = "Organisasjonen må ha minst én admin.";
const DUPLICATE_EMAIL = "Det finnes alt en ansatt med denne e-posten";
const KARI_NAME = "Kari Testdatter";
const KARI_EMAIL = "kari.testdatter@eksempel.no";
const KARI_TITLE = "Testtakstmann";

// ---------------------------------------------------------------------------------------------
// Hjelpere

/** Organisasjon med en admin og takstmannen Kari (stilling «Testtakstmann»). */
async function setup() {
  const org = await createOrganization();
  const admin = await createUser({ name: "Admin Testesen", email: "admin.testesen@eksempel.no" });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const kariUser = await createUser({ name: KARI_NAME, email: KARI_EMAIL });
  const kari = await createEmployee(kariUser, org.id, ["inspector"]);
  await db.update(employees).set({ jobTitle: KARI_TITLE }).where(eq(employees.id, kari.id));
  return { org, admin, adminEmployee, kariUser, kari };
}

/** En annen admin i samme organisasjon. */
async function secondAdmin(organizationId: string, name = "Admin Toesen") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, ["admin"]);
  return { actor, employee };
}

/** Antall rader i tabellene admin kan skrive til. */
async function countRows() {
  const [row] = await db.execute<{
    employees: number;
    employee_roles: number;
    employee_permissions: number;
    audit_log: number;
    users: number;
  }>(sql`select
      (select count(*)::int from employees) as employees,
      (select count(*)::int from employee_roles) as employee_roles,
      (select count(*)::int from employee_permissions) as employee_permissions,
      (select count(*)::int from audit_log) as audit_log,
      (select count(*)::int from users) as users`);
  if (!row) throw new Error("fant ikke tellingen");
  return {
    employees: row.employees,
    employeeRoles: row.employee_roles,
    employeePermissions: row.employee_permissions,
    auditLog: row.audit_log,
    users: row.users,
  };
}

async function employeeRow(id: string) {
  const [row] = await db.select().from(employees).where(eq(employees.id, id));
  if (!row) throw new Error("fant ikke den ansatte");
  return row;
}

async function roleRows(employeeId: string) {
  return db
    .select()
    .from(employeeRoleAssignments)
    .where(eq(employeeRoleAssignments.employeeId, employeeId))
    .orderBy(employeeRoleAssignments.createdAt);
}

async function activeRoleNames(employeeId: string) {
  return (await roleRows(employeeId))
    .filter((row) => row.deletedAt === null)
    .map((row) => row.role)
    .sort();
}

async function permissionRows(employeeId: string) {
  return db
    .select()
    .from(employeePermissions)
    .where(eq(employeePermissions.employeeId, employeeId));
}

/**
 * Antall aktive admin etter definisjonen i kortet (Omfang 4): rollen admin uten `deleted_at`, og
 * den ansatte er ikke slettet, har ikke sluttet og har innlogging. Bare brukt i denne filen.
 */
async function activeAdminCount(organizationId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(employeeRoleAssignments)
    .innerJoin(employees, eq(employees.id, employeeRoleAssignments.employeeId))
    .where(
      and(
        eq(employeeRoleAssignments.organizationId, organizationId),
        eq(employeeRoleAssignments.role, "admin"),
        isNull(employeeRoleAssignments.deletedAt),
        isNull(employees.deletedAt),
        isNull(employees.deactivatedAt),
        sql`${employees.userId} is not null`,
      ),
    );
  return row?.count ?? 0;
}

async function markDeactivated(employeeId: string) {
  await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, employeeId));
}

async function markDeleted(employeeId: string) {
  await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employeeId));
}

/** Fanger feilen fra et kall som skal feile. */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

/** Venter at kallet avvises med meldingen om siste admin (testene sjekker meldingen, ikke klassen). */
async function expectLastAdmin(promise: Promise<unknown>) {
  const error = await caught(promise);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(LAST_ADMIN);
}

// ---------------------------------------------------------------------------------------------
// Tabellene over funksjonene

type Target = { organizationId: string; employeeId: string };

/** De sju nye funksjonene for ansatte, kalt mot en målperson. */
const employeeCalls: ReadonlyArray<
  readonly [string, (actor: Actor, target: Target) => Promise<unknown>]
> = [
  ["listEmployeesForAdmin", (actor, t) => listEmployeesForAdmin(actor, t.organizationId)],
  ["getEmployeeForAdmin", (actor, t) => getEmployeeForAdmin(actor, t.organizationId, t.employeeId)],
  [
    "createEmployee",
    (actor, t) =>
      adminCreateEmployee(actor, t.organizationId, {
        name: "Ola Testmann",
        email: "ola.testmann@eksempel.no",
        roles: ["inspector"],
      }),
  ],
  [
    "updateEmployee",
    (actor, t) =>
      updateEmployee(actor, t.organizationId, t.employeeId, {
        name: KARI_NAME,
        jobTitle: "Endret stilling",
      }),
  ],
  [
    "setEmployeeRoles",
    (actor, t) => setEmployeeRoles(actor, t.organizationId, t.employeeId, ["inspector", "manager"]),
  ],
  ["deactivateEmployee", (actor, t) => deactivateEmployee(actor, t.organizationId, t.employeeId)],
  ["reactivateEmployee", (actor, t) => reactivateEmployee(actor, t.organizationId, t.employeeId)],
];

/** Funksjonene som tar en ansatt-id (fremmed id, ugyldig id, slettet ansatt). */
const byIdCalls: ReadonlyArray<
  readonly [
    string,
    (actor: Actor, organizationId: string, employeeId: string) => Promise<unknown>,
    (
      /** Målpersonen i B: aktiv, eller har sluttet (så «angre sluttet» ville gjort noe). */
      "active" | "deactivated"
    ),
  ]
> = [
  ["getEmployeeForAdmin", (a, o, id) => getEmployeeForAdmin(a, o, id), "active"],
  [
    "updateEmployee",
    (a, o, id) => updateEmployee(a, o, id, { name: "Endret Navn", jobTitle: "Endret" }),
    "active",
  ],
  ["setEmployeeRoles", (a, o, id) => setEmployeeRoles(a, o, id, ["manager"]), "active"],
  ["deactivateEmployee", (a, o, id) => deactivateEmployee(a, o, id), "active"],
  ["reactivateEmployee", (a, o, id) => reactivateEmployee(a, o, id), "deactivated"],
  [
    "grantEmployeePermission",
    (a, o, id) => grantEmployeePermission(a, o, id, "report.publish"),
    "active",
  ],
  [
    "revokeEmployeePermission",
    (a, o, id) => revokeEmployeePermission(a, o, id, "template.edit_structure"),
    "active",
  ],
];

const nonAdminRoles = ["inspector", "office", "manager"] as const;

// ---------------------------------------------------------------------------------------------
// 3.1 Tilgang per rolle

describe("tilgang per rolle", () => {
  it.each(
    employeeCalls.flatMap(([name, call]) =>
      nonAdminRoles.map((role) => [name, role, call] as const),
    ),
  )("%s med rollen %s gir AccessDeniedError og skriver ingenting", async (_name, role, call) => {
    const { org, kari } = await setup();
    const person = await createUser();
    await createEmployee(person, org.id, [role]);
    const before = await countRows();
    const kariBefore = await employeeRow(kari.id);

    await expect(call(person, { organizationId: org.id, employeeId: kari.id })).rejects.toThrow(
      AccessDeniedError,
    );

    expect(await countRows()).toEqual(before);
    expect(await employeeRow(kari.id)).toEqual(kariBefore);
  });

  it.each(
    employeeCalls.flatMap(([name, call]) =>
      (["uten roller", "admin som har sluttet"] as const).map(
        (variant) => [name, variant, call] as const,
      ),
    ),
  )("%s: ansatt %s får AccessDeniedError", async (_name, variant, call) => {
    const { org, kari } = await setup();
    const person = await createUser();
    const employee = await createEmployee(
      person,
      org.id,
      variant === "uten roller" ? [] : ["admin"],
    );
    if (variant === "admin som har sluttet") await markDeactivated(employee.id);
    const before = await countRows();

    await expect(call(person, { organizationId: org.id, employeeId: kari.id })).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await countRows()).toEqual(before);
  });

  it.each(employeeCalls)(
    "%s: enkeltrettigheten template.edit_structure gir ikke adminrettighet",
    async (_name, call) => {
      const { org, kari } = await setup();
      const person = await createUser();
      const employee = await createEmployee(person, org.id, ["inspector"]);
      await grantPermission(employee, "template.edit_structure");
      const before = await countRows();

      await expect(call(person, { organizationId: org.id, employeeId: kari.id })).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await countRows()).toEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 3.2 Tenant-isolasjon: ett expectTenantIsolation per ny funksjon (sju)

describe("tenant-isolasjon", () => {
  it("listEmployeesForAdmin viser aldri ansatte fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const company = await createCompany(grant.organizationId);
          const office = await createOffice(grant.organizationId);
          const person = await createUser({ name: `Testansatt ${side.toUpperCase()}` });
          const employee = await createEmployee(person, grant.organizationId, ["inspector"], {
            companyId: company.id,
            officeId: office.id,
          });
          ids[side].push(employee.id);
        }
        return ids;
      },
      query: listEmployeesForAdmin,
      idOf: (row) => row.id,
    });
  });

  it("getEmployeeForAdmin henter bare ansatte i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await createEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await getEmployeeForAdmin(
          actor,
          organizationId,
          employeeByOrg.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });
  });

  it("createEmployee legger den ansatte i egen organisasjon", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => [
        await adminCreateEmployee(actor, organizationId, {
          name: "Testansatt Ny",
          email: `${actor.id}@eksempel.no`,
          roles: ["inspector"],
        }),
      ],
      idOf: (row) => row.organizationId,
    });

    // Admin B og den nye ansatte, ikke noe fra A
    const inB = await db.select().from(employees).where(eq(employees.organizationId, orgB));
    expect(inB).toHaveLength(2);
  });

  it("updateEmployee endrer bare den ansatte i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    const callerByOrg = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await createEmployee(
          await createUser({ name: KARI_NAME }),
          grantA.organizationId,
          ["inspector"],
        );
        const b = await createEmployee(
          await createUser({ name: KARI_NAME }),
          grantB.organizationId,
          ["inspector"],
        );
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const row = await updateEmployee(
          actor,
          organizationId,
          employeeByOrg.get(organizationId) ?? randomUUID(),
          { name: KARI_NAME, jobTitle: `Endret av ${actor.id}` },
        );
        callerByOrg.set(organizationId, actor.id);
        return [row];
      },
      idOf: (row) => row.id,
    });

    const rowB = await employeeRow(employeeByOrg.get(orgB) ?? "");
    expect(rowB.jobTitle).toBe(`Endret av ${callerByOrg.get(orgB)}`);
    expect(rowB.rowVersion).toBe(2);
  });

  it("setEmployeeRoles endrer bare roller i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await createEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await createEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const employeeId = employeeByOrg.get(organizationId) ?? randomUUID();
        const roles = await setEmployeeRoles(actor, organizationId, employeeId, [
          "inspector",
          "office",
        ]);
        expect([...roles].sort()).toEqual(["inspector", "office"]);
        return [{ id: employeeId }];
      },
      idOf: (row) => row.id,
    });

    const employeeB = employeeByOrg.get(orgB) ?? "";
    const officeRows = (await roleRows(employeeB)).filter(
      (row) => row.role === "office" && row.deletedAt === null,
    );
    expect(officeRows).toHaveLength(1);
    const logB = (await auditRows(orgB)).filter((row) => row.action === "role_change");
    expect(logB).toHaveLength(1);
  });

  it("deactivateEmployee markerer bare ansatte i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        // Takstmann, ikke admin, så regelen om siste admin slår ikke inn.
        const a = await createEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await createEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await deactivateEmployee(
          actor,
          organizationId,
          employeeByOrg.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });

    const logB = (await auditRows(orgB)).filter((row) => row.action === "deactivate");
    expect(logB).toHaveLength(1);
  });

  it("reactivateEmployee angrer bare i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await createEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await createEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        await markDeactivated(a.id);
        await markDeactivated(b.id);
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await reactivateEmployee(
          actor,
          organizationId,
          employeeByOrg.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });

    const logB = (await auditRows(orgB)).filter((row) => row.action === "reactivate");
    expect(logB).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3 Fremmed id i egen organisasjon (regel 2)

describe("fremmed, ugyldig og slettet id", () => {
  /** Admin i A, og i B en aktiv og en sluttet ansatt med rolle og enkeltrettighet. */
  async function twoOrganizations() {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const adminA = await createUser({ name: "Admin A" });
    await createEmployee(adminA, orgA.id, ["admin"]);
    await createEmployee(await createUser({ name: "Admin B" }), orgB.id, ["admin"]);
    const activeB = await createEmployee(await createUser({ name: KARI_NAME }), orgB.id, [
      "inspector",
    ]);
    await grantPermission(activeB, "template.edit_structure");
    const deactivatedB = await createEmployee(await createUser(), orgB.id, ["inspector"]);
    await markDeactivated(deactivatedB.id);
    return { orgA, orgB, adminA, activeB, deactivatedB };
  }

  async function snapshot(employeeId: string) {
    return {
      employee: await employeeRow(employeeId),
      roles: await roleRows(employeeId),
      permissions: await permissionRows(employeeId),
    };
  }

  it.each(byIdCalls)(
    "%s med en ansatt-id fra B gir AccessDeniedError, og B er uendret",
    async (_name, call, targetKind) => {
      const { orgA, adminA, activeB, deactivatedB } = await twoOrganizations();
      const target = targetKind === "active" ? activeB : deactivatedB;
      const before = await snapshot(target.id);

      await expect(call(adminA, orgA.id, target.id)).rejects.toThrow(AccessDeniedError);

      expect(await snapshot(target.id)).toEqual(before);
      expect((await db.select().from(auditLog)).length).toBe(0);
    },
  );

  it.each(
    byIdCalls.flatMap(([name, call]) =>
      (["ikke-en-id", "tilfeldig uuid"] as const).map((kind) => [name, kind, call] as const),
    ),
  )("%s med %s gir AccessDeniedError uten databasefeil", async (_name, kind, call) => {
    const { org, admin } = await setup();
    const id = kind === "ikke-en-id" ? "ikke-en-id" : randomUUID();

    await expect(call(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
    expect((await db.select().from(auditLog)).length).toBe(0);
  });

  it.each(byIdCalls)(
    "%s på en slettet ansatt i egen organisasjon gir AccessDeniedError",
    async (_name, call) => {
      const { org, admin, kari } = await setup();
      await grantPermission(kari, "template.edit_structure");
      await markDeleted(kari.id);
      const before = await snapshot(kari.id);

      await expect(call(admin, org.id, kari.id)).rejects.toThrow(AccessDeniedError);

      expect(await snapshot(kari.id)).toEqual(before);
      expect((await db.select().from(auditLog)).length).toBe(0);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 3.4 Selskap og kontor på ansatt

describe("selskap og kontor på den ansatte", () => {
  type Variant = "companyFromB" | "officeFromB" | "deletedCompany" | "deletedOffice";
  type InvalidVariant = "invalidCompany" | "invalidOffice";

  async function context() {
    const base = await setup();
    const orgB = await createOrganization("Organisasjon B");
    const companyB = await createCompany(orgB.id, { legalName: "Testselskap B AS" });
    const officeB = await createOffice(orgB.id, { name: "Testkontor B" });
    const deletedCompany = await createCompany(base.org.id, {
      legalName: "Slettet Testselskap AS",
      deletedAt: new Date(),
    });
    const deletedOffice = await createOffice(base.org.id, {
      name: "Slettet testkontor",
      deletedAt: new Date(),
    });
    return { ...base, companyB, officeB, deletedCompany, deletedOffice };
  }

  function refs(
    ctx: Awaited<ReturnType<typeof context>>,
    variant: Variant | InvalidVariant,
  ): { companyId: string | null; officeId: string | null } {
    switch (variant) {
      case "companyFromB":
        return { companyId: ctx.companyB.id, officeId: null };
      case "officeFromB":
        return { companyId: null, officeId: ctx.officeB.id };
      case "deletedCompany":
        return { companyId: ctx.deletedCompany.id, officeId: null };
      case "deletedOffice":
        return { companyId: null, officeId: ctx.deletedOffice.id };
      case "invalidCompany":
        return { companyId: "ikke-en-id", officeId: null };
      case "invalidOffice":
        return { companyId: null, officeId: "ikke-en-id" };
    }
  }

  const variants: Array<Variant | InvalidVariant> = [
    "companyFromB",
    "officeFromB",
    "deletedCompany",
    "deletedOffice",
    "invalidCompany",
    "invalidOffice",
  ];

  it.each(variants)("createEmployee med %s avvises, og ingen rad skrives", async (variant) => {
    const ctx = await context();
    const before = await countRows();

    await expect(
      adminCreateEmployee(ctx.admin, ctx.org.id, {
        name: "Ola Testmann",
        email: "ola.testmann@eksempel.no",
        roles: ["inspector"],
        ...refs(ctx, variant),
      }),
    ).rejects.toThrow(AccessDeniedError);

    expect(await countRows()).toEqual(before);
  });

  it.each(variants)("updateEmployee med %s avvises, og raden er uendret", async (variant) => {
    const ctx = await context();
    const before = await employeeRow(ctx.kari.id);

    await expect(
      updateEmployee(ctx.admin, ctx.org.id, ctx.kari.id, {
        name: KARI_NAME,
        jobTitle: KARI_TITLE,
        ...refs(ctx, variant),
      }),
    ).rejects.toThrow(AccessDeniedError);

    expect(await employeeRow(ctx.kari.id)).toEqual(before);
    expect((await db.select().from(auditLog)).length).toBe(0);
  });

  it("selskap og kontor i egen organisasjon og null er lov", async () => {
    const { org, admin, kari } = await setup();
    const company = await createCompany(org.id);
    const office = await createOffice(org.id);

    const created = await adminCreateEmployee(admin, org.id, {
      name: "Ola Testmann",
      email: "ola.testmann@eksempel.no",
      companyId: company.id,
      officeId: office.id,
      roles: [],
    });
    expect(created).toMatchObject({ companyId: company.id, officeId: office.id });

    const withoutBoth = await adminCreateEmployee(admin, org.id, {
      name: "Per Testmann",
      email: "per.testmann@eksempel.no",
      companyId: null,
      officeId: null,
      roles: [],
    });
    expect(withoutBoth).toMatchObject({ companyId: null, officeId: null });

    const updated = await updateEmployee(admin, org.id, kari.id, {
      name: KARI_NAME,
      jobTitle: KARI_TITLE,
      companyId: company.id,
      officeId: office.id,
    });
    expect(updated).toMatchObject({ companyId: company.id, officeId: office.id });
  });
});

// ---------------------------------------------------------------------------------------------
// 3.5 Ny ansatt og innlogging (A26)

describe("ny ansatt og innlogging", () => {
  it("ny e-post lager en ny innlogging med små bokstaver, og den ansatte får rollene", async () => {
    const { org, admin } = await setup();
    const usersBefore = (await countRows()).users;

    const created = await adminCreateEmployee(admin, org.id, {
      name: "Ola Testmann",
      email: "Ola.Testmann@Eksempel.NO",
      roles: ["inspector", "office"],
    });

    expect((await countRows()).users).toBe(usersBefore + 1);
    const [user] = await db.select().from(users).where(eq(users.email, "ola.testmann@eksempel.no"));
    expect(user).toBeDefined();
    expect(created.userId).toBe(user?.id);
    expect(created.organizationId).toBe(org.id);
    expect(await activeRoleNames(created.id)).toEqual(["inspector", "office"]);
  });

  it("e-post med mellomrom og store bokstaver treffer eksisterende innlogging uten å endre navnet", async () => {
    const { org, admin } = await setup();
    const ola = await createUser({ name: "Ola Testmann", email: "ola@eksempel.no" });
    const usersBefore = (await countRows()).users;

    const created = await adminCreateEmployee(admin, org.id, {
      name: "Annet Testnavn",
      email: "  Ola@Eksempel.NO ",
      roles: ["inspector"],
    });

    expect((await countRows()).users).toBe(usersBefore);
    expect(created.userId).toBe(ola.id);
    const [user] = await db.select().from(users).where(eq(users.id, ola.id));
    expect(user?.name).toBe("Ola Testmann");
  });

  it("duplikat i samme organisasjon gir meldingen og skriver ingenting", async () => {
    const { org, admin } = await setup();
    const before = await countRows();

    const error = await caught(
      adminCreateEmployee(admin, org.id, { name: "Ny Kari", email: KARI_EMAIL, roles: [] }),
    );

    expect((error as Error).message).toBe(DUPLICATE_EMAIL);
    expect(await countRows()).toEqual(before);
  });

  it("samme melding uansett om e-posten finnes i en annen organisasjon", async () => {
    const { org: orgA, admin: adminA } = await setup();
    const orgB = await createOrganization("Organisasjon B");
    const ola = await createUser({ name: "Ola Testmann", email: "ola@eksempel.no" });
    await createEmployee(ola, orgA.id, ["inspector"]);

    // Bare i A
    const onlyInA = await caught(
      adminCreateEmployee(adminA, orgA.id, { name: "Ola", email: "ola@eksempel.no", roles: [] }),
    );
    // I A og B
    await createEmployee(ola, orgB.id, ["inspector"]);
    const inAandB = await caught(
      adminCreateEmployee(adminA, orgA.id, { name: "Ola", email: "ola@eksempel.no", roles: [] }),
    );

    expect((onlyInA as Error).message).toBe(DUPLICATE_EMAIL);
    expect((inAandB as Error).message).toBe((onlyInA as Error).message);
  });

  it("e-post som bare finnes i en annen organisasjon: opprettingen lykkes uten å nevne den", async () => {
    const { org: orgA, admin: adminA } = await setup();
    const orgB = await createOrganization("Organisasjon B");
    const per = await createUser({ name: "Per Testmann Innlogging", email: "per@eksempel.no" });
    await createEmployee(per, orgB.id, ["inspector"]);

    const created = await adminCreateEmployee(adminA, orgA.id, {
      name: "Per Ny",
      email: "per@eksempel.no",
      roles: ["inspector"],
    });
    const seen = await getEmployeeForAdmin(adminA, orgA.id, created.id);

    expect(created.organizationId).toBe(orgA.id);
    for (const answer of [created, seen]) {
      const text = JSON.stringify(answer);
      expect(text).not.toContain(orgB.id);
      expect(text).not.toContain("Per Testmann Innlogging");
    }
  });

  it("duplikat også når den eksisterende ansatte har sluttet", async () => {
    const { org, admin, kari } = await setup();
    await markDeactivated(kari.id);
    const before = await countRows();

    const error = await caught(
      adminCreateEmployee(admin, org.id, { name: KARI_NAME, email: KARI_EMAIL, roles: [] }),
    );

    expect((error as Error).message).toBe(DUPLICATE_EMAIL);
    expect(await countRows()).toEqual(before);
  });

  it("ingen e-post sendes når en ansatt legges inn (A26)", async () => {
    const { org, admin } = await setup();
    const send = vi.spyOn(email, "sendEmail");
    const mailboxBefore = email.readDevMailbox().length;

    await adminCreateEmployee(admin, org.id, {
      name: "Ola Testmann",
      email: "ola.testmann@eksempel.no",
      roles: ["inspector"],
    });

    expect(send).not.toHaveBeenCalled();
    expect(email.readDevMailbox()).toHaveLength(mailboxBefore);
  });

  it("den nye ansatte får tilgang med en gang", async () => {
    const { org, admin } = await setup();
    const created = await adminCreateEmployee(admin, org.id, {
      name: "Ola Testmann",
      email: "ola.testmann@eksempel.no",
      roles: ["inspector"],
    });
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, created.userId ?? ""));
    if (!user) throw new Error("fant ikke innloggingen");

    const grant = await requireOrganizationAccess(user, org.id, "organization.read");
    expect(grant.employeeId).toBe(created.id);
    await expect(requireOrganizationAccess(user, org.id, "assignment.edit")).resolves.toBeDefined();
  });

  it("e-post bare for admin: listEmployeesForAdmin og getEmployeeForAdmin gir faste felt", async () => {
    const { org, admin, kari } = await setup();
    await grantPermission(kari, "template.edit_structure");
    const adminKeys = [
      "companyId",
      "companyName",
      "deactivatedAt",
      "email",
      "id",
      "jobTitle",
      "name",
      "officeId",
      "officeName",
      "permissions",
      "roles",
    ];

    const list = await listEmployeesForAdmin(admin, org.id);
    for (const row of list) expect(Object.keys(row).sort()).toEqual(adminKeys);
    const one = await getEmployeeForAdmin(admin, org.id, kari.id);
    expect(Object.keys(one).sort()).toEqual(adminKeys);
    expect(one).toMatchObject({
      email: KARI_EMAIL,
      roles: ["inspector"],
      permissions: ["template.edit_structure"],
    });

    const plain = await listEmployees(admin, org.id);
    for (const row of plain) expect(row).not.toHaveProperty("email");
  });

  it("listEmployeesForAdmin viser den som har sluttet etter de aktive, og ikke slettede", async () => {
    const { org, admin, kari } = await setup();
    const bjorn = await createEmployee(await createUser({ name: "Bjørn Testmann" }), org.id, [
      "inspector",
    ]);
    const removed = await createEmployee(await createUser({ name: "Slettet Testmann" }), org.id, [
      "inspector",
    ]);
    // «Aaa» ville stått først hvis den bare ble sortert på navn
    const aaa = await createEmployee(await createUser({ name: "Aaa Testmann" }), org.id, [
      "inspector",
    ]);
    await markDeactivated(aaa.id);
    await markDeleted(removed.id);

    const ids = (await listEmployeesForAdmin(admin, org.id)).map((row) => row.id);

    expect(ids).not.toContain(removed.id);
    expect(ids.at(-1)).toBe(aaa.id);
    expect(ids).toEqual(expect.arrayContaining([bjorn.id, kari.id]));
  });
});

// ---------------------------------------------------------------------------------------------
// 3.6 Roller og enkeltrettigheter

describe("roller og enkeltrettigheter", () => {
  it("setEmployeeRoles legger til og tar bort med myk sletting", async () => {
    const { org, admin, kari } = await setup();

    await setEmployeeRoles(admin, org.id, kari.id, ["inspector", "manager"]);
    expect(await roleRows(kari.id)).toHaveLength(2);

    const result = await setEmployeeRoles(admin, org.id, kari.id, ["manager"]);
    expect(result).toEqual(["manager"]);
    const rows = await roleRows(kari.id);
    expect(rows).toHaveLength(2);
    const inspectorRow = rows.find((row) => row.role === "inspector");
    expect(inspectorRow?.deletedAt).toBeInstanceOf(Date);
    expect(await activeRoleNames(kari.id)).toEqual(["manager"]);
  });

  it("samme roller på nytt gir ingen nye rader, ingen ny deleted_at og ingen loggrad", async () => {
    const { org, admin, kari } = await setup();
    await setEmployeeRoles(admin, org.id, kari.id, ["inspector", "manager"]);
    const rowsBefore = await roleRows(kari.id);
    const auditBefore = (await auditRows(org.id)).length;

    await setEmployeeRoles(admin, org.id, kari.id, ["manager", "inspector"]);

    expect(await roleRows(kari.id)).toEqual(rowsBefore);
    expect(await auditRows(org.id)).toHaveLength(auditBefore);
  });

  it("fjernet og gitt rolle og enkeltrettighet slår ut i neste tilgangssjekk", async () => {
    const { org, admin, kari, kariUser } = await setup();

    await setEmployeeRoles(admin, org.id, kari.id, ["inspector", "manager"]);
    await expect(
      requireOrganizationAccess(kariUser, org.id, "staff.manage"),
    ).resolves.toBeDefined();

    await setEmployeeRoles(admin, org.id, kari.id, ["inspector"]);
    await expect(requireOrganizationAccess(kariUser, org.id, "staff.manage")).rejects.toThrow(
      AccessDeniedError,
    );

    await expect(
      requireOrganizationAccess(kariUser, org.id, "organization.manage"),
    ).rejects.toThrow(AccessDeniedError);
    await setEmployeeRoles(admin, org.id, kari.id, ["inspector", "admin"]);
    await expect(
      requireOrganizationAccess(kariUser, org.id, "organization.manage"),
    ).resolves.toBeDefined();

    await setEmployeeRoles(admin, org.id, kari.id, ["inspector"]);
    await grantEmployeePermission(admin, org.id, kari.id, "template.edit_structure");
    await expect(
      requireOrganizationAccess(kariUser, org.id, "template.edit_structure"),
    ).resolves.toBeDefined();
    await revokeEmployeePermission(admin, org.id, kari.id, "template.edit_structure");
    await expect(
      requireOrganizationAccess(kariUser, org.id, "template.edit_structure"),
    ).rejects.toThrow(AccessDeniedError);
  });

  it.each([
    ["ukjent rolle", ["superadmin"]],
    ["tom streng", [""]],
  ])("setEmployeeRoles avviser %s med ZodError", async (_label, roles) => {
    const { org, admin, kari } = await setup();
    const before = await roleRows(kari.id);

    const error = await caught(
      setEmployeeRoles(admin, org.id, kari.id, roles as unknown as EmployeeRole[]),
    );

    expect(error).toBeInstanceOf(ZodError);
    expect(await roleRows(kari.id)).toEqual(before);
  });

  it("grantEmployeePermission avviser en rettighet som ikke kan gis", async () => {
    const { org, admin, kari } = await setup();
    const error = await caught(
      grantEmployeePermission(admin, org.id, kari.id, "organization.manage"),
    );
    expect(error).toBeInstanceOf(ZodError);
    expect(await permissionRows(kari.id)).toHaveLength(0);
  });

  it.each([
    ["e-post uten @", { email: "ola" }],
    ["e-post uten domene", { email: "ola@" }],
    ["e-post uten navn", { email: "@eksempel.no" }],
    ["tom e-post", { email: "" }],
    ["tomt navn", { name: "" }],
    ["navn med bare mellomrom", { name: "   " }],
    ["ukjent rolle", { roles: ["superadmin"] as unknown as EmployeeRole[] }],
  ])("createEmployee avviser %s med ZodError uten rad", async (_label, override) => {
    const { org, admin } = await setup();
    const before = await countRows();

    const error = await caught(
      adminCreateEmployee(admin, org.id, {
        name: "Ola Testmann",
        email: "ola.testmann@eksempel.no",
        roles: ["inspector"],
        ...override,
      }),
    );

    expect(error).toBeInstanceOf(ZodError);
    expect(await countRows()).toEqual(before);
  });

  it("updateEmployee avviser tomt navn med ZodError", async () => {
    const { org, admin, kari } = await setup();
    const before = await employeeRow(kari.id);
    const error = await caught(updateEmployee(admin, org.id, kari.id, { name: "  " }));
    expect(error).toBeInstanceOf(ZodError);
    expect(await employeeRow(kari.id)).toEqual(before);
  });

  it("fjern, gi og fjern samme rolle gir to slettede rader, ingen aktiv, og ingen rader forsvinner", async () => {
    const { org, admin, kari } = await setup();
    await setEmployeeRoles(admin, org.id, kari.id, ["inspector", "manager"]);
    let counts = await countRows();

    for (const roles of [["inspector"], ["inspector", "manager"], ["inspector"]] as const) {
      await setEmployeeRoles(admin, org.id, kari.id, [...roles]);
      const now = await countRows();
      expect(now.employees).toBeGreaterThanOrEqual(counts.employees);
      expect(now.employeeRoles).toBeGreaterThanOrEqual(counts.employeeRoles);
      counts = now;
    }

    const managerRows = (await roleRows(kari.id)).filter((row) => row.role === "manager");
    expect(managerRows).toHaveLength(2);
    expect(managerRows.every((row) => row.deletedAt !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.7 Sluttet og angre

describe("sluttet og angre sluttet", () => {
  it("deactivateEmployee setter deactivated_at, beholder raden og stenger tilgangen", async () => {
    const { org, admin, kari, kariUser } = await setup();
    await db.insert(sessions).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: kariUser.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const [userBefore] = await db.select().from(users).where(eq(users.id, kariUser.id));
    const sessionsBefore = await db.select().from(sessions).where(eq(sessions.userId, kariUser.id));
    await expect(requireOrganizationAccess(kariUser, org.id)).resolves.toBeDefined();

    const row = await deactivateEmployee(admin, org.id, kari.id);

    expect(row.deactivatedAt).toBeInstanceOf(Date);
    const after = await employeeRow(kari.id);
    expect(after).toMatchObject({ userId: kariUser.id, name: KARI_NAME, deletedAt: null });
    expect(after.deactivatedAt).toBeInstanceOf(Date);
    expect(await activeRoleNames(kari.id)).toEqual(["inspector"]);
    await expect(requireOrganizationAccess(kariUser, org.id)).rejects.toThrow(AccessDeniedError);
    const [userAfter] = await db.select().from(users).where(eq(users.id, kariUser.id));
    expect(userAfter).toEqual(userBefore);
    expect(await db.select().from(sessions).where(eq(sessions.userId, kariUser.id))).toEqual(
      sessionsBefore,
    );
  });

  it("reactivateEmployee nullstiller deactivated_at, og tilgangen virker igjen", async () => {
    const { org, admin, kari, kariUser } = await setup();
    await deactivateEmployee(admin, org.id, kari.id);

    const row = await reactivateEmployee(admin, org.id, kari.id);

    expect(row.deactivatedAt).toBeNull();
    expect((await employeeRow(kari.id)).deactivatedAt).toBeNull();
    await expect(requireOrganizationAccess(kariUser, org.id)).resolves.toBeDefined();
  });

  it("reactivateEmployee avviser en ansatt uten innlogging", async () => {
    const { org, admin } = await setup();
    const [withoutLogin] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Tidligere Testmann",
        deactivatedAt: new Date(),
      })
      .returning();
    if (!withoutLogin) throw new Error("kunne ikke opprette ansatt");

    await expect(reactivateEmployee(admin, org.id, withoutLogin.id)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await employeeRow(withoutLogin.id)).toEqual(withoutLogin);
    expect(await auditRows(org.id)).toHaveLength(0);
  });

  it("deactivateEmployee på en som alt har sluttet endrer ikke tidspunktet og logger ikke på nytt", async () => {
    const { org, admin, kari } = await setup();
    await deactivateEmployee(admin, org.id, kari.id);
    const first = await employeeRow(kari.id);
    const auditBefore = (await auditRows(org.id)).length;

    await caught(deactivateEmployee(admin, org.id, kari.id));

    expect((await employeeRow(kari.id)).deactivatedAt).toEqual(first.deactivatedAt);
    expect(await auditRows(org.id)).toHaveLength(auditBefore);
  });

  it("den som har sluttet, står fortsatt i listene", async () => {
    const { org, admin, kari } = await setup();
    await deactivateEmployee(admin, org.id, kari.id);

    const forAdmin = await listEmployeesForAdmin(admin, org.id);
    expect(forAdmin.find((row) => row.id === kari.id)?.deactivatedAt).toBeInstanceOf(Date);
    const all = await listEmployees(admin, org.id, { includeDeactivated: true });
    expect(all.map((row) => row.id)).toContain(kari.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.8 Admin stenges aldri ute (A25).
// Testene i denne blokken skal aldri fjernes (CLAUDE.md regel 11, A25).

describe("admin stenges aldri ute", () => {
  // Denne testen skal aldri fjernes (CLAUDE.md regel 11, A25)
  it.each([
    ["ingen roller", [] as EmployeeRole[]],
    ["bare takstmann", ["inspector"] as EmployeeRole[]],
  ])("siste admin kan ikke miste rollen (%s)", async (_label, roles) => {
    const { org, admin, adminEmployee } = await setup();
    const auditBefore = (await auditRows(org.id)).length;

    await expectLastAdmin(setEmployeeRoles(admin, org.id, adminEmployee.id, roles));

    expect(await activeRoleNames(adminEmployee.id)).toEqual(["admin"]);
    expect(await activeAdminCount(org.id)).toBe(1);
    expect(await auditRows(org.id)).toHaveLength(auditBefore);
  });

  // Denne testen skal aldri fjernes (CLAUDE.md regel 11, A25)
  it("siste admin kan ikke markere seg selv som sluttet", async () => {
    const { org, admin, adminEmployee } = await setup();
    const auditBefore = (await auditRows(org.id)).length;

    await expectLastAdmin(deactivateEmployee(admin, org.id, adminEmployee.id));

    expect((await employeeRow(adminEmployee.id)).deactivatedAt).toBeNull();
    expect(await activeAdminCount(org.id)).toBe(1);
    expect(await auditRows(org.id)).toHaveLength(auditBefore);
  });

  // Denne testen skal aldri fjernes (CLAUDE.md regel 11, A25)
  it("med to aktive admin kan rollen tas fra én, men ikke fra den siste", async () => {
    const { org, admin, adminEmployee } = await setup();
    const other = await secondAdmin(org.id);

    await setEmployeeRoles(admin, org.id, other.employee.id, ["inspector"]);
    expect(await activeAdminCount(org.id)).toBe(1);

    await expectLastAdmin(setEmployeeRoles(admin, org.id, adminEmployee.id, ["inspector"]));
    expect(await activeAdminCount(org.id)).toBe(1);
  });

  // Denne testen skal aldri fjernes (CLAUDE.md regel 11, A25)
  it.each([
    ["har sluttet", "deactivated"],
    ["er slettet", "deleted"],
    ["har admin-rollen slettet", "roleDeleted"],
    ["mangler innlogging", "noUser"],
  ] as const)("en admin som %s regnes ikke med", async (_label, kind) => {
    const { org, admin, adminEmployee } = await setup();
    if (kind === "noUser") {
      // Sluttet uten innlogging (D18), satt inn direkte
      const [ghost] = await db
        .insert(employees)
        .values({
          organizationId: org.id,
          userId: null,
          name: "Tidligere Admin",
          deactivatedAt: new Date(),
        })
        .returning();
      if (!ghost) throw new Error("kunne ikke opprette ansatt");
      await db
        .insert(employeeRoleAssignments)
        .values({ organizationId: org.id, employeeId: ghost.id, role: "admin" });
    } else {
      const other = await secondAdmin(org.id);
      if (kind === "deactivated") await markDeactivated(other.employee.id);
      if (kind === "deleted") await markDeleted(other.employee.id);
      if (kind === "roleDeleted") {
        await db
          .update(employeeRoleAssignments)
          .set({ deletedAt: new Date() })
          .where(eq(employeeRoleAssignments.employeeId, other.employee.id));
      }
    }
    const auditBefore = (await auditRows(org.id)).length;

    await expectLastAdmin(setEmployeeRoles(admin, org.id, adminEmployee.id, ["inspector"]));
    await expectLastAdmin(deactivateEmployee(admin, org.id, adminEmployee.id));

    expect(await activeRoleNames(adminEmployee.id)).toEqual(["admin"]);
    expect((await employeeRow(adminEmployee.id)).deactivatedAt).toBeNull();
    expect(await auditRows(org.id)).toHaveLength(auditBefore);
  });

  describe("samtidige endringer (5 runder per variant)", () => {
    const ROUNDS = 5;

    /** To aktive admin, A og B, i samme organisasjon. */
    async function twoAdmins() {
      const org = await createOrganization();
      const a = await secondAdmin(org.id, "Admin A");
      const b = await secondAdmin(org.id, "Admin B");
      return { org, a, b };
    }

    /**
     * Nøyaktig ett kall lykkes, ett avvises, og det finnes nøyaktig én aktiv admin etterpå.
     * Den som avvises, får meldingen om siste admin. Rekker den andre å bli ferdig før
     * tilgangssjekken til den avviste er gjort, er den avviste ikke lenger admin og får
     * `AccessDeniedError`; det er også riktig (ingen ble stengt ute), og godtas derfor.
     */
    async function expectExactlyOne(
      organizationId: string,
      results: PromiseSettledResult<unknown>[],
    ) {
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const reason = rejected[0]?.reason as Error;
      expect([LAST_ADMIN, new AccessDeniedError().message]).toContain(reason.message);
      expect(await activeAdminCount(organizationId)).toBe(1);
    }

    // Denne testen skal aldri fjernes (CLAUDE.md regel 11, A25)
    it("a. A tar rollen fra B mens B tar rollen fra A", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetDatabase();
        const { org, a, b } = await twoAdmins();
        const results = await Promise.allSettled([
          setEmployeeRoles(a.actor, org.id, b.employee.id, ["inspector"]),
          setEmployeeRoles(b.actor, org.id, a.employee.id, ["inspector"]),
        ]);
        await expectExactlyOne(org.id, results);
      }
    });

    // Denne testen skal aldri fjernes (CLAUDE.md regel 11, A25)
    it("b. A og B markerer hverandre som sluttet", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetDatabase();
        const { org, a, b } = await twoAdmins();
        const results = await Promise.allSettled([
          deactivateEmployee(a.actor, org.id, b.employee.id),
          deactivateEmployee(b.actor, org.id, a.employee.id),
        ]);
        await expectExactlyOne(org.id, results);
      }
    });

    // Denne testen skal aldri fjernes (CLAUDE.md regel 11, A25)
    it("c. A tar rollen fra B mens B markerer A som sluttet", async () => {
      for (let round = 0; round < ROUNDS; round += 1) {
        await resetDatabase();
        const { org, a, b } = await twoAdmins();
        const results = await Promise.allSettled([
          setEmployeeRoles(a.actor, org.id, b.employee.id, ["inspector"]),
          deactivateEmployee(b.actor, org.id, a.employee.id),
        ]);
        await expectExactlyOne(org.id, results);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 3.9 Revisjonslogg og feillogg uten persontekst

describe("revisjonslogg uten persontekst", () => {
  type Action =
    | "create"
    | "update"
    | "role_change"
    | "permission_change"
    | "deactivate"
    | "reactivate";

  /** Kjører handlingen og gir id-en loggraden skal peke på. */
  const actions: ReadonlyArray<
    readonly [Action, (ctx: Awaited<ReturnType<typeof setup>>) => Promise<string>]
  > = [
    [
      "create",
      async ({ org, admin }) =>
        (
          await adminCreateEmployee(admin, org.id, {
            name: "Kari Testdatter",
            email: "Kari.Testdatter@Eksempel.no",
            jobTitle: KARI_TITLE,
            roles: ["inspector"],
          })
        ).id,
    ],
    [
      "update",
      async ({ org, admin, kari }) =>
        (
          await updateEmployee(admin, org.id, kari.id, {
            name: `${KARI_NAME} Ny`,
            jobTitle: `${KARI_TITLE} senior`,
          })
        ).id,
    ],
    [
      "role_change",
      async ({ org, admin, kari }) => {
        await setEmployeeRoles(admin, org.id, kari.id, ["inspector", "manager"]);
        return kari.id;
      },
    ],
    [
      "permission_change",
      async ({ org, admin, kari }) =>
        (await grantEmployeePermission(admin, org.id, kari.id, "template.edit_structure")).id,
    ],
    [
      "deactivate",
      async ({ org, admin, kari }) => (await deactivateEmployee(admin, org.id, kari.id)).id,
    ],
    [
      "reactivate",
      async ({ org, admin, kari }) => {
        await markDeactivated(kari.id);
        return (await reactivateEmployee(admin, org.id, kari.id)).id;
      },
    ],
  ];

  it.each(actions)("%s skriver ikke navn, e-post eller stilling", async (action, run) => {
    const ctx = await setup();
    // `create` lager sin egen Kari; den fra oppsettet må ikke ha samme e-post
    if (action === "create") {
      await db
        .update(users)
        .set({ email: "annen@eksempel.no" })
        .where(eq(users.id, ctx.kariUser.id));
    }

    const entityId = await run(ctx);

    const rows = (await auditRows(ctx.org.id)).filter((row) => row.action === action);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ action, entityId, organizationId: ctx.org.id });
    const text = JSON.stringify(row?.changes).toLowerCase();
    expect(text).not.toContain(KARI_NAME.toLowerCase());
    expect(text).not.toContain(KARI_EMAIL);
    expect(text).not.toContain(KARI_TITLE.toLowerCase());
  });

  it("update lister navnene på feltene som er endret, ikke verdiene", async () => {
    const { org, admin, kari } = await setup();

    await updateEmployee(admin, org.id, kari.id, { name: KARI_NAME, jobTitle: "Ny stilling" });

    const [row] = (await auditRows(org.id)).filter((r) => r.action === "update");
    expect(row?.changes).toEqual({ fields: ["jobTitle"] });
  });

  it("en createEmployee som stoppes, skriver ikke persontekst til loggen", async () => {
    const { org, admin } = await setup();
    const orgB = await createOrganization("Organisasjon B");
    const companyB = await createCompany(orgB.id);
    const written: string[] = [];
    const capture = (...args: unknown[]) => {
      written.push(JSON.stringify(args));
    };
    for (const method of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, method).mockImplementation(capture);
    }
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }

    await caught(
      adminCreateEmployee(admin, org.id, {
        name: KARI_NAME,
        email: KARI_EMAIL,
        jobTitle: KARI_TITLE,
        roles: [],
      }),
    );
    await caught(
      adminCreateEmployee(admin, org.id, {
        name: KARI_NAME,
        email: "kari.ny@eksempel.no",
        jobTitle: KARI_TITLE,
        companyId: companyB.id,
        roles: [],
      }),
    );

    const text = written.join("\n").toLowerCase();
    for (const value of [KARI_NAME, KARI_EMAIL, "kari.ny@eksempel.no", KARI_TITLE]) {
      expect(text).not.toContain(value.toLowerCase());
    }
  });
});

// ---------------------------------------------------------------------------------------------
// findAdminOrganizationId (brukes av menyen og sidene i /admin)

describe("findAdminOrganizationId", () => {
  it("gir organisasjonen for admin og null for andre og for admin som har sluttet", async () => {
    const { org, admin, adminEmployee, kariUser } = await setup();

    expect(await findAdminOrganizationId(admin)).toBe(org.id);
    expect(await findAdminOrganizationId(kariUser)).toBeNull();

    await secondAdmin(org.id);
    await markDeactivated(adminEmployee.id);
    expect(await findAdminOrganizationId(admin)).toBeNull();
  });

  it("gir aldri en organisasjon der personen ikke er admin", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const person = await createUser();
    await createEmployee(person, orgA.id, ["inspector"]);
    await createEmployee(person, orgB.id, ["admin"]);

    expect(await findAdminOrganizationId(person)).toBe(orgB.id);
  });
});
