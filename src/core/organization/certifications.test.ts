import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import {
  AccessDeniedError,
  CERTIFICATION_EXPIRY_WARNING_DAYS,
  certificationAreaLabels,
  certificationAreas,
  type Actor,
} from "@/core/access";
import { db } from "@/db/client";
import { auditLog, certifications, employees, type EmployeeRole } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import {
  auditRows,
  createCertification as giveCertification,
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  createCertification,
  deleteCertification,
  listCertificationsForEmployee,
  listExpiringCertifications,
  type CertificationCreateInput,
} from "./index";

/*
 * Sertifiseringer i kjernen: tilgang, tenant-isolasjon, fremmed id, validering, myk sletting,
 * databasen, revisjonslogg og listen «går ut snart».
 * Testplan: docs/funksjoner/fase0b-sertifisering-testplan.md avsnitt 3 og 4.
 * Støtter hovedmål: reklamasjoner (riktig utløpsdato, admin ser i tide hvem som må fornye) og tid
 * (fornyelse er én ny rad).
 * Testdata er oppdiktet: «Kari Testdatter», e-post på eksempel.no, TEST-CERT-0001,
 * «Testsertifisering AS».
 */

const NOW = new Date("2026-10-31T10:00:00Z");
const KARI_NAME = "Kari Testdatter";
const KARI_EMAIL = "kari.testdatter@eksempel.no";
const CERT_NUMBER = "TEST-CERT-0001";
const ISSUER = "Testsertifisering AS";
const MISSING_VALID_TO = "Velg dato for gyldig til.";
const FROM_AFTER_TO = "Gyldig fra kan ikke være etter gyldig til.";

beforeEach(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------
// Hjelpere

type Employee = Awaited<ReturnType<typeof createEmployee>>;

/** Organisasjon med en admin og takstmannen Kari. */
async function setup(name = "Testfirma takst") {
  const org = await createOrganization(name);
  const admin = await createUser({
    name: "Admin Testesen",
    email: `admin.${randomUUID()}@eksempel.no`,
  });
  const adminEmployee = await createEmployee(admin, org.id, ["admin"]);
  const kariUser = await createUser({ name: KARI_NAME, email: `${randomUUID()}.${KARI_EMAIL}` });
  const kari = await createEmployee(kariUser, org.id, ["inspector"]);
  return { org, admin, adminEmployee, kariUser, kari };
}

async function addPerson(
  organizationId: string,
  name: string,
  roles: EmployeeRole[] = ["inspector"],
) {
  const user = await createUser({ name });
  const employee = await createEmployee(user, organizationId, roles);
  return { user, employee };
}

async function counts() {
  const [row] = await db.execute<{ certifications: number; audit_log: number }>(sql`select
      (select count(*)::int from certifications) as certifications,
      (select count(*)::int from audit_log) as audit_log`);
  if (!row) throw new Error("fant ikke tellingen");
  return row;
}

async function certRow(id: string) {
  const [row] = await db.select().from(certifications).where(eq(certifications.id, id));
  return row;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("forventet en feil");
}

/** Postgres-feilkoden, enten direkte eller i `cause` (Drizzle pakker inn feilen). */
function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

async function setDeactivated(employeeId: string) {
  await db.update(employees).set({ deactivatedAt: NOW }).where(eq(employees.id, employeeId));
}

async function setDeleted(employeeId: string) {
  await db.update(employees).set({ deletedAt: NOW }).where(eq(employees.id, employeeId));
}

type Call = (actor: Actor, organizationId: string) => Promise<unknown>;

/** De fire funksjonene, med gyldige argumenter for Kari i organisasjonen. */
async function fourCalls(kari: Employee): Promise<{ navn: string; call: Call }[]> {
  const cert = await giveCertification(kari, { validTo: "2027-10-31" });
  return [
    {
      navn: "listCertificationsForEmployee",
      call: (actor, organizationId) =>
        listCertificationsForEmployee(actor, organizationId, kari.id),
    },
    {
      navn: "createCertification",
      call: (actor, organizationId) =>
        createCertification(actor, organizationId, { employeeId: kari.id, validTo: "2027-10-31" }),
    },
    {
      navn: "deleteCertification",
      call: (actor, organizationId) => deleteCertification(actor, organizationId, cert.id),
    },
    {
      navn: "listExpiringCertifications",
      call: (actor, organizationId) => listExpiringCertifications(actor, organizationId),
    },
  ];
}

async function expectAllDenied(actor: Actor, organizationId: string, kari: Employee) {
  const calls = await fourCalls(kari);
  const before = await counts();
  for (const { navn, call } of calls) {
    await expect(call(actor, organizationId), navn).rejects.toBeInstanceOf(AccessDeniedError);
  }
  expect(await counts()).toEqual(before);
  const [cert] = await db
    .select()
    .from(certifications)
    .where(eq(certifications.employeeId, kari.id));
  expect(cert?.deletedAt ?? null).toBeNull();
}

// ---------------------------------------------------------------------------------------------
// 3.1 Tilgang per rolle

describe("3.1 tilgang per rolle", () => {
  it.each<EmployeeRole>(["inspector", "office", "manager"])(
    "%s får AccessDeniedError på alle fire, og ingen rader eller loggrader endres",
    async (role) => {
      const { org, kari } = await setup();
      const { user, employee } = await addPerson(org.id, "Ola Testesen", [role]);
      // Med gyldig sertifisering: sertifiseringen gir ingen adminrettighet
      await giveCertification(employee, { validTo: "2027-10-31" });
      await expectAllDenied(user, org.id, kari);
    },
  );

  it("ansatt uten roller får AccessDeniedError på alle fire", async () => {
    const { org, kari } = await setup();
    const { user } = await addPerson(org.id, "Ola Testesen", []);
    await expectAllDenied(user, org.id, kari);
  });

  it("admin som har sluttet får AccessDeniedError på alle fire", async () => {
    const { org, kari } = await setup();
    const { user, employee } = await addPerson(org.id, "Admin Sluttesen", ["admin"]);
    await setDeactivated(employee.id);
    await expectAllDenied(user, org.id, kari);
  });

  it("slettet admin får AccessDeniedError på alle fire", async () => {
    const { org, kari } = await setup();
    const { user, employee } = await addPerson(org.id, "Admin Slettesen", ["admin"]);
    await setDeleted(employee.id);
    await expectAllDenied(user, org.id, kari);
  });

  it.each(["report.publish", "template.edit_structure"])(
    "takstmann med enkeltrettigheten %s får fortsatt AccessDeniedError",
    async (permission) => {
      const { org, kari } = await setup();
      const { user, employee } = await addPerson(org.id, "Ola Testesen", ["inspector"]);
      await grantPermission(employee, permission);
      await giveCertification(employee, { validTo: "2027-10-31" });
      await expectAllDenied(user, org.id, kari);
    },
  );

  it("takstmann kan ikke registrere sertifisering på seg selv", async () => {
    const { org, kariUser, kari } = await setup();
    const before = await counts();
    await expect(
      createCertification(kariUser, org.id, { employeeId: kari.id, validTo: "2027-10-31" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await counts()).toEqual(before);
  });

  it("admin lykkes på alle fire (positiv kontroll)", async () => {
    const { org, admin, kari } = await setup();
    for (const { navn, call } of await fourCalls(kari)) {
      await expect(call(admin, org.id), navn).resolves.toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3.2 Tenant-isolasjon (ett expectTenantIsolation per funksjon)

describe("3.2 tenant-isolasjon", () => {
  it("listCertificationsForEmployee", async () => {
    const employeeByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [grant, key] of [
          [grantA, "a"],
          [grantB, "b"],
        ] as const) {
          const { employee } = await addPerson(grant.organizationId, KARI_NAME);
          employeeByOrg.set(grant.organizationId, employee.id);
          const cert = await giveCertification(employee, { validTo: "2027-10-31" });
          ids[key].push(cert.id);
        }
        return ids;
      },
      query: (actor, organizationId) =>
        listCertificationsForEmployee(
          actor,
          organizationId,
          employeeByOrg.get(organizationId) ?? "",
        ),
      idOf: (row) => row.id,
    });
  });

  it("createCertification", async () => {
    const employeeByOrg = new Map<string, string>();
    let orgB = "";
    let orgA = "";
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        orgA = grantA.organizationId;
        orgB = grantB.organizationId;
        for (const grant of [grantA, grantB]) {
          const { employee } = await addPerson(grant.organizationId, KARI_NAME);
          employeeByOrg.set(grant.organizationId, employee.id);
        }
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => [
        await createCertification(actor, organizationId, {
          employeeId: employeeByOrg.get(organizationId) ?? "",
          validTo: "2027-10-31",
        }),
      ],
      idOf: (row) => row.organizationId,
    });
    const inB = await db
      .select()
      .from(certifications)
      .where(eq(certifications.organizationId, orgB));
    expect(inB).toHaveLength(1);
    expect(inB[0]?.employeeId).toBe(employeeByOrg.get(orgB));
    const inA = await db
      .select()
      .from(certifications)
      .where(eq(certifications.organizationId, orgA));
    expect(inA).toHaveLength(1);
  });

  it("deleteCertification", async () => {
    const certByOrg = new Map<string, string>();
    const adminByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [grant, key] of [
          [grantA, "a"],
          [grantB, "b"],
        ] as const) {
          const { employee } = await addPerson(grant.organizationId, KARI_NAME);
          const cert = await giveCertification(employee, { validTo: "2027-10-31" });
          certByOrg.set(grant.organizationId, cert.id);
          adminByOrg.set(grant.organizationId, grant.employeeId);
          ids[key].push(cert.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => [
        await deleteCertification(actor, organizationId, certByOrg.get(organizationId) ?? ""),
      ],
      idOf: (row) => row.id,
    });
    // Hver rad er slettet av admin i sin egen organisasjon, aldri av den andre
    for (const [organizationId, certId] of certByOrg) {
      const row = await certRow(certId);
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(row?.deletedBy).toBe(adminByOrg.get(organizationId));
      expect(row?.organizationId).toBe(organizationId);
    }
  });

  it("listExpiringCertifications", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [grant, key] of [
          [grantA, "a"],
          [grantB, "b"],
        ] as const) {
          const { employee } = await addPerson(grant.organizationId, KARI_NAME);
          const cert = await giveCertification(employee, { validTo: "2026-10-30" });
          ids[key].push(cert.id);
        }
        return ids;
      },
      query: (actor, organizationId) => listExpiringCertifications(actor, organizationId),
      idOf: (row) => row.certificationId,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 3.3 Fremmed id i egen organisasjon (regel 2)

describe("3.3 fremmed id", () => {
  async function twoOrgs() {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");
    const certB = await giveCertification(b.kari, { validTo: "2027-10-31" });
    return { a, b, certB };
  }

  async function snapshot() {
    return {
      certs: await db.select().from(certifications).orderBy(certifications.id),
      audit: await db.select().from(auditLog),
    };
  }

  type Target = "list" | "create" | "delete";
  const run = (target: Target, actor: Actor, organizationId: string, id: string) => {
    switch (target) {
      case "list":
        return listCertificationsForEmployee(actor, organizationId, id);
      case "create":
        return createCertification(actor, organizationId, {
          employeeId: id,
          validTo: "2027-10-31",
        });
      case "delete":
        return deleteCertification(actor, organizationId, id);
    }
  };

  it.each<Target>(["list", "create", "delete"])(
    "%s: admin A med orgA og id fra B gir AccessDeniedError, ingenting endres",
    async (target) => {
      const { a, b, certB } = await twoOrgs();
      const foreignId = target === "delete" ? certB.id : b.kari.id;
      const before = await snapshot();
      await expect(run(target, a.admin, a.org.id, foreignId)).rejects.toBeInstanceOf(
        AccessDeniedError,
      );
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(
    (["list", "create", "delete"] as Target[]).flatMap((target) => [
      { target, id: "ikke-en-id" },
      { target, id: randomUUID() },
    ]),
  )("$target med id $id: AccessDeniedError, ingen databasefeil", async ({ target, id }) => {
    const { a } = await twoOrgs();
    const before = await snapshot();
    await expect(run(target, a.admin, a.org.id, id)).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await snapshot()).toEqual(before);
  });

  it("slettet ansatt i egen organisasjon: createCertification og listCertificationsForEmployee nektes", async () => {
    const { org, admin, kari } = await setup();
    await giveCertification(kari, { validTo: "2027-10-31" });
    await setDeleted(kari.id);
    const before = await counts();
    await expect(
      createCertification(admin, org.id, { employeeId: kari.id, validTo: "2027-10-31" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(listCertificationsForEmployee(admin, org.id, kari.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect(await counts()).toEqual(before);
  });

  it("ansatt som har sluttet: ny sertifisering avvises, historikken kan fortsatt leses", async () => {
    // Valget er låst her: createCertification avviser, listen for den ansatte viser historikken.
    const { org, admin, kari } = await setup();
    const old = await giveCertification(kari, { validTo: "2026-10-30" });
    await setDeactivated(kari.id);
    const before = await counts();
    await expect(
      createCertification(admin, org.id, { employeeId: kari.id, validTo: "2027-10-31" }),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await counts()).toEqual(before);
    expect((await listCertificationsForEmployee(admin, org.id, kari.id)).map((r) => r.id)).toEqual([
      old.id,
    ]);
    expect(await listExpiringCertifications(admin, org.id)).toEqual([]);
  });

  it("allerede slettet sertifisering: AccessDeniedError, deleted_at endres ikke", async () => {
    const { org, admin, kari } = await setup();
    const deletedAt = new Date("2026-10-01T08:00:00Z");
    const cert = await giveCertification(kari, { validTo: "2027-10-31", deletedAt });
    const before = await counts();
    await expect(deleteCertification(admin, org.id, cert.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    expect((await certRow(cert.id))?.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    expect(await counts()).toEqual(before);
  });

  it("organizationId i skjemadata ignoreres: aldri rad i B", async () => {
    const { a, b } = await twoOrgs();
    const input = {
      employeeId: a.kari.id,
      validTo: "2027-10-31",
      organizationId: b.org.id,
    } as CertificationCreateInput;
    const error = await createCertification(a.admin, a.org.id, input).then(
      () => null,
      (e: unknown) => e,
    );
    if (error !== null) expect(error).toBeInstanceOf(ZodError);
    const inB = await db
      .select()
      .from(certifications)
      .where(eq(certifications.organizationId, b.org.id));
    expect(inB).toHaveLength(1); // bare den fra twoOrgs
    if (error === null) {
      const inA = await db
        .select()
        .from(certifications)
        .where(eq(certifications.organizationId, a.org.id));
      expect(inA).toHaveLength(1);
      expect(inA[0]?.employeeId).toBe(a.kari.id);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3.4 Lagring, validering og myk sletting

describe("3.4 lagring, validering og myk sletting", () => {
  it("createCertification lagrer alle feltene, med organisasjonen fra tilgangssjekken", async () => {
    const { org, admin, adminEmployee, kari } = await setup();
    const created = await createCertification(admin, org.id, {
      employeeId: kari.id,
      area: "condition_report",
      issuer: ISSUER,
      certificateNumber: CERT_NUMBER,
      validFrom: "2025-11-01",
      validTo: "2027-10-31",
    });
    const stored = await certRow(created.id);
    expect(stored).toMatchObject({
      organizationId: org.id,
      employeeId: kari.id,
      area: "condition_report",
      issuer: ISSUER,
      certificateNumber: CERT_NUMBER,
      validFrom: "2025-11-01",
      validTo: "2027-10-31",
      deletedAt: null,
    });
    // Sporingsfeltet følger mønsteret i resten av admin: den ansatte bak tilgangssjekken
    expect(stored?.createdBy).toBe(adminEmployee.id);
  });

  it("bare «Gyldig til»: område forhåndsvalgt, de valgfrie feltene er null", async () => {
    const { org, admin, kari } = await setup();
    const created = await createCertification(admin, org.id, {
      employeeId: kari.id,
      validTo: "2027-10-31",
    });
    expect(await certRow(created.id)).toMatchObject({
      area: "condition_report",
      issuer: null,
      certificateNumber: null,
      validFrom: null,
      validTo: "2027-10-31",
    });
  });

  type Rejected = { navn: string; input: Record<string, unknown>; message?: string };
  const rejected: Rejected[] = [
    { navn: "mangler gyldig til", input: {}, message: MISSING_VALID_TO },
    { navn: "tom gyldig til", input: { validTo: "" }, message: MISSING_VALID_TO },
    {
      navn: "gyldig fra etter gyldig til",
      input: { validFrom: "2027-01-02", validTo: "2027-01-01" },
      message: FROM_AFTER_TO,
    },
    { navn: "ugyldig dato 2026-13-01", input: { validTo: "2026-13-01" } },
    { navn: "ikke en dato", input: { validTo: "ikke-dato" } },
    { navn: "ugyldig gyldig fra", input: { validFrom: "ikke-dato", validTo: "2027-01-01" } },
    { navn: "ukjent område", input: { validTo: "2027-01-01", area: "electric" } },
  ];

  it.each(rejected)(
    "avvises: $navn (ZodError, ingen rad, ingen loggrad)",
    async ({ input, message }) => {
      const { org, admin, kari } = await setup();
      const before = await counts();
      const error = await caught(
        createCertification(admin, org.id, {
          employeeId: kari.id,
          ...input,
        } as CertificationCreateInput),
      );
      expect(error).toBeInstanceOf(ZodError);
      if (message) {
        expect((error as ZodError).issues.map((issue) => issue.message)).toContain(message);
      }
      expect(await counts()).toEqual(before);
    },
  );

  it("gyldig fra lik gyldig til godtas", async () => {
    const { org, admin, kari } = await setup();
    const created = await createCertification(admin, org.id, {
      employeeId: kari.id,
      validFrom: "2027-01-01",
      validTo: "2027-01-01",
    });
    expect(await certRow(created.id)).toMatchObject({
      validFrom: "2027-01-01",
      validTo: "2027-01-01",
    });
  });

  it("tom streng i de valgfrie feltene lagres som null", async () => {
    const { org, admin, kari } = await setup();
    const created = await createCertification(admin, org.id, {
      employeeId: kari.id,
      validTo: "2027-10-31",
      validFrom: "",
      issuer: "  ",
      certificateNumber: "",
    });
    expect(await certRow(created.id)).toMatchObject({
      validFrom: null,
      issuer: null,
      certificateNumber: null,
    });
  });

  it("område er fast kode: nøyaktig condition_report med etiketten «Tilstandsrapport bolig»", () => {
    expect([...certificationAreas]).toEqual(["condition_report"]);
    expect(certificationAreaLabels).toEqual({ condition_report: "Tilstandsrapport bolig" });
  });

  it("konstanten for listen er 60 dager", () => {
    expect(CERTIFICATION_EXPIRY_WARNING_DAYS).toBe(60);
  });

  it("myk sletting: deleted_at og deleted_by settes, raden står, antall rader går ikke ned", async () => {
    const { org, admin, adminEmployee, kari } = await setup();
    const created = await createCertification(admin, org.id, {
      employeeId: kari.id,
      validTo: "2027-10-31",
    });
    const before = (await counts()).certifications;
    await deleteCertification(admin, org.id, created.id);
    const row = await certRow(created.id);
    expect(row).toBeDefined();
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.deletedBy).toBe(adminEmployee.id);
    expect((await counts()).certifications).toBe(before);
  });

  it("listen for én ansatt: uten slettede, nyeste gyldig til først, bare den ansatte", async () => {
    const { org, admin, kari } = await setup();
    const { employee: ola } = await addPerson(org.id, "Ola Testesen");
    const oldest = await giveCertification(kari, { validTo: "2025-10-31" });
    const newest = await giveCertification(kari, { validTo: "2028-10-31" });
    const middle = await giveCertification(kari, { validTo: "2026-11-15" });
    await giveCertification(kari, { validTo: "2029-01-01", deletedAt: NOW });
    await giveCertification(ola, { validTo: "2027-01-01" });

    const rows = await listCertificationsForEmployee(admin, org.id, kari.id);
    expect(rows.map((r) => r.id)).toEqual([newest.id, middle.id, oldest.id]);
    expect(rows.every((r) => r.organizationId === org.id && r.employeeId === kari.id)).toBe(true);
  });

  it("fornyelse er ny rad: to rader for samme ansatt og område, den gamle står", async () => {
    const { org, admin, kari } = await setup();
    const first = await createCertification(admin, org.id, {
      employeeId: kari.id,
      validTo: "2026-11-15",
    });
    const second = await createCertification(admin, org.id, {
      employeeId: kari.id,
      validTo: "2028-11-15",
    });
    expect(second.id).not.toBe(first.id);
    expect((await listCertificationsForEmployee(admin, org.id, kari.id)).map((r) => r.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// 3.5 Database (integrasjon, direkte insert)

describe("3.5 databasen", () => {
  it("sammensatt fremmednøkkel: ansatt fra B med organization_id A avvises (23503)", async () => {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");
    const error = await caught(
      db.insert(certifications).values({
        organizationId: a.org.id,
        employeeId: b.kari.id,
        area: "condition_report",
        validTo: "2027-10-31",
      }),
    );
    expect(pgCode(error)).toBe("23503");
    expect((await counts()).certifications).toBe(0);
  });

  it("sjekkregel: valid_from etter valid_to avvises (23514)", async () => {
    const { kari } = await setup();
    const error = await caught(
      giveCertification(kari, { validFrom: "2027-01-02", validTo: "2027-01-01" }),
    );
    expect(pgCode(error)).toBe("23514");
  });

  it("valid_from lik valid_to og valid_from null godtas", async () => {
    const { kari } = await setup();
    await expect(
      giveCertification(kari, { validFrom: "2027-01-01", validTo: "2027-01-01" }),
    ).resolves.toBeDefined();
    await expect(
      giveCertification(kari, { validFrom: null, validTo: "2027-01-01" }),
    ).resolves.toBeDefined();
  });

  it("valid_to er påkrevd (23502)", async () => {
    const { org, kari } = await setup();
    const error = await caught(
      db.execute(
        sql`insert into certifications (organization_id, employee_id, area, valid_to) values (${org.id}, ${kari.id}, 'condition_report', null)`,
      ),
    );
    expect(pgCode(error)).toBe("23502");
  });
});

// ---------------------------------------------------------------------------------------------
// 3.6 Revisjonslogg

describe("3.6 revisjonslogg", () => {
  it("createCertification gir én rad certification.created", async () => {
    const { org, admin, adminEmployee, kari } = await setup();
    const created = await createCertification(admin, org.id, {
      employeeId: kari.id,
      validTo: "2027-10-31",
    });
    const rows = await auditRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      action: "certification.created",
      entityId: created.id,
      actorEmployeeId: adminEmployee.id,
    });
  });

  it("deleteCertification gir én rad certification.deleted", async () => {
    const { org, admin, adminEmployee, kari } = await setup();
    const cert = await giveCertification(kari, { validTo: "2027-10-31" });
    await deleteCertification(admin, org.id, cert.id);
    const rows = await auditRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: org.id,
      action: "certification.deleted",
      entityId: cert.id,
      actorEmployeeId: adminEmployee.id,
    });
  });

  it("avviste kall (tilgang, fremmed id, validering) gir ingen loggrad", async () => {
    const a = await setup("Organisasjon A");
    const b = await setup("Organisasjon B");
    const certB = await giveCertification(b.kari, { validTo: "2027-10-31" });
    await caught(
      createCertification(a.kariUser, a.org.id, { employeeId: a.kari.id, validTo: "2027-10-31" }),
    );
    await caught(
      createCertification(a.admin, a.org.id, { employeeId: b.kari.id, validTo: "2027-10-31" }),
    );
    await caught(deleteCertification(a.admin, a.org.id, certB.id));
    await caught(createCertification(a.admin, a.org.id, { employeeId: a.kari.id, validTo: "" }));
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it("ingen persontekst i revisjonsloggen eller i logglinjene", async () => {
    const { org, admin, kari } = await setup();
    const written: string[] = [];
    const capture = (...args: unknown[]) => {
      written.push(JSON.stringify(args));
    };
    for (const method of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(logger, method).mockImplementation(capture);
    }
    const created = await createCertification(admin, org.id, {
      employeeId: kari.id,
      validTo: "2027-10-31",
      issuer: ISSUER,
      certificateNumber: CERT_NUMBER,
    });
    await deleteCertification(admin, org.id, created.id);
    await caught(
      createCertification(admin, org.id, {
        employeeId: kari.id,
        validTo: "ikke-dato",
        certificateNumber: CERT_NUMBER,
      }),
    );

    const auditText = JSON.stringify(await auditRows(org.id));
    const text = `${auditText}\n${written.join("\n")}`;
    for (const value of [KARI_NAME, KARI_EMAIL, "Admin Testesen", ISSUER, CERT_NUMBER]) {
      expect(text).not.toContain(value);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 4 Listen «går ut snart» (regeltester som data). Systemtid 2026-10-31T10:00:00Z.

describe("4 listen «går ut snart»", () => {
  type Scenario = {
    navn: string;
    /** Sertifiseringene: validTo og eventuelt slettet. */
    certs: { validTo: string; deleted?: boolean }[];
    employee?: "deactivated" | "deleted";
    /** Forventet: ikke i listen (null), eller validTo og expired for linjen. */
    forventet: { validTo: string; expired: boolean } | null;
  };

  const scenarios: Scenario[] = [
    {
      navn: "utgått i går",
      certs: [{ validTo: "2026-10-30" }],
      forventet: { validTo: "2026-10-30", expired: true },
    },
    {
      navn: "utløper i dag",
      certs: [{ validTo: "2026-10-31" }],
      forventet: { validTo: "2026-10-31", expired: false },
    },
    {
      navn: "60 dager frem",
      certs: [{ validTo: "2026-12-30" }],
      forventet: { validTo: "2026-12-30", expired: false },
    },
    { navn: "61 dager frem", certs: [{ validTo: "2026-12-31" }], forventet: null },
    {
      navn: "fornyet",
      certs: [{ validTo: "2026-10-01" }, { validTo: "2028-01-01" }],
      forventet: null,
    },
    {
      navn: "fornyet, men den nye er slettet",
      certs: [{ validTo: "2026-10-01" }, { validTo: "2028-01-01", deleted: true }],
      forventet: { validTo: "2026-10-01", expired: true },
    },
    {
      navn: "bare slettet rad",
      certs: [{ validTo: "2026-10-01", deleted: true }],
      forventet: null,
    },
    {
      navn: "ansatt som har sluttet",
      certs: [{ validTo: "2026-10-01" }],
      employee: "deactivated",
      forventet: null,
    },
    {
      navn: "slettet ansatt",
      certs: [{ validTo: "2026-10-01" }],
      employee: "deleted",
      forventet: null,
    },
    {
      navn: "to gamle utgåtte, ingen ny: én linje (den nyeste)",
      certs: [{ validTo: "2025-06-01" }, { validTo: "2026-09-01" }],
      forventet: { validTo: "2026-09-01", expired: true },
    },
  ];

  it.each(scenarios)("$navn", async ({ certs, employee, forventet }) => {
    const { org, admin, kari } = await setup();
    for (const cert of certs) {
      await giveCertification(kari, {
        validTo: cert.validTo,
        deletedAt: cert.deleted ? NOW : null,
      });
    }
    if (employee === "deactivated") await setDeactivated(kari.id);
    if (employee === "deleted") await setDeleted(kari.id);

    const rows = await listExpiringCertifications(admin, org.id);
    if (forventet === null) {
      expect(rows).toEqual([]);
    } else {
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        employeeId: kari.id,
        employeeName: KARI_NAME,
        area: "condition_report",
        ...forventet,
      });
    }
  });

  it("sortering: tidligst gyldig til først, samme dato sortert på navn", async () => {
    const { org, admin } = await setup();
    const { employee: berit } = await addPerson(org.id, "Berit Testesen");
    const { employee: anne } = await addPerson(org.id, "Anne Testesen");
    const { employee: cato } = await addPerson(org.id, "Cato Testesen");
    await giveCertification(cato, { validTo: "2026-12-01" });
    await giveCertification(berit, { validTo: "2026-11-15" });
    await giveCertification(anne, { validTo: "2026-11-15" });

    const first = await listExpiringCertifications(admin, org.id);
    expect(first.map((r) => r.employeeName)).toEqual([
      "Anne Testesen",
      "Berit Testesen",
      "Cato Testesen",
    ]);
    // Stabil rekkefølge
    expect((await listExpiringCertifications(admin, org.id)).map((r) => r.employeeId)).toEqual(
      first.map((r) => r.employeeId),
    );
  });

  it("tom liste gir []", async () => {
    const { org, admin } = await setup();
    expect(await listExpiringCertifications(admin, org.id)).toEqual([]);
  });

  it("svarets nøkler er en fast liste uten userId, email eller organizationId", async () => {
    const { org, admin, kari } = await setup();
    await giveCertification(kari, { validTo: "2026-10-30", certificateNumber: CERT_NUMBER });
    const [row] = await listExpiringCertifications(admin, org.id);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "area",
      "certificateNumber",
      "certificationId",
      "employeeId",
      "employeeName",
      "expired",
      "validTo",
    ]);
  });
});
