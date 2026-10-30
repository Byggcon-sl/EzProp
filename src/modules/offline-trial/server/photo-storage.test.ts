import { createHash, randomBytes } from "node:crypto";
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
import {
  ALL_ROLES,
  createDeactivatedEmployee,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../tests/offline-trial";
import {
  APP0,
  APP1_EXIF,
  APP1_XMP,
  APP13,
  APP2,
  cleanDisplayCopy,
  DHT,
  DQT,
  jpeg,
  jpegWithScan,
  SOF0,
  SOS,
} from "../../../../tests/jpeg-bytes";
import { expectTenantIsolation } from "../../../../tests/tenant-isolation";
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

// --- Prøve D – bilder: visningskopien på serveren (docs/funksjoner/fase1-prove-d-bilder.md
// pkt. 3, AK 6, 8 og 10). Testplan avsnitt 2.2, 3.1, 3.2 og 3.3. JPEG-bytene bygges i testen
// (`tests/jpeg-bytes.ts`), ingen ekte bilder. Alle data er oppdiktet.

const COPY = cleanDisplayCopy();
const COPY_SHA = createHash("sha256").update(COPY).digest("hex");
const UNUSED_UUID = "00000000-0000-4000-8000-000000000000";

function displayPath(organizationId: string, photoId: string): string {
  return path.join(uploadDir, organizationId, `${photoId}.display.jpg`);
}

function sha(bytes: Uint8Array | Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Testskjema og ett bilde med original mottatt (`storeTrialPhoto`). */
async function photoWithOriginal(actor: Actor, organizationId: string, formId?: string) {
  const form = formId ?? (await putTrialForm(actor, organizationId));
  const photoId = uuidv7();
  await storeTrialPhoto(actor, organizationId, photoId, meta(form), BYTES);
  return { formId: form, photoId };
}

async function softDelete(photoId: string) {
  await db.update(trialPhotos).set({ deletedAt: new Date() }).where(eq(trialPhotos.id, photoId));
}

/** Meldingen til feilen, eller kaster om kallet lyktes. */
async function errorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Kallet skulle feilet");
}

/** Filene som slutter på `.display.jpg` under en mappe. */
async function displayFiles(dir: string): Promise<string[]> {
  return (await listAll(dir)).filter((name) => name.endsWith(".display.jpg"));
}

/** Admin-innloggingen i grant-ens organisasjon (expectTenantIsolation bruker admin i begge). */
async function actorFor(grant: EmployeeGrant): Promise<Actor> {
  const [found] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(eq(employees.id, grant.employeeId));
  if (!found) throw new Error("fant ikke den ansatte");
  return found;
}

/**
 * Prøver funksjonen for hver id og gir de id-ene som lyktes. Fanger bare
 * `TrialPhotoNotFoundError`; `AccessDeniedError` og alt annet går videre (testplan 3.3).
 */
async function idsThatSucceed(ids: string[], call: (id: string) => Promise<unknown>) {
  const ok: { id: string }[] = [];
  for (const id of ids) {
    try {
      await call(id);
      ok.push({ id });
    } catch (error) {
      if (error instanceof TrialPhotoNotFoundError) continue;
      throw error;
    }
  }
  return ok;
}

describe("hasMetadataSegment", () => {
  // Obligatorisk
  it.each([
    ["bare APP0 (JFIF)", jpeg(APP0)],
    ["APP0 + APP2 (fargeprofil)", jpeg(APP0, APP2)],
    ["APP0 + DQT + SOF0 + DHT", jpeg(APP0, DQT, SOF0, DHT)],
    ["ingen APPn", jpeg(DQT, SOF0, DHT)],
  ])("hasMetadataSegment godtar JPEG uten metadatafelt: %s", (_name, bytes) => {
    expect(hasMetadataSegment(bytes)).toBe(false);
  });

  // Obligatorisk (A7, A10)
  it.each([
    ["APP1 Exif etter APP0", jpeg(APP0, APP1_EXIF)],
    ["APP1 med XMP-hode", jpeg(APP0, APP1_XMP)],
    ["APP13 (Photoshop 3.0)", jpeg(APP0, APP13)],
    ["APP1 som første felt", jpeg(APP1_EXIF, APP0)],
    ["APP1 etter APP2", jpeg(APP0, APP2, APP1_EXIF)],
  ])("hasMetadataSegment avviser APP1 og APP13: %s", (_name, bytes) => {
    expect(hasMetadataSegment(bytes)).toBe(true);
  });

  it("hasMetadataSegment ser ikke etter bildedataene", () => {
    // `FF E1` inne i bildedataene etter `FF DA` er ikke et felt
    const bytes = jpegWithScan([APP0], [0x12, 0xff, 0xe1, 0x00, 0x10, 0x34]);
    expect(hasMetadataSegment(bytes)).toBe(false);
  });

  // Obligatorisk (ødelagt fil regnes som avvist)
  it.each([
    ["tom fil", new Uint8Array(0)],
    ["bare FF D8", Uint8Array.from([0xff, 0xd8])],
    [
      "uten FF D8 først (PNG-hode)",
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ],
    ["avkuttet midt i et lengdefelt", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
    [
      "lengde som peker forbi slutten",
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0x4a, 0x46]),
    ],
    ["lengde 0", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, ...SOS, 0xff, 0xd9])],
    ["lengde 1", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, ...SOS, 0xff, 0xd9])],
    ["ingen FF DA før slutten", Uint8Array.from([0xff, 0xd8, ...APP0])],
    [
      "fyllbytes FF FF uten merke til slutten",
      Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0xff, 0xff]),
    ],
  ])("hasMetadataSegment avviser ødelagte filer: %s", (_name, bytes) => {
    expect(hasMetadataSegment(bytes)).toBe(true);
  });

  it("hasMetadataSegment henger aldri", { timeout: 2000 }, () => {
    const random = new Uint8Array(randomBytes(1024 * 1024));
    random[0] = 0xff;
    random[1] = 0xd8;
    const allFf = new Uint8Array(1024 * 1024).fill(0xff);
    for (const bytes of [random, allFf]) {
      let result: unknown;
      expect(() => {
        result = hasMetadataSegment(bytes);
      }).not.toThrow();
      expect(typeof result).toBe("boolean");
    }
  });
});

describe("storeTrialDisplayCopy", () => {
  // Obligatorisk
  it("lagrer kopien som <id>.display.jpg under TRIAL_UPLOAD_DIR/<organizationId> og svarer sha256", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const { photoId } = await photoWithOriginal(actor, organizationId);
    const originalPath = path.join(uploadDir, organizationId, photoId);
    const originalShaBefore = sha(readFileSync(originalPath));

    const result = await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);

    const file = displayPath(organizationId, photoId);
    expect(existsSync(file)).toBe(true);
    expect(Buffer.compare(readFileSync(file), Buffer.from(COPY))).toBe(0);
    expect(result).toEqual({ sha256: COPY_SHA });
    // Originalen er uendret
    expect(sha(readFileSync(originalPath))).toBe(originalShaBefore);
    expect(originalShaBefore).toBe(SHA);
  });

  // Valget er låst her: bare nøyaktig `image/jpeg` godtas, også parametre avvises.
  it.each(["image/png", "image/heic", "image/jpeg; charset=x", "", "text/plain"])(
    "annen type enn image/jpeg gir InvalidTrialChangeError uten fil (%s)",
    async (contentType) => {
      const { actor, organizationId } = await setupOrganization();
      const { photoId } = await photoWithOriginal(actor, organizationId);

      await expect(
        storeTrialDisplayCopy(actor, organizationId, photoId, contentType, COPY),
      ).rejects.toThrow(InvalidTrialChangeError);
      expect(await displayFiles(uploadDir)).toEqual([]);
    },
  );

  it("fil uten FF D8 først gir InvalidTrialChangeError uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);

    await expect(
      storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", BYTES),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(await displayFiles(uploadDir)).toEqual([]);
  });

  // Obligatorisk (AK 6)
  it.each([
    ["APP1 Exif med oppdiktet GPS", jpeg(APP0, APP1_EXIF)],
    ["APP1 XMP", jpeg(APP0, APP1_XMP)],
    ["APP13", jpeg(APP0, APP13)],
  ])("kopi med APP1 eller APP13 gir InvalidTrialChangeError uten fil (%s)", async (_n, bytes) => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);

    await expect(
      storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", bytes),
    ).rejects.toThrow(InvalidTrialChangeError);
    expect(await displayFiles(uploadDir)).toEqual([]);
  });

  // Obligatorisk
  it.each([
    ["avkuttet", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00])],
    ["lengde forbi slutten", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0x4a, 0x46])],
  ])(
    "ødelagt eller avkuttet kopi gir InvalidTrialChangeError, aldri annen feil (%s)",
    async (_n, bytes) => {
      const { actor, organizationId } = await setupOrganization();
      const { photoId } = await photoWithOriginal(actor, organizationId);

      const error = await errorOf(
        storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", bytes),
      );
      expect(error).toBeInstanceOf(InvalidTrialChangeError);
      expect(await displayFiles(uploadDir)).toEqual([]);
    },
  );

  it("for stor kopi gir TrialPhotoTooLargeError uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    vi.stubEnv("TRIAL_PHOTO_MAX_BYTES", String(COPY.byteLength - 1));

    await expect(
      storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY),
    ).rejects.toThrow(TrialPhotoTooLargeError);
    expect(await displayFiles(uploadDir)).toEqual([]);
  });

  it("ugyldig id gir TrialPhotoNotFoundError uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    await photoWithOriginal(actor, organizationId);
    const before = await listAll(uploadDir);

    for (const badId of ["../x", "ikke-en-uuid"]) {
      await expect(
        storeTrialDisplayCopy(actor, organizationId, badId, "image/jpeg", COPY),
        badId,
      ).rejects.toThrow(TrialPhotoNotFoundError);
    }
    expect(await listAll(uploadDir)).toEqual(before);
    expect(existsSync(path.join(path.dirname(uploadDir), "x"))).toBe(false);
    expect(existsSync(path.join(path.dirname(uploadDir), "x.display.jpg"))).toBe(false);
  });

  // Obligatorisk (AK 6, 8)
  it("404 når raden ikke finnes, er slettet, mangler sha256 eller uploaded_at", async () => {
    const { actor, organizationId } = await setupOrganization();
    const formId = await putTrialForm(actor, organizationId);

    const unknown = await errorOf(
      storeTrialDisplayCopy(actor, organizationId, uuidv7(), "image/jpeg", COPY),
    );
    expect(unknown).toBeInstanceOf(TrialPhotoNotFoundError);

    const deleted = (await photoWithOriginal(actor, organizationId, formId)).photoId;
    await softDelete(deleted);
    const deletedError = await errorOf(
      storeTrialDisplayCopy(actor, organizationId, deleted, "image/jpeg", COPY),
    );

    // Raden er laget av synken, uten fil: sha256 og uploaded_at er tomme
    const synced = uuidv7();
    await applyTrialChanges(actor, organizationId, [photoOp(formId, "cover_photo", {}, synced)]);
    const syncedRow = await photoRow(synced);
    expect(syncedRow!.sha256).toBeNull();
    expect(syncedRow!.uploadedAt).toBeNull();
    const syncedError = await errorOf(
      storeTrialDisplayCopy(actor, organizationId, synced, "image/jpeg", COPY),
    );

    for (const error of [deletedError, syncedError]) {
      expect(error).toBeInstanceOf(TrialPhotoNotFoundError);
      expect(error.message).toBe(unknown.message);
    }
    expect(await displayFiles(uploadDir)).toEqual([]);
  });

  // Obligatorisk (AK 8, retting i pkt. 3)
  it("storeTrialPhoto gir 404 for slettet rad", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { formId, photoId } = await photoWithOriginal(actor, organizationId);
    await softDelete(photoId);
    const before = await photoRow(photoId);
    const file = path.join(uploadDir, organizationId, photoId);
    const fileShaBefore = sha(readFileSync(file));

    await expect(
      storeTrialPhoto(actor, organizationId, photoId, meta(formId), COPY),
    ).rejects.toThrow(TrialPhotoNotFoundError);

    expect(sha(readFileSync(file))).toBe(fileShaBefore);
    const after = await photoRow(photoId);
    expect(after!.sha256).toBe(before!.sha256);
    expect(after!.uploadedAt).toEqual(before!.uploadedAt);
    expect(after!.deletedAt).toEqual(before!.deletedAt);
  });

  it("den ferdige stien til kopien ligger alltid under TRIAL_UPLOAD_DIR/<organizationId>", async () => {
    const { actor, organizationId, grant } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);

    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);

    const files = await displayFiles(uploadDir);
    expect(files).toHaveLength(1);
    const relative = path.relative(uploadDir, path.join(uploadDir, files[0]!));
    expect(relative.startsWith(`${grant.organizationId}${path.sep}`)).toBe(true);
    expect(relative.split(path.sep)).not.toContain("..");
    expect(relative).toBe(path.join(grant.organizationId, `${photoId}.display.jpg`));
  });

  it("kopien endrer ikke raden", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    const before = await photoRow(photoId);

    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);

    const after = await photoRow(photoId);
    expect(after).toEqual(before);
    expect(after!.sha256).toBe(SHA);
  });
});

describe("readTrialDisplayCopy", () => {
  it("gir bytene til kopien", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);

    const bytes = await readTrialDisplayCopy(actor, organizationId, photoId);
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(COPY))).toBe(0);
  });

  it("uten kopi gir 404 med Bildet er ikke lastet opp ennå.", async () => {
    // Teksten selv sjekkes gjennom ruten (route.test.ts, K4); her vises at det er en 404-feil
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);

    await expect(readTrialDisplayCopy(actor, organizationId, photoId)).rejects.toThrow(
      TrialPhotoNotFoundError,
    );
  });

  // Obligatorisk (AK 8)
  it("slettet rad gir 404 selv om filen finnes", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);
    await softDelete(photoId);

    await expect(readTrialDisplayCopy(actor, organizationId, photoId)).rejects.toThrow(
      TrialPhotoNotFoundError,
    );
    // Ingenting slettes permanent
    expect(existsSync(displayPath(organizationId, photoId))).toBe(true);
    expect(existsSync(path.join(uploadDir, organizationId, photoId))).toBe(true);
  });

  it("ukjent og ugyldig id gir 404", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    await storeTrialDisplayCopy(actor, organizationId, photoId, "image/jpeg", COPY);

    for (const id of [uuidv7(), "../x", `../${organizationId}/${photoId}`, UNUSED_UUID]) {
      await expect(readTrialDisplayCopy(actor, organizationId, id), id).rejects.toThrow(
        TrialPhotoNotFoundError,
      );
    }
  });
});

describe("visningskopien: tenant-isolasjon", () => {
  /** Ett skjema og to bilder med original i organisasjonen; `withCopy` lagrer også kopiene. */
  async function seedSide(grant: EmployeeGrant, withCopy: boolean): Promise<string[]> {
    const actor = await actorFor(grant);
    const formId = await putTrialForm(actor, grant.organizationId);
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { photoId } = await photoWithOriginal(actor, grant.organizationId, formId);
      if (withCopy) {
        await storeTrialDisplayCopy(actor, grant.organizationId, photoId, "image/jpeg", COPY);
      }
      ids.push(photoId);
    }
    return ids;
  }

  // Obligatorisk (AK 10)
  it("storeTrialDisplayCopy: tenant-isolasjon", async () => {
    const all: string[] = [];
    const orgOf = new Map<string, string>();
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedSide(grantA, false);
        const b = await seedSide(grantB, false);
        for (const id of a) orgOf.set(id, grantA.organizationId);
        for (const id of b) orgOf.set(id, grantB.organizationId);
        all.push(...a, ...b);
        return { a, b };
      },
      query: (actor, organizationId) =>
        idsThatSucceed(all, (id) =>
          storeTrialDisplayCopy(actor, organizationId, id, "image/jpeg", COPY),
        ),
      idOf: (entry) => entry.id,
    });

    // Ingen kopi for et bilde havnet i en annen organisasjons mappe
    for (const id of all) {
      for (const organizationId of new Set(orgOf.values())) {
        const file = displayPath(organizationId, id);
        expect(existsSync(file), file).toBe(organizationId === orgOf.get(id));
      }
    }
  });

  // Obligatorisk (AK 10)
  it("readTrialDisplayCopy: tenant-isolasjon", async () => {
    const all: string[] = [];
    await expectTenantIsolation({
      seed: async (grantA, grantB) => {
        const a = await seedSide(grantA, true);
        const b = await seedSide(grantB, true);
        all.push(...a, ...b);
        return { a, b };
      },
      query: (actor, organizationId) =>
        idsThatSucceed(all, (id) => readTrialDisplayCopy(actor, organizationId, id)),
      idOf: (entry) => entry.id,
    });
  });

  // Obligatorisk
  it("egen organisasjons-id med bilde-id fra B gir samme 404 som finnes ikke", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const { photoId: photoB } = await photoWithOriginal(b.actor, b.organizationId);
    await storeTrialDisplayCopy(b.actor, b.organizationId, photoB, "image/jpeg", COPY);
    const fileB = displayPath(b.organizationId, photoB);
    const bytesBefore = readFileSync(fileB);
    const other = cleanDisplayCopy([0x77, 0x78]);

    const unknownPut = await errorOf(
      storeTrialDisplayCopy(a.actor, a.organizationId, uuidv7(), "image/jpeg", other),
    );
    const foreignPut = await errorOf(
      storeTrialDisplayCopy(a.actor, a.organizationId, photoB, "image/jpeg", other),
    );
    expect(unknownPut).toBeInstanceOf(TrialPhotoNotFoundError);
    expect(foreignPut).toBeInstanceOf(TrialPhotoNotFoundError);
    expect(foreignPut.message).toBe(unknownPut.message);
    expect(Buffer.compare(readFileSync(fileB), bytesBefore)).toBe(0);
    expect(await listAll(path.join(uploadDir, a.organizationId))).toEqual([]);

    const unknownGet = await errorOf(readTrialDisplayCopy(a.actor, a.organizationId, uuidv7()));
    const foreignGet = await errorOf(readTrialDisplayCopy(a.actor, a.organizationId, photoB));
    expect(unknownGet).toBeInstanceOf(TrialPhotoNotFoundError);
    expect(foreignGet).toBeInstanceOf(TrialPhotoNotFoundError);
    expect(foreignGet.message).toBe(unknownGet.message);
  });
});
