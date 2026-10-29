import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError } from "@/core/access";
import type { EmployeeRole } from "@/db/schema";
import { db } from "@/db/client";
import { trialPhotos } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../../tests/factories";
import {
  ALL_ROLES,
  createDeactivatedEmployee,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../tests/offline-trial";
import { applyTrialChanges } from "./apply-changes";
import {
  InvalidTrialChangeError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "./errors";
import { readTrialPhotoBody, storeTrialPhoto } from "./photo-storage";
import { TRIAL_PHOTO_DEFAULT_MAX_BYTES, type TrialPhotoMeta } from "./types";

// Opplasting av bildefiler i prøven (docs/funksjoner/fase1-kandidat-powersync.md pkt. 11).
// Testplan avsnitt 3.4. Ingenting går tapt, og ingenting skrives utenfor TRIAL_UPLOAD_DIR.

const ROOT = process.cwd();
const TEST_IMAGE = readFileSync(path.join(ROOT, "e2e", "fixtures", "test-image.png"));
const BYTES = new Uint8Array(TEST_IMAGE);
const SHA = createHash("sha256").update(BYTES).digest("hex");

let uploadDir: string;
const extraDirs: string[] = [];

beforeEach(async () => {
  await resetDatabase();
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "trial-upload-test-"));
  vi.stubEnv("TRIAL_UPLOAD_DIR", uploadDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(uploadDir, { recursive: true, force: true });
  for (const dir of extraDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function meta(trialFormId: string, extra: Partial<TrialPhotoMeta> = {}): TrialPhotoMeta {
  return {
    trialFormId,
    fieldKey: "cover_photo",
    name: "test-image.png",
    sizeBytes: BYTES.byteLength,
    contentType: "image/png",
    ...extra,
  };
}

async function photoRow(id: string) {
  const [row] = await db.select().from(trialPhotos).where(eq(trialPhotos.id, id));
  return row;
}

/** Alle filer og mapper under en mappe (rekursivt). */
async function listAll(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true });
  return entries.map(String);
}

describe("storeTrialPhoto", () => {
  it("lagrer filen under TRIAL_UPLOAD_DIR/<organizationId>/<id> og svarer riktig sha256", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();

    const result = await storeTrialPhoto(actor, organizationId, photoId, meta(formId), BYTES);

    const expectedPath = path.join(uploadDir, organizationId, photoId);
    expect(existsSync(expectedPath)).toBe(true);
    expect(Buffer.compare(readFileSync(expectedPath), TEST_IMAGE)).toBe(0);
    expect(result).toEqual({ sha256: SHA });

    const row = await photoRow(photoId);
    expect(row!.sha256).toBe(SHA);
    expect(row!.storagePath).toBeTruthy();
    expect(path.resolve(row!.storagePath!)).toBe(path.resolve(expectedPath));
    expect(row!.uploadedAt).toBeInstanceOf(Date);
  });

  it("lager raden fra meta når den mangler", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();
    expect(await photoRow(photoId)).toBeUndefined();

    await storeTrialPhoto(
      actor,
      organizationId,
      photoId,
      meta(formId, { fieldKey: "roof_photo", name: "tak.png" }),
      BYTES,
    );

    const row = await photoRow(photoId);
    expect(row).toBeDefined();
    expect(row!.trialFormId).toBe(formId);
    expect(row!.fieldKey).toBe("roof_photo");
    expect(row!.name).toBe("tak.png");
    expect(row!.sizeBytes).toBe(BYTES.byteLength);
    expect(row!.organizationId).toBe(organizationId);
    expect(row!.createdBy).toBe(actor.id);
  });

  it("oppdaterer eksisterende rad uten å endre id, trial_form_id eller field_key", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const otherForm = await putTrialForm(actor, organizationId, "Testskjema 2");
    const photoId = uuidv7();
    await applyTrialChanges(actor, organizationId, [
      photoOp(
        formId,
        "cover_photo",
        { name: "forside.png", size_bytes: BYTES.byteLength },
        photoId,
      ),
    ]);
    const before = await photoRow(photoId);

    // Metadata i spørrestrengen kan ikke flytte et bilde som allerede finnes
    await storeTrialPhoto(
      actor,
      organizationId,
      photoId,
      meta(otherForm, { fieldKey: "roof_photo", name: "annet-navn.png" }),
      BYTES,
    );

    const after = await photoRow(photoId);
    expect(after!.id).toBe(before!.id);
    expect(after!.trialFormId).toBe(formId);
    expect(after!.fieldKey).toBe("cover_photo");
    expect(after!.name).toBe("forside.png");
    expect(after!.organizationId).toBe(organizationId);
    expect(after!.createdBy).toBe(before!.createdBy);
    expect(after!.sha256).toBe(SHA);
    expect(after!.storagePath).toBeTruthy();
    expect(after!.uploadedAt).toBeInstanceOf(Date);
    expect(after!.updatedBy).toBe(actor.id);
  });

  it("idempotent: samme fil to ganger gir samme sti og samme sha256", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();

    const first = await storeTrialPhoto(actor, organizationId, photoId, meta(formId), BYTES);
    const firstRow = await photoRow(photoId);
    const second = await storeTrialPhoto(actor, organizationId, photoId, meta(formId), BYTES);
    const secondRow = await photoRow(photoId);

    expect(second).toEqual(first);
    expect(secondRow!.storagePath).toBe(firstRow!.storagePath);
    expect(secondRow!.sha256).toBe(firstRow!.sha256);
    const rows = await db.select().from(trialPhotos);
    expect(rows).toHaveLength(1);
    expect(await listAll(path.join(uploadDir, organizationId))).toEqual([photoId]);
  });

  it("ugyldig id gir 404-feil uten filskriving", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);

    for (const badId of ["../x", "x", `../${organizationId}/x`, "..", ""]) {
      await expect(
        storeTrialPhoto(actor, organizationId, badId, meta(formId), BYTES),
        badId,
      ).rejects.toThrow(TrialPhotoNotFoundError);
    }
    expect(await listAll(uploadDir)).toEqual([]);
    expect(existsSync(path.join(path.dirname(uploadDir), "x"))).toBe(false);
    expect(await db.select().from(trialPhotos)).toHaveLength(0);
  });

  it("bilde-id i en annen organisasjon gir 404-feil uten filskriving", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formA = await putTrialForm(a.actor, a.organizationId);
    const formB = await putTrialForm(b.actor, b.organizationId);
    const photoB = uuidv7();
    await applyTrialChanges(b.actor, b.organizationId, [
      photoOp(formB, "cover_photo", { name: "b.png" }, photoB),
    ]);
    const before = await photoRow(photoB);

    await expect(
      storeTrialPhoto(a.actor, a.organizationId, photoB, meta(formA), BYTES),
    ).rejects.toThrow(TrialPhotoNotFoundError);

    expect(await listAll(path.join(uploadDir, a.organizationId))).toEqual([]);
    expect(await listAll(path.join(uploadDir, b.organizationId))).toEqual([]);
    expect(await photoRow(photoB)).toEqual(before);
  });

  it("fremmed trial_form_id i meta gir InvalidTrialChangeError uten fil", async () => {
    const a = await setupOrganization("inspector", "Organisasjon A");
    const b = await setupOrganization("inspector", "Organisasjon B");
    const formB = await putTrialForm(b.actor, b.organizationId);
    const photoId = uuidv7();

    await expect(
      storeTrialPhoto(a.actor, a.organizationId, photoId, meta(formB), BYTES),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(await photoRow(photoId)).toBeUndefined();
    expect(await listAll(uploadDir)).toEqual([]);

    // Ukjent skjema gir det samme
    await expect(
      storeTrialPhoto(a.actor, a.organizationId, photoId, meta(uuidv7()), BYTES),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(await listAll(uploadDir)).toEqual([]);
  });

  it("innholdstype som ikke er image/* gir InvalidTrialChangeError", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);

    for (const contentType of ["application/pdf", "text/html", ""]) {
      await expect(
        storeTrialPhoto(actor, organizationId, uuidv7(), meta(formId, { contentType }), BYTES),
        contentType || "(tom)",
      ).rejects.toThrow(InvalidTrialChangeError);
    }
    expect(await listAll(uploadDir)).toEqual([]);
    expect(await db.select().from(trialPhotos)).toHaveLength(0);

    for (const contentType of ["image/jpeg", "image/png", "image/heic"]) {
      await expect(
        storeTrialPhoto(actor, organizationId, uuidv7(), meta(formId, { contentType }), BYTES),
        contentType,
      ).resolves.toEqual({ sha256: SHA });
    }
  });

  it("fil over TRIAL_PHOTO_MAX_BYTES gir TrialPhotoTooLargeError", async () => {
    expect(TRIAL_PHOTO_DEFAULT_MAX_BYTES).toBe(25 * 1024 * 1024);
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    vi.stubEnv("TRIAL_PHOTO_MAX_BYTES", "10");
    const photoId = uuidv7();

    await expect(
      storeTrialPhoto(
        actor,
        organizationId,
        photoId,
        meta(formId, { sizeBytes: 11 }),
        new Uint8Array(11),
      ),
    ).rejects.toThrow(TrialPhotoTooLargeError);
    expect(await listAll(uploadDir)).toEqual([]);
    expect(await photoRow(photoId)).toBeUndefined();

    await expect(
      storeTrialPhoto(
        actor,
        organizationId,
        uuidv7(),
        meta(formId, { sizeBytes: 10 }),
        new Uint8Array(10),
      ),
    ).resolves.toHaveProperty("sha256");
  });

  it("navn over 200 tegn gir InvalidTrialChangeError uten rad og fil (småfunn 9)", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();

    await expect(
      storeTrialPhoto(
        actor,
        organizationId,
        photoId,
        meta(formId, { name: "n".repeat(201) }),
        BYTES,
      ),
    ).rejects.toThrow("Navnet er for langt. Det kan ha høyst 200 tegn.");
    expect(await photoRow(photoId)).toBeUndefined();
    expect(await listAll(uploadDir)).toEqual([]);

    await expect(
      storeTrialPhoto(
        actor,
        organizationId,
        photoId,
        meta(formId, { name: "n".repeat(200) }),
        BYTES,
      ),
    ).resolves.toEqual({ sha256: SHA });
  });

  it("den ferdige stien ligger alltid under TRIAL_UPLOAD_DIR", async () => {
    const relative = path.join("var", `tmp-test-${uuidv7()}`);
    extraDirs.push(path.resolve(relative));
    vi.stubEnv("TRIAL_UPLOAD_DIR", relative);
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();

    await storeTrialPhoto(actor, organizationId, photoId, meta(formId), BYTES);

    const row = await photoRow(photoId);
    const base = path.resolve(relative);
    expect(row!.storagePath!.startsWith(base + path.sep)).toBe(true);
    expect(existsSync(path.join(base, organizationId, photoId))).toBe(true);
  });

  it("fremmed organisasjon gir AccessDeniedError", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const formB = await putTrialForm(b.actor, b.organizationId);

    await expect(
      storeTrialPhoto(a.actor, b.organizationId, uuidv7(), meta(formB), BYTES),
    ).rejects.toThrow(AccessDeniedError);
    expect(await listAll(uploadDir)).toEqual([]);
    expect(await db.select().from(trialPhotos)).toHaveLength(0);
  });

  describe("alle fire roller kan laste opp, deaktivert ansatt nektes", () => {
    it.each(ALL_ROLES)(
      "alle fire roller kan laste opp, deaktivert ansatt nektes (%s)",
      async (role: EmployeeRole) => {
        const { actor, organizationId } = await setupOrganization(role);
        const formId = await putTrialForm(actor, organizationId);
        await expect(
          storeTrialPhoto(actor, organizationId, uuidv7(), meta(formId), BYTES),
        ).resolves.toEqual({ sha256: SHA });
      },
    );

    it("alle fire roller kan laste opp, deaktivert ansatt nektes (deaktivert)", async () => {
      const owner = await setupOrganization("admin");
      const formId = await putTrialForm(owner.actor, owner.organizationId);
      const gone = await createDeactivatedEmployee(owner.organizationId);
      await expect(
        storeTrialPhoto(gone, owner.organizationId, uuidv7(), meta(formId), BYTES),
      ).rejects.toThrow(AccessDeniedError);
      expect(await listAll(uploadDir)).toEqual([]);
    });
  });
});

// Småfunn 8: bilderuten skal ikke lese en for stor fil inn i minnet før grensen sjekkes.
describe("readTrialPhotoBody", () => {
  /** En strøm som teller hvor mange biter som er lest, og om den ble avbrutt. */
  function countingStream(chunkCount: number, chunkSize: number) {
    const state = { pulled: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (state.pulled >= chunkCount) {
          controller.close();
          return;
        }
        state.pulled += 1;
        controller.enqueue(new Uint8Array(chunkSize));
      },
      cancel() {
        state.cancelled = true;
      },
    });
    return { stream, state };
  }

  function putRequest(body: BodyInit | null, headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/prove/bilder/x", {
      method: "PUT",
      body,
      headers,
      duplex: "half",
    } as RequestInit);
  }

  it("leser hele filen når den er innenfor grensen", async () => {
    const bytes = await readTrialPhotoBody(putRequest(BYTES), BYTES.byteLength);
    expect(Buffer.compare(Buffer.from(bytes), TEST_IMAGE)).toBe(0);
  });

  it("for stor Content-Length avvises før noe av kroppen leses", async () => {
    const { stream, state } = countingStream(100, 10);
    const request = putRequest(stream, { "content-length": "1000" });
    await expect(readTrialPhotoBody(request, 999)).rejects.toThrow(TrialPhotoTooLargeError);
    expect(state.pulled).toBeLessThanOrEqual(1);
  });

  it("uten Content-Length stoppes lesingen straks grensen passeres", async () => {
    const { stream, state } = countingStream(100, 10);
    await expect(readTrialPhotoBody(putRequest(stream), 25)).rejects.toThrow(
      TrialPhotoTooLargeError,
    );
    // 25 byte passeres på tredje bit; resten av de 100 bitene leses aldri
    expect(state.pulled).toBeLessThanOrEqual(4);
    expect(state.cancelled).toBe(true);
  });

  it("bruker TRIAL_PHOTO_MAX_BYTES som standard, med samme feil som før", async () => {
    vi.stubEnv("TRIAL_PHOTO_MAX_BYTES", "10");
    await expect(readTrialPhotoBody(putRequest(new Uint8Array(11)))).rejects.toThrow(
      "Bildet er for stort.",
    );
    await expect(readTrialPhotoBody(putRequest(new Uint8Array(10)))).resolves.toHaveLength(10);
  });
});
