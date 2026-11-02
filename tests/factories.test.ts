import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { createLocalFileStorage } from "@/core/files";
import { isCertificationValid } from "@/core/organization/certification-rules";
import { db } from "@/db/client";
import {
  certifications,
  employeePermissions,
  files,
  integrationConnections,
  loginAttempts,
  trialAnswers,
  trialForms,
  trialPhotos,
} from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import { uuidv7 } from "@/shared/lib/uuid";
import {
  createCertification,
  createEmployee,
  createFile,
  createIntegrationConnection,
  createOrganization,
  createUser,
  grantPermission,
  RESET_TABLES,
  resetDatabase,
} from "./factories";

// Fanger at en ny tabell glemmes i truncate-listen (testplan for oppgave 4, avsnitt 3.6).

describe("resetDatabase", () => {
  it("truncate-listen har alle tabellene i databasen (også files)", async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const tables = result.map((row) => row.table_name).sort();
    expect(tables).toContain("files");
    const listed: readonly string[] = RESET_TABLES;
    expect(tables.filter((table) => !listed.includes(table))).toEqual([]);
    expect(listed).toContain("files");
    // `files` tømmes før `organizations`, som den peker på
    expect(listed.indexOf("files")).toBeLessThan(listed.indexOf("organizations"));
  });

  it("resetDatabase tømmer files", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    await createFile(org.id);

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(files);
    expect(row!.n).toBe(0);
  });

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

describe("resetDatabase og innloggingssperren (fase 0b)", () => {
  it("o) resetDatabase tømmer login_attempts", async () => {
    await resetDatabase();
    await db.insert(loginAttempts).values([
      { emailHash: "a".repeat(64), kind: "code_requested" },
      { emailHash: "a".repeat(64), kind: "code_failed" },
      { emailHash: "a".repeat(64), kind: "login_succeeded" },
    ]);
    const [before] = await db.select({ n: count() }).from(loginAttempts);
    expect(before!.n).toBe(3);

    await resetDatabase();

    const [after] = await db.select({ n: count() }).from(loginAttempts);
    expect(after!.n).toBe(0);
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

// Filtjenesten (docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 7). Innholdet skrives bare
// til en midlertidig mappe, aldri til var/files. Bytene er oppdiktet.
describe("createFile (fase 0b, filtjeneste)", () => {
  let tmp: string | undefined;

  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it("1. gir en rad i organisasjonen med storage_key <organisasjon>/photo/<id>", async () => {
    const orgA = await createOrganization("Oppdiktet takst A");
    await createOrganization("Oppdiktet takst B");

    const row = await createFile(orgA.id);

    expect(row.organizationId).toBe(orgA.id);
    expect(row.storageKey).toBe(`${orgA.id}/photo/${row.id}`);
    const [stored] = await db.select().from(files).where(eq(files.id, row.id));
    expect(stored?.organizationId).toBe(orgA.id);
  });

  it("2. med storage: innholdet finnes i porten, og sha256 og size_bytes stemmer", async () => {
    tmp = await mkdtemp(path.join(tmpdir(), "factories-files-"));
    const storage = createLocalFileStorage(tmp);
    const orgA = await createOrganization("Oppdiktet takst A");
    const bytes = new TextEncoder().encode("oppdiktet innhold for fabrikken");

    const row = await createFile(orgA.id, {}, { storage, bytes });

    expect(Buffer.from(await storage.get(row.storageKey)).equals(Buffer.from(bytes))).toBe(true);
    expect(row.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(Number(row.sizeBytes)).toBe(bytes.byteLength);
  });

  it("3. deletedAt og deletedBy fra overstyringene står på raden", async () => {
    const orgA = await createOrganization("Oppdiktet takst A");
    const employee = await createEmployee(await createUser(), orgA.id, ["inspector"]);
    const deletedAt = new Date("2026-11-01T08:00:00Z");

    const row = await createFile(orgA.id, { deletedAt, deletedBy: employee.id });

    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    expect(row.deletedBy).toBe(employee.id);
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

// Testplan docs/funksjoner/fase0b-tilkoblingslag-testplan.md avsnitt 10. Verdiene er oppdiktet.
describe("createIntegrationConnection (fase 0b, tilkoblingslag)", () => {
  it("10.1 uten overstyring: email/server_log, active, tomme settings, ingen secret_ref", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst A");

    const row = await createIntegrationConnection(org.id);

    expect(row.organizationId).toBe(org.id);
    expect(row.port).toBe("email");
    expect(row.provider).toBe("server_log");
    expect(row.status).toBe("active");
    expect(row.settings).toEqual({});
    expect(row.secretRef).toBeNull();
    expect(row.lastOkAt).toBeNull();
    expect(row.lastError).toBeNull();
    expect(row.deletedAt).toBeNull();
  });

  it("10.2 overstyringene står på raden, og fabrikken validerer ikke", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst A");
    const lastOkAt = new Date("2026-11-01T10:00:00.000Z");
    const deletedAt = new Date("2026-11-02T08:00:00.000Z");

    const row = await createIntegrationConnection(org.id, {
      port: "accounting",
      provider: "x",
      status: "error",
      secretRef: "ORG_HEMMELIGHET",
      settings: { from: "ikke-en-adresse" },
      lastOkAt,
      lastError: "gammel feil",
      deletedAt,
      deletedBy: "oppdiktet-ansatt",
    });

    expect(row).toMatchObject({
      organizationId: org.id,
      port: "accounting",
      provider: "x",
      status: "error",
      secretRef: "ORG_HEMMELIGHET",
      settings: { from: "ikke-en-adresse" },
      lastError: "gammel feil",
      deletedBy: "oppdiktet-ansatt",
    });
    expect(row.lastOkAt?.toISOString()).toBe(lastOkAt.toISOString());
    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
  });

  it("10.3 integration_connections står i truncate-listen før organizations, og tømmes", async () => {
    const listed: readonly string[] = RESET_TABLES;
    expect(listed).toContain("integration_connections");
    expect(listed.indexOf("integration_connections")).toBeLessThan(listed.indexOf("organizations"));

    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst A");
    await createIntegrationConnection(org.id);

    await resetDatabase();

    const [row] = await db.select({ n: count() }).from(integrationConnections);
    expect(row!.n).toBe(0);
  });
});
