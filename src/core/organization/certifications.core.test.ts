import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { AccessDeniedError, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { certifications, employees } from "@/db/schema";
import {
  auditRows,
  createCertification as insertCertification,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  createCertification,
  deleteCertification,
  listCertificationsForEmployee,
  listExpiringCertifications,
} from "./certifications";

beforeEach(resetDatabase);

const TODAY = "2026-10-31";

async function setup() {
  const org = await createOrganization();
  const adminUser = await createUser({ name: "Admin Testesen" });
  const admin = await createEmployee(adminUser, org.id, ["admin"]);
  const inspectorUser = await createUser({ name: "Takstmann Testesen" });
  const inspector = await createEmployee(inspectorUser, org.id, ["inspector"]);
  return { org, adminUser, admin, inspectorUser, inspector };
}

function grantEmployee(grant: EmployeeGrant) {
  return { id: grant.employeeId, organizationId: grant.organizationId };
}

describe("tenant-isolasjon", () => {
  it("listCertificationsForEmployee", async () => {
    const employeeByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        employeeByOrg.set(grantA.organizationId, grantA.employeeId);
        employeeByOrg.set(grantB.organizationId, grantB.employeeId);
        const a = await insertCertification(grantEmployee(grantA));
        const b = await insertCertification(grantEmployee(grantB));
        return { a: [a.id], b: [b.id] };
      },
      query: (actor, organizationId) =>
        listCertificationsForEmployee(
          actor,
          organizationId,
          employeeByOrg.get(organizationId) ?? randomUUID(),
        ),
      idOf: (row) => row.id,
    });
  });

  it("createCertification", async () => {
    const employeeByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        employeeByOrg.set(grantA.organizationId, grantA.employeeId);
        employeeByOrg.set(grantB.organizationId, grantB.employeeId);
        return { a: [grantA.organizationId], b: [grantB.organizationId] };
      },
      query: async (actor, organizationId) => [
        await createCertification(actor, organizationId, {
          employeeId: employeeByOrg.get(organizationId) ?? randomUUID(),
          validTo: "2027-10-31",
        }),
      ],
      idOf: (row) => row.organizationId,
    });
  });

  it("deleteCertification", async () => {
    const certificationByOrg = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertCertification(grantEmployee(grantA));
        const b = await insertCertification(grantEmployee(grantB));
        certificationByOrg.set(grantA.organizationId, a.id);
        certificationByOrg.set(grantB.organizationId, b.id);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => [
        await deleteCertification(
          actor,
          organizationId,
          certificationByOrg.get(organizationId) ?? randomUUID(),
        ),
      ],
      idOf: (row) => row.id,
    });
  });

  it("listExpiringCertifications", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await insertCertification(grantEmployee(grantA), { validTo: "2026-10-30" });
        const b = await insertCertification(grantEmployee(grantB), { validTo: "2026-10-30" });
        return { a: [a.id], b: [b.id] };
      },
      query: (actor, organizationId) =>
        listExpiringCertifications(actor, organizationId, { today: TODAY }),
      idOf: (row) => row.certificationId,
    });
  });
});

describe("tilgang", () => {
  it("takstmann får ikke lese, lagre eller fjerne, heller ikke på seg selv", async () => {
    const { org, inspectorUser, inspector } = await setup();
    const own = await insertCertification(inspector);
    await expect(
      createCertification(inspectorUser, org.id, {
        employeeId: inspector.id,
        validTo: "2027-10-31",
      }),
    ).rejects.toThrow(AccessDeniedError);
    await expect(
      listCertificationsForEmployee(inspectorUser, org.id, inspector.id),
    ).rejects.toThrow(AccessDeniedError);
    await expect(deleteCertification(inspectorUser, org.id, own.id)).rejects.toThrow(
      AccessDeniedError,
    );
    await expect(listExpiringCertifications(inspectorUser, org.id)).rejects.toThrow(
      AccessDeniedError,
    );
  });

  it("ugyldig id, ukjent id og ansatt som har sluttet eller er slettet gir AccessDeniedError", async () => {
    const { org, adminUser, inspector } = await setup();
    for (const id of ["ikke-en-id", randomUUID()]) {
      await expect(
        createCertification(adminUser, org.id, { employeeId: id, validTo: "2027-10-31" }),
      ).rejects.toThrow(AccessDeniedError);
      await expect(listCertificationsForEmployee(adminUser, org.id, id)).rejects.toThrow(
        AccessDeniedError,
      );
      await expect(deleteCertification(adminUser, org.id, id)).rejects.toThrow(AccessDeniedError);
    }

    // Sluttet: kan listes, men ikke få ny sertifisering
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, inspector.id));
    await expect(listCertificationsForEmployee(adminUser, org.id, inspector.id)).resolves.toEqual(
      [],
    );
    await expect(
      createCertification(adminUser, org.id, { employeeId: inspector.id, validTo: "2027-10-31" }),
    ).rejects.toThrow(AccessDeniedError);

    await db.update(employees).set({ deletedAt: new Date() }).where(eq(employees.id, inspector.id));
    await expect(listCertificationsForEmployee(adminUser, org.id, inspector.id)).rejects.toThrow(
      AccessDeniedError,
    );
    expect(await db.select().from(certifications)).toEqual([]);
  });
});

describe("lagring, validering og myk sletting", () => {
  it("lagrer, lister og fjerner med revisjonslogg", async () => {
    const { org, adminUser, admin, inspector } = await setup();
    const created = await createCertification(adminUser, org.id, {
      employeeId: inspector.id,
      issuer: "Testutsteder",
      certificateNumber: " ",
      validFrom: "",
      validTo: "2027-10-31",
    });
    expect(created).toMatchObject({
      organizationId: org.id,
      employeeId: inspector.id,
      area: "condition_report",
      issuer: "Testutsteder",
      certificateNumber: null,
      validFrom: null,
      validTo: "2027-10-31",
    });
    const older = await insertCertification(inspector, { validTo: "2026-01-01" });

    const listed = await listCertificationsForEmployee(adminUser, org.id, inspector.id);
    expect(listed.map((row) => row.id)).toEqual([created.id, older.id]);

    const deleted = await deleteCertification(adminUser, org.id, created.id);
    expect(deleted.id).toBe(created.id);
    await expect(deleteCertification(adminUser, org.id, created.id)).rejects.toThrow(
      AccessDeniedError,
    );
    const [stored] = await db
      .select()
      .from(certifications)
      .where(eq(certifications.id, created.id));
    expect(stored?.deletedAt).toBeInstanceOf(Date);
    expect(stored?.deletedBy).toBe(admin.id);
    expect(
      (await listCertificationsForEmployee(adminUser, org.id, inspector.id)).map((r) => r.id),
    ).toEqual([older.id]);

    const actions = (await auditRows(org.id)).map((row) => [row.action, row.entityId]);
    expect(actions).toEqual([
      ["certification.created", created.id],
      ["certification.deleted", created.id],
    ]);
  });

  it.each([
    { input: { validTo: "" }, message: "Velg dato for gyldig til." },
    { input: {}, message: "Velg dato for gyldig til." },
    {
      input: { validFrom: "2027-01-02", validTo: "2027-01-01" },
      message: "Gyldig fra kan ikke være etter gyldig til.",
    },
    { input: { validTo: "2026-13-01" }, message: "Velg dato for gyldig til." },
    { input: { validTo: "2027-01-01", area: "electric" }, message: undefined },
  ])("avviser $input uten rad og loggrad", async ({ input, message }) => {
    const { org, adminUser, inspector } = await setup();
    const promise = createCertification(adminUser, org.id, {
      employeeId: inspector.id,
      ...(input as { validTo: string }),
    });
    await expect(promise).rejects.toThrow(ZodError);
    if (message) await expect(promise).rejects.toThrow(message);
    expect(await db.select().from(certifications)).toEqual([]);
    expect(await auditRows(org.id)).toEqual([]);
  });

  it("databasen avviser feil organisasjon og gyldig fra etter gyldig til", async () => {
    const { inspector } = await setup();
    const other = await createOrganization("B");
    await expect(
      db.insert(certifications).values({
        organizationId: other.id,
        employeeId: inspector.id,
        area: "condition_report",
        validTo: "2027-01-01",
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      insertCertification(inspector, { validFrom: "2027-01-02", validTo: "2027-01-01" }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
});

describe("listen «går ut snart»", () => {
  it("viser nyeste per ansatt og område innen 60 dager, også utgåtte", async () => {
    const { org, adminUser } = await setup();
    async function person(name: string) {
      return createEmployee(await createUser({ name }), org.id, ["inspector"]);
    }
    const expired = await person("Berit Utgått");
    const today = await person("Anne Idag");
    const sixty = await person("Cato Seksti");
    const sixtyOne = await person("Dag Sekstien");
    const renewed = await person("Eva Fornyet");
    const renewedDeleted = await person("Frode Slettetny");
    const gone = await person("Gro Sluttet");

    const rows = {
      expired: await insertCertification(expired, { validTo: "2026-10-30" }),
      today: await insertCertification(today, { validTo: "2026-10-31" }),
      sixty: await insertCertification(sixty, { validTo: "2026-12-30" }),
    };
    await insertCertification(sixtyOne, { validTo: "2026-12-31" });
    await insertCertification(renewed, { validTo: "2026-10-01" });
    await insertCertification(renewed, { validTo: "2028-01-01" });
    const oldOne = await insertCertification(renewedDeleted, { validTo: "2026-10-01" });
    await insertCertification(renewedDeleted, {
      validTo: "2028-01-01",
      deletedAt: new Date(),
    });
    await insertCertification(gone, { validTo: "2026-10-01" });
    await db.update(employees).set({ deactivatedAt: new Date() }).where(eq(employees.id, gone.id));

    const list = await listExpiringCertifications(adminUser, org.id, { today: TODAY });
    expect(list.map((row) => [row.certificationId, row.expired])).toEqual([
      [oldOne.id, true],
      [rows.expired.id, true],
      [rows.today.id, false],
      [rows.sixty.id, false],
    ]);
    expect(Object.keys(list[0] ?? {}).sort()).toEqual([
      "area",
      "certificateNumber",
      "certificationId",
      "employeeId",
      "employeeName",
      "expired",
      "validTo",
    ]);
  });

  it("tom liste", async () => {
    const { org, adminUser } = await setup();
    expect(await listExpiringCertifications(adminUser, org.id, { today: TODAY })).toEqual([]);
  });
});
