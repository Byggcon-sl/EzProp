import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessDeniedError, type Actor, type EmployeeGrant } from "@/core/access";
import type { EmployeeRole } from "@/db/schema";
import { db } from "@/db/client";
import { employees, trialPhotos, users } from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../../tests/factories";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
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
import {
  hasMetadataSegment,
  readTrialDisplayCopy,
  readTrialPhotoBody,
  storeTrialDisplayCopy,
  storeTrialPhoto,
} from "./photo-storage";
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

// Prøve D: visningskopien (docs/funksjoner/fase1-prove-d-bilder.md pkt. 3). Testplan 2.2, 3.1–3.3.

/** Ett felt i en JPEG: merke og innhold, med lengdefeltet regnet ut. */
function segment(marker: number, payload: number[] | string = [0, 0]): number[] {
  const data = typeof payload === "string" ? [...Buffer.from(payload, "latin1")] : payload;
  const length = data.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...data];
}

/** En liten JPEG: FF D8, feltene, FF DA, noen bytes bildedata og FF D9. */
function jpeg(...segments: number[][]): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...segments.flat(),
    ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0x12,
    0x34,
    0x56,
    0xff,
    0xd9,
  ]);
}

const APP0 = segment(0xe0, "JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
const APP2 = segment(0xe2, "ICC_PROFILE\0\x01\x01");
const APP1_EXIF = segment(0xe1, "Exif\0\0GPSLatitude 0/0/0 N");
const APP1_XMP = segment(0xe1, "http://ns.adobe.com/xap/1.0/\0<x/>");
const APP13 = segment(0xed, "Photoshop 3.0\0");
const COPY = jpeg(APP0);
const COPY_SHA = createHash("sha256").update(COPY).digest("hex");
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("hasMetadataSegment", () => {
  it("hasMetadataSegment godtar JPEG uten metadatafelt", () => {
    const cases = [
      jpeg(APP0),
      jpeg(APP0, APP2),
      jpeg(APP0, segment(0xdb), segment(0xc0), segment(0xc4)),
      jpeg(segment(0xdb)),
      jpeg(),
    ];
    for (const bytes of cases) expect(hasMetadataSegment(bytes)).toBe(false);
  });

  it("hasMetadataSegment avviser APP1 og APP13", () => {
    const cases = [
      jpeg(APP0, APP1_EXIF),
      jpeg(APP0, APP1_XMP),
      jpeg(APP0, APP13),
      jpeg(APP1_EXIF),
      jpeg(APP2, APP1_EXIF),
    ];
    for (const bytes of cases) expect(hasMetadataSegment(bytes)).toBe(true);
  });

  it("hasMetadataSegment ser ikke etter bildedataene", () => {
    const bytes = new Uint8Array([
      0xff,
      0xd8,
      ...APP0,
      ...segment(0xda, [1, 1, 0, 0, 0x3f, 0]),
      0xff,
      0xe1,
      0x00,
      0x10,
      0xff,
      0xd9,
    ]);
    expect(hasMetadataSegment(bytes)).toBe(false);
  });

  it("hasMetadataSegment avviser ødelagte filer", () => {
    const cases: Uint8Array[] = [
      new Uint8Array(0),
      new Uint8Array([0xff, 0xd8]),
      PNG_HEAD,
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 0x01, 0x02]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xda]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0xff, 0xda]),
      new Uint8Array([0xff, 0xd8, ...APP0]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xff, 0xff, 0xff]),
    ];
    for (const bytes of cases) expect(hasMetadataSegment(bytes)).toBe(true);
  });

  it("hasMetadataSegment henger aldri", { timeout: 2000 }, () => {
    const random = new Uint8Array(1024 * 1024);
    for (let i = 0; i < random.length; i += 1) random[i] = Math.floor(Math.random() * 256);
    random[0] = 0xff;
    random[1] = 0xd8;
    expect(typeof hasMetadataSegment(random)).toBe("boolean");
    const allFf = new Uint8Array(1024 * 1024).fill(0xff);
    expect(hasMetadataSegment(allFf)).toBe(true);
  });
});

/** Legger inn originalen med storeTrialPhoto, slik ruten gjør. */
async function uploadOriginal(actor: Actor, organizationId: string, photoId = uuidv7()) {
  const formId = await putTrialForm(actor, organizationId);
  await storeTrialPhoto(actor, organizationId, photoId, meta(formId), BYTES);
  return photoId;
}

function displayPath(organizationId: string, photoId: string) {
  return path.join(uploadDir, organizationId, `${photoId}.display.jpg`);
}

async function softDelete(photoId: string) {
  await db.update(trialPhotos).set({ deletedAt: new Date() }).where(eq(trialPhotos.id, photoId));
}

/** Admin-innloggingen i grant-ens organisasjon. */
async function actorFor(grant: EmployeeGrant): Promise<Actor> {
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, grant.employeeId));
  if (!row) throw new Error("fant ikke den ansatte");
  return row;
}

/** Id-ene som lyktes; bare 404-feilen fanges, så AccessDeniedError går videre. */
async function succeeded(ids: string[], run: (id: string) => Promise<unknown>) {
  const ok: { id: string }[] = [];
  for (const id of ids) {
    try {
      await run(id);
      ok.push({ id });
    } catch (error) {
      if (!(error instanceof TrialPhotoNotFoundError)) throw error;
    }
  }
  return ok;
}

describe("storeTrialDisplayCopy", () => {
  it("lagrer kopien som <id>.display.jpg under TRIAL_UPLOAD_DIR/<organizationId> og svarer sha256", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const photoId = await uploadOriginal(actor, organizationId);

    const result = await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);

    expect(result).toEqual({ sha256: COPY_SHA });
    expect(Buffer.compare(readFileSync(displayPath(organizationId, photoId)), COPY)).toBe(0);
    const original = readFileSync(path.join(uploadDir, organizationId, photoId));
    expect(createHash("sha256").update(original).digest("hex")).toBe(SHA);
  });

  it("annen type enn image/jpeg gir InvalidTrialChangeError uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    for (const type of ["image/png", "image/heic", "image/jpeg; charset=x", "", "text/plain"]) {
      await expect(
        storeTrialDisplayCopy(actor, organizationId, photoId, type, COPY),
        type || "(tom)",
      ).rejects.toThrow(InvalidTrialChangeError);
    }
    expect(existsSync(displayPath(organizationId, photoId))).toBe(false);
  });

  it("fil uten FF D8 først gir InvalidTrialChangeError uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    await expect(
      storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", PNG_HEAD),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(existsSync(displayPath(organizationId, photoId))).toBe(false);
  });

  it("kopi med APP1 eller APP13 gir InvalidTrialChangeError uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    for (const bytes of [jpeg(APP0, APP1_EXIF), jpeg(APP0, APP1_XMP), jpeg(APP0, APP13)]) {
      await expect(
        storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", bytes),
      ).rejects.toThrow(InvalidTrialChangeError);
    }
    expect(existsSync(displayPath(organizationId, photoId))).toBe(false);
  });

  it("ødelagt eller avkuttet kopi gir InvalidTrialChangeError, aldri annen feil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    const cases = [
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]),
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 0x01]),
    ];
    for (const bytes of cases) {
      await expect(
        storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", bytes),
      ).rejects.toThrow(InvalidTrialChangeError);
    }
    expect(existsSync(displayPath(organizationId, photoId))).toBe(false);
  });

  it("for stor kopi gir TrialPhotoTooLargeError uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    vi.stubEnv("TRIAL_PHOTO_MAX_BYTES", String(COPY.byteLength - 1));
    await expect(
      storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY),
    ).rejects.toThrow(TrialPhotoTooLargeError);
    expect(existsSync(displayPath(organizationId, photoId))).toBe(false);
  });

  it("ugyldig id gir TrialPhotoNotFoundError uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    for (const badId of ["../x", "ikke-en-uuid"]) {
      await expect(
        storeTrialDisplayCopy(actor, organizationId, badId, "image/jpeg", COPY),
      ).rejects.toThrow(TrialPhotoNotFoundError);
    }
    expect(await listAll(uploadDir)).toEqual([]);
  });

  it("404 når raden ikke finnes, er slettet, mangler sha256 eller uploaded_at", async () => {
    const { actor, organizationId } = await setupOrganization();
    const deleted = await uploadOriginal(actor, organizationId);
    await softDelete(deleted);
    const formId = await putTrialForm(actor, organizationId, "Testskjema 2");
    const notReceived = uuidv7();
    await applyTrialChanges(actor, organizationId, [
      photoOp(formId, "cover_photo", {}, notReceived),
    ]);

    const messages: string[] = [];
    for (const id of [uuidv7(), deleted, notReceived]) {
      const error = await storeTrialDisplayCopy(actor, organizationId, id, "image/jpeg", COPY).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, id).toBeInstanceOf(TrialPhotoNotFoundError);
      messages.push((error as Error).message);
      expect(existsSync(displayPath(organizationId, id))).toBe(false);
    }
    expect(new Set(messages).size).toBe(1);
  });

  it("storeTrialPhoto gir 404 for slettet rad", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);
    const photoId = uuidv7();
    await storeTrialPhoto(actor, organizationId, photoId, meta(formId), BYTES);
    await softDelete(photoId);
    const before = await photoRow(photoId);

    await expect(
      storeTrialPhoto(actor, organizationId, photoId, meta(formId), new Uint8Array([1, 2, 3])),
    ).rejects.toThrow(TrialPhotoNotFoundError);

    expect(await photoRow(photoId)).toEqual(before);
    const onDisk = readFileSync(path.join(uploadDir, organizationId, photoId));
    expect(Buffer.compare(onDisk, TEST_IMAGE)).toBe(0);
  });

  it("den ferdige stien til kopien ligger alltid under TRIAL_UPLOAD_DIR/<organizationId>", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);
    const files = (await listAll(uploadDir)).filter((f) => f.endsWith(".display.jpg"));
    expect(files).toEqual([path.join(organizationId, `${photoId}.display.jpg`)]);
    const relative = path.relative(uploadDir, path.join(uploadDir, files[0]!));
    expect(relative.startsWith(organizationId + path.sep)).toBe(true);
    expect(relative.includes("..")).toBe(false);
  });

  it("kopien endrer ikke raden", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    const before = await photoRow(photoId);
    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);
    expect(await photoRow(photoId)).toEqual(before);
  });

  it("storeTrialDisplayCopy: tenant-isolasjon", async () => {
    const ids = { a: [] as string[], b: [] as string[], orgA: "", orgB: "" };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const actorA = await actorFor(grantA);
        const actorB = await actorFor(grantB);
        ids.orgA = grantA.organizationId;
        ids.orgB = grantB.organizationId;
        ids.a = [
          await uploadOriginal(actorA, grantA.organizationId),
          await uploadOriginal(actorA, grantA.organizationId),
        ];
        ids.b = [
          await uploadOriginal(actorB, grantB.organizationId),
          await uploadOriginal(actorB, grantB.organizationId),
        ];
        return { a: ids.a, b: ids.b };
      },
      query: (actor, organizationId) =>
        succeeded([...ids.a, ...ids.b], (id) =>
          storeTrialDisplayCopy(actor, organizationId, id, "image/jpeg", COPY),
        ),
      idOf: (row) => row.id,
    });
    for (const id of ids.b) expect(existsSync(displayPath(ids.orgA, id))).toBe(false);
    for (const id of ids.a) expect(existsSync(displayPath(ids.orgB, id))).toBe(false);
  });

  it("egen organisasjons-id med bilde-id fra B gir samme 404 som finnes ikke", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const photoB = await uploadOriginal(b.actor, b.organizationId);
    const copyB = jpeg(APP0, APP2);
    await storeTrialDisplayCopy(b.actor, b.organizationId, photoB, "image/jpeg", copyB);

    const notFound = (e: unknown) => e as Error;
    const unknown = await storeTrialDisplayCopy(
      a.actor,
      a.organizationId,
      uuidv7(),
      "image/jpeg",
      COPY,
    ).catch(notFound);
    const foreign = await storeTrialDisplayCopy(
      a.actor,
      a.organizationId,
      photoB,
      "image/jpeg",
      COPY,
    ).catch(notFound);
    expect(foreign).toBeInstanceOf(TrialPhotoNotFoundError);
    expect((foreign as Error).message).toBe((unknown as Error).message);
    expect(Buffer.compare(readFileSync(displayPath(b.organizationId, photoB)), copyB)).toBe(0);
    expect(await listAll(path.join(uploadDir, a.organizationId))).toEqual([]);

    const unknownRead = await readTrialDisplayCopy(a.actor, a.organizationId, uuidv7()).catch(
      notFound,
    );
    const foreignRead = await readTrialDisplayCopy(a.actor, a.organizationId, photoB).catch(
      notFound,
    );
    expect(foreignRead).toBeInstanceOf(TrialPhotoNotFoundError);
    expect((foreignRead as Error).message).toBe((unknownRead as Error).message);
  });
});

describe("readTrialDisplayCopy", () => {
  it("gir bytene til kopien", async () => {
    const { actor, organizationId } = await setupOrganization("office");
    const photoId = await uploadOriginal(actor, organizationId);
    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);
    const bytes = await readTrialDisplayCopy(actor, organizationId, photoId);
    expect(Buffer.compare(Buffer.from(bytes), COPY)).toBe(0);
  });

  it("uten kopi gir 404 med Bildet er ikke lastet opp ennå.", async () => {
    // Ruten gjør TrialPhotoNotFoundError om til 404 med den teksten (K4, løsning b)
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    await expect(readTrialDisplayCopy(actor, organizationId, photoId)).rejects.toThrow(
      TrialPhotoNotFoundError,
    );
  });

  it("slettet rad gir 404 selv om filen finnes", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);
    await softDelete(photoId);
    await expect(readTrialDisplayCopy(actor, organizationId, photoId)).rejects.toThrow(
      TrialPhotoNotFoundError,
    );
    expect(existsSync(displayPath(organizationId, photoId))).toBe(true);
  });

  it("ukjent og ugyldig id gir 404", async () => {
    const { actor, organizationId } = await setupOrganization();
    for (const id of [uuidv7(), "../x"]) {
      await expect(readTrialDisplayCopy(actor, organizationId, id), id).rejects.toThrow(
        TrialPhotoNotFoundError,
      );
    }
  });

  it("readTrialDisplayCopy: tenant-isolasjon", async () => {
    const ids = { a: [] as string[], b: [] as string[] };
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        for (const [grant, side] of [
          [grantA, "a"],
          [grantB, "b"],
        ] as const) {
          const actor = await actorFor(grant);
          for (let i = 0; i < 2; i += 1) {
            const id = await uploadOriginal(actor, grant.organizationId);
            await storeTrialDisplayCopy(actor, grant.organizationId, id, "image/jpeg", COPY);
            ids[side].push(id);
          }
        }
        return { a: ids.a, b: ids.b };
      },
      query: (actor, organizationId) =>
        succeeded([...ids.a, ...ids.b], (id) => readTrialDisplayCopy(actor, organizationId, id)),
      idOf: (row) => row.id,
    });
  });
});
