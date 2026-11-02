import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { requireOrganizationAccess } from "@/core/access";
import { createFileStorage, createLocalFileStorage } from "@/core/files";
import { isCertificationValid } from "@/core/organization/certification-rules";
import { db } from "@/db/client";
import {
  certifications,
  employeePermissions,
  files,
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
  createOrganization,
  createUser,
  grantPermission,
  RESET_TABLES,
  resetDatabase,
} from "./factories";

// Filtjenesten (docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 7). Midlertidig mappe.
describe("createFile, grunnkrav (fase 0b, filtjeneste)", () => {
  it("1. lager en rad med riktig organisasjon og storage_key <org>/<kind>/<id>", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const row = await createFile(org.id);
    expect(row.organizationId).toBe(org.id);
    expect(row.storageKey).toBe(`${org.id}/${row.kind}/${row.id}`);
    expect(row.deletedAt).toBeNull();
  });

  it("2. med storage skrives innholdet via porten, og sha256 stemmer med innholdet", async () => {
    await resetDatabase();
    const tmp = await mkdtemp(join(tmpdir(), "ezprop-factory-files-"));
    try {
      const storage = createFileStorage({ FILE_STORAGE_DIR: tmp });
      const org = await createOrganization("Oppdiktet takst AS");
      const bytes = new TextEncoder().encode("oppdiktet innhold for fabrikken");
      const row = await createFile(org.id, { kind: "document" }, { storage, bytes });
      const stored = await storage.get(row.storageKey);
      expect(Buffer.from(stored).equals(Buffer.from(bytes))).toBe(true);
      expect(row.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(Number(row.sizeBytes)).toBe(bytes.byteLength);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

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

describe("createFile (fase 0b, filtjeneste)", () => {
  it("1. gir en rad med riktig organisasjon og nøkkelformat <organisasjon>/<kind>/<id>", async () => {
    await resetDatabase();
    const orgA = await createOrganization("Oppdiktet takst A");
    await createOrganization("Oppdiktet takst B");

    const row = await createFile(orgA.id);
    expect(row.organizationId).toBe(orgA.id);
    expect(row.storageKey).toBe(`${orgA.id}/photo/${row.id}`);
    expect(row.deletedAt).toBeNull();
    expect(row.retainUntil).toBeNull();

    const document = await createFile(orgA.id, { kind: "document", mimeType: "application/pdf" });
    expect(document.storageKey).toBe(`${orgA.id}/document/${document.id}`);
    expect(document.mimeType).toBe("application/pdf");

    const [stored] = await db.select().from(files).where(eq(files.id, row.id));
    expect(stored?.organizationId).toBe(orgA.id);
  });

  it("2. med storage: filen finnes i porten, og sha256 stemmer med innholdet", async () => {
    await resetDatabase();
    const tmp = await mkdtemp(path.join(tmpdir(), "factories-files-"));
    try {
      const storage = createLocalFileStorage(tmp);
      const org = await createOrganization("Oppdiktet takst AS");
      const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);

      const row = await createFile(org.id, {}, { storage, bytes });

      expect(Array.from(await storage.get(row.storageKey))).toEqual(Array.from(bytes));
      expect(Array.from(await readFile(path.join(tmp, row.storageKey)))).toEqual(Array.from(bytes));
      expect(row.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(row.sizeBytes).toBe(bytes.byteLength);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("3. overstyringene brukes", async () => {
    await resetDatabase();
    const org = await createOrganization("Oppdiktet takst AS");
    const retainUntil = new Date("2036-11-02T00:00:00Z");
    const deletedAt = new Date("2026-11-01T00:00:00Z");

    const row = await createFile(org.id, {
      kind: "report_pdf",
      mimeType: "application/pdf",
      retainUntil,
      deletedAt,
      storageKey: `${org.id}/report_pdf/egen-nokkel`,
      sha256: "0".repeat(64),
    });

    expect(row.kind).toBe("report_pdf");
    expect(row.retainUntil?.toISOString()).toBe(retainUntil.toISOString());
    expect(row.deletedAt?.toISOString()).toBe(deletedAt.toISOString());
    expect(row.storageKey).toBe(`${org.id}/report_pdf/egen-nokkel`);
    expect(row.sha256).toBe("0".repeat(64));
  });
});
