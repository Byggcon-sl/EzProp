import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
  activeAdminCount,
  auditRows,
  createCompany as seedCompany,
  createEmployee as seedEmployee,
  createOffice as seedOffice,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  createEmployee,
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

/*
 * Admin: ansatte, roller, enkeltrettigheter, sluttet og «admin stenges aldri ute».
 * Testplan: docs/funksjoner/fase0b-admin-organisasjon-testplan.md, avsnitt 3.
 * Oppgavekort: docs/funksjoner/fase0b-admin-organisasjon.md (Omfang 2–7).
 * Testdata er oppdiktet (eksempel.no, org.nr. 00000000x, «Kari Testdatter»).
 */

// Spion på e-post: kjernen skal aldri sende e-post når en ansatt legges inn (A26).
vi.mock("@/core/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/email")>();
  return { ...actual, sendEmail: vi.fn(actual.sendEmail) };
});

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});

const LAST_ADMIN_MESSAGE = "Organisasjonen må ha minst én admin.";
const DUPLICATE_EMAIL_MESSAGE = "Det finnes alt en ansatt med denne e-posten";
const PERMISSION = "template.edit_structure";

type NewEmployeeInput = Parameters<typeof createEmployee>[2];
type EmployeeUpdate = Parameters<typeof updateEmployee>[3];
type RolesArg = Parameters<typeof setEmployeeRoles>[3];

let emailCounter = 0;

/** Ny ansatt med oppdiktede verdier. E-posten er unik per kall med mindre testen gir en. */
function newEmployee(overrides: Record<string, unknown> = {}): NewEmployeeInput {
  emailCounter += 1;
  return {
    name: "Ny Testansatt",
    email: `ny.testansatt.${emailCounter}@eksempel.no`,
    jobTitle: "Testtakstmann",
    companyId: null,
    officeId: null,
    roles: ["inspector"],
    ...overrides,
  } as NewEmployeeInput;
}

function employeeUpdate(overrides: Record<string, unknown> = {}): EmployeeUpdate {
  return {
    name: "Ny Testansatt",
    jobTitle: "Testtakstmann",
    companyId: null,
    officeId: null,
    ...overrides,
  } as EmployeeUpdate;
}

function roles(...list: string[]): RolesArg {
  return list as unknown as RolesArg;
}

async function orgWithAdmin(name = "Organisasjon A") {
  const org = await createOrganization(name);
  const admin = await createUser({ name: "Test Admin" });
  const adminEmployee = await seedEmployee(admin, org.id, ["admin"]);
  return { org, admin, adminEmployee };
}

/** En ansatt i organisasjonen (via fabrikken), med innlogging. */
async function seedPerson(
  organizationId: string,
  personRoles: EmployeeRole[] = ["inspector"],
  overrides: { name?: string; email?: string } = {},
) {
  const actor = await createUser({
    name: overrides.name ?? "Test Takstmann",
    email: overrides.email,
  });
  const employee = await seedEmployee(actor, organizationId, personRoles);
  return { actor, employee };
}

async function markDeactivated(employeeId: string) {
  await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, employeeId));
}

async function markDeleted(employeeId: string) {
  await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, employeeId));
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
    .where(eq(employeeRoleAssignments.employeeId, employeeId));
}

async function activeRoles(employeeId: string) {
  const rows = await roleRows(employeeId);
  return rows
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

async function tableCounts() {
  const [e, r, a, u] = await Promise.all([
    db.select({ id: employees.id }).from(employees),
    db.select({ id: employeeRoleAssignments.id }).from(employeeRoleAssignments),
    db.select({ id: auditLog.id }).from(auditLog),
    db.select({ id: users.id }).from(users),
  ]);
  return { employees: e.length, roles: r.length, audit: a.length, users: u.length };
}

async function actorByEmail(address: string): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.email, address));
  if (!row) throw new Error(`fant ingen innlogging for ${address}`);
  return row;
}

/** Venter at kallet avvises, men ikke av en rå databasefeil (det ville gitt 500 i skjermen). */
async function expectRejectedWithoutDatabaseError(call: Promise<unknown>) {
  const error: unknown = await call.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, "kallet skulle vært avvist").toBeInstanceOf(Error);
  const cause = (error as { cause?: { code?: string } }).cause;
  expect(cause?.code, "databasefeil slapp gjennom").toBeUndefined();
  expect((error as Error).message).not.toMatch(/Failed query|violates|syntax for type uuid/i);
}

const nonAdminRoles: EmployeeRole[] = ["inspector", "office", "manager"];

/** Alle nye funksjoner, kalt mot en ansatt i organisasjonen. */
const adminCalls: Record<
  string,
  (actor: Actor, organizationId: string, employeeId: string) => Promise<unknown>
> = {
  listEmployeesForAdmin: (actor, organizationId) => listEmployeesForAdmin(actor, organizationId),
  getEmployeeForAdmin: (actor, organizationId, employeeId) =>
    getEmployeeForAdmin(actor, organizationId, employeeId),
  createEmployee: (actor, organizationId) =>
    createEmployee(actor, organizationId, newEmployee({ email: "rolletest@eksempel.no" })),
  updateEmployee: (actor, organizationId, employeeId) =>
    updateEmployee(actor, organizationId, employeeId, employeeUpdate({ jobTitle: "Endret" })),
  setEmployeeRoles: (actor, organizationId, employeeId) =>
    setEmployeeRoles(actor, organizationId, employeeId, roles("inspector", "office")),
  deactivateEmployee: (actor, organizationId, employeeId) =>
    deactivateEmployee(actor, organizationId, employeeId),
  reactivateEmployee: (actor, organizationId, employeeId) =>
    reactivateEmployee(actor, organizationId, employeeId),
};
const adminCallNames = Object.keys(adminCalls);

// ---------------------------------------------------------------------------------------------
// 3.1 Tilgang per rolle
// ---------------------------------------------------------------------------------------------

describe("3.1 tilgang per rolle", () => {
  const cases = adminCallNames.flatMap((name) =>
    nonAdminRoles.map((role) => [name, role] as const),
  );

  it.each(cases)("%s med rollen %s gir AccessDeniedError og ingen endring", async (name, role) => {
    const { org } = await orgWithAdmin();
    const { actor } = await seedPerson(org.id, [role]);
    const { employee: target } = await seedPerson(org.id, ["inspector"]);
    const before = await tableCounts();
    const targetBefore = await employeeRow(target.id);

    await expect(adminCalls[name]!(actor, org.id, target.id)).rejects.toThrow(AccessDeniedError);

    expect(await tableCounts()).toEqual(before);
    expect(await employeeRow(target.id)).toEqual(targetBefore);
  });

  it.each(adminCallNames)("%s: ansatt uten roller får AccessDeniedError", async (name) => {
    const { org } = await orgWithAdmin();
    const { actor } = await seedPerson(org.id, []);
    const { employee: target } = await seedPerson(org.id, ["inspector"]);
    const before = await tableCounts();

    await expect(adminCalls[name]!(actor, org.id, target.id)).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(before);
  });

  it.each(adminCallNames)("%s: admin som har sluttet får AccessDeniedError", async (name) => {
    const { org } = await orgWithAdmin();
    const { actor, employee } = await seedPerson(org.id, ["admin"]);
    await markDeactivated(employee.id);
    const { employee: target } = await seedPerson(org.id, ["inspector"]);
    const before = await tableCounts();

    await expect(adminCalls[name]!(actor, org.id, target.id)).rejects.toThrow(AccessDeniedError);
    expect(await tableCounts()).toEqual(before);
  });

  it.each(adminCallNames)(
    "%s: takstmann med enkeltrettigheten template.edit_structure får fortsatt AccessDeniedError",
    async (name) => {
      const { org } = await orgWithAdmin();
      const { actor, employee } = await seedPerson(org.id, ["inspector"]);
      await grantPermission(employee, PERMISSION);
      const { employee: target } = await seedPerson(org.id, ["inspector"]);
      const before = await tableCounts();

      await expect(adminCalls[name]!(actor, org.id, target.id)).rejects.toThrow(AccessDeniedError);
      expect(await tableCounts()).toEqual(before);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// 3.2 Tenant-isolasjon (ett expectTenantIsolation per funksjon)
// ---------------------------------------------------------------------------------------------

describe("3.2 tenant-isolasjon", () => {
  it("1. listEmployeesForAdmin gir aldri ansatte fra en annen organisasjon", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const companyA = await seedCompany(grantA.organizationId, {
          legalName: "Testselskap A AS",
        });
        const companyB = await seedCompany(grantB.organizationId, {
          legalName: "Testselskap B AS",
        });
        const officeA = await seedOffice(grantA.organizationId, { name: "Testkontor A" });
        const officeB = await seedOffice(grantB.organizationId, { name: "Testkontor B" });
        const a = await seedEmployee(await createUser(), grantA.organizationId, ["inspector"], {
          companyId: companyA.id,
          officeId: officeA.id,
        });
        const b = await seedEmployee(await createUser(), grantB.organizationId, ["inspector"], {
          companyId: companyB.id,
          officeId: officeB.id,
        });
        return { a: [a.id], b: [b.id] };
      },
      query: listEmployeesForAdmin,
      idOf: (row) => row.id,
    });
  });

  it("2. getEmployeeForAdmin gir bare den ansatte i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await seedEmployee(await createUser(), grantB.organizationId, ["inspector"]);
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

  it("3. createEmployee legger den ansatte i egen organisasjon", async () => {
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => {
        const row = await createEmployee(
          actor,
          organizationId,
          newEmployee({ email: `${actor.id}@eksempel.no` }),
        );
        return [await employeeRow(row.id)];
      },
      idOf: (row) => row.organizationId,
    });
    const inB = await db.select().from(employees).where(eq(employees.organizationId, orgB));
    // Admin B fra hjelperen og den nye ansatte
    expect(inB).toHaveLength(2);
  });

  it("4. updateEmployee endrer bare den ansatte i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    const actorByOrg = new Map<string, Actor>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await seedEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await seedEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const employeeId = employeeByOrg.get(organizationId) ?? randomUUID();
        await updateEmployee(
          actor,
          organizationId,
          employeeId,
          employeeUpdate({ name: "Test Takstmann", jobTitle: `Endret av ${actor.id}` }),
        );
        actorByOrg.set(organizationId, actor);
        return [await employeeRow(employeeId)];
      },
      idOf: (row) => row.id,
    });
    const rowB = await employeeRow(employeeByOrg.get(orgB)!);
    expect(rowB.jobTitle).toBe(`Endret av ${actorByOrg.get(orgB)!.id}`);
    expect(rowB.rowVersion).toBe(2);
  });

  it("5. setEmployeeRoles endrer bare rollene i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await seedEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await seedEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const employeeId = employeeByOrg.get(organizationId) ?? randomUUID();
        await setEmployeeRoles(actor, organizationId, employeeId, roles("inspector", "office"));
        return [await employeeRow(employeeId)];
      },
      idOf: (row) => row.id,
    });
    const employeeB = employeeByOrg.get(orgB)!;
    const officeRows = (await roleRows(employeeB)).filter(
      (row) => row.role === "office" && row.deletedAt === null,
    );
    expect(officeRows).toHaveLength(1);
    const logB = (await auditRows(orgB)).filter((row) => row.action === "role_change");
    expect(logB).toHaveLength(1);
  });

  it("6. deactivateEmployee markerer bare den ansatte i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        // Takstmann, ikke admin: regelen om siste admin slår ikke inn
        const a = await seedEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await seedEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const employeeId = employeeByOrg.get(organizationId) ?? randomUUID();
        await deactivateEmployee(actor, organizationId, employeeId);
        return [await employeeRow(employeeId)];
      },
      idOf: (row) => row.id,
    });
    const logB = (await auditRows(orgB)).filter((row) => row.action === "deactivate");
    expect(logB).toHaveLength(1);
    expect((await employeeRow(employeeByOrg.get(orgB)!)).deactivatedAt).not.toBeNull();
  });

  it("7. reactivateEmployee angrer bare i egen organisasjon", async () => {
    const employeeByOrg = new Map<string, string>();
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgB = grantB.organizationId;
        const a = await seedEmployee(await createUser(), grantA.organizationId, ["inspector"]);
        const b = await seedEmployee(await createUser(), grantB.organizationId, ["inspector"]);
        await markDeactivated(a.id);
        await markDeactivated(b.id);
        employeeByOrg.set(grantA.organizationId, a.id);
        employeeByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const employeeId = employeeByOrg.get(organizationId) ?? randomUUID();
        await reactivateEmployee(actor, organizationId, employeeId);
        return [await employeeRow(employeeId)];
      },
      idOf: (row) => row.id,
    });
    const logB = (await auditRows(orgB)).filter((row) => row.action === "reactivate");
    expect(logB).toHaveLength(1);
    expect((await employeeRow(employeeByOrg.get(orgB)!)).deactivatedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3 Fremmed id i egen organisasjon (regel 2)
// ---------------------------------------------------------------------------------------------

/** Funksjonene som tar en ansatt-id, kalt av admin i orgA. */
const idCalls: Record<
  string,
  (actor: Actor, organizationId: string, employeeId: string) => Promise<unknown>
> = {
  getEmployeeForAdmin: (actor, organizationId, employeeId) =>
    getEmployeeForAdmin(actor, organizationId, employeeId),
  updateEmployee: (actor, organizationId, employeeId) =>
    updateEmployee(actor, organizationId, employeeId, employeeUpdate({ jobTitle: "Kapret" })),
  setEmployeeRoles: (actor, organizationId, employeeId) =>
    setEmployeeRoles(actor, organizationId, employeeId, roles("admin")),
  deactivateEmployee: (actor, organizationId, employeeId) =>
    deactivateEmployee(actor, organizationId, employeeId),
  reactivateEmployee: (actor, organizationId, employeeId) =>
    reactivateEmployee(actor, organizationId, employeeId),
  grantEmployeePermission: (actor, organizationId, employeeId) =>
    grantEmployeePermission(actor, organizationId, employeeId, PERMISSION),
  revokeEmployeePermission: (actor, organizationId, employeeId) =>
    revokeEmployeePermission(actor, organizationId, employeeId, PERMISSION),
};
const idCallNames = Object.keys(idCalls);

describe("3.3 fremmed, ugyldig, ukjent og slettet id", () => {
  async function snapshot(employeeId: string) {
    return {
      employee: await employeeRow(employeeId),
      roles: await roleRows(employeeId),
      permissions: await permissionRows(employeeId),
    };
  }

  it.each(idCallNames)("1. %s med en ansatt-id fra B gir AccessDeniedError", async (name) => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const { org: orgB } = await orgWithAdmin("Organisasjon B");
    const { employee: targetB } = await seedPerson(orgB.id, ["inspector"]);
    // Én enkeltrettighet, så revoke har noe å ta bort hvis isolasjonen svikter
    await grantPermission(targetB, PERMISSION);
    // Sluttet-variant for reactivate, så kallet ellers ville lyktes
    if (name === "reactivateEmployee") await markDeactivated(targetB.id);
    const before = await snapshot(targetB.id);

    await expect(idCalls[name]!(adminA, orgA.id, targetB.id)).rejects.toThrow(AccessDeniedError);

    expect(await snapshot(targetB.id)).toEqual(before);
    expect(await auditRows(orgA.id)).toHaveLength(0);
    expect(await auditRows(orgB.id)).toHaveLength(0);
  });

  const badIds = idCallNames.flatMap((name) =>
    [
      ["ikke-en-id", "ikke-en-id"],
      ["tilfeldig uuid", "random"],
    ].map(([label, kind]) => [name, label!, kind!] as const),
  );

  it.each(badIds)(
    "2. %s med %s gir AccessDeniedError, ingen databasefeil",
    async (name, _l, kind) => {
      const { org, admin } = await orgWithAdmin();
      const before = await tableCounts();
      const id = kind === "random" ? randomUUID() : kind;

      await expect(idCalls[name]!(admin, org.id, id)).rejects.toThrow(AccessDeniedError);
      expect(await tableCounts()).toEqual(before);
    },
  );

  const deletedCalls = idCallNames.filter(
    (name) => name !== "grantEmployeePermission" && name !== "revokeEmployeePermission",
  );

  it.each(deletedCalls)("3. %s på en slettet ansatt gir AccessDeniedError", async (name) => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await seedPerson(org.id, ["inspector"]);
    if (name === "reactivateEmployee") await markDeactivated(employee.id);
    await markDeleted(employee.id);
    const before = await snapshot(employee.id);

    await expect(idCalls[name]!(admin, org.id, employee.id)).rejects.toThrow(AccessDeniedError);
    expect(await snapshot(employee.id)).toEqual(before);
    expect(await auditRows(org.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.4 Selskap og kontor på ansatt
// ---------------------------------------------------------------------------------------------

describe("3.4 selskap og kontor på ansatt", () => {
  type Variant = "foreign" | "deleted" | "invalid";

  async function setup(kind: "company" | "office", variant: Variant) {
    const { org, admin } = await orgWithAdmin("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    let id: string;
    if (variant === "invalid") id = "ikke-en-id";
    else {
      const target = variant === "foreign" ? orgB.id : org.id;
      const deletedAt = variant === "deleted" ? new Date() : null;
      id =
        kind === "company"
          ? (await seedCompany(target, { legalName: "Testselskap X AS", deletedAt })).id
          : (await seedOffice(target, { name: "Testkontor X", deletedAt })).id;
    }
    const field = kind === "company" ? { companyId: id } : { officeId: id };
    return { org, admin, field };
  }

  const variants = (["company", "office"] as const).flatMap((kind) =>
    (["foreign", "deleted", "invalid"] as const).map((variant) => [kind, variant] as const),
  );

  it.each(variants)(
    "createEmployee med %s (%s) avvises, ingen rad skrevet",
    async (kind, variant) => {
      const { org, admin, field } = await setup(kind, variant);
      const before = await tableCounts();

      await expectRejectedWithoutDatabaseError(
        createEmployee(admin, org.id, newEmployee({ ...field })),
      );
      expect(await tableCounts()).toEqual(before);
    },
  );

  it.each(variants)(
    "updateEmployee med %s (%s) avvises, raden er uendret",
    async (kind, variant) => {
      const { org, admin, field } = await setup(kind, variant);
      const { employee } = await seedPerson(org.id, ["inspector"]);
      const before = await employeeRow(employee.id);

      await expectRejectedWithoutDatabaseError(
        updateEmployee(admin, org.id, employee.id, employeeUpdate({ ...field })),
      );
      expect(await employeeRow(employee.id)).toEqual(before);
      expect(await auditRows(org.id)).toHaveLength(0);
    },
  );

  it("5. uten selskap og kontor (null) er lov, og selskap og kontor fra egen organisasjon er lov", async () => {
    const { org, admin } = await orgWithAdmin();
    const company = await seedCompany(org.id);
    const office = await seedOffice(org.id);

    const withoutBoth = await createEmployee(admin, org.id, newEmployee());
    expect(await employeeRow(withoutBoth.id)).toMatchObject({ companyId: null, officeId: null });

    const withBoth = await createEmployee(
      admin,
      org.id,
      newEmployee({ companyId: company.id, officeId: office.id }),
    );
    expect(await employeeRow(withBoth.id)).toMatchObject({
      companyId: company.id,
      officeId: office.id,
    });

    await updateEmployee(
      admin,
      org.id,
      withBoth.id,
      employeeUpdate({ companyId: null, officeId: null }),
    );
    expect(await employeeRow(withBoth.id)).toMatchObject({ companyId: null, officeId: null });
  });
});

// ---------------------------------------------------------------------------------------------
// 3.5 Ny ansatt og innlogging (A26)
// ---------------------------------------------------------------------------------------------

describe("3.5 ny ansatt og innlogging", () => {
  it("1. ny e-post lager en ny innlogging med små bokstaver, og den ansatte får rollene", async () => {
    const { org, admin } = await orgWithAdmin();
    const usersBefore = (await tableCounts()).users;

    const created = await createEmployee(
      admin,
      org.id,
      newEmployee({ email: "Kari.Ny@Eksempel.no", roles: ["inspector", "office"] }),
    );

    expect((await tableCounts()).users).toBe(usersBefore + 1);
    const login = await actorByEmail("kari.ny@eksempel.no");
    const row = await employeeRow(created.id);
    expect(row.userId).toBe(login.id);
    expect(row.organizationId).toBe(org.id);
    expect(await activeRoles(created.id)).toEqual(["inspector", "office"]);
  });

  it("2. «  Ola@Eksempel.NO » treffer eksisterende innlogging; navnet på innloggingen er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const existing = await createUser({ name: "Ola Innlogging", email: "ola@eksempel.no" });
    const usersBefore = (await tableCounts()).users;

    const created = await createEmployee(
      admin,
      org.id,
      newEmployee({ name: "Ola Skjemanavn", email: "  Ola@Eksempel.NO " }),
    );

    expect((await tableCounts()).users).toBe(usersBefore);
    expect((await employeeRow(created.id)).userId).toBe(existing.id);
    const [login] = await db.select().from(users).where(eq(users.id, existing.id));
    expect(login?.name).toBe("Ola Innlogging");
    expect(login?.email).toBe("ola@eksempel.no");
  });

  it("3. duplikat i samme organisasjon gir feilmeldingen, og ingenting skrives", async () => {
    const { org, admin } = await orgWithAdmin();
    await createEmployee(admin, org.id, newEmployee({ email: "dobbel@eksempel.no" }));
    const before = await tableCounts();

    await expect(
      createEmployee(admin, org.id, newEmployee({ email: " Dobbel@Eksempel.no" })),
    ).rejects.toThrow(DUPLICATE_EMAIL_MESSAGE);
    expect(await tableCounts()).toEqual(before);
  });

  it("4. samme melding uansett om e-posten finnes i en annen organisasjon", async () => {
    const messageFor = async (alsoInB: boolean) => {
      await resetDatabase();
      const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
      const { org: orgB } = await orgWithAdmin("Organisasjon B");
      const person = await createUser({ name: "Delt Innlogging", email: "delt@eksempel.no" });
      await seedEmployee(person, orgA.id, ["inspector"]);
      if (alsoInB) await seedEmployee(person, orgB.id, ["inspector"]);
      const error: unknown = await createEmployee(
        adminA,
        orgA.id,
        newEmployee({ email: "delt@eksempel.no" }),
      ).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(Error);
      const text = `${(error as Error).message} ${JSON.stringify(error)}`;
      expect(text).not.toContain(orgB.id);
      expect(text).not.toContain("Organisasjon B");
      expect(text).not.toContain("Delt Innlogging");
      return (error as Error).message;
    };

    const onlyA = await messageFor(false);
    const both = await messageFor(true);
    expect(onlyA).toBe(both);
    expect(onlyA).toContain(DUPLICATE_EMAIL_MESSAGE);
  });

  it("4b. e-post som bare finnes i B: opprettingen i A lykkes, og svaret nevner ikke B eller innloggingsnavnet", async () => {
    const { org: orgA, admin: adminA } = await orgWithAdmin("Organisasjon A");
    const { org: orgB } = await orgWithAdmin("Organisasjon B");
    const person = await createUser({ name: "Delt Innlogging", email: "delt@eksempel.no" });
    await seedEmployee(person, orgB.id, ["inspector"]);

    const created = await createEmployee(
      adminA,
      orgA.id,
      newEmployee({ name: "Ny I A", email: "delt@eksempel.no" }),
    );
    const text = JSON.stringify(created);
    expect(text).not.toContain(orgB.id);
    expect(text).not.toContain("Delt Innlogging");
    const row = await employeeRow(created.id);
    expect(row.organizationId).toBe(orgA.id);
    expect(row.userId).toBe(person.id);
  });

  it("5. duplikat også når den eksisterende ansatte har sluttet", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await seedPerson(org.id, ["inspector"], { email: "sluttet@eksempel.no" });
    await markDeactivated(employee.id);
    const before = await tableCounts();

    await expect(
      createEmployee(admin, org.id, newEmployee({ email: "sluttet@eksempel.no" })),
    ).rejects.toThrow(DUPLICATE_EMAIL_MESSAGE);
    expect(await tableCounts()).toEqual(before);
  });

  it("6. ingen e-post sendes når en ansatt legges inn", async () => {
    const { org, admin } = await orgWithAdmin();
    const sendEmail = vi.mocked(email.sendEmail);
    sendEmail.mockClear();
    const mailboxBefore = email.readDevMailbox().length;

    await createEmployee(admin, org.id, newEmployee({ email: "ingen.epost@eksempel.no" }));

    expect(sendEmail).not.toHaveBeenCalled();
    expect(email.readDevMailbox()).toHaveLength(mailboxBefore);
  });

  it("7. ny ansatt får tilgang med en gang", async () => {
    const { org, admin } = await orgWithAdmin();
    await createEmployee(admin, org.id, newEmployee({ email: "straks@eksempel.no" }));
    const newActor = await actorByEmail("straks@eksempel.no");

    // Testplanen sier «assignment.read»; den rettigheten finnes ikke. Lesetilgangen heter
    // organization.read (src/core/access/permissions.ts).
    const grant = await requireOrganizationAccess(newActor, org.id, "organization.read");
    expect(grant.organizationId).toBe(org.id);
    expect(grant.roles).toEqual(["inspector"]);
  });

  describe("8. e-post bare for admin", () => {
    const forbiddenKeys = [
      "userId",
      "organizationId",
      "createdBy",
      "updatedBy",
      "deletedBy",
      "deletedAt",
      "rowVersion",
    ];

    it("listEmployees (for alle) gir fortsatt ikke e-post", async () => {
      const { org, admin } = await orgWithAdmin();
      await seedPerson(org.id, ["inspector"], { email: "skjult@eksempel.no" });
      const rows = await listEmployees(admin, org.id);
      expect(JSON.stringify(rows)).not.toContain("skjult@eksempel.no");
      for (const row of rows) expect(Object.keys(row)).not.toContain("email");
    });

    it("listEmployeesForAdmin og getEmployeeForAdmin gir e-post, roller og enkeltrettigheter, uten innloggings- og organisasjons-id", async () => {
      const { org, admin } = await orgWithAdmin();
      const { employee } = await seedPerson(org.id, ["inspector", "manager"], {
        email: "synlig@eksempel.no",
      });
      await grantPermission(employee, PERMISSION);

      const listed = (await listEmployeesForAdmin(admin, org.id)).find(
        (row) => row.id === employee.id,
      );
      const single = await getEmployeeForAdmin(admin, org.id, employee.id);

      for (const row of [listed, single]) {
        expect(row).toBeDefined();
        const keys = Object.keys(row!);
        for (const key of [
          "id",
          "name",
          "email",
          "jobTitle",
          "roles",
          "permissions",
          "deactivatedAt",
        ]) {
          expect(keys, `mangler ${key}`).toContain(key);
        }
        for (const key of forbiddenKeys) expect(keys, `skal ikke ha ${key}`).not.toContain(key);
        const value = row as unknown as { email: string; roles: string[]; permissions: string[] };
        expect(value.email).toBe("synlig@eksempel.no");
        expect([...value.roles].sort()).toEqual(["inspector", "manager"]);
        expect(value.permissions).toEqual([PERMISSION]);
      }
      // Lik form i listen og på siden til den ansatte
      expect(Object.keys(listed!).sort()).toEqual(Object.keys(single).sort());
    });

    it("tatt bort rolle og rettighet vises ikke", async () => {
      const { org, admin } = await orgWithAdmin();
      const { employee } = await seedPerson(org.id, ["inspector", "manager"]);
      const permission = await grantPermission(employee, PERMISSION);
      await db
        .update(employeeRoleAssignments)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(employeeRoleAssignments.employeeId, employee.id),
            eq(employeeRoleAssignments.role, "manager"),
          ),
        );
      await db
        .update(employeePermissions)
        .set({ deletedAt: new Date() })
        .where(eq(employeePermissions.id, permission.id));

      const single = (await getEmployeeForAdmin(admin, org.id, employee.id)) as unknown as {
        roles: string[];
        permissions: string[];
      };
      expect(single.roles).toEqual(["inspector"]);
      expect(single.permissions).toEqual([]);
    });
  });

  it("9. sluttet nederst i listEmployeesForAdmin, slettede vises ikke", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee: early } = await seedPerson(org.id, ["inspector"], { name: "Aase Sluttet" });
    await markDeactivated(early.id);
    const { employee: active } = await seedPerson(org.id, ["inspector"], { name: "Zara Aktiv" });
    const { employee: removed } = await seedPerson(org.id, ["inspector"], {
      name: "Bente Slettet",
    });
    await markDeleted(removed.id);

    const ids = (await listEmployeesForAdmin(admin, org.id)).map((row) => row.id);
    expect(ids).not.toContain(removed.id);
    expect(ids).toContain(active.id);
    expect(ids[ids.length - 1]).toBe(early.id);
    expect(ids.indexOf(active.id)).toBeLessThan(ids.indexOf(early.id));
  });

  describe("validering (regeltester som data)", () => {
    it.each([
      ["e-post uten @", { email: "ola" }],
      ["e-post uten domene", { email: "ola@" }],
      ["e-post uten navn", { email: "@eksempel.no" }],
      ["tom e-post", { email: "" }],
      ["tomt navn", { name: "" }],
      ["navn med bare mellomrom", { name: "   " }],
      ["ukjent rolle", { roles: ["superadmin"] }],
      ["tom rolle", { roles: [""] }],
    ])("%s avvises med ZodError, ingenting skrives", async (_label, overrides) => {
      const { org, admin } = await orgWithAdmin();
      const before = await tableCounts();
      await expect(createEmployee(admin, org.id, newEmployee(overrides))).rejects.toThrow(ZodError);
      expect(await tableCounts()).toEqual(before);
    });

    it("tomt navn i updateEmployee avvises med ZodError", async () => {
      const { org, admin } = await orgWithAdmin();
      const { employee } = await seedPerson(org.id);
      const before = await employeeRow(employee.id);
      await expect(
        updateEmployee(admin, org.id, employee.id, employeeUpdate({ name: "" })),
      ).rejects.toThrow(ZodError);
      expect(await employeeRow(employee.id)).toEqual(before);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 3.6 Roller og enkeltrettigheter
// ---------------------------------------------------------------------------------------------

describe("3.6 roller og enkeltrettigheter", () => {
  it("1. setEmployeeRoles legger til og tar bort med myk sletting", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await seedPerson(org.id, ["inspector"]);

    const afterAdd = await setEmployeeRoles(
      admin,
      org.id,
      employee.id,
      roles("inspector", "manager"),
    );
    expect([...afterAdd].sort()).toEqual(["inspector", "manager"]);
    expect(await roleRows(employee.id)).toHaveLength(2);

    const afterRemove = await setEmployeeRoles(admin, org.id, employee.id, roles("manager"));
    expect([...afterRemove]).toEqual(["manager"]);
    const rows = await roleRows(employee.id);
    expect(rows).toHaveLength(2);
    const inspector = rows.find((row) => row.role === "inspector");
    expect(inspector?.deletedAt).not.toBeNull();
    expect(rows.find((row) => row.role === "manager")?.deletedAt).toBeNull();
  });

  it("2. samme roller på nytt gir ingen nye rader og ingen ny deleted_at", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await seedPerson(org.id, ["inspector", "manager"]);
    const before = await roleRows(employee.id);

    await setEmployeeRoles(admin, org.id, employee.id, roles("manager", "inspector"));
    const after = await roleRows(employee.id);
    expect(after).toHaveLength(before.length);
    expect(after.every((row) => row.deletedAt === null)).toBe(true);
  });

  it("3. effekten vises i neste tilgangssjekk", async () => {
    const { org, admin } = await orgWithAdmin();
    const { actor, employee } = await seedPerson(org.id, ["inspector", "manager"]);
    await requireOrganizationAccess(actor, org.id, "claims.read");

    await setEmployeeRoles(admin, org.id, employee.id, roles("inspector"));
    await expect(requireOrganizationAccess(actor, org.id, "claims.read")).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(requireOrganizationAccess(actor, org.id, "organization.manage")).rejects.toThrow(
      AccessDeniedError,
    );

    await setEmployeeRoles(admin, org.id, employee.id, roles("inspector", "admin"));
    const grant = await requireOrganizationAccess(actor, org.id, "organization.manage");
    expect(grant.roles).toContain("admin");

    await grantEmployeePermission(admin, org.id, employee.id, PERMISSION);
    await setEmployeeRoles(admin, org.id, employee.id, roles("inspector"));
    const withPermission = await requireOrganizationAccess(actor, org.id, PERMISSION);
    expect(withPermission.permissions).toContain(PERMISSION);
    await revokeEmployeePermission(admin, org.id, employee.id, PERMISSION);
    await expect(requireOrganizationAccess(actor, org.id, PERMISSION)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  describe("4. validering av roller og rettigheter", () => {
    it.each([
      ["ukjent rolle", ["superadmin"]],
      ["tom streng", [""]],
      ["gyldig og ukjent sammen", ["inspector", "superadmin"]],
    ])("setEmployeeRoles: %s avvises med ZodError, rollene er uendret", async (_label, list) => {
      const { org, admin } = await orgWithAdmin();
      const { employee } = await seedPerson(org.id, ["inspector"]);
      const before = await roleRows(employee.id);
      await expect(setEmployeeRoles(admin, org.id, employee.id, roles(...list))).rejects.toThrow(
        ZodError,
      );
      expect(await roleRows(employee.id)).toEqual(before);
    });

    it("grantEmployeePermission avviser organization.manage", async () => {
      const { org, admin } = await orgWithAdmin();
      const { employee } = await seedPerson(org.id, ["inspector"]);
      await expect(
        grantEmployeePermission(admin, org.id, employee.id, "organization.manage"),
      ).rejects.toThrow(ZodError);
      expect(await permissionRows(employee.id)).toHaveLength(0);
    });
  });

  it("5. fjern–gi–fjern gir to rader med deleted_at og ingen aktiv; antall rader går aldri ned", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await seedPerson(org.id, ["inspector", "manager"]);
    const counts: number[] = [];
    const count = async () => {
      const c = await tableCounts();
      counts.push(c.employees, c.roles);
      return c;
    };

    const start = await count();
    await setEmployeeRoles(admin, org.id, employee.id, roles("inspector"));
    const s1 = await count();
    await setEmployeeRoles(admin, org.id, employee.id, roles("inspector", "manager"));
    const s2 = await count();
    await setEmployeeRoles(admin, org.id, employee.id, roles("inspector"));
    const s3 = await count();

    const managerRows = (await roleRows(employee.id)).filter((row) => row.role === "manager");
    expect(managerRows).toHaveLength(2);
    expect(managerRows.every((row) => row.deletedAt !== null)).toBe(true);

    for (const [prev, next] of [
      [start, s1],
      [s1, s2],
      [s2, s3],
    ] as const) {
      expect(next.employees).toBeGreaterThanOrEqual(prev.employees);
      expect(next.roles).toBeGreaterThanOrEqual(prev.roles);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3.7 Sluttet og angre
// ---------------------------------------------------------------------------------------------

describe("3.7 sluttet og angre", () => {
  it("1. deactivateEmployee setter deactivated_at; raden, rollene og innloggingen står, tilgangen er borte", async () => {
    const { org, admin } = await orgWithAdmin();
    const { actor, employee } = await seedPerson(org.id, ["inspector"], { name: "Siri Slutter" });
    await db.insert(sessions).values({
      id: randomUUID(),
      token: randomUUID(),
      userId: actor.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const [userBefore] = await db.select().from(users).where(eq(users.id, actor.id));
    const sessionsBefore = await db.select().from(sessions).where(eq(sessions.userId, actor.id));

    await deactivateEmployee(admin, org.id, employee.id);

    const row = await employeeRow(employee.id);
    expect(row.deactivatedAt).not.toBeNull();
    expect(row.deletedAt).toBeNull();
    expect(row.userId).toBe(actor.id);
    expect(row.name).toBe("Siri Slutter");
    expect(await activeRoles(employee.id)).toEqual(["inspector"]);
    await expect(requireOrganizationAccess(actor, org.id)).rejects.toThrow(AccessDeniedError);
    const [userAfter] = await db.select().from(users).where(eq(users.id, actor.id));
    expect(userAfter).toEqual(userBefore);
    expect(await db.select().from(sessions).where(eq(sessions.userId, actor.id))).toEqual(
      sessionsBefore,
    );
  });

  it("2. reactivateEmployee nullstiller deactivated_at, og tilgangen virker igjen", async () => {
    const { org, admin } = await orgWithAdmin();
    const { actor, employee } = await seedPerson(org.id, ["inspector"]);
    await deactivateEmployee(admin, org.id, employee.id);
    await expect(requireOrganizationAccess(actor, org.id)).rejects.toThrow(AccessDeniedError);

    await reactivateEmployee(admin, org.id, employee.id);
    expect((await employeeRow(employee.id)).deactivatedAt).toBeNull();
    const grant = await requireOrganizationAccess(actor, org.id);
    expect(grant.employeeId).toBe(employee.id);
  });

  it("3. reactivateEmployee uten user_id avvises, og raden er uendret", async () => {
    const { org, admin } = await orgWithAdmin();
    const [noLogin] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Tidligere Testansatt",
        deactivatedAt: new Date(),
      })
      .returning();
    const before = await employeeRow(noLogin!.id);

    await expectRejectedWithoutDatabaseError(reactivateEmployee(admin, org.id, noLogin!.id));
    expect(await employeeRow(noLogin!.id)).toEqual(before);
    expect((await auditRows(org.id)).filter((row) => row.action === "reactivate")).toHaveLength(0);
  });

  it("4. deactivateEmployee på en som alt har sluttet endrer ikke deactivated_at og gir ingen ny loggrad", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await seedPerson(org.id, ["inspector"]);
    await deactivateEmployee(admin, org.id, employee.id);
    const first = await employeeRow(employee.id);
    const logBefore = (await auditRows(org.id)).filter((row) => row.action === "deactivate");

    // Utvikler velger: ingen endring, eller en tydelig feil
    await deactivateEmployee(admin, org.id, employee.id).catch(() => undefined);

    const second = await employeeRow(employee.id);
    expect(second.deactivatedAt).toEqual(first.deactivatedAt);
    const logAfter = (await auditRows(org.id)).filter((row) => row.action === "deactivate");
    expect(logAfter).toHaveLength(logBefore.length);
  });

  it("5. den som har sluttet står i listEmployeesForAdmin og i listEmployees med includeDeactivated", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee } = await seedPerson(org.id, ["inspector"]);
    await deactivateEmployee(admin, org.id, employee.id);

    const adminList = await listEmployeesForAdmin(admin, org.id);
    const listed = adminList.find((row) => row.id === employee.id);
    expect(listed).toBeDefined();
    expect((listed as unknown as { deactivatedAt: Date | null }).deactivatedAt).not.toBeNull();
    const all = await listEmployees(admin, org.id, { includeDeactivated: true });
    expect(all.map((row) => row.id)).toContain(employee.id);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.8 Admin stenges aldri ute (A25)
// ---------------------------------------------------------------------------------------------

/*
 * TESTENE I DENNE BLOKKEN SKAL ALDRI FJERNES ELLER SVEKKES.
 * Admin stenges aldri ute (CLAUDE.md regel 11, beslutning A25): organisasjonen må alltid ha minst
 * én aktiv admin, også når to admin endrer hverandre samtidig.
 */
describe("3.8 admin stenges aldri ute (A25) – skal aldri fjernes", () => {
  it("1. siste admin kan ikke miste rollen: setEmployeeRoles(…, [])", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const before = await tableCounts();

    await expect(setEmployeeRoles(admin, org.id, adminEmployee.id, roles())).rejects.toThrow(
      LAST_ADMIN_MESSAGE,
    );
    expect(await activeRoles(adminEmployee.id)).toEqual(["admin"]);
    expect(await activeAdminCount(org.id)).toBe(1);
    expect((await tableCounts()).audit).toBe(before.audit);
  });

  it("2. siste admin kan ikke miste rollen: setEmployeeRoles(…, ['inspector'])", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const before = await tableCounts();

    await expect(
      setEmployeeRoles(admin, org.id, adminEmployee.id, roles("inspector")),
    ).rejects.toThrow(LAST_ADMIN_MESSAGE);
    expect(await activeRoles(adminEmployee.id)).toEqual(["admin"]);
    expect(await activeAdminCount(org.id)).toBe(1);
    expect((await tableCounts()).audit).toBe(before.audit);
    expect(await roleRows(adminEmployee.id)).toHaveLength(1);
  });

  it("3. siste admin kan ikke markere seg selv som sluttet", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const before = await tableCounts();

    await expect(deactivateEmployee(admin, org.id, adminEmployee.id)).rejects.toThrow(
      LAST_ADMIN_MESSAGE,
    );
    expect((await employeeRow(adminEmployee.id)).deactivatedAt).toBeNull();
    expect(await activeAdminCount(org.id)).toBe(1);
    expect((await tableCounts()).audit).toBe(before.audit);
  });

  it("4. med to aktive admin er det lov å ta rollen fra én, men ikke fra den andre etterpå", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const { employee: second } = await seedPerson(org.id, ["admin"]);
    expect(await activeAdminCount(org.id)).toBe(2);

    await setEmployeeRoles(admin, org.id, second.id, roles("inspector"));
    expect(await activeAdminCount(org.id)).toBe(1);

    await expect(
      setEmployeeRoles(admin, org.id, adminEmployee.id, roles("inspector")),
    ).rejects.toThrow(LAST_ADMIN_MESSAGE);
    expect(await activeAdminCount(org.id)).toBe(1);
  });

  it("4b. med to aktive admin er det lov å markere én som sluttet", async () => {
    const { org, admin } = await orgWithAdmin();
    const { employee: second } = await seedPerson(org.id, ["admin"]);
    await deactivateEmployee(admin, org.id, second.id);
    expect(await activeAdminCount(org.id)).toBe(1);
  });

  it("5. admin som har sluttet, regnes ikke med", async () => {
    const { org } = await orgWithAdmin();
    // X har sluttet (admin fra orgWithAdmin brukes ikke videre)
    const [x] = await db.select().from(employees).where(eq(employees.organizationId, org.id));
    await markDeactivated(x!.id);
    const { actor: y, employee: yEmployee } = await seedPerson(org.id, ["admin"]);
    const before = await tableCounts();

    await expect(setEmployeeRoles(y, org.id, yEmployee.id, roles("inspector"))).rejects.toThrow(
      LAST_ADMIN_MESSAGE,
    );
    await expect(deactivateEmployee(y, org.id, yEmployee.id)).rejects.toThrow(LAST_ADMIN_MESSAGE);
    expect(await activeRoles(yEmployee.id)).toEqual(["admin"]);
    expect((await employeeRow(yEmployee.id)).deactivatedAt).toBeNull();
    expect((await tableCounts()).audit).toBe(before.audit);
  });

  it("6a. slettet admin (deleted_at på ansatt-raden) regnes ikke med", async () => {
    const org = await createOrganization();
    const { employee: x } = await seedPerson(org.id, ["admin"]);
    await markDeleted(x.id);
    const { actor: y, employee: yEmployee } = await seedPerson(org.id, ["admin"]);
    const before = await tableCounts();

    await expect(setEmployeeRoles(y, org.id, yEmployee.id, roles())).rejects.toThrow(
      LAST_ADMIN_MESSAGE,
    );
    await expect(deactivateEmployee(y, org.id, yEmployee.id)).rejects.toThrow(LAST_ADMIN_MESSAGE);
    expect(await activeAdminCount(org.id)).toBe(1);
    expect((await tableCounts()).audit).toBe(before.audit);
  });

  it("6b. admin-rolle med deleted_at regnes ikke med", async () => {
    const org = await createOrganization();
    const { employee: x } = await seedPerson(org.id, ["admin", "inspector"]);
    await db
      .update(employeeRoleAssignments)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(employeeRoleAssignments.employeeId, x.id),
          eq(employeeRoleAssignments.role, "admin"),
        ),
      );
    const { actor: y, employee: yEmployee } = await seedPerson(org.id, ["admin"]);
    const before = await tableCounts();

    await expect(setEmployeeRoles(y, org.id, yEmployee.id, roles("inspector"))).rejects.toThrow(
      LAST_ADMIN_MESSAGE,
    );
    expect(await activeAdminCount(org.id)).toBe(1);
    expect((await tableCounts()).audit).toBe(before.audit);
  });

  it("7. admin uten user_id regnes ikke med", async () => {
    const org = await createOrganization();
    const [x] = await db
      .insert(employees)
      .values({
        organizationId: org.id,
        userId: null,
        name: "Tidligere Admin",
        deactivatedAt: new Date(),
      })
      .returning();
    await db
      .insert(employeeRoleAssignments)
      .values({ organizationId: org.id, employeeId: x!.id, role: "admin" });
    const { actor: y, employee: yEmployee } = await seedPerson(org.id, ["admin"]);
    const before = await tableCounts();

    await expect(setEmployeeRoles(y, org.id, yEmployee.id, roles())).rejects.toThrow(
      LAST_ADMIN_MESSAGE,
    );
    await expect(deactivateEmployee(y, org.id, yEmployee.id)).rejects.toThrow(LAST_ADMIN_MESSAGE);
    expect(await activeAdminCount(org.id)).toBe(1);
    expect((await tableCounts()).audit).toBe(before.audit);
  });

  describe("9. samtidige endringer (Promise.all, 5 runder per variant)", () => {
    type Pair = {
      orgId: string;
      a: { actor: Actor; employeeId: string };
      b: { actor: Actor; employeeId: string };
    };

    async function twoAdmins(): Promise<Pair> {
      const org = await createOrganization();
      const a = await seedPerson(org.id, ["admin"], { name: "Admin En" });
      const b = await seedPerson(org.id, ["admin"], { name: "Admin To" });
      return {
        orgId: org.id,
        a: { actor: a.actor, employeeId: a.employee.id },
        b: { actor: b.actor, employeeId: b.employee.id },
      };
    }

    const variants: [string, (pair: Pair) => [Promise<unknown>, Promise<unknown>]][] = [
      [
        "a. A tar rollen fra B og B tar rollen fra A",
        ({ orgId, a, b }) => [
          setEmployeeRoles(a.actor, orgId, b.employeeId, roles("inspector")),
          setEmployeeRoles(b.actor, orgId, a.employeeId, roles("inspector")),
        ],
      ],
      [
        "b. A og B markerer hverandre som sluttet",
        ({ orgId, a, b }) => [
          deactivateEmployee(a.actor, orgId, b.employeeId),
          deactivateEmployee(b.actor, orgId, a.employeeId),
        ],
      ],
      [
        "c. A tar rollen fra B mens B markerer A som sluttet",
        ({ orgId, a, b }) => [
          setEmployeeRoles(a.actor, orgId, b.employeeId, roles("inspector")),
          deactivateEmployee(b.actor, orgId, a.employeeId),
        ],
      ],
    ];

    it.each(variants)(
      "%s: nøyaktig ett kall lykkes, og én aktiv admin står igjen",
      async (_l, run) => {
        for (let round = 1; round <= 5; round += 1) {
          await resetDatabase();
          const pair = await twoAdmins();

          const results = await Promise.allSettled(run(pair));
          const fulfilled = results.filter((r) => r.status === "fulfilled");
          const rejected = results.filter(
            (r): r is PromiseRejectedResult => r.status === "rejected",
          );

          expect(fulfilled, `runde ${round}: nøyaktig ett kall skal lykkes`).toHaveLength(1);
          expect(rejected, `runde ${round}: nøyaktig ett kall skal avvises`).toHaveLength(1);
          // Avvist med meldingen om siste admin. Rakk det første kallet å bli ferdig før det andre
          // kom til tilgangssjekken, er avvisningen AccessDeniedError; begge holder admin inne.
          const reason = rejected[0]!.reason as Error;
          const allowed =
            reason instanceof AccessDeniedError || reason.message.includes(LAST_ADMIN_MESSAGE);
          expect(allowed, `runde ${round}: uventet feil «${reason.message}»`).toBe(true);
          expect(await activeAdminCount(pair.orgId), `runde ${round}`).toBe(1);
        }
      },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// 3.9 Revisjonslogg og feillogg uten persontekst
// ---------------------------------------------------------------------------------------------

describe("3.9 revisjonslogg uten persontekst", () => {
  const NAME = "Kari Testdatter";
  const EMAIL = "kari.testdatter@eksempel.no";
  const JOB_TITLE = "Testtakstmann";

  function expectNoPersonText(changes: unknown) {
    const text = JSON.stringify(changes);
    expect(text).not.toContain(NAME);
    expect(text).not.toContain("Testdatter");
    expect(text.toLowerCase()).not.toContain(EMAIL);
    expect(text).not.toContain(JOB_TITLE);
  }

  async function setupKari() {
    const { org, admin } = await orgWithAdmin();
    const grant = await requireOrganizationAccess(admin, org.id, "organization.manage");
    const kari = await createEmployee(
      admin,
      org.id,
      newEmployee({ name: NAME, email: EMAIL, jobTitle: JOB_TITLE, roles: ["inspector"] }),
    );
    return { org, admin, grant, kariId: kari.id };
  }

  const actions: [string, (ctx: Awaited<ReturnType<typeof setupKari>>) => Promise<unknown>][] = [
    ["create", async () => undefined],
    [
      "update",
      ({ admin, org, kariId }) =>
        updateEmployee(
          admin,
          org.id,
          kariId,
          employeeUpdate({ name: NAME, jobTitle: `${JOB_TITLE} senior` }),
        ),
    ],
    [
      "role_change",
      ({ admin, org, kariId }) =>
        setEmployeeRoles(admin, org.id, kariId, roles("inspector", "manager")),
    ],
    [
      "permission_change",
      ({ admin, org, kariId }) => grantEmployeePermission(admin, org.id, kariId, PERMISSION),
    ],
    ["deactivate", ({ admin, org, kariId }) => deactivateEmployee(admin, org.id, kariId)],
    [
      "reactivate",
      async ({ admin, org, kariId }) => {
        await deactivateEmployee(admin, org.id, kariId);
        await reactivateEmployee(admin, org.id, kariId);
      },
    ],
  ];

  it.each(actions)("1. %s: changes har ingen navn, e-post eller stilling", async (action, run) => {
    const ctx = await setupKari();
    await run(ctx);

    const rows = (await auditRows(ctx.org.id)).filter((row) => row.action === action);
    expect(rows.length, `ingen loggrad med action ${action}`).toBeGreaterThan(0);
    const roleIds = (await roleRows(ctx.kariId)).map((row) => row.id);
    const permissionIds = (await permissionRows(ctx.kariId)).map((row) => row.id);
    for (const row of rows) {
      expectNoPersonText(row.changes);
      expect(row.organizationId).toBe(ctx.grant.organizationId);
      expect(row.actorEmployeeId).toBe(ctx.grant.employeeId);
      // Riktig id: den ansatte, eller raden for rollen/rettigheten som ble endret
      expect([ctx.kariId, ...roleIds, ...permissionIds]).toContain(row.entityId);
    }
    // Ingen persontekst i noen loggrad, uansett handling
    for (const row of await auditRows(ctx.org.id)) expectNoPersonText(row.changes);
  });

  it("2. update lister navnene på feltene som er endret, ikke verdiene", async () => {
    const ctx = await setupKari();
    await updateEmployee(
      ctx.admin,
      ctx.org.id,
      ctx.kariId,
      employeeUpdate({ name: NAME, jobTitle: "Ny stilling" }),
    );
    const [row] = (await auditRows(ctx.org.id)).filter((r) => r.action === "update");
    const text = JSON.stringify(row?.changes);
    expect(text).toContain("jobTitle");
    expect(text).not.toContain("Ny stilling");
    expect(text).not.toContain('"name"');
    expect(text).not.toContain("companyId");
    expect(text).not.toContain("officeId");
  });

  it("3. createEmployee som stoppes, skriver ikke navn, e-post eller stilling til loggen", async () => {
    const { org, admin } = await orgWithAdmin();
    await createEmployee(admin, org.id, newEmployee({ email: EMAIL }));
    const otherOrg = await createOrganization("Organisasjon B");
    const foreignCompany = await seedCompany(otherOrg.id);

    const captured: unknown[] = [];
    const capture = (...args: unknown[]) => {
      captured.push(...args);
    };
    for (const method of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, method).mockImplementation(capture);
    }
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }

    await createEmployee(
      admin,
      org.id,
      newEmployee({ name: NAME, email: EMAIL, jobTitle: JOB_TITLE }),
    ).catch(() => undefined);
    await createEmployee(
      admin,
      org.id,
      newEmployee({
        name: NAME,
        email: "kari.annen@eksempel.no",
        jobTitle: JOB_TITLE,
        companyId: foreignCompany.id,
      }),
    ).catch(() => undefined);

    const text = JSON.stringify(
      captured.map((value) => (value instanceof Error ? value.message : value)),
    );
    expect(text).not.toContain(NAME);
    expect(text).not.toContain(JOB_TITLE);
    expect(text.toLowerCase()).not.toContain(EMAIL);
    expect(text.toLowerCase()).not.toContain("kari.annen@eksempel.no");
  });
});

// ---------------------------------------------------------------------------------------------
// findAdminOrganizationId (brukes av menyen og sidene i /admin)

describe("findAdminOrganizationId", () => {
  it("gir organisasjonen for admin og null for andre og for admin som har sluttet", async () => {
    const { org, admin, adminEmployee } = await orgWithAdmin();
    const { actor: inspector } = await seedPerson(org.id);
    await seedPerson(org.id, ["admin"], { name: "Andre Admin" });

    expect(await findAdminOrganizationId(admin)).toBe(org.id);
    expect(await findAdminOrganizationId(inspector)).toBeNull();

    await markDeactivated(adminEmployee.id);
    expect(await findAdminOrganizationId(admin)).toBeNull();
  });

  it("gir aldri en organisasjon der personen ikke er admin", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const person = await createUser();
    await seedEmployee(person, orgA.id, ["inspector"]);
    await seedEmployee(person, orgB.id, ["admin"]);

    expect(await findAdminOrganizationId(person)).toBe(orgB.id);
  });

  // Sperren for /admin/logg (fase0b-revisjon-hendelser-testplan.md 4.1): siden bruker
  // getAdminContext, så leder og kontor skal ikke slippe inn selv om kjernen lar leder lese loggen.
  it.each<EmployeeRole>(["manager", "office"])("gir null for %s", async (role) => {
    const { org } = await orgWithAdmin();
    const { actor } = await seedPerson(org.id, [role], { name: "Kari Testdatter" });
    expect(await findAdminOrganizationId(actor)).toBeNull();
  });
});
