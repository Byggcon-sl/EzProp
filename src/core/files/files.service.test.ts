import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile as readDiskFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { count, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, type Actor } from "@/core/access";
import {
  ALLOWED_MIME_TYPES,
  createFileStorage,
  FILE_KINDS,
  FileIntegrityError,
  FileNotFoundError,
  FileRetentionError,
  FileValidationError,
  MAX_FILE_BYTES,
  markFileDeleted,
  readFile,
  saveFile,
  type FileStorage,
} from "@/core/files";
import { db } from "@/db/client";
import { employees, files, organizations, type EmployeeRole } from "@/db/schema";
import { APP0, jpeg, textBytes } from "../../../tests/jpeg-bytes";
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

// Testplan docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 6. Filene skrives bare i en
// midlertidig mappe (FILE_STORAGE_DIR settes i beforeEach), aldri i var/files. Innholdet er
// oppdiktede byte.

const env = process.env as Record<string, string | undefined>;
const ENV_KEYS = [
  "FILE_STORAGE_DIR",
  "FILE_STORAGE_DRIVER",
  "FILE_STORAGE_AZURE_CONNECTION_STRING",
  "FILE_STORAGE_AZURE_CONTAINER",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, env[key]]));

let tmp: string;

beforeEach(async () => {
  await resetDatabase();
  tmp = await mkdtemp(join(tmpdir(), "ezprop-files-service-"));
  for (const key of ENV_KEYS) delete env[key];
  env.FILE_STORAGE_DIR = tmp;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete env[key];
    else env[key] = savedEnv[key];
  }
  await rm(tmp, { recursive: true, force: true });
});

const ALL_ROLES: EmployeeRole[] = ["inspector", "office", "manager", "admin"];
const NOT_ADMIN: EmployeeRole[] = ["inspector", "office", "manager"];

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const photoBytes = (extra = "") => jpeg(APP0, textBytes(`oppdiktet ${extra}`));

/** Alle filer i den midlertidige mappen, relative stier. */
async function filesOnDisk(): Promise<string[]> {
  const entries = await readdir(tmp, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

async function fileRowCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(files);
  return row!.n;
}

async function fileRow(id: string) {
  const [row] = await db.select().from(files).where(eq(files.id, id));
  return row;
}

/** Fanger feilen fra et løfte (eller null om det lykkes). */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

async function member(organizationId: string, roles: EmployeeRole[], name = "Test Ansatt") {
  const actor = await createUser({ name });
  const employee = await createEmployee(actor, organizationId, roles);
  return { actor, employee };
}

function localStorage(): FileStorage {
  return createFileStorage({ FILE_STORAGE_DIR: tmp });
}

/** Setter retain_until med SQL, så testen virker både med dato- og tidskolonne. */
async function setRetainUntil(id: string, when: "i morgen" | "i går") {
  const value = when === "i morgen" ? sql`now() + interval '1 day'` : sql`now() - interval '1 day'`;
  await db.execute(sql`update files set retain_until = ${value} where id = ${id}`);
}

describe("6.1 lagre og hente", () => {
  it("1. rundtur: samme byte, samme sha256 og riktig størrelse", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);
    const bytes = photoBytes("rundtur");

    const saved = await saveFile(actor, org.id, { kind: "photo", mimeType: "image/jpeg", bytes });
    expect(saved.sha256).toBe(sha256(bytes));
    expect(saved.sizeBytes).toBe(bytes.byteLength);

    const read = await readFile(actor, org.id, saved.id);
    expect(same(read.bytes, bytes)).toBe(true);
    expect(read.sha256).toBe(sha256(bytes));
    expect(read.sizeBytes).toBe(bytes.byteLength);
    expect(read.id).toBe(saved.id);
    expect(read.kind).toBe("photo");
    expect(read.mimeType).toBe("image/jpeg");
  });

  it("2. raden har organisasjon, type, størrelse og fingeravtrykk, og er ikke slettet", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);
    const bytes = photoBytes("rad");

    const saved = await saveFile(actor, org.id, { kind: "photo", mimeType: "image/jpeg", bytes });
    const row = await fileRow(saved.id);
    expect(row).toBeDefined();
    expect(row!.organizationId).toBe(org.id);
    expect(row!.kind).toBe("photo");
    expect(row!.mimeType).toBe("image/jpeg");
    expect(Number(row!.sizeBytes)).toBe(bytes.byteLength);
    expect(row!.sha256).toBe(sha256(bytes));
    expect(row!.retainUntil).toBeNull();
    expect(row!.createdBy).toBeTruthy();
    expect(row!.deletedAt).toBeNull();
  });

  it("3. storage_key er <org>/<kind>/<id>, og filen ligger der i mappen", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);
    const bytes = photoBytes("nøkkel");

    const saved = await saveFile(actor, org.id, { kind: "photo", mimeType: "image/jpeg", bytes });
    const row = await fileRow(saved.id);
    expect(row!.storageKey).toBe(`${org.id}/photo/${saved.id}`);
    expect(same(await readDiskFile(join(tmp, row!.storageKey)), bytes)).toBe(true);
  });

  it("4. fil først, så rad: feiler raden, finnes ingen rad, og feilen har ingen sti eller hemmelighet", async () => {
    env.FILE_STORAGE_AZURE_CONNECTION_STRING = "hemmelig-test-verdi";
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);

    await db.execute(
      sql.raw(`create or replace function ezprop_test_fail_files() returns trigger
        language plpgsql as $$ begin raise exception 'testfeil fra trigger'; end $$`),
    );
    await db.execute(
      sql.raw(`create trigger ezprop_test_fail_files before insert on files
        for each row execute function ezprop_test_fail_files()`),
    );
    let error: unknown;
    try {
      error = await caught(
        saveFile(actor, org.id, {
          kind: "photo",
          mimeType: "image/jpeg",
          bytes: photoBytes("trigger"),
        }),
      );
    } finally {
      await db.execute(sql.raw("drop trigger if exists ezprop_test_fail_files on files"));
      await db.execute(sql.raw("drop function if exists ezprop_test_fail_files()"));
    }

    expect(error).toBeInstanceOf(Error);
    expect(await fileRowCount()).toBe(0);
    // Filen blir liggende uten rad (akseptert: ingenting slettes, og den kan ikke nås)
    expect(await filesOnDisk()).toHaveLength(1);
    const texts = [(error as Error).message, String(error)];
    for (const text of texts) {
      expect(text).not.toContain(tmp);
      expect(text).not.toContain(`${org.id}/photo/`);
      expect(text).not.toContain("hemmelig-test-verdi");
    }
  });

  it("5. endret innhold i lagringen gir FileIntegrityError uten sti", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);
    const saved = await saveFile(actor, org.id, {
      kind: "photo",
      mimeType: "image/jpeg",
      bytes: photoBytes("original"),
    });
    const row = await fileRow(saved.id);
    await writeFile(join(tmp, row!.storageKey), photoBytes("endret etterpå"));

    const error = await caught(readFile(actor, org.id, saved.id));
    expect(error).toBeInstanceOf(FileIntegrityError);
    expect((error as Error).message).not.toContain(tmp);
    expect((error as Error).message).not.toContain(row!.storageKey);
  });

  describe("6. ekstra forsvar på prefikset: en rad i A som peker på B sin fil", () => {
    async function setup() {
      const orgA = await createOrganization("Organisasjon A");
      const orgB = await createOrganization("Organisasjon B");
      const { actor: adminA } = await member(orgA.id, ["admin"], "Admin A");
      const { actor: adminB } = await member(orgB.id, ["admin"], "Admin B");
      const bytesA = photoBytes("innhold A");
      const bytesB = photoBytes("innhold B, skal aldri leses av A");
      const savedA = await saveFile(adminA, orgA.id, {
        kind: "photo",
        mimeType: "image/jpeg",
        bytes: bytesA,
      });
      const savedB = await saveFile(adminB, orgB.id, {
        kind: "photo",
        mimeType: "image/jpeg",
        bytes: bytesB,
      });
      const rowB = await fileRow(savedB.id);
      return { orgA, adminA, savedA, rowB: rowB!, bytesB };
    }

    it("bare nøkkelen byttet: feil, aldri B sitt innhold", async () => {
      const { orgA, adminA, savedA, rowB, bytesB } = await setup();
      await db.update(files).set({ storageKey: rowB.storageKey }).where(eq(files.id, savedA.id));

      const result = await readFile(adminA, orgA.id, savedA.id).then(
        (value: unknown) => value,
        (error: unknown) => error,
      );
      if (!(result instanceof Error)) {
        expect(same((result as { bytes: Uint8Array }).bytes, bytesB)).toBe(false);
      }
      expect(result instanceof FileNotFoundError || result instanceof FileIntegrityError).toBe(
        true,
      );
    });

    it("nøkkel, fingeravtrykk og størrelse kopiert: bare prefikssjekken stopper, aldri B sitt innhold", async () => {
      const { orgA, adminA, savedA, rowB, bytesB } = await setup();
      await db
        .update(files)
        .set({ storageKey: rowB.storageKey, sha256: rowB.sha256, sizeBytes: rowB.sizeBytes })
        .where(eq(files.id, savedA.id));

      const result = await readFile(adminA, orgA.id, savedA.id).then(
        (value: unknown) => value,
        (error: unknown) => error,
      );
      if (!(result instanceof Error)) {
        expect(same((result as { bytes: Uint8Array }).bytes, bytesB)).toBe(false);
      }
      expect(result instanceof FileNotFoundError || result instanceof FileIntegrityError).toBe(
        true,
      );
    });
  });

  it("7. fil-ID som ikke er en uuid gir FileNotFoundError, ikke databasefeil", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    await expect(readFile(actor, org.id, "ikke-en-id")).rejects.toThrow(FileNotFoundError);
  });
});

describe("6.2 validering før skriving", () => {
  async function expectNothingWritten() {
    expect(await filesOnDisk()).toEqual([]);
    expect(await fileRowCount()).toBe(0);
  }

  it("1. nøyaktig 25 MB godtas, én byte mer avvises", async () => {
    expect(MAX_FILE_BYTES).toBe(26214400);
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);

    const tooBig = new Uint8Array(25 * 1024 * 1024 + 1);
    await expect(
      saveFile(actor, org.id, { kind: "document", mimeType: "application/pdf", bytes: tooBig }),
    ).rejects.toThrow(FileValidationError);
    await expectNothingWritten();

    const exact = new Uint8Array(25 * 1024 * 1024).fill(7);
    const saved = await saveFile(actor, org.id, {
      kind: "document",
      mimeType: "application/pdf",
      bytes: exact,
    });
    expect(saved.sizeBytes).toBe(25 * 1024 * 1024);
  });

  it("2. tom fil (0 byte) avvises", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);
    await expect(
      saveFile(actor, org.id, { kind: "photo", mimeType: "image/jpeg", bytes: new Uint8Array(0) }),
    ).rejects.toThrow(FileValidationError);
    await expectNothingWritten();
  });

  // Fasit skrevet inn her, ikke hentet fra koden.
  const ACCEPTED: [string, string][] = [
    ["photo", "image/jpeg"],
    ["photo", "image/png"],
    ["photo", "image/heic"],
    ["photo", "image/webp"],
    ["report_pdf", "application/pdf"],
    ["document", "application/pdf"],
    ["document", "image/jpeg"],
    ["document", "image/png"],
  ];
  const REJECTED: [string, string][] = [
    ["photo", "application/pdf"],
    ["report_pdf", "image/jpeg"],
    ["document", "image/heic"],
    ...["photo", "report_pdf", "document"].flatMap((kind): [string, string][] =>
      ["image/svg+xml", "text/html", "application/octet-stream", ""].map((mime) => [kind, mime]),
    ),
  ];

  it.each(ACCEPTED)("3. %s × %s godtas", async (kind, mimeType) => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);
    const saved = await saveFile(actor, org.id, {
      kind: kind as never,
      mimeType,
      bytes: Uint8Array.from(textBytes(`oppdiktet ${kind} ${mimeType}`)),
    });
    const row = await fileRow(saved.id);
    expect(row!.kind).toBe(kind);
    expect(row!.mimeType).toBe(mimeType);
  });

  it.each(REJECTED)("3. %s × %j avvises før noe skrives", async (kind, mimeType) => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector"]);
    await expect(
      saveFile(actor, org.id, {
        kind: kind as never,
        mimeType,
        bytes: Uint8Array.from(textBytes("<svg onload=alert(1)>")),
      }),
    ).rejects.toThrow(FileValidationError);
    await expectNothingWritten();
  });

  it("3. ALLOWED_MIME_TYPES stemmer med fasiten", () => {
    const expected: Record<string, string[]> = {};
    for (const [kind, mime] of ACCEPTED) (expected[kind] ??= []).push(mime);
    const actual = ALLOWED_MIME_TYPES as unknown as Record<string, readonly string[]>;
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const kind of Object.keys(expected)) {
      expect([...actual[kind]!].sort()).toEqual(expected[kind]!.sort());
    }
  });

  it.each(["logo", "signature", "attachment", ""])(
    "4. ugyldig kind %j avvises før noe skrives",
    async (kind) => {
      const org = await createOrganization();
      const { actor } = await member(org.id, ["inspector"]);
      await expect(
        saveFile(actor, org.id, {
          kind: kind as never,
          mimeType: "image/png",
          bytes: Uint8Array.from(textBytes("oppdiktet")),
        }),
      ).rejects.toThrow(FileValidationError);
      await expectNothingWritten();
    },
  );

  it("5. FILE_KINDS er nøyaktig document, photo, report_pdf", () => {
    expect([...FILE_KINDS].sort()).toEqual(["document", "photo", "report_pdf"]);
  });
});

describe("6.3 myk sletting", () => {
  it("1. merker raden og rører ikke filen; readFile gir FileNotFoundError etterpå", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    const bytes = photoBytes("merkes");
    const saved = await saveFile(actor, org.id, { kind: "photo", mimeType: "image/jpeg", bytes });
    const before = await fileRow(saved.id);

    const updated = await markFileDeleted(actor, org.id, saved.id);
    expect(updated.id).toBe(saved.id);
    expect(updated.organizationId).toBe(org.id);

    const row = await fileRow(saved.id);
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.deletedBy).toBeTruthy();
    expect(same(await readDiskFile(join(tmp, before!.storageKey)), bytes)).toBe(true);
    await expect(readFile(actor, org.id, saved.id)).rejects.toThrow(FileNotFoundError);
  });

  it("2. revisjonsloggen får én rad med bare fileId, kind og organizationId", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    const saved = await saveFile(actor, org.id, {
      kind: "photo",
      mimeType: "image/jpeg",
      bytes: photoBytes("revisjon"),
    });
    const row = await fileRow(saved.id);
    const before = await auditRows(org.id);

    await markFileDeleted(actor, org.id, saved.id);

    const after = await auditRows(org.id);
    expect(after).toHaveLength(before.length + 1);
    const beforeIds = new Set(before.map((entry) => entry.id));
    const added = after.filter((entry) => !beforeIds.has(entry.id));
    expect(added).toHaveLength(1);
    const entry = added[0]!;
    expect(Object.keys(entry.changes as Record<string, unknown>).sort()).toEqual([
      "fileId",
      "kind",
      "organizationId",
    ]);
    const changes = entry.changes as Record<string, unknown>;
    expect(changes.fileId).toBe(saved.id);
    expect(changes.kind).toBe("photo");
    expect(changes.organizationId).toBe(org.id);
    const text = JSON.stringify(entry);
    expect(text).not.toContain(row!.storageKey);
    expect(text).not.toContain(row!.sha256);
    expect(text).not.toContain("image/jpeg");
    expect(text).not.toContain(tmp);
  });

  it("3. retain_until i fremtiden: også admin får FileRetentionError, ingenting endres", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    const file = await createFile(org.id);
    await setRetainUntil(file.id, "i morgen");
    const auditBefore = await auditRows(org.id);

    await expect(markFileDeleted(actor, org.id, file.id)).rejects.toThrow(FileRetentionError);
    expect((await fileRow(file.id))!.deletedAt).toBeNull();
    expect(await auditRows(org.id)).toHaveLength(auditBefore.length);
  });

  it.each(["tom", "i går"] as const)("4. retain_until %s: merking er tillatt", async (retain) => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    const file = await createFile(org.id);
    if (retain === "i går") await setRetainUntil(file.id, "i går");

    await markFileDeleted(actor, org.id, file.id);
    expect((await fileRow(file.id))!.deletedAt).not.toBeNull();
  });

  it("5. allerede merket: andre kall gir FileNotFoundError, og merket er uendret", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    const file = await createFile(org.id);
    await markFileDeleted(actor, org.id, file.id);
    const first = await fileRow(file.id);

    const { actor: otherAdmin } = await member(org.id, ["admin"], "Admin To");
    await expect(markFileDeleted(otherAdmin, org.id, file.id)).rejects.toThrow(FileNotFoundError);
    const second = await fileRow(file.id);
    expect(second!.deletedAt).toEqual(first!.deletedAt);
    expect(second!.deletedBy).toBe(first!.deletedBy);
  });

  it("6. porten har ingen slette-operasjon, og raden finnes etter merking", async () => {
    const storage: FileStorage = localStorage();
    // @ts-expect-error Porten har ingen delete (regel 3). Fanges av pnpm typecheck.
    expect(storage.delete).toBeUndefined();
    expect(Object.keys(storage)).not.toContain("delete");

    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    const file = await createFile(org.id);
    await markFileDeleted(actor, org.id, file.id);
    const rows = await db.select().from(files).where(eq(files.id, file.id));
    expect(rows).toHaveLength(1);
  });
});

describe("6.4 tilgang per rolle", () => {
  it.each(ALL_ROLES)("1. %s kan lagre og lese", async (role) => {
    const org = await createOrganization();
    const { actor } = await member(org.id, [role]);
    const bytes = photoBytes(role);
    const saved = await saveFile(actor, org.id, { kind: "photo", mimeType: "image/jpeg", bytes });
    const read = await readFile(actor, org.id, saved.id);
    expect(same(read.bytes, bytes)).toBe(true);
  });

  it.each(NOT_ADMIN)("2. %s kan ikke merke som slettet", async (role) => {
    const org = await createOrganization();
    const { actor } = await member(org.id, [role]);
    const file = await createFile(org.id);

    await expect(markFileDeleted(actor, org.id, file.id)).rejects.toThrow(AccessDeniedError);
    const row = await fileRow(file.id);
    expect(row!.deletedAt).toBeNull();
    expect(row!.deletedBy).toBeNull();
  });

  it("3. admin kan merke som slettet", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    const file = await createFile(org.id);
    await markFileDeleted(actor, org.id, file.id);
    expect((await fileRow(file.id))!.deletedAt).not.toBeNull();
  });

  it("4. ansatt med både takstmann og admin kan merke", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["inspector", "admin"]);
    const file = await createFile(org.id);
    await markFileDeleted(actor, org.id, file.id);
    expect((await fileRow(file.id))!.deletedAt).not.toBeNull();
  });

  it("5. enkeltrettigheten organization.manage gir ikke takstmann sletting", async () => {
    const org = await createOrganization();
    const { actor, employee } = await member(org.id, ["inspector"]);
    await grantPermission(employee, "organization.manage");
    const file = await createFile(org.id);

    await expect(markFileDeleted(actor, org.id, file.id)).rejects.toThrow(AccessDeniedError);
    expect((await fileRow(file.id))!.deletedAt).toBeNull();
  });

  it.each(["deaktivert", "uten roller", "ikke ansatt"] as const)(
    "6/7. %s: AccessDeniedError på lagre, lese og merke, og ingenting endres",
    async (kind) => {
      const org = await createOrganization();
      const file = await createFile(org.id, {}, { storage: localStorage() });
      let actor: Actor;
      if (kind === "deaktivert") {
        const created = await member(org.id, ["admin"]);
        await db
          .update(employees)
          .set({ deactivatedAt: new Date() })
          .where(eq(employees.id, created.employee.id));
        actor = created.actor;
      } else if (kind === "uten roller") {
        actor = (await member(org.id, [])).actor;
      } else {
        actor = await createUser({ name: "Innlogget uten ansettelse" });
      }
      // Organisasjonen har en aktiv admin, så det er ikke en tom organisasjon som nekter
      await member(org.id, ["admin"], "Annen admin");
      const diskBefore = await filesOnDisk();
      const rowBefore = await fileRow(file.id);

      await expect(
        saveFile(actor, org.id, {
          kind: "photo",
          mimeType: "image/jpeg",
          bytes: photoBytes("nektet"),
        }),
      ).rejects.toThrow(AccessDeniedError);
      await expect(readFile(actor, org.id, file.id)).rejects.toThrow(AccessDeniedError);
      await expect(markFileDeleted(actor, org.id, file.id)).rejects.toThrow(AccessDeniedError);

      expect(await filesOnDisk()).toEqual(diskBefore);
      expect(await fileRowCount()).toBe(1);
      expect(await fileRow(file.id)).toEqual(rowBefore);
    },
  );
});

describe("6.5 admin stenges aldri ute (regel 11)", () => {
  // Denne testen skal aldri fjernes: admin må alltid kunne lagre, lese og merke filer,
  // uansett innstillinger.
  it("1. admin kan lagre, lese og merke når access.inspectors_edit_all er false", async () => {
    const org = await createOrganization();
    await db
      .update(organizations)
      .set({ settings: { "access.inspectors_edit_all": false } })
      .where(eq(organizations.id, org.id));
    const { actor } = await member(org.id, ["admin"]);
    const bytes = photoBytes("admin innstilling av");

    const saved = await saveFile(actor, org.id, { kind: "photo", mimeType: "image/jpeg", bytes });
    expect(same((await readFile(actor, org.id, saved.id)).bytes, bytes)).toBe(true);
    await markFileDeleted(actor, org.id, saved.id);
    expect((await fileRow(saved.id))!.deletedAt).not.toBeNull();
  });

  // Skal heller aldri fjernes: admin trenger verken sertifisering eller enkeltrettigheter.
  it("2. admin uten sertifisering og uten enkeltrettigheter kan lagre, lese og merke", async () => {
    const org = await createOrganization();
    const { actor } = await member(org.id, ["admin"]);
    const bytes = photoBytes("admin uten sertifisering");

    const saved = await saveFile(actor, org.id, {
      kind: "document",
      mimeType: "image/png",
      bytes,
    });
    expect(same((await readFile(actor, org.id, saved.id)).bytes, bytes)).toBe(true);
    await markFileDeleted(actor, org.id, saved.id);
    expect((await fileRow(saved.id))!.deletedAt).not.toBeNull();
  });
});

describe("6.6 fremmed fil-ID i egen organisasjon", () => {
  async function setup() {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    await member(orgA.id, ["admin"], "Admin A");
    const { actor: adminB } = await member(orgB.id, ["admin"], "Admin B");
    const { actor: inspectorB } = await member(orgB.id, ["inspector"], "Takstmann B");
    const fileA = await createFile(orgA.id, {}, { storage: localStorage() });
    return { orgA, orgB, adminB, inspectorB, fileA };
  }

  it("1. admin i B leser fil fra A: FileNotFoundError, ingen byte", async () => {
    const { orgB, adminB, fileA } = await setup();
    const result = await readFile(adminB, orgB.id, fileA.id).then(
      (value: unknown) => value,
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(FileNotFoundError);
  });

  it("2. admin i B merker fil fra A: FileNotFoundError, ingenting endres og ingen revisjonsrad", async () => {
    const { orgA, orgB, adminB, fileA } = await setup();
    const auditA = await auditRows(orgA.id);
    const auditB = await auditRows(orgB.id);

    await expect(markFileDeleted(adminB, orgB.id, fileA.id)).rejects.toThrow(FileNotFoundError);
    const row = await fileRow(fileA.id);
    expect(row!.deletedAt).toBeNull();
    expect(row!.deletedBy).toBeNull();
    expect(await auditRows(orgA.id)).toHaveLength(auditA.length);
    expect(await auditRows(orgB.id)).toHaveLength(auditB.length);
  });

  it("3. takstmann i B leser fil fra A: FileNotFoundError", async () => {
    const { orgB, inspectorB, fileA } = await setup();
    await expect(readFile(inspectorB, orgB.id, fileA.id)).rejects.toThrow(FileNotFoundError);
  });
});

describe("6.7 tenant-isolasjon (regel 2)", () => {
  it("1. readFile leser aldri fremmede id-er, og fremmed organisasjon nektes", async () => {
    const allIds: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const storage = localStorage();
        const a = [
          await createFile(grantA.organizationId, {}, { storage }),
          await createFile(grantA.organizationId, { kind: "document" }, { storage }),
        ].map((row) => row.id);
        const b = [
          await createFile(grantB.organizationId, {}, { storage }),
          await createFile(grantB.organizationId, { kind: "report_pdf" }, { storage }),
        ].map((row) => row.id);
        allIds.push(...a, ...b);
        return { a, b };
      },
      query: async (actor, organizationId) => {
        const rows: { id: string }[] = [];
        for (const id of allIds) {
          try {
            const file = await readFile(actor, organizationId, id);
            rows.push({ id: file.id });
          } catch (error) {
            if (error instanceof FileNotFoundError) continue;
            throw error;
          }
        }
        return rows;
      },
      idOf: (row) => row.id,
    });
  });

  it("2. saveFile legger filen i organisasjonen fra tilgangssjekken", async () => {
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = [
          await createFile(grantA.organizationId),
          await createFile(grantA.organizationId),
        ];
        const b = [
          await createFile(grantB.organizationId),
          await createFile(grantB.organizationId),
        ];
        return { a: a.map((row) => row.id), b: b.map((row) => row.id) };
      },
      query: async (actor, organizationId) => {
        const saved = await saveFile(actor, organizationId, {
          kind: "photo",
          mimeType: "image/jpeg",
          bytes: photoBytes(`isolasjon ${organizationId}`),
        });
        // Slår opp den nye raden uten filter, og gir alle rader i den radens organisasjon
        const row = await fileRow(saved.id);
        return db.select().from(files).where(eq(files.organizationId, row!.organizationId));
      },
      idOf: (row) => row.id,
    });
  });

  it("3. markFileDeleted merker bare i egen organisasjon, og fremmed organisasjon nektes", async () => {
    const idsByOrg = new Map<string, string[]>();
    const callsByOrg = new Map<string, number>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const ids = async (organizationId: string) => {
          const rows = [await createFile(organizationId), await createFile(organizationId)];
          idsByOrg.set(
            organizationId,
            rows.map((row) => row.id),
          );
          return rows.map((row) => row.id);
        };
        return { a: await ids(grantA.organizationId), b: await ids(grantB.organizationId) };
      },
      query: async (actor, organizationId) => {
        // Første kall per organisasjon (egen bruker) merker første fil; senere kall (fremmed
        // bruker) prøver den andre, så vi kan sjekke at den aldri blir merket.
        const call = callsByOrg.get(organizationId) ?? 0;
        callsByOrg.set(organizationId, call + 1);
        const id = idsByOrg.get(organizationId)![Math.min(call, 1)]!;
        const updated = await markFileDeleted(actor, organizationId, id);
        return db.select().from(files).where(eq(files.organizationId, updated.organizationId));
      },
      idOf: (row) => row.id,
    });

    // Etter kallene: bare den første filen i hver organisasjon er merket
    for (const [, ids] of idsByOrg) {
      expect((await fileRow(ids[0]!))!.deletedAt).not.toBeNull();
      expect((await fileRow(ids[1]!))!.deletedAt).toBeNull();
    }
    expect([...callsByOrg.values()]).toEqual([2, 2]);
  });
});

describe("6.8 databasen", () => {
  it("1. unik på (organization_id, storage_key), men samme nøkkel i en annen organisasjon godtas", async () => {
    const orgA = await createOrganization("Organisasjon A");
    const orgB = await createOrganization("Organisasjon B");
    const storageKey = "felles/photo/nokkel";
    await createFile(orgA.id, { storageKey });
    await expect(createFile(orgA.id, { storageKey })).rejects.toThrow();
    await expect(createFile(orgB.id, { storageKey })).resolves.toBeDefined();
  });

  it("2. kolonnene finnes, organization_id er påkrevd og retain_until kan være tom", async () => {
    const result = await db.execute(
      sql`select column_name, is_nullable from information_schema.columns
          where table_schema = current_schema() and table_name = 'files'`,
    );
    const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as {
      column_name: string;
      is_nullable: string;
    }[];
    const columns = new Map(rows.map((row) => [row.column_name, row.is_nullable]));
    expect(columns.get("organization_id")).toBe("NO");
    expect(columns.get("deleted_at")).toBe("YES");
    expect(columns.get("deleted_by")).toBe("YES");
    expect(columns.get("retain_until")).toBe("YES");
    expect(columns.has("sha256")).toBe(true);
    expect(columns.has("size_bytes")).toBe(true);
    expect(columns.has("storage_key")).toBe(true);
    expect(columns.has("kind")).toBe(true);
    expect(columns.has("mime_type")).toBe(true);
  });

  it("3. insert uten organization_id gir databasefeil", async () => {
    await expect(
      db.execute(
        sql`insert into files (storage_key, kind, mime_type, size_bytes, sha256)
            values ('x/photo/y', 'photo', 'image/jpeg', 1, 'ab')`,
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
