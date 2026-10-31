import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, certifications, employees, type EmployeeRole } from "@/db/schema";
import { certificationCases, MIDNIGHT_UTC, NOW } from "../../../tests/certification-cases";
import {
  auditRows,
  createCertification,
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  addCertification,
  listCertificationsForEmployee,
  listExpiringCertifications,
  removeCertification,
} from "./index";

/*
 * Spørringene for sertifiseringer (testplan docs/funksjoner/fase0b-sertifisering-testplan.md,
 * del 4). Fast dato: `NOW` er 31.10.2026 i Oslo. Testdata er oppdiktet.
 *
 * Støtter hovedmål: reklamasjoner (ingen publiserer uten gyldig sertifisering, admin ser i god
 * tid hvem som må fornye) og tid (fornyelse er én ny rad).
 */

beforeEach(resetDatabase);

const ISSUER = "Testsertifisering AS";
const NUMBER = "TEST-CERT-0001";
const AREA = "condition_report";

async function setup(role: EmployeeRole = "admin") {
  const org = await createOrganization();
  const person = await createUser({ name: "Kari Testdatter" });
  const actorEmployee = await createEmployee(person, org.id, [role]);
  const inspectorUser = await createUser({ name: "Ola Testsen" });
  const inspector = await createEmployee(inspectorUser, org.id, ["inspector"]);
  return { org, person, actorEmployee, inspector };
}

/** Ny takstmann i organisasjonen. Oppdiktet navn. */
async function newInspector(organizationId: string, name: string) {
  const user = await createUser({ name });
  return createEmployee(user, organizationId, ["inspector"]);
}

async function counts() {
  const [certs] = await db.select({ n: sql<number>`count(*)::int` }).from(certifications);
  const [logs] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
  return { certs: certs?.n ?? 0, logs: logs?.n ?? 0 };
}

async function certRow(id: string) {
  const [row] = await db.select().from(certifications).where(eq(certifications.id, id));
  if (!row) throw new Error("fant ikke sertifiseringen");
  return row;
}

type Call = (actor: Actor, orgId: string, employeeId: string, certId: string) => Promise<unknown>;

const calls: [string, Call][] = [
  [
    "listCertificationsForEmployee",
    (actor, orgId, employeeId) => listCertificationsForEmployee(actor, orgId, employeeId, NOW),
  ],
  [
    "addCertification",
    (actor, orgId, employeeId) =>
      addCertification(actor, orgId, { employeeId, area: AREA, validTo: "2027-10-31" }),
  ],
  [
    "removeCertification",
    (actor, orgId, _employeeId, certId) => removeCertification(actor, orgId, certId),
  ],
  ["listExpiringCertifications", (actor, orgId) => listExpiringCertifications(actor, orgId, NOW)],
];

describe("4.1 tilgang per rolle", () => {
  const denied: EmployeeRole[] = ["inspector", "office", "manager"];
  const cases = calls.flatMap(([name, call]) => denied.map((role) => [name, role, call] as const));

  it.each(cases)(
    "1. %s: rollen %s får AccessDeniedError og endrer ingenting",
    async (_n, role, call) => {
      const { org, person, inspector } = await setup(role);
      const cert = await createCertification(inspector, { validFrom: null, validTo: "2026-10-01" });
      const before = await counts();

      await expect(call(person, org.id, inspector.id, cert.id)).rejects.toThrow(AccessDeniedError);
      expect(await counts()).toEqual(before);
      expect((await certRow(cert.id)).deletedAt).toBeNull();
    },
  );

  it.each(calls)(
    "2. %s: takstmann med report.publish og gyldig sertifisering får AccessDeniedError",
    async (_n, call) => {
      const { org, person, actorEmployee } = await setup("inspector");
      await grantPermission(actorEmployee, "report.publish");
      const cert = await createCertification(actorEmployee);
      const before = await counts();
      await expect(call(person, org.id, actorEmployee.id, cert.id)).rejects.toThrow(
        AccessDeniedError,
      );
      expect(await counts()).toEqual(before);
    },
  );

  it.each(calls)("3. %s: ansatt uten roller og admin som har sluttet avvises", async (_n, call) => {
    const { org, person, actorEmployee, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    const noRoles = await createUser({ name: "Per Testmann" });
    await createEmployee(noRoles, org.id, []);
    await expect(call(noRoles, org.id, inspector.id, cert.id)).rejects.toThrow(AccessDeniedError);

    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, actorEmployee.id));
    const before = await counts();
    await expect(call(person, org.id, inspector.id, cert.id)).rejects.toThrow(AccessDeniedError);
    expect(await counts()).toEqual(before);
  });

  it.each(calls)("4. %s: admin lykkes", async (_n, call) => {
    const { org, person, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    await expect(call(person, org.id, inspector.id, cert.id)).resolves.toBeDefined();
  });
});

describe("4.2 tenant-isolasjon (regel 2)", () => {
  it("1. listCertificationsForEmployee", async () => {
    const employeeOf: Record<string, string> = {};
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const employee = await newInspector(grant.organizationId, `Testansatt ${side}`);
          const cert = await createCertification(employee);
          employeeOf[grant.organizationId] = employee.id;
          ids[side].push(cert.id);
        }
        return ids;
      },
      query: (actor, organizationId) =>
        listCertificationsForEmployee(
          actor,
          organizationId,
          employeeOf[organizationId] ?? randomUUID(),
          NOW,
        ),
      idOf: (row) => row.id,
    });
  });

  it("2. addCertification", async () => {
    const employeeOf: Record<string, string> = {};
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const employee = await newInspector(grant.organizationId, `Testansatt ${side}`);
          employeeOf[grant.organizationId] = employee.id;
        }
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => [
        await addCertification(actor, organizationId, {
          employeeId: employeeOf[organizationId] ?? randomUUID(),
          area: AREA,
          validTo: "2027-10-31",
        }),
      ],
      idOf: (row) => row.organizationId,
    });
    const rowsB = await db
      .select()
      .from(certifications)
      .where(eq(certifications.organizationId, orgB));
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]?.employeeId).toBe(employeeOf[orgB]);
  });

  it("3. removeCertification", async () => {
    const certOf: Record<string, string> = {};
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const employee = await newInspector(grant.organizationId, `Testansatt ${side}`);
          const cert = await createCertification(employee);
          certOf[grant.organizationId] = cert.id;
          ids[side].push(cert.id);
        }
        orgB = grantB.organizationId;
        return ids;
      },
      query: async (actor, organizationId) => [
        await removeCertification(actor, organizationId, certOf[organizationId] ?? randomUUID()),
      ],
      idOf: (row) => row.id,
    });
    // B-raden er fjernet én gang, av B selv (A ble avvist)
    const rowB = await certRow(certOf[orgB]!);
    expect(rowB.deletedAt).not.toBeNull();
    const deletesB = (await auditRows(orgB)).filter(
      (log) => log.entityType === "certification" && log.action === "delete",
    );
    expect(deletesB).toHaveLength(1);
    expect(deletesB[0]?.entityId).toBe(rowB.id);
  });

  it("4. listExpiringCertifications", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids: { a: string[]; b: string[] } = { a: [], b: [] };
        for (const [side, grant] of [
          ["a", grantA],
          ["b", grantB],
        ] as const) {
          const employee = await newInspector(grant.organizationId, `Testansatt ${side}`);
          const cert = await createCertification(employee, {
            validFrom: "2024-10-01",
            validTo: "2026-10-01",
          });
          ids[side].push(cert.id);
        }
        return ids;
      },
      query: (actor, organizationId) => listExpiringCertifications(actor, organizationId, NOW),
      idOf: (row) => row.certificationId,
    });
  });
});

describe("4.3 fremmed og ugyldig id i egen organisasjon (regel 2)", () => {
  async function twoOrgs() {
    const a = await setup("admin");
    const orgB = await createOrganization("Organisasjon B");
    const userB = await createUser({ name: "Per Testmann" });
    const employeeB = await createEmployee(userB, orgB.id, ["inspector"]);
    const certB = await createCertification(employeeB);
    return { ...a, orgB, employeeB, certB };
  }

  it("1. addCertification med ansatt fra B gir AccessDeniedError, ingen rad og ingen loggrad", async () => {
    const { org, person, orgB, employeeB } = await twoOrgs();
    const before = await counts();
    await expect(
      addCertification(person, org.id, {
        employeeId: employeeB.id,
        area: AREA,
        validTo: "2027-10-31",
      }),
    ).rejects.toThrow(AccessDeniedError);
    expect(await counts()).toEqual(before);
    expect(await auditRows(org.id)).toEqual([]);
    expect(await auditRows(orgB.id)).toEqual([]);
  });

  it("2. removeCertification med id fra B endrer ingenting", async () => {
    const { org, person, certB } = await twoOrgs();
    const before = await counts();
    await expect(removeCertification(person, org.id, certB.id)).rejects.toThrow(AccessDeniedError);
    const row = await certRow(certB.id);
    expect(row.deletedAt).toBeNull();
    expect(row.updatedAt).toEqual(certB.updatedAt);
    expect(await counts()).toEqual(before);
  });

  it("3. listCertificationsForEmployee med ansatt fra B gir AccessDeniedError (ikke tom liste)", async () => {
    const { org, person, employeeB } = await twoOrgs();
    await expect(listCertificationsForEmployee(person, org.id, employeeB.id, NOW)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it.each(["ikke-en-id", randomUUID()])(
    "4. id %s gir AccessDeniedError på alle tre, uten databasefeil",
    async (id) => {
      const { org, person } = await setup("admin");
      const before = await counts();
      await expect(listCertificationsForEmployee(person, org.id, id, NOW)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(
        addCertification(person, org.id, { employeeId: id, area: AREA, validTo: "2027-10-31" }),
      ).rejects.toThrow(AccessDeniedError);
      await expect(removeCertification(person, org.id, id)).rejects.toThrow(AccessDeniedError);
      expect(await counts()).toEqual(before);
    },
  );

  it("5. slettet ansatt avvises; ansatt som har sluttet kan få sertifisering (historikk)", async () => {
    const { org, person, inspector } = await setup("admin");
    const removed = await newInspector(org.id, "Bjørn Testesen");
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, removed.id));
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, inspector.id));

    const before = await counts();
    await expect(
      addCertification(person, org.id, {
        employeeId: removed.id,
        area: AREA,
        validTo: "2027-10-31",
      }),
    ).rejects.toThrow(AccessDeniedError);
    expect(await counts()).toEqual(before);

    // Valget i kortet (prosjektleder 31.10.2026): sluttet er lov, for historikken
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: AREA,
      validTo: "2027-10-31",
    });
    expect(row.employeeId).toBe(inspector.id);
  });

  it("6. removeCertification på en alt fjernet rad gir AccessDeniedError, deletedAt endres ikke", async () => {
    const { org, person, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    const first = await removeCertification(person, org.id, cert.id);
    await expect(removeCertification(person, org.id, cert.id)).rejects.toThrow(AccessDeniedError);
    expect((await certRow(cert.id)).deletedAt).toEqual(first.deletedAt);
  });
});

describe("4.4 legge til, fjerne og liste", () => {
  it("1. addCertification lagrer alle feltene, organisasjonen fra tilgangen og hvem som laget", async () => {
    const { org, person, actorEmployee, inspector } = await setup("admin");
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: AREA,
      validFrom: "2026-01-01",
      validTo: "2028-01-01",
      issuer: ISSUER,
      certificateNumber: NUMBER,
    });
    expect(row).toMatchObject({
      organizationId: org.id,
      employeeId: inspector.id,
      area: AREA,
      validFrom: "2026-01-01",
      validTo: "2028-01-01",
      issuer: ISSUER,
      certificateNumber: NUMBER,
      deletedAt: null,
    });
    // Admin: ansatt-id eller bruker-id (samme mønster som employee_permissions)
    expect([actorEmployee.id, person.id]).toContain(row.createdBy);
    expect(await certRow(row.id)).toEqual(row);
  });

  it("2. removeCertification er myk sletting: raden står med deletedAt", async () => {
    const { org, person, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    const before = await counts();
    const row = await removeCertification(person, org.id, cert.id);
    expect(row.id).toBe(cert.id);
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect((await counts()).certs).toBe(before.certs);
    expect((await certRow(cert.id)).deletedAt).toEqual(row.deletedAt);
    expect(await listCertificationsForEmployee(person, org.id, inspector.id, NOW)).toEqual([]);
  });

  it("3. fornyelse er ny rad; den gamle står og er merket utgått", async () => {
    const { org, person, inspector } = await setup("admin");
    const old = await createCertification(inspector, {
      validFrom: "2024-10-01",
      validTo: "2026-10-01",
    });
    const renewed = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: AREA,
      validFrom: "2026-10-15",
      validTo: "2028-10-15",
    });
    const rows = await listCertificationsForEmployee(person, org.id, inspector.id, NOW);
    expect(rows).toHaveLength(2);
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(old.id)).toBe("expired");
    expect(byId.get(renewed.id)).toBe("valid");
  });

  it("4. status følger tabellen i del 1, og slettede rader vises ikke", async () => {
    const { org, person, inspector } = await setup("admin");
    const expected = new Map<string, string>();
    let deletedId = "";
    for (const c of certificationCases) {
      const row = await createCertification(inspector, {
        validFrom: c.validFrom,
        validTo: c.validTo,
        deletedAt: c.deletedAt,
      });
      if (c.status === null) deletedId = row.id;
      else expected.set(row.id, c.status);
    }
    const rows = await listCertificationsForEmployee(person, org.id, inspector.id, NOW);
    expect(rows.map((row) => row.id)).not.toContain(deletedId);
    expect(new Map(rows.map((row) => [row.id, row.status]))).toEqual(expected);
  });

  it("5. svaret har faste nøkler, uten organizationId og userId", async () => {
    const { org, person, inspector } = await setup("admin");
    await createCertification(inspector, { validTo: "2026-10-01", validFrom: null });
    const [own] = await listCertificationsForEmployee(person, org.id, inspector.id, NOW);
    expect(Object.keys(own ?? {}).sort()).toEqual(
      ["area", "certificateNumber", "id", "issuer", "status", "validFrom", "validTo"].sort(),
    );
    const [expiring] = await listExpiringCertifications(person, org.id, NOW);
    expect(Object.keys(expiring ?? {}).sort()).toEqual(
      ["area", "certificationId", "employeeId", "employeeName", "status", "validTo"].sort(),
    );
  });
});

describe("4.5 listen «går ut snart» (now = 31.10.2026)", () => {
  it("1. utgått og innen 60 dager vises, 61 dager ikke; tidligst først", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    const b = await newInspector(org.id, "Bjørn Testesen");
    const c = await newInspector(org.id, "Cato Testesen");
    const d = await newInspector(org.id, "Dina Testesen");
    await createCertification(a, { validFrom: null, validTo: "2026-12-30" });
    await createCertification(b, { validFrom: null, validTo: "2026-10-30" });
    await createCertification(c, { validFrom: null, validTo: "2026-12-31" });
    await createCertification(d, { validFrom: null, validTo: "2026-10-31" });

    const rows = await listExpiringCertifications(admin, org.id, NOW);
    expect(rows.map((row) => [row.employeeName, row.validTo, row.status])).toEqual([
      ["Bjørn Testesen", "2026-10-30", "expired"],
      ["Dina Testesen", "2026-10-31", "expiring"],
      ["Anne Testesen", "2026-12-30", "expiring"],
    ]);
    expect(rows.map((row) => row.employeeId)).toEqual([b.id, d.id, a.id]);
  });

  it("2. fornyet vises ikke: gammel utgått, ny gyldig i ett år", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: "2024-10-01", validTo: "2026-10-01" });
    await createCertification(a, { validFrom: "2026-10-01", validTo: "2027-10-01" });
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("3. fornyet med gyldig fra frem i tid vises ikke", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    // Gammel går ut om 10 dager, ny starter om 11 dager og varer ett år
    await createCertification(a, { validFrom: null, validTo: "2026-11-10" });
    await createCertification(a, { validFrom: "2026-11-11", validTo: "2027-11-11" });
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("4. nyeste per område er senest gyldig til, ikke sist opprettet", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: null, validTo: "2027-10-31" });
    await createCertification(a, { validFrom: null, validTo: "2026-01-01" });
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("5. slettet rad teller ikke", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    const b = await newInspector(org.id, "Bjørn Testesen");
    // Den eneste gyldige raden er slettet, så den utgåtte vises
    const expired = await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    await createCertification(a, {
      validFrom: null,
      validTo: "2027-10-01",
      deletedAt: new Date(),
    });
    // En slettet utgått rad alene gir ingen linje
    await createCertification(b, { validFrom: null, validTo: "2026-10-01", deletedAt: new Date() });
    const rows = await listExpiringCertifications(admin, org.id, NOW);
    expect(rows.map((row) => row.certificationId)).toEqual([expired.id]);
  });

  it("6. ansatt som har sluttet (deactivated_at) vises ikke", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    expect(await listExpiringCertifications(admin, org.id, NOW)).toHaveLength(1);
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, a.id));
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("7. ansatt med deleted_at vises ikke", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    expect(await listExpiringCertifications(admin, org.id, NOW)).toHaveLength(1);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, a.id));
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("8. én linje per ansatt og område, også med flere utgåtte rader", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: null, validTo: "2025-10-01" });
    await createCertification(a, { validFrom: null, validTo: "2024-10-01" });
    const latest = await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    const rows = await listExpiringCertifications(admin, org.id, NOW);
    expect(rows.map((row) => row.certificationId)).toEqual([latest.id]);
  });

  it("9. ansatt uten sertifisering vises ikke", async () => {
    const { org, person: admin, inspector } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    const rows = await listExpiringCertifications(admin, org.id, NOW);
    expect(rows.map((row) => row.employeeId)).toEqual([a.id]);
    expect(rows.map((row) => row.employeeId)).not.toContain(inspector.id);
  });

  it("10. tom liste gir []", async () => {
    const { org, person: admin } = await setup("admin");
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("11. midnatt: now = 23:30 UTC 30.10, gyldig til 30.10 gir status expired", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await newInspector(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: null, validTo: "2026-10-30" });
    const rows = await listExpiringCertifications(admin, org.id, MIDNIGHT_UTC);
    expect(rows.map((row) => row.status)).toEqual(["expired"]);
  });
});

describe("4.6 validering (regeltester som data)", () => {
  const base = { area: AREA, validTo: "2027-10-31" };
  const VALID_TO = "Velg dato for gyldig til.";
  const RANGE = "Gyldig fra kan ikke være etter gyldig til.";
  const tooLong = "x".repeat(1000);

  const invalid: [string, Record<string, unknown>, string | null][] = [
    ["1. gyldig til mangler", { area: AREA }, VALID_TO],
    ["1. gyldig til tom", { ...base, validTo: "" }, VALID_TO],
    ["2. gyldig fra etter gyldig til", { ...base, validFrom: "2027-11-01" }, RANGE],
    ["4. gyldig til 31.13.2026", { ...base, validTo: "31.13.2026" }, null],
    ["4. gyldig til 2026-02-30", { ...base, validTo: "2026-02-30" }, null],
    ["4. gyldig til ikke-dato", { ...base, validTo: "ikke-dato" }, null],
    ["4. gyldig fra 31.13.2026", { ...base, validFrom: "31.13.2026" }, null],
    ["4. gyldig fra 2026-02-30", { ...base, validFrom: "2026-02-30" }, null],
    ["4. gyldig fra ikke-dato", { ...base, validFrom: "ikke-dato" }, null],
    ["5. ukjent område bolig", { ...base, area: "bolig" }, null],
    ["5. tomt område", { ...base, area: "" }, null],
    ["6. for langt nummer", { ...base, certificateNumber: tooLong }, null],
    ["6. for lang utsteder", { ...base, issuer: tooLong }, null],
  ];

  it.each(invalid)(
    "%s avvises med ZodError, uten rad og loggrad (7)",
    async (_n, input, message) => {
      const { org, person, inspector } = await setup("admin");
      const before = await counts();
      const promise = addCertification(person, org.id, {
        employeeId: inspector.id,
        ...input,
      } as Parameters<typeof addCertification>[2]);
      await expect(promise).rejects.toBeInstanceOf(ZodError);
      if (message) await expect(promise).rejects.toThrow(message);
      expect(await counts()).toEqual(before);
    },
  );

  it("3. gyldig fra lik gyldig til godtas", async () => {
    const { org, person, inspector } = await setup("admin");
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: AREA,
      validFrom: "2027-10-31",
      validTo: "2027-10-31",
    });
    expect(row.validFrom).toBe(row.validTo);
  });

  it("5. condition_report godtas", async () => {
    const { org, person, inspector } = await setup("admin");
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: AREA,
      validTo: "2027-10-31",
    });
    expect(row.area).toBe(AREA);
  });
});

describe("4.7 revisjonslogg", () => {
  it("1. addCertification gir én rad certification/create med organisasjon, id og aktør", async () => {
    const { org, person, actorEmployee, inspector } = await setup("admin");
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: AREA,
      validTo: "2027-10-31",
      certificateNumber: NUMBER,
    });
    const logs = (await auditRows(org.id)).filter((log) => log.entityType === "certification");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      organizationId: org.id,
      entityType: "certification",
      action: "create",
      entityId: row.id,
      actorEmployeeId: actorEmployee.id,
    });
  });

  it("2. removeCertification gir én rad certification/delete", async () => {
    const { org, person, actorEmployee, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    await removeCertification(person, org.id, cert.id);
    const logs = (await auditRows(org.id)).filter((log) => log.entityType === "certification");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      organizationId: org.id,
      action: "delete",
      entityId: cert.id,
      actorEmployeeId: actorEmployee.id,
    });
  });

  it("3. ingen loggrad ved avvist tilgang eller valideringsfeil", async () => {
    const { org, person, inspector } = await setup("admin");
    const outsider = await createUser({ name: "Per Testmann" });
    await createEmployee(outsider, org.id, ["manager"]);
    const cert = await createCertification(inspector);

    await expect(
      addCertification(outsider, org.id, {
        employeeId: inspector.id,
        area: AREA,
        validTo: "2027-10-31",
      }),
    ).rejects.toThrow(AccessDeniedError);
    await expect(removeCertification(outsider, org.id, cert.id)).rejects.toThrow(AccessDeniedError);
    await expect(
      addCertification(person, org.id, { employeeId: inspector.id, area: AREA, validTo: "" }),
    ).rejects.toBeInstanceOf(ZodError);

    expect(await auditRows(org.id)).toEqual([]);
  });
});
