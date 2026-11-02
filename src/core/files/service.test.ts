import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import { db } from "@/db/client";
import { files } from "@/db/schema";
import {
  auditRows,
  createEmployee,
  createOrganization,
  createUser,
  resetDatabase,
} from "../../../tests/factories";
import { expectTenantIsolation } from "../../../tests/tenant-isolation";
import {
  FileNotFoundError,
  FileRetentionError,
  FileValidationError,
  findActiveFile,
  markFileDeleted,
  readFile,
  readFileRetention,
  saveFile,
} from "./index";

/*
 * Utviklerens egne tester for tjenesten (bit 2). Den fulle testplanen
 * (docs/funksjoner/fase0b-filtjeneste-testplan.md, avsnitt 4 og 6) skrives av testskriveren.
 * Testdata er oppdiktet. Støtter hovedmål: reklamasjoner (fingeravtrykk, myk sletting) og
 * KI først (alle henter filer gjennom samme tilgangssjekk).
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
let tmp: string;
const previousDir = process.env.FILE_STORAGE_DIR;
const previousDriver = process.env.FILE_STORAGE_DRIVER;

beforeEach(async () => {
  await resetDatabase();
  tmp = await mkdtemp(path.join(tmpdir(), "files-service-"));
  process.env.FILE_STORAGE_DIR = tmp;
  delete process.env.FILE_STORAGE_DRIVER;
});

afterEach(async () => {
  process.env.FILE_STORAGE_DIR = previousDir;
  if (previousDriver === undefined) delete process.env.FILE_STORAGE_DRIVER;
  else process.env.FILE_STORAGE_DRIVER = previousDriver;
  await rm(tmp, { recursive: true, force: true });
});

async function setup(roles: Parameters<typeof createEmployee>[2] = ["inspector"]) {
  const org = await createOrganization();
  const user = await createUser({ name: "Kari Testdatter" });
  await createEmployee(user, org.id, roles);
  return { org, user };
}

describe("filtjenesten", () => {
  it("lagrer og henter samme innhold med riktig nøkkel og fingeravtrykk", async () => {
    const { org, user } = await setup();
    const saved = await saveFile(user, org.id, {
      kind: "photo",
      mimeType: "image/jpeg",
      bytes: JPEG,
    });
    expect(saved.sha256).toBe(createHash("sha256").update(JPEG).digest("hex"));
    expect(saved.sizeBytes).toBe(JPEG.byteLength);

    const [row] = await db.select().from(files).where(eq(files.id, saved.id));
    expect(row?.storageKey).toBe(`${org.id}/photo/${saved.id}`);
    expect(row?.createdBy).not.toBeNull();
    expect(row?.retainUntil).toBeNull();

    const read = await readFile(user, org.id, saved.id);
    expect(Array.from(read.bytes)).toEqual(Array.from(JPEG));
    expect(read.sha256).toBe(saved.sha256);
  });

  it("avviser ugyldig filtype før noe skrives", async () => {
    const { org, user } = await setup();
    await expect(
      saveFile(user, org.id, { kind: "photo", mimeType: "image/svg+xml", bytes: JPEG }),
    ).rejects.toBeInstanceOf(FileValidationError);
    await expect(
      saveFile(user, org.id, { kind: "photo", mimeType: "image/jpeg", bytes: new Uint8Array() }),
    ).rejects.toBeInstanceOf(FileValidationError);
    expect(await db.select().from(files)).toHaveLength(0);
  });

  it("ikke-uuid gir ikke funnet", async () => {
    const { org, user } = await setup();
    await expect(readFile(user, org.id, "ikke-en-id")).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it("takstmann kan ikke merke som slettet; admin kan, og revisjonsloggen er minimal", async () => {
    const { org, user } = await setup(["inspector", "admin"]);
    const inspector = await createUser({ name: "Ola Testsen" });
    await createEmployee(inspector, org.id, ["inspector"]);
    const saved = await saveFile(user, org.id, {
      kind: "document",
      mimeType: "application/pdf",
      bytes: JPEG,
    });

    await expect(markFileDeleted(inspector, org.id, saved.id)).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
    const row = await markFileDeleted(user, org.id, saved.id);
    expect(row.deletedAt).not.toBeNull();
    await expect(readFile(user, org.id, saved.id)).rejects.toBeInstanceOf(FileNotFoundError);

    const logs = (await auditRows(org.id)).filter((log) => log.entityType === "file");
    expect(logs).toHaveLength(1);
    expect(logs[0]?.changes).toEqual({
      fileId: saved.id,
      kind: "document",
      organizationId: org.id,
    });
  });

  it("retain_until i fremtiden hindrer myk sletting, også for admin", async () => {
    const { org, user } = await setup(["admin"]);
    const saved = await saveFile(user, org.id, {
      kind: "photo",
      mimeType: "image/png",
      bytes: JPEG,
    });
    await db
      .update(files)
      .set({ retainUntil: new Date(Date.now() + 86_400_000) })
      .where(eq(files.id, saved.id));
    await expect(markFileDeleted(user, org.id, saved.id)).rejects.toBeInstanceOf(
      FileRetentionError,
    );
    const [row] = await db.select().from(files).where(eq(files.id, saved.id));
    expect(row?.deletedAt).toBeNull();
  });

  it("findActiveFile gir bare rader fra egen organisasjon", async () => {
    await expectTenantIsolation({
      // Radene legges inn direkte; oppslaget leser ikke selve filen.
      seed: async (grantA, grantB) => {
        const ids = { a: [] as string[], b: [] as string[] };
        for (const [grant, list] of [
          [grantA, ids.a],
          [grantB, ids.b],
        ] as const) {
          const [row] = await db
            .insert(files)
            .values({
              organizationId: grant.organizationId,
              storageKey: `${grant.organizationId}/photo/x`,
              kind: "photo",
              mimeType: "image/jpeg",
              sizeBytes: 1,
              sha256: "0",
            })
            .returning();
          if (row) list.push(row.id);
        }
        return ids;
      },
      query: async (actor, organizationId) => {
        const grant = await requireOrganizationAccess(actor, organizationId);
        const rows = await db.select({ id: files.id }).from(files);
        const found = [];
        for (const { id } of rows) {
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

describe("readFileRetention", () => {
  it("gir standard 10/2/10 og leser gyldige egne verdier", () => {
    expect(readFileRetention("org", {})).toEqual({
      deviationOriginalYears: 10,
      otherOriginalYears: 2,
      displayYears: 10,
    });
    expect(
      readFileRetention("org", {
        "photo.retention.other_original_years": 3,
        "photo.retention.display_years": 2.5,
      }),
    ).toEqual({ deviationOriginalYears: 10, otherOriginalYears: 3, displayYears: 10 });
  });
});
