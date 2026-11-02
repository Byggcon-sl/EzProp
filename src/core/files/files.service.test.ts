import { createHash } from "node:crypto";
import { mkdtemp, readFile as readFromDisk, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { auditLog, employees, files, organizations, type EmployeeRole } from "@/db/schema";
import { APP0, DQT, jpeg, SOF0, SOS } from "../../../tests/jpeg-bytes";
import {
  auditRows,
  createEmployee,
  createFile,
  createOrganization,
  createUser,
  grantPermission,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  ALLOWED_MIME_TYPES,
  createFileStorage,
  FILE_KINDS,
  FileIntegrityError,
  FileNotFoundError,
  FileRetentionError,
  FileValidationError,
  findActiveFile,
  markFileDeleted,
  MAX_FILE_BYTES,
  readFile,
  saveFile,
  type FileStorage,
} from "./index";

/*
 * Integrasjonstester for den felles filtjenesten, testplanen
 * docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 6. Støtter hovedmål: reklamasjoner
 * (en fil skrives aldri over, slettes aldri før oppbevaringstiden er ute, og endret innhold
 * oppdages) og KI først (KI får senere bare filer fra organisasjonen den jobber for).
 *
 * Filene skrives bare i en midlertidig mappe (`mkdtemp`), aldri i `var/files`. Testdata er
 * oppdiktet: små byte-rekker og JPEG-byte bygget i testen.
 */

const SECRET = "hemmelig-test-verdi";
const JPEG = jpeg(APP0, DQT, SOF0, SOS);
const ENV_KEYS = [
  "FILE_STORAGE_DIR",
  "FILE_STORAGE_DRIVER",
  "FILE_STORAGE_AZURE_CONNECTION_STRING",
  "FILE_STORAGE_AZURE_CONTAINER",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

let tmp: string;

beforeEach(async () => {
  await resetDatabase();
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  tmp = await mkdtemp(path.join(tmpdir(), "files-service-test-"));
  process.env.FILE_STORAGE_DIR = tmp;
  delete process.env.FILE_STORAGE_DRIVER;
  delete process.env.FILE_STORAGE_AZURE_CONNECTION_STRING;
  delete process.env.FILE_STORAGE_AZURE_CONTAINER;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(tmp, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function storage(): FileStorage {
  return createFileStorage(process.env);
}

/** Alle filer (ikke mapper) under den midlertidige mappen, relative stier. */
async function filesOnDisk(dir = tmp, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      result.push(...(await filesOnDisk(path.join(dir, entry.name), relative)));
    else result.push(relative);
  }
  return result.sort();
}

async function fileRowCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(files);
  return row?.n ?? 0;
}

async function fileRow(id: string) {
  const [row] = await db.select().from(files).where(eq(files.id, id));
  if (!row) throw new Error("fant ikke raden i testen");
  return row;
}

async function auditCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(auditLog);
  return row?.n ?? 0;
}

/** Organisasjon med én ansatt med rollene. */
async function orgWithEmployee(roles: EmployeeRole[], name = "Oppdiktet takst AS") {
  const org = await createOrganization(name);
  const user = await createUser({ name: "Kari Testdatter" });
  const employee = await createEmployee(user, org.id, roles);
  return { org, user, employee };
}

async function addEmployee(organizationId: string, roles: EmployeeRole[]) {
  const user = await createUser({ name: "Ola Testsen" });
  const employee = await createEmployee(user, organizationId, roles);
  return { user, employee };
}

async function setSettings(organizationId: string, settings: Record<string, unknown>) {
  await db.update(organizations).set({ settings }).where(eq(organizations.id, organizationId));
}

async function savePhoto(actor: Actor, organizationId: string, bytes: Uint8Array = JPEG) {
  return saveFile(actor, organizationId, { kind: "photo", mimeType: "image/jpeg", bytes });
}

const DAY = 24 * 60 * 60 * 1000;

describe("6.1 lagre og hente", () => {
  it("1. rundtur: samme byte, samme sha256 og riktig størrelse", async () => {
    const { org, user } = await orgWithEmployee(["inspector"]);

    const saved = await savePhoto(user, org.id);
    expect(saved.sha256).toBe(sha256(JPEG));
    expect(saved.sizeBytes).toBe(JPEG.byteLength);

    const read = await readFile(user, org.id, saved.id);
    expect(read.id).toBe(saved.id);
    expect(Array.from(read.bytes)).toEqual(Array.from(JPEG));
    expect(read.sha256).toBe(sha256(JPEG));
    expect(read.sizeBytes).toBe(JPEG.byteLength);
    expect(read.kind).toBe("photo");
    expect(read.mimeType).toBe("image/jpeg");
  });

  it("2. raden har riktige verdier", async () => {
    const { org, user } = await orgWithEmployee(["inspector"]);
    const saved = await savePhoto(user, org.id);

    const row = await fileRow(saved.id);
    expect(row.organizationId).toBe(org.id);
    expect(row.kind).toBe("photo");
    expect(row.mimeType).toBe("image/jpeg");
    expect(row.sizeBytes).toBe(JPEG.byteLength);
    expect(row.sha256).toBe(sha256(JPEG));
    expect(row.retainUntil).toBeNull();
    expect(row.createdBy).toBeTruthy();
    expect(row.deletedAt).toBeNull();
    expect(row.deletedBy).toBeNull();
  });

  it("3. storage_key er <organisasjon>/photo/<id>, og filen ligger der i mappen", async () => {
    const { org, user } = await orgWithEmployee(["inspector"]);
    const saved = await savePhoto(user, org.id);

    const row = await fileRow(saved.id);
    expect(row.storageKey).toBe(`${org.id}/photo/${saved.id}`);
    const onDisk = await readFromDisk(path.join(tmp, row.storageKey));
    expect(Array.from(onDisk)).toEqual(Array.from(JPEG));
    expect(await filesOnDisk()).toEqual([row.storageKey]);
  });

  it("4. feiler raden, kastes en feil uten sti, nøkkel eller hemmelighet, og ingen rad finnes", async () => {
    process.env.FILE_STORAGE_AZURE_CONNECTION_STRING = SECRET;
    const { org, user } = await orgWithEmployee(["inspector"]);

    await db.execute(
      sql.raw(`create or replace function files_test_fail() returns trigger as $$
        begin raise exception 'testfeil fra trigger'; end; $$ language plpgsql`),
    );
    await db.execute(
      sql.raw(
        "create trigger files_test_fail before insert on files for each row execute function files_test_fail()",
      ),
    );
    let caught: unknown;
    try {
      await savePhoto(user, org.id);
    } catch (error) {
      caught = error;
    } finally {
      await db.execute(sql.raw("drop trigger if exists files_test_fail on files"));
      await db.execute(sql.raw("drop function if exists files_test_fail()"));
    }

    expect(caught).toBeInstanceOf(Error);
    expect(await fileRowCount()).toBe(0);
    // Filen skrives før raden; den blir liggende uten rad (akseptert, ingenting slettes)
    const onDisk = await filesOnDisk();
    expect(onDisk).toHaveLength(1);
    const storageKey = onDisk[0]!;
    expect(storageKey.startsWith(`${org.id}/photo/`)).toBe(true);

    const error = caught as Error;
    for (const text of [error.message, String(error)]) {
      expect(text).not.toContain(tmp);
      expect(text).not.toContain(storageKey);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("testfeil fra trigger");
    }
  });

  it("5. endret innhold på disken gir FileIntegrityError uten sti", async () => {
    const { org, user } = await orgWithEmployee(["inspector"]);
    const saved = await savePhoto(user, org.id);
    const row = await fileRow(saved.id);

    // Samme lengde, annet innhold: bare fingeravtrykket kan avsløre det
    const tampered = new Uint8Array(JPEG);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! + 1) % 256;
    await writeFile(path.join(tmp, row.storageKey), tampered);

    const error = await readFile(user, org.id, saved.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FileIntegrityError);
    expect((error as Error).message).not.toContain(tmp);
    expect((error as Error).message).not.toContain(row.storageKey);

    // Annen lengde gir også integritetsfeil
    await writeFile(path.join(tmp, row.storageKey), new Uint8Array([1, 2, 3]));
    await expect(readFile(user, org.id, saved.id)).rejects.toBeInstanceOf(FileIntegrityError);
  });

  it("6. ekstra forsvar på prefikset: en rad i A med B sin nøkkel gir aldri B sitt innhold", async () => {
    const a = await orgWithEmployee(["admin"], "Organisasjon A");
    const b = await orgWithEmployee(["admin"], "Organisasjon B");
    const contentB = new Uint8Array([0xbb, 0xbb, 0xbb, 0x01]);
    const savedB = await savePhoto(b.user, b.org.id, contentB);
    const savedA = await savePhoto(a.user, a.org.id);
    const keyB = (await fileRow(savedB.id)).storageKey;

    // Rå oppdatering: raden i A peker på B sin fil, med B sitt fingeravtrykk
    await db
      .update(files)
      .set({ storageKey: keyB, sha256: sha256(contentB), sizeBytes: contentB.byteLength })
      .where(eq(files.id, savedA.id));

    let result: Awaited<ReturnType<typeof readFile>> | undefined;
    let caught: unknown;
    try {
      result = await readFile(a.user, a.org.id, savedA.id);
    } catch (error) {
      caught = error;
    }
    expect(result).toBeUndefined();
    expect(caught instanceof FileNotFoundError || caught instanceof FileIntegrityError).toBe(true);
  });

  it("7. ikke-uuid som fil-ID gir FileNotFoundError, ikke databasefeil", async () => {
    const { org, user } = await orgWithEmployee(["admin"]);
    await expect(readFile(user, org.id, "ikke-en-id")).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(markFileDeleted(user, org.id, "ikke-en-id")).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });
});

describe("6.2 validering før skriving", () => {
  async function expectNothingWritten() {
    expect(await readdir(tmp)).toEqual([]);
    expect(await fileRowCount()).toBe(0);
  }

  it("1a. MAX_FILE_BYTES er 25 MB, og nøyaktig 25 MB godtas", async () => {
    expect(MAX_FILE_BYTES).toBe(26_214_400);
    const { org, user } = await orgWithEmployee(["inspector"]);
    const saved = await savePhoto(user, org.id, new Uint8Array(25 * 1024 * 1024));
    expect(saved.sizeBytes).toBe(26_214_400);
    expect(await fileRowCount()).toBe(1);
  });

  it("1b. én byte over 25 MB gir FileValidationError, og ingenting skrives", async () => {
    const { org, user } = await orgWithEmployee(["inspector"]);
    await expect(
      savePhoto(user, org.id, new Uint8Array(25 * 1024 * 1024 + 1)),
    ).rejects.toBeInstanceOf(FileValidationError);
    await expectNothingWritten();
  });

  it("2. tom fil gir FileValidationError, og ingenting skrives", async () => {
    const { org, user } = await orgWithEmployee(["inspector"]);
    await expect(savePhoto(user, org.id, new Uint8Array(0))).rejects.toBeInstanceOf(
      FileValidationError,
    );
    await expectNothingWritten();
  });

  // Fasit skrevet inn i testen, ikke importert fra koden
  const accepted: [string, string][] = [
    ["photo", "image/jpeg"],
    ["photo", "image/png"],
    ["photo", "image/heic"],
    ["photo", "image/webp"],
    ["report_pdf", "application/pdf"],
    ["document", "application/pdf"],
    ["document", "image/jpeg"],
    ["document", "image/png"],
  ];
  const rejected: [string, string][] = [
    ["photo", "application/pdf"],
    ["report_pdf", "image/jpeg"],
    ["document", "image/heic"],
    ...["photo", "report_pdf", "document"].flatMap((kind) =>
      ["image/svg+xml", "text/html", "application/octet-stream", ""].map(
        (mimeType) => [kind, mimeType] as [string, string],
      ),
    ),
  ];

  it.each(accepted)("3. %s × %s godtas", async (kind, mimeType) => {
    const { org, user } = await orgWithEmployee(["inspector"]);
    const saved = await saveFile(user, org.id, { kind, mimeType, bytes: JPEG });
    const row = await fileRow(saved.id);
    expect(row.kind).toBe(kind);
    expect(row.mimeType).toBe(mimeType);
  });

  it.each(rejected)("3. %s × «%s» avvises før noe skrives", async (kind, mimeType) => {
    const { org, user } = await orgWithEmployee(["inspector"]);
    await expect(saveFile(user, org.id, { kind, mimeType, bytes: JPEG })).rejects.toBeInstanceOf(
      FileValidationError,
    );
    await expectNothingWritten();
  });

  it.each(["logo", "signature", "attachment", ""])(
    "4. ugyldig kind «%s» avvises før noe skrives",
    async (kind) => {
      const { org, user } = await orgWithEmployee(["inspector"]);
      await expect(
        saveFile(user, org.id, { kind, mimeType: "image/jpeg", bytes: JPEG }),
      ).rejects.toBeInstanceOf(FileValidationError);
      await expectNothingWritten();
    },
  );

  it("5. FILE_KINDS er nøyaktig document, photo, report_pdf (sortert)", () => {
    expect([...FILE_KINDS]).toEqual(["document", "photo", "report_pdf"]);
    expect(
      Object.fromEntries(
        Object.entries(ALLOWED_MIME_TYPES).map(([kind, types]) => [kind, [...types].sort()]),
      ),
    ).toEqual({
      document: ["application/pdf", "image/jpeg", "image/png"],
      photo: ["image/heic", "image/jpeg", "image/png", "image/webp"],
      report_pdf: ["application/pdf"],
    });
  });
});

describe("6.3 myk sletting", () => {
  it("1. merker raden, rører ikke filen, og readFile gir ikke funnet etterpå", async () => {
    const { org, user } = await orgWithEmployee(["admin"]);
    const saved = await savePhoto(user, org.id);
    const { storageKey } = await fileRow(saved.id);

    const row = await markFileDeleted(user, org.id, saved.id);
    expect(row.id).toBe(saved.id);
    expect(row.organizationId).toBe(org.id);

    const stored = await fileRow(saved.id);
    expect(stored.deletedAt).not.toBeNull();
    expect(stored.deletedBy).toBeTruthy();
    expect(Array.from(await readFromDisk(path.join(tmp, storageKey)))).toEqual(Array.from(JPEG));
    await expect(readFile(user, org.id, saved.id)).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it("2. revisjonsloggen får én rad med bare fileId, kind og organizationId", async () => {
    const { org, user } = await orgWithEmployee(["admin"]);
    const saved = await saveFile(user, org.id, {
      kind: "document",
      mimeType: "application/pdf",
      bytes: JPEG,
    });
    const { storageKey } = await fileRow(saved.id);
    const before = await auditRows(org.id);

    await markFileDeleted(user, org.id, saved.id);

    const after = await auditRows(org.id);
    expect(after).toHaveLength(before.length + 1);
    const added = after.filter((row) => !before.some((old) => old.id === row.id));
    expect(added).toHaveLength(1);
    const entry = added[0]!;
    expect(Object.keys(entry.changes).sort()).toEqual(["fileId", "kind", "organizationId"]);
    expect(entry.changes).toEqual({ fileId: saved.id, kind: "document", organizationId: org.id });

    const text = JSON.stringify(entry);
    for (const forbidden of [
      storageKey,
      saved.sha256,
      "application/pdf",
      tmp,
      "storage_key",
      "storageKey",
      "sha256",
      "mime_type",
      "mimeType",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("3. retain_until i fremtiden stopper også admin, uten endring og uten logg", async () => {
    const { org, user } = await orgWithEmployee(["admin"]);
    const row = await createFile(org.id, { retainUntil: new Date(Date.now() + DAY) });
    const auditBefore = await auditCount();

    await expect(markFileDeleted(user, org.id, row.id)).rejects.toBeInstanceOf(FileRetentionError);

    const stored = await fileRow(row.id);
    expect(stored.deletedAt).toBeNull();
    expect(stored.deletedBy).toBeNull();
    expect(await auditCount()).toBe(auditBefore);
  });

  it.each([
    ["tom", null],
    ["i går", new Date(Date.now() - DAY)],
  ])("4. retain_until %s: merking er tillatt", async (_label, retainUntil) => {
    const { org, user } = await orgWithEmployee(["admin"]);
    const row = await createFile(org.id, { retainUntil });

    await markFileDeleted(user, org.id, row.id);

    expect((await fileRow(row.id)).deletedAt).not.toBeNull();
  });

  it("5. andre kall gir ikke funnet, og deleted_at/deleted_by er uendret", async () => {
    const { org, user } = await orgWithEmployee(["admin"]);
    const other = await addEmployee(org.id, ["admin"]);
    const row = await createFile(org.id);

    await markFileDeleted(user, org.id, row.id);
    const first = await fileRow(row.id);

    await expect(markFileDeleted(other.user, org.id, row.id)).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
    const second = await fileRow(row.id);
    expect(second.deletedAt?.toISOString()).toBe(first.deletedAt?.toISOString());
    expect(second.deletedBy).toBe(first.deletedBy);
  });

  it("6. porten har ingen sletting, og raden finnes fortsatt etter merking", async () => {
    const port = storage();
    // @ts-expect-error FileStorage har ingen slette-operasjon (regel 3). Fanges av typecheck.
    const remove: unknown = port.delete;
    expect(remove).toBeUndefined();
    expect("delete" in port).toBe(false);

    const { org, user } = await orgWithEmployee(["admin"]);
    const row = await createFile(org.id, {}, { storage: port });
    await markFileDeleted(user, org.id, row.id);

    // Uten filter på deleted_at: raden står der fortsatt
    const rows = await db.select().from(files).where(eq(files.id, row.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deletedAt).not.toBeNull();
    expect(await filesOnDisk()).toEqual([row.storageKey]);
  });
});

describe("6.4 tilgang per rolle", () => {
  it.each<EmployeeRole>(["inspector", "office", "manager", "admin"])(
    "1. %s kan lagre og lese",
    async (role) => {
      const { org, user } = await orgWithEmployee([role]);
      const saved = await savePhoto(user, org.id);
      const read = await readFile(user, org.id, saved.id);
      expect(Array.from(read.bytes)).toEqual(Array.from(JPEG));
    },
  );

  it.each<EmployeeRole>(["inspector", "office", "manager"])(
    "2. %s kan ikke merke som slettet, og raden er uendret",
    async (role) => {
      const { org, user } = await orgWithEmployee([role]);
      const row = await createFile(org.id);
      const before = await fileRow(row.id);

      await expect(markFileDeleted(user, org.id, row.id)).rejects.toBeInstanceOf(AccessDeniedError);

      expect(await fileRow(row.id)).toEqual(before);
    },
  );

  it("3. admin kan merke som slettet", async () => {
    const { org, user } = await orgWithEmployee(["admin"]);
    const row = await createFile(org.id);
    await markFileDeleted(user, org.id, row.id);
    expect((await fileRow(row.id)).deletedAt).not.toBeNull();
  });

  it("4. ansatt med to roller (inspector og admin) kan merke", async () => {
    const { org, user } = await orgWithEmployee(["inspector", "admin"]);
    const row = await createFile(org.id);
    await markFileDeleted(user, org.id, row.id);
    expect((await fileRow(row.id)).deletedAt).not.toBeNull();
  });

  it("5. enkeltrettigheten organization.manage gir ikke sletting (kan ikke gis, A21)", async () => {
    const { org, user, employee } = await orgWithEmployee(["inspector"]);
    await grantPermission(employee, "organization.manage");
    const row = await createFile(org.id);
    const before = await fileRow(row.id);

    await expect(markFileDeleted(user, org.id, row.id)).rejects.toBeInstanceOf(AccessDeniedError);
    expect(await fileRow(row.id)).toEqual(before);
  });

  async function expectDeniedEverywhere(actor: Actor, organizationId: string) {
    const row = await createFile(organizationId, {}, { storage: storage() });
    const before = await fileRow(row.id);
    const diskBefore = await filesOnDisk();
    const auditBefore = await auditCount();

    await expect(savePhoto(actor, organizationId)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(readFile(actor, organizationId, row.id)).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(markFileDeleted(actor, organizationId, row.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );

    expect(await fileRowCount()).toBe(1);
    expect(await fileRow(row.id)).toEqual(before);
    expect(await filesOnDisk()).toEqual(diskBefore);
    expect(await auditCount()).toBe(auditBefore);
  }

  it("6a. deaktivert ansatt (også admin) nektes alt", async () => {
    const { org, user, employee } = await orgWithEmployee(["admin"]);
    await db
      .update(employees)
      .set({ deactivatedAt: new Date() })
      .where(eq(employees.id, employee.id));
    await expectDeniedEverywhere(user, org.id);
  });

  it("6b. ansatt uten roller nektes alt", async () => {
    const { org, user } = await orgWithEmployee([]);
    await expectDeniedEverywhere(user, org.id);
  });

  it("7. innlogget uten ansettelse i organisasjonen nektes alt", async () => {
    const org = await createOrganization("Oppdiktet takst AS");
    const stranger = await createUser({ name: "Uten Ansettelse" });
    await expectDeniedEverywhere(stranger, org.id);
  });
});

describe("6.5 admin stenges aldri ute (regel 11)", () => {
  // Denne testen skal aldri fjernes: admin må alltid kunne lagre, lese og merke filer.
  it("1. med access.inspectors_edit_all = false kan admin lagre, lese og merke", async () => {
    const { org, user } = await orgWithEmployee(["admin"]);
    await setSettings(org.id, { "access.inspectors_edit_all": false });

    const saved = await savePhoto(user, org.id);
    const read = await readFile(user, org.id, saved.id);
    expect(Array.from(read.bytes)).toEqual(Array.from(JPEG));
    await markFileDeleted(user, org.id, saved.id);
    expect((await fileRow(saved.id)).deletedAt).not.toBeNull();
  });

  // Denne testen skal aldri fjernes.
  it("2. admin uten sertifisering og uten enkeltrettigheter kan lagre, lese og merke", async () => {
    // createEmployee gir verken sertifisering eller enkeltrettigheter
    const { org, user } = await orgWithEmployee(["admin"]);

    const saved = await savePhoto(user, org.id);
    await readFile(user, org.id, saved.id);
    await markFileDeleted(user, org.id, saved.id);
    expect((await fileRow(saved.id)).deletedAt).not.toBeNull();
  });
});

describe("6.6 fremmed fil-ID i egen organisasjon", () => {
  async function twoOrganizations() {
    const a = await orgWithEmployee(["admin"], "Organisasjon A");
    const b = await orgWithEmployee(["admin"], "Organisasjon B");
    const fileA = await createFile(a.org.id, {}, { storage: storage() });
    return { a, b, fileA };
  }

  it("1. readFile med A sin fil-ID i B gir FileNotFoundError, ingen byte", async () => {
    const { b, fileA } = await twoOrganizations();
    let result: Awaited<ReturnType<typeof readFile>> | undefined;
    await expect(
      (async () => {
        result = await readFile(b.user, b.org.id, fileA.id);
      })(),
    ).rejects.toBeInstanceOf(FileNotFoundError);
    expect(result).toBeUndefined();
  });

  it("2. markFileDeleted med A sin fil-ID i B gir FileNotFoundError; A er uendret, ingen logg", async () => {
    const { a, b, fileA } = await twoOrganizations();
    const before = await fileRow(fileA.id);
    const auditA = (await auditRows(a.org.id)).length;
    const auditB = (await auditRows(b.org.id)).length;

    await expect(markFileDeleted(b.user, b.org.id, fileA.id)).rejects.toBeInstanceOf(
      FileNotFoundError,
    );

    const after = await fileRow(fileA.id);
    expect(after.deletedAt).toBeNull();
    expect(after).toEqual(before);
    expect(await auditRows(a.org.id)).toHaveLength(auditA);
    expect(await auditRows(b.org.id)).toHaveLength(auditB);
  });

  it("3. det samme gjelder takstmann i B", async () => {
    const { b, fileA } = await twoOrganizations();
    const inspectorB = await addEmployee(b.org.id, ["inspector"]);
    await expect(readFile(inspectorB.user, b.org.id, fileA.id)).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
  });
});

describe("6.7 tenant-isolasjon (regel 2)", () => {
  /** To filer med innhold i hver organisasjon. */
  async function seedTwoEach(organizationIdA: string, organizationIdB: string) {
    const port = storage();
    const ids = { a: [] as string[], b: [] as string[] };
    for (let i = 0; i < 2; i += 1) {
      const bytes = new Uint8Array([0x10 + i, 0x20, 0x30, i]);
      ids.a.push((await createFile(organizationIdA, {}, { storage: port, bytes })).id);
      ids.b.push((await createFile(organizationIdB, {}, { storage: port, bytes })).id);
    }
    return ids;
  }

  it("1. readFile gir aldri fremmede filer, og fremmed organisasjon nektes", async () => {
    let allIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = await seedTwoEach(grantA.organizationId, grantB.organizationId);
        allIds = [...ids.a, ...ids.b];
        return ids;
      },
      query: async (actor, organizationId) => {
        const found: { id: string }[] = [];
        for (const id of allIds) {
          try {
            const file = await readFile(actor, organizationId, id);
            found.push({ id: file.id });
          } catch (error) {
            if (!(error instanceof FileNotFoundError)) throw error;
          }
        }
        return found;
      },
      idOf: (row) => row.id,
    });
  });

  it("2. saveFile lagrer alltid i organisasjonen fra tilgangssjekken", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await createFile(grantA.organizationId);
        const b = await createFile(grantB.organizationId);
        return { a: [a.id], b: [b.id] };
      },
      query: async (actor, organizationId) => {
        const saved = await savePhoto(actor, organizationId);
        // Oppslag uten filter, så raden finnes uansett hvilken organisasjon den havnet i
        const row = await fileRow(saved.id);
        return db.select().from(files).where(eq(files.organizationId, row.organizationId));
      },
      idOf: (row) => row.id,
    });

    // Nøkkelen begynner alltid med radens egen organisasjon
    const rows = await db.select().from(files);
    for (const row of rows) {
      expect(row.storageKey.startsWith(`${row.organizationId}/`)).toBe(true);
    }
  });

  it("3. markFileDeleted merker bare i egen organisasjon, og fremmed organisasjon nektes", async () => {
    const seededByOrganization = new Map<string, string[]>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = await seedTwoEach(grantA.organizationId, grantB.organizationId);
        seededByOrganization.set(grantA.organizationId, ids.a);
        seededByOrganization.set(grantB.organizationId, ids.b);
        return ids;
      },
      query: async (actor, organizationId) => {
        const candidates = seededByOrganization.get(organizationId) ?? [];
        let target: string | undefined;
        for (const id of candidates) {
          if ((await fileRow(id)).deletedAt === null) {
            target = id;
            break;
          }
        }
        if (!target) throw new Error("ingen umerket fil igjen i testen");
        const marked = await markFileDeleted(actor, organizationId, target);
        // Alle rader, også merkede, i den returnerte radens organisasjon
        return db.select().from(files).where(eq(files.organizationId, marked.organizationId));
      },
      idOf: (row) => row.id,
    });

    // Hver organisasjon fikk nøyaktig én merket rad: kallet fra den fremmede ble avvist
    for (const [organizationId, ids] of seededByOrganization) {
      const deleted = await db
        .select({ id: files.id })
        .from(files)
        .where(and(eq(files.organizationId, organizationId), isNotNull(files.deletedAt)));
      expect(deleted).toHaveLength(1);
      expect(ids).toContain(deleted[0]!.id);
    }
  });

  it("4. findActiveFile gir bare rader fra organisasjonen i tilgangen", async () => {
    let allIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = await seedTwoEach(grantA.organizationId, grantB.organizationId);
        allIds = [...ids.a, ...ids.b];
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const found: { id: string }[] = [];
        for (const id of allIds) {
          try {
            found.push(await findActiveFile(grant, id));
          } catch (error) {
            if (!(error instanceof FileNotFoundError)) throw error;
          }
        }
        return found;
      },
      idOf: (row) => row.id,
    });
  });
});

describe("6.8 databasen", () => {
  function rawRow(organizationId: string, storageKey: string) {
    return {
      organizationId,
      storageKey,
      kind: "photo",
      mimeType: "image/jpeg",
      sizeBytes: 4,
      sha256: "0".repeat(64),
    };
  }

  it("1. (organization_id, storage_key) er unik sammensatt", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const key = "felles/photo/nokkel";

    await db.insert(files).values(rawRow(orgA.id, key));
    await expect(db.insert(files).values(rawRow(orgA.id, key))).rejects.toThrow();
    // Samme nøkkel i en annen organisasjon godtas: begrensningen gjelder paret
    await expect(db.insert(files).values(rawRow(orgB.id, key))).resolves.toBeDefined();
  });

  it("2. kolonnene finnes med riktig krav om verdi", async () => {
    const result = await db.execute<{ column_name: string; is_nullable: string }>(
      sql`select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'files'`,
    );
    const columns = new Map(result.map((row) => [row.column_name, row.is_nullable]));
    expect(columns.get("organization_id")).toBe("NO");
    expect(columns.get("deleted_at")).toBe("YES");
    expect(columns.get("deleted_by")).toBe("YES");
    expect(columns.get("retain_until")).toBe("YES");
    expect(columns.get("sha256")).toBe("NO");
    expect(columns.get("size_bytes")).toBe("NO");
    expect(columns.has("storage_key")).toBe(true);
  });

  it("3. organization_id er påkrevd", async () => {
    await expect(
      db.execute(
        sql`insert into files (storage_key, kind, mime_type, size_bytes, sha256) values ('x/photo/y', 'photo', 'image/jpeg', 1, ${"0".repeat(64)})`,
      ),
    ).rejects.toThrow();
    expect(await fileRowCount()).toBe(0);
  });

  it("4. resetDatabase tømmer files", async () => {
    const org = await createOrganization();
    await createFile(org.id);
    expect(await fileRowCount()).toBe(1);
    await resetDatabase();
    expect(await fileRowCount()).toBe(0);
  });
});
