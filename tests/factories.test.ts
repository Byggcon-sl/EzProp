import { count, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { isCertificationValid } from "@/core/organization/certification-rules";
import { db } from "@/db/client";
import {
  certifications,
  employeePermissions,
  trialAnswers,
  trialForms,
  trialPhotos,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createCertification,
  createEmployee,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "./factories";

// Fanger at en ny tabell glemmes i truncate-listen (testplan for oppgave 4, avsnitt 3.6).

describe("resetDatabase", () => {
  it("resetDatabase tømmer trial_-tabellene", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const formId = uuidv7();
    await db
      .insert(trialForms)
      .values({ id: formId, organizationId: org.id, name: "Testskjema 1" });
    await db.insert(trialAnswers).values({
      organizationId: org.id,
      trialFormId: formId,
      fieldKey: "floors",
      value: 2,
      deviceId: "enhet-1",
    });
    await db.insert(trialPhotos).values({
      organizationId: org.id,
      trialFormId: formId,
      fieldKey: "cover_photo",
      name: "test-image.png",
      sizeBytes: 120,
    });

    await resetDatabase();

    for (const table of [trialForms, trialAnswers, trialPhotos]) {
      const [row] = await db.select({ n: count() }).from(table);
      expect(row!.n).toBe(0);
    }
  });
});

describe("grantPermission (fase 0b, roller og rettigheter)", () => {
  it("1. setter inn én rad med den ansattes organisasjon, og rettigheten virker", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const user = await createUser({ name: "Test Leder" });
    const employee = await createEmployee(user, org.id, ["manager"]);

    const row = await grantPermission(employee, "template.edit_structure");

    expect(row.organizationId).toBe(org.id);
    expect(row.employeeId).toBe(employee.id);
    expect(row.permission).toBe("template.edit_structure");
    expect(row.deletedAt).toBeNull();
    await expect(
      requireOrganizationAccess(user, org.id, "template.edit_structure"),
    ).resolves.toBeDefined();
  });

  it("2. resetDatabase tømmer employee_permissions", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const user = await createUser();
    const employee = await createEmployee(user, org.id, ["inspector"]);
    await grantPermission(employee, "report.edit");

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(employeePermissions);
    expect(row!.n).toBe(0);
  });
});

describe("createCertification (fase 0b, sertifisering)", () => {
  /** Samme dato ett år frem, regnet for hånd fra «ÅÅÅÅ-MM-DD». */
  function nextYear(isoDate: string): string {
    return `${Number(isoDate.slice(0, 4)) + 1}${isoDate.slice(4)}`;
  }

  it("1. uten overstyring: gyldig i dag, gyldig til ett år frem, samme organisasjon", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const employee = await createEmployee(await createUser(), org.id, ["inspector"]);

    const today = todayInOslo();
    const row = await createCertification(employee);

    expect(row.organizationId).toBe(org.id);
    expect(row.employeeId).toBe(employee.id);
    expect(row.area).toBe("condition_report");
    expect(row.validFrom).toBe(today);
    expect(row.validTo).toBe(nextYear(today));
    expect(row.deletedAt).toBeNull();
    expect(isCertificationValid(row, today)).toBe(true);
  });

  it("2. overstyring av validTo, validFrom, organizationId og employeeId brukes", async () => {
    await resetDatabase();
    const orgA = await createOrganization("Oppdiktet takst A");
    const orgB = await createOrganization("Oppdiktet takst B");
    const inA = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    const colleague = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    const inB = await createEmployee(await createUser(), orgB.id, ["inspector"]);

    const dated = await createCertification(inA, { validFrom: null, validTo: "2026-10-30" });
    expect(dated.validFrom).toBeNull();
    expect(dated.validTo).toBe("2026-10-30");

    const fromSet = await createCertification(inA, {
      validFrom: "2026-11-01",
      validTo: "2027-11-01",
    });
    expect(fromSet.validFrom).toBe("2026-11-01");
    expect(fromSet.validTo).toBe("2027-11-01");

    const other = await createCertification(inA, { employeeId: colleague.id });
    expect(other.employeeId).toBe(colleague.id);
    expect(other.organizationId).toBe(orgA.id);

    const moved = await createCertification(inA, {
      organizationId: orgB.id,
      employeeId: inB.id,
    });
    expect(moved.organizationId).toBe(orgB.id);
    expect(moved.employeeId).toBe(inB.id);
  });

  it("3. resetDatabase tømmer certifications", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const employee = await createEmployee(await createUser(), org.id, ["inspector"]);
    await createCertification(employee);

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(certifications);
    expect(row!.n).toBe(0);
  });
});

describe("login_attempts (fase 0b, sperre ved innlogging)", () => {
  it("o) resetDatabase tømmer login_attempts", async () => {
    // Lastes her, så resten av filen kjører selv om sperremodulen mangler
    const { checkAndRecordAttempt } = await import("@/core/auth/login-throttle");
    await resetDatabase();
    await checkAndRecordAttempt("ola@eksempel.no", "request_code");
    const before = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from login_attempts`,
    );
    expect(Array.from(before)[0]?.n).toBe(1);

    await resetDatabase();

    const after = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from login_attempts`,
    );
    expect(Array.from(after)[0]?.n).toBe(0);
  });
});
