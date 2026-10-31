import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, certifications, employees, type EmployeeRole } from "@/db/schema";
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
 * del 4). Fast dato: i dag er 2026-10-31 i Oslo. Testdata er oppdiktet.
 */

beforeEach(resetDatabase);

const NOW = new Date("2026-10-31T10:00:00Z");
const ISSUER = "Testsertifisering AS";
const NUMBER = "TEST-CERT-0001";

async function setup(role: EmployeeRole = "admin") {
  const org = await createOrganization();
  const person = await createUser({ name: "Kari Testdatter" });
  const actorEmployee = await createEmployee(person, org.id, [role]);
  const inspectorUser = await createUser({ name: "Ola Testsen" });
  const inspector = await createEmployee(inspectorUser, org.id, ["inspector"]);
  return { org, person, actorEmployee, inspector };
}

async function counts() {
  const [certs] = await db.select({ n: sql<number>`count(*)::int` }).from(certifications);
  const [logs] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog);
  return { certs: certs?.n ?? 0, logs: logs?.n ?? 0 };
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
      addCertification(actor, orgId, {
        employeeId,
        area: "condition_report",
        validTo: "2027-10-31",
      }),
  ],
  [
    "removeCertification",
    (actor, orgId, _employeeId, certId) => removeCertification(actor, orgId, certId),
  ],
  ["listExpiringCertifications", (actor, orgId) => listExpiringCertifications(actor, orgId, NOW)],
];

describe("tilgang", () => {
  const denied: EmployeeRole[] = ["inspector", "office", "manager"];
  const cases = calls.flatMap(([name, call]) => denied.map((role) => [name, role, call] as const));

  it.each(cases)(
    "%s: rollen %s får AccessDeniedError og endrer ingenting",
    async (_n, role, call) => {
      const { org, person, inspector } = await setup(role);
      const cert = await createCertification(inspector, { validFrom: null, validTo: "2026-10-01" });
      const before = await counts();

      await expect(call(person, org.id, inspector.id, cert.id)).rejects.toThrow(AccessDeniedError);
      expect(await counts()).toEqual(before);
      const [row] = await db.select().from(certifications).where(eq(certifications.id, cert.id));
      expect(row?.deletedAt).toBeNull();
    },
  );

  it.each(calls)(
    "%s: takstmann med report.publish og gyldig sertifisering får AccessDeniedError",
    async (_n, call) => {
      const { org, person, actorEmployee } = await setup("inspector");
      await grantPermission(actorEmployee, "report.publish");
      const cert = await createCertification(actorEmployee);
      await expect(call(person, org.id, actorEmployee.id, cert.id)).rejects.toThrow(
        AccessDeniedError,
      );
    },
  );

  it.each(calls)("%s: ansatt uten roller og admin som har sluttet avvises", async (_n, call) => {
    const { org, person, actorEmployee, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    const noRoles = await createUser();
    await createEmployee(noRoles, org.id, []);
    await expect(call(noRoles, org.id, inspector.id, cert.id)).rejects.toThrow(AccessDeniedError);

    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, actorEmployee.id));
    await expect(call(person, org.id, inspector.id, cert.id)).rejects.toThrow(AccessDeniedError);
  });

  it.each(calls)("%s: admin lykkes", async (_n, call) => {
    const { org, person, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    await expect(call(person, org.id, inspector.id, cert.id)).resolves.toBeDefined();
  });
});

describe("tenant-isolasjon", () => {
  it("listCertificationsForEmployee", async () => {
    const employeeOf: Record<string, string> = {};
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createCertification({
          id: grantA.employeeId,
          organizationId: grantA.organizationId,
        });
        const b = await createCertification({
          id: grantB.employeeId,
          organizationId: grantB.organizationId,
        });
        employeeOf[grantA.organizationId] = grantA.employeeId;
        employeeOf[grantB.organizationId] = grantB.employeeId;
        return { a: [a.id], b: [b.id] };
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

  it("addCertification", async () => {
    const employeeOf: Record<string, string> = {};
    let orgB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        employeeOf[grantA.organizationId] = grantA.employeeId;
        employeeOf[grantB.organizationId] = grantB.employeeId;
        orgB = grantB.organizationId;
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => [
        await addCertification(actor, organizationId, {
          employeeId: employeeOf[organizationId] ?? randomUUID(),
          area: "condition_report",
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
  });

  it("removeCertification", async () => {
    const certOf: Record<string, string> = {};
    let certB = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createCertification({
          id: grantA.employeeId,
          organizationId: grantA.organizationId,
        });
        const b = await createCertification({
          id: grantB.employeeId,
          organizationId: grantB.organizationId,
        });
        certOf[grantA.organizationId] = a.id;
        certOf[grantB.organizationId] = b.id;
        certB = b.id;
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await removeCertification(actor, organizationId, certOf[organizationId] ?? randomUUID()),
      ],
      idOf: (row) => row.id,
    });
    const [rowB] = await db.select().from(certifications).where(eq(certifications.id, certB));
    expect(rowB?.deletedAt).not.toBeNull();
  });

  it("listExpiringCertifications", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createCertification(
          { id: grantA.employeeId, organizationId: grantA.organizationId },
          { validFrom: "2024-01-01", validTo: "2026-10-01" },
        );
        const b = await createCertification(
          { id: grantB.employeeId, organizationId: grantB.organizationId },
          { validFrom: "2024-01-01", validTo: "2026-10-01" },
        );
        return { a: [a.id], b: [b.id] };
      },
      query: (actor, organizationId) => listExpiringCertifications(actor, organizationId, NOW),
      idOf: (row) => row.certificationId,
    });
  });
});

describe("fremmed og ugyldig id", () => {
  async function twoOrgs() {
    const a = await setup("admin");
    const orgB = await createOrganization("Organisasjon B");
    const userB = await createUser({ name: "Per Testmann" });
    const employeeB = await createEmployee(userB, orgB.id, ["inspector"]);
    const certB = await createCertification(employeeB);
    return { ...a, orgB, employeeB, certB };
  }

  it("addCertification med ansatt fra B gir AccessDeniedError og ingen rad", async () => {
    const { org, person, employeeB } = await twoOrgs();
    const before = await counts();
    await expect(
      addCertification(person, org.id, {
        employeeId: employeeB.id,
        area: "condition_report",
        validTo: "2027-10-31",
      }),
    ).rejects.toThrow(AccessDeniedError);
    expect(await counts()).toEqual(before);
  });

  it("removeCertification med id fra B endrer ingenting", async () => {
    const { org, person, certB } = await twoOrgs();
    await expect(removeCertification(person, org.id, certB.id)).rejects.toThrow(AccessDeniedError);
    const [row] = await db.select().from(certifications).where(eq(certifications.id, certB.id));
    expect(row?.deletedAt).toBeNull();
    expect(row?.updatedAt).toEqual(certB.updatedAt);
  });

  it("listCertificationsForEmployee med ansatt fra B gir AccessDeniedError", async () => {
    const { org, person, employeeB } = await twoOrgs();
    await expect(listCertificationsForEmployee(person, org.id, employeeB.id, NOW)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it.each(["ikke-en-id", randomUUID()])("id %s gir AccessDeniedError", async (id) => {
    const { org, person } = await setup("admin");
    await expect(listCertificationsForEmployee(person, org.id, id, NOW)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(
      addCertification(person, org.id, {
        employeeId: id,
        area: "condition_report",
        validTo: "2027-10-31",
      }),
    ).rejects.toThrow(AccessDeniedError);
    await expect(removeCertification(person, org.id, id)).rejects.toThrow(AccessDeniedError);
  });

  it("slettet ansatt avvises; ansatt som har sluttet kan få sertifisering (historikk)", async () => {
    const { org, person, inspector } = await setup("admin");
    const otherUser = await createUser();
    const removed = await createEmployee(otherUser, org.id, ["inspector"]);
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, removed.id));
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, inspector.id));

    await expect(
      addCertification(person, org.id, {
        employeeId: removed.id,
        area: "condition_report",
        validTo: "2027-10-31",
      }),
    ).rejects.toThrow(AccessDeniedError);
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: "condition_report",
      validTo: "2027-10-31",
    });
    expect(row.employeeId).toBe(inspector.id);
  });

  it("removeCertification på en fjernet rad gir AccessDeniedError", async () => {
    const { org, person, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    const first = await removeCertification(person, org.id, cert.id);
    await expect(removeCertification(person, org.id, cert.id)).rejects.toThrow(AccessDeniedError);
    const [row] = await db.select().from(certifications).where(eq(certifications.id, cert.id));
    expect(row?.deletedAt).toEqual(first.deletedAt);
  });
});

describe("legge til, fjerne og liste", () => {
  it("addCertification lagrer feltene, organisasjonen og hvem som laget", async () => {
    const { org, person, actorEmployee, inspector } = await setup("admin");
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: "condition_report",
      validFrom: "2026-01-01",
      validTo: "2028-01-01",
      issuer: `  ${ISSUER}  `,
      certificateNumber: NUMBER,
    });
    expect(row).toMatchObject({
      organizationId: org.id,
      employeeId: inspector.id,
      area: "condition_report",
      validFrom: "2026-01-01",
      validTo: "2028-01-01",
      issuer: ISSUER,
      certificateNumber: NUMBER,
      createdBy: actorEmployee.id,
      deletedAt: null,
    });
  });

  it("removeCertification er myk sletting", async () => {
    const { org, person, actorEmployee, inspector } = await setup("admin");
    const cert = await createCertification(inspector);
    const before = await counts();
    const row = await removeCertification(person, org.id, cert.id);
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.deletedBy).toBe(actorEmployee.id);
    expect((await counts()).certs).toBe(before.certs);
    expect(await listCertificationsForEmployee(person, org.id, inspector.id, NOW)).toEqual([]);
  });

  it("fornyelse er ny rad, den gamle er merket utgått", async () => {
    const { org, person, inspector } = await setup("admin");
    await createCertification(inspector, { validFrom: "2024-10-01", validTo: "2026-10-01" });
    await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: "condition_report",
      validFrom: "2026-10-15",
      validTo: "2028-10-15",
    });
    const rows = await listCertificationsForEmployee(person, org.id, inspector.id, NOW);
    expect(rows.map((row) => [row.validTo, row.status])).toEqual([
      ["2028-10-15", "valid"],
      ["2026-10-01", "expired"],
    ]);
  });

  it("status følger datoregelen", async () => {
    const { org, person, inspector } = await setup("admin");
    await createCertification(inspector, { validFrom: null, validTo: "2026-10-31" });
    await createCertification(inspector, { validFrom: "2026-11-01", validTo: "2027-11-01" });
    await createCertification(inspector, { validFrom: null, validTo: "2027-06-01" });
    const rows = await listCertificationsForEmployee(person, org.id, inspector.id, NOW);
    expect(rows.map((row) => [row.validTo, row.status])).toEqual([
      ["2027-11-01", "not_started"],
      ["2027-06-01", "valid"],
      ["2026-10-31", "expiring"],
    ]);
  });

  it("svaret har faste nøkler", async () => {
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

describe("listen «går ut snart»", () => {
  async function person(orgId: string, name: string) {
    const user = await createUser({ name });
    return createEmployee(user, orgId, ["inspector"]);
  }

  it("viser utgått og innen 60 dager, ikke 61, tidligst først", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await person(org.id, "Anne Testesen");
    const b = await person(org.id, "Bjørn Testesen");
    const c = await person(org.id, "Cato Testesen");
    const d = await person(org.id, "Dina Testesen");
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
  });

  it("fornyet vises ikke, heller ikke med gyldig fra frem i tid", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await person(org.id, "Anne Testesen");
    const b = await person(org.id, "Bjørn Testesen");
    await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    await createCertification(a, { validFrom: "2026-10-01", validTo: "2027-10-01" });
    await createCertification(b, { validFrom: null, validTo: "2026-11-10" });
    await createCertification(b, { validFrom: "2026-11-11", validTo: "2027-11-11" });
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("nyeste er senest gyldig til, ikke sist opprettet", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await person(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: null, validTo: "2027-10-31" });
    await createCertification(a, { validFrom: null, validTo: "2026-01-01" });
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("slettet rad teller ikke", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await person(org.id, "Anne Testesen");
    const b = await person(org.id, "Bjørn Testesen");
    const expired = await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    await createCertification(a, {
      validFrom: null,
      validTo: "2027-10-01",
      deletedAt: new Date(),
    });
    await createCertification(b, { validFrom: null, validTo: "2026-10-01", deletedAt: new Date() });
    const rows = await listExpiringCertifications(admin, org.id, NOW);
    expect(rows.map((row) => row.certificationId)).toEqual([expired.id]);
  });

  it("ansatte som har sluttet eller er slettet vises ikke", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await person(org.id, "Anne Testesen");
    const b = await person(org.id, "Bjørn Testesen");
    await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    await createCertification(b, { validFrom: null, validTo: "2026-10-01" });
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, a.id));
    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, b.id));
    expect(await listExpiringCertifications(admin, org.id, NOW)).toEqual([]);
  });

  it("én linje per ansatt og område, ingen for ansatt uten sertifisering", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await person(org.id, "Anne Testesen");
    await person(org.id, "Bjørn Testesen");
    await createCertification(a, { validFrom: null, validTo: "2025-10-01" });
    const latest = await createCertification(a, { validFrom: null, validTo: "2026-10-01" });
    const rows = await listExpiringCertifications(admin, org.id, NOW);
    expect(rows.map((row) => row.certificationId)).toEqual([latest.id]);
  });

  it("midnatt i Oslo: 23:30 UTC den 30.10 er 31.10, så 30.10 er utgått", async () => {
    const { org, person: admin } = await setup("admin");
    const a = await person(org.id, "Anne Testesen");
    await createCertification(a, { validFrom: null, validTo: "2026-10-30" });
    const rows = await listExpiringCertifications(admin, org.id, new Date("2026-10-30T23:30:00Z"));
    expect(rows.map((row) => row.status)).toEqual(["expired"]);
  });
});

describe("validering", () => {
  const base = { area: "condition_report", validTo: "2027-10-31" };
  const invalid: [string, Record<string, unknown>, string | null][] = [
    ["gyldig til mangler", { area: "condition_report" }, "Velg dato for gyldig til."],
    ["gyldig til tom", { ...base, validTo: "" }, "Velg dato for gyldig til."],
    [
      "gyldig fra etter gyldig til",
      { ...base, validFrom: "2027-11-01" },
      "Gyldig fra kan ikke være etter gyldig til.",
    ],
    ["31.13.2026", { ...base, validTo: "31.13.2026" }, "Velg dato for gyldig til."],
    ["2026-02-30", { ...base, validTo: "2026-02-30" }, "Velg dato for gyldig til."],
    ["ikke-dato i gyldig fra", { ...base, validFrom: "ikke-dato" }, null],
    ["ukjent område", { ...base, area: "bolig" }, null],
    ["tomt område", { ...base, area: "" }, null],
    ["for langt nummer", { ...base, certificateNumber: "x".repeat(201) }, null],
    ["for lang utsteder", { ...base, issuer: "x".repeat(201) }, null],
  ];

  it.each(invalid)("%s avvises uten rad og loggrad", async (_n, input, message) => {
    const { org, person, inspector } = await setup("admin");
    const before = await counts();
    const promise = addCertification(person, org.id, {
      employeeId: inspector.id,
      ...input,
    } as Parameters<typeof addCertification>[2]);
    await expect(promise).rejects.toThrow(ZodError);
    if (message) await expect(promise).rejects.toThrow(message);
    expect(await counts()).toEqual(before);
  });

  it("gyldig fra lik gyldig til og 200 tegn godtas", async () => {
    const { org, person, inspector } = await setup("admin");
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: "condition_report",
      validFrom: "2027-10-31",
      validTo: "2027-10-31",
      issuer: "x".repeat(200),
      certificateNumber: "",
    });
    expect(row.certificateNumber).toBeNull();
  });
});

describe("revisjonslogg", () => {
  it("legge til og fjerne gir create og delete med riktig aktør", async () => {
    const { org, person, actorEmployee, inspector } = await setup("admin");
    const row = await addCertification(person, org.id, {
      employeeId: inspector.id,
      area: "condition_report",
      validTo: "2027-10-31",
      certificateNumber: NUMBER,
    });
    await removeCertification(person, org.id, row.id);
    const logs = await auditRows(org.id);
    expect(
      logs.map((log) => [log.entityType, log.action, log.entityId, log.actorEmployeeId]),
    ).toEqual([
      ["certification", "create", row.id, actorEmployee.id],
      ["certification", "delete", row.id, actorEmployee.id],
    ]);
    expect(JSON.stringify(logs.map((log) => log.changes))).not.toContain(NUMBER);
  });
});
