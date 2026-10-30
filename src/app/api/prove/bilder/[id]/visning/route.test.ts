import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/core/access";
import { getCurrentActor } from "@/core/auth/session";
import { db } from "@/db/client";
import { trialPhotos } from "@/db/schema";
import { applyTrialChanges } from "@/modules/offline-trial/server/apply-changes";
import { storeTrialPhoto } from "@/modules/offline-trial/server/photo-storage";
import { logger } from "@/shared/lib/logger";
import { uuidv7 } from "@/shared/lib/uuid";
import { resetDatabase } from "../../../../../../../tests/factories";
import {
  APP0,
  APP1_EXIF,
  APP1_XMP,
  APP13,
  cleanDisplayCopy,
  jpeg,
  textBytes,
} from "../../../../../../../tests/jpeg-bytes";
import {
  ALL_ROLES,
  createDeactivatedEmployee,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../../../../tests/offline-trial";
import { GET, PUT } from "./route";

// Prøve D – bilder: visningsruten PUT og GET /api/prove/bilder/[id]/visning
// (docs/funksjoner/fase1-prove-d-bilder.md pkt. 3, AK 6, 8, 10 og 11). Testplan avsnitt 3.4.
// Bare innloggingen er mocket; tilgangssjekken i src/core/access kjøres ekte mot testdatabasen.
// JPEG-bytene bygges i testen (`tests/jpeg-bytes.ts`). Alle data er oppdiktet.

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const ORIGINAL = new Uint8Array(
  readFileSync(path.join(process.cwd(), "e2e", "fixtures", "test-image.png")),
);
const COPY = cleanDisplayCopy();
const COPY_SHA = createHash("sha256").update(COPY).digest("hex");
const NOT_UPLOADED = "Bildet er ikke lastet opp ennå.";

let uploadDir: string;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getCurrentActor).mockReset();
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "trial-display-route-test-"));
  vi.stubEnv("TRIAL_UPLOAD_DIR", uploadDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(uploadDir, { recursive: true, force: true });
});

function loggedInAs(actor: Actor | null) {
  vi.mocked(getCurrentActor).mockResolvedValue(actor);
}

function address(id: string, organizationId: string): string {
  return `http://localhost/api/prove/bilder/${encodeURIComponent(id)}/visning?organisasjon=${organizationId}`;
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function putRequest(
  id: string,
  organizationId: string,
  body: Uint8Array,
  contentType = "image/jpeg",
  headers: Record<string, string> = {},
): Request {
  return new Request(address(id, organizationId), {
    method: "PUT",
    headers: { "content-type": contentType, ...headers },
    body: body as BodyInit,
  });
}

async function put(
  id: string,
  organizationId: string,
  body: Uint8Array = COPY,
  contentType = "image/jpeg",
) {
  return PUT(putRequest(id, organizationId, body, contentType), params(id));
}

async function get(id: string, organizationId: string) {
  return GET(new Request(address(id, organizationId), { method: "GET" }), params(id));
}

/** Testskjema og ett bilde med original mottatt. */
async function photoWithOriginal(actor: Actor, organizationId: string) {
  const formId = await putTrialForm(actor, organizationId);
  const photoId = uuidv7();
  await storeTrialPhoto(
    actor,
    organizationId,
    photoId,
    {
      trialFormId: formId,
      fieldKey: "cover_photo",
      name: "test-image.png",
      sizeBytes: ORIGINAL.byteLength,
      contentType: "image/png",
    },
    ORIGINAL,
  );
  return { formId, photoId };
}

async function displayFiles(): Promise<string[]> {
  if (!existsSync(uploadDir)) return [];
  const entries = await readdir(uploadDir, { recursive: true });
  return entries.map(String).filter((name) => name.endsWith(".display.jpg"));
}

async function expectError(response: Response, status: number): Promise<string> {
  expect(response.status).toBe(status);
  const cacheControl = response.headers.get("cache-control") ?? "";
  expect(cacheControl).toContain("private");
  expect(cacheControl).toContain("no-store");
  const body = (await response.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(["feil"]);
  expect(typeof body.feil).toBe("string");
  return body.feil as string;
}

describe("PUT og GET /api/prove/bilder/[id]/visning", () => {
  // Obligatorisk
  it("ikke innlogget gir 401 på PUT og GET uten fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    loggedInAs(null);

    const request = putRequest(photoId, organizationId, COPY);
    const putResponse = await PUT(request, params(photoId));
    expect(putResponse.status).toBe(401);
    expect(await putResponse.json()).toEqual({ feil: "Du må logge inn." });
    expect(request.bodyUsed).toBe(false);

    const getResponse = await get(photoId, organizationId);
    expect(getResponse.status).toBe(401);
    expect(await getResponse.json()).toEqual({ feil: "Du må logge inn." });
    expect(await displayFiles()).toEqual([]);
  });

  // Obligatorisk (AK 11, admin stenges aldri ute)
  it.each(ALL_ROLES)("de fire rollene får PUT og GET (%s)", async (role) => {
    const { actor, organizationId } = await setupOrganization(role);
    const { photoId } = await photoWithOriginal(actor, organizationId);
    loggedInAs(actor);

    const putResponse = await put(photoId, organizationId);
    expect(putResponse.status).toBe(200);
    expect(await putResponse.json()).toEqual({ sha256: COPY_SHA });

    const getResponse = await get(photoId, organizationId);
    expect(getResponse.status).toBe(200);
    const bytes = Buffer.from(await getResponse.arrayBuffer());
    expect(Buffer.compare(bytes, Buffer.from(COPY))).toBe(0);
  });

  // Obligatorisk
  it("deaktivert ansatt nektes PUT og GET", async () => {
    const owner = await setupOrganization("admin");
    const { photoId } = await photoWithOriginal(owner.actor, owner.organizationId);
    const gone = await createDeactivatedEmployee(owner.organizationId);
    loggedInAs(gone);

    await expectError(await put(photoId, owner.organizationId), 403);
    expect(await displayFiles()).toEqual([]);
    await expectError(await get(photoId, owner.organizationId), 403);
  });

  it("fremmed organisasjon i adressen gir 403", async () => {
    const a = await setupOrganization("admin", "Oppdiktet takst A");
    const b = await setupOrganization("admin", "Oppdiktet takst B");
    const { photoId } = await photoWithOriginal(b.actor, b.organizationId);
    loggedInAs(b.actor);
    expect((await put(photoId, b.organizationId)).status).toBe(200);

    loggedInAs(a.actor);
    await expectError(await put(photoId, b.organizationId, cleanDisplayCopy([0x55])), 403);
    await expectError(await get(photoId, b.organizationId), 403);
    // Kopien til B er uendret
    const file = path.join(uploadDir, b.organizationId, `${photoId}.display.jpg`);
    expect(Buffer.compare(readFileSync(file), Buffer.from(COPY))).toBe(0);
  });

  it.each([
    ["feil type (image/png)", COPY, "image/png"],
    ["feil type (image/heic)", COPY, "image/heic"],
    ["uten FF D8", ORIGINAL, "image/jpeg"],
    ["APP1 Exif med oppdiktet GPS", jpeg(APP0, APP1_EXIF), "image/jpeg"],
    ["APP1 XMP", jpeg(APP0, APP1_XMP), "image/jpeg"],
    ["APP13", jpeg(APP0, APP13), "image/jpeg"],
    ["avkuttet", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), "image/jpeg"],
    [
      "lengde forbi slutten",
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0xff, 0x4a]),
      "image/jpeg",
    ],
  ] as const)(
    "PUT svarer 400 for feil type, uten FF D8, med metadata og ødelagt fil (%s)",
    async (_name, body, contentType) => {
      const { actor, organizationId } = await setupOrganization();
      const { photoId } = await photoWithOriginal(actor, organizationId);
      loggedInAs(actor);

      const message = await expectError(await put(photoId, organizationId, body, contentType), 400);
      // Ingenting fra filen i svaret
      expect(message).not.toMatch(/Exif|JFIF|Photoshop|xmpmeta|GPS/);
      expect(await displayFiles()).toEqual([]);
    },
  );

  it("PUT svarer 413 for stor fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    loggedInAs(actor);
    vi.stubEnv("TRIAL_PHOTO_MAX_BYTES", "10");

    const response = await PUT(
      putRequest(photoId, organizationId, COPY, "image/jpeg", {
        "content-length": String(COPY.byteLength),
      }),
      params(photoId),
    );
    await expectError(response, 413);
    expect(await displayFiles()).toEqual([]);
  });

  it("PUT og GET svarer 404 for ugyldig id, slettet rad og original som ikke er mottatt", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { formId, photoId: deleted } = await photoWithOriginal(actor, organizationId);
    loggedInAs(actor);
    expect((await put(deleted, organizationId)).status).toBe(200);
    await db.update(trialPhotos).set({ deletedAt: new Date() }).where(eq(trialPhotos.id, deleted));
    const synced = uuidv7();
    await applyTrialChanges(actor, organizationId, [photoOp(formId, "cover_photo", {}, synced)]);
    const filesBefore = await displayFiles();

    const unknown = await expectError(await put(uuidv7(), organizationId), 404);
    for (const id of ["../x", "ikke-en-uuid", deleted, synced]) {
      expect(await expectError(await put(id, organizationId), 404), `PUT ${id}`).toBe(unknown);
      await expectError(await get(id, organizationId), 404);
    }
    expect(await displayFiles()).toEqual(filesBefore);
  });

  // Obligatorisk
  it("GET gir bildet med riktige hoder", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    loggedInAs(actor);
    expect((await put(photoId, organizationId)).status).toBe(200);

    const response = await get(photoId, organizationId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).toContain("no-store");
    expect(response.headers.get("content-disposition") ?? "").toMatch(/^inline/);
  });

  it("GET uten kopi gir 404 med Bildet er ikke lastet opp ennå.", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    loggedInAs(actor);

    const response = await get(photoId, organizationId);
    expect(await expectError(response, 404)).toBe(NOT_UPLOADED);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("GET for bilde-id fra en annen organisasjon gir samme svar som ukjent id", async () => {
    const a = await setupOrganization("admin", "Oppdiktet takst A");
    const b = await setupOrganization("admin", "Oppdiktet takst B");
    const { photoId } = await photoWithOriginal(b.actor, b.organizationId);
    loggedInAs(b.actor);
    expect((await put(photoId, b.organizationId)).status).toBe(200);

    loggedInAs(a.actor);
    const unknown = await expectError(await get(uuidv7(), a.organizationId), 404);
    expect(await expectError(await get(photoId, a.organizationId), 404)).toBe(unknown);
    expect(await expectError(await put(photoId, a.organizationId), 404)).toBe(
      await expectError(await put(uuidv7(), a.organizationId), 404),
    );
  });

  it("loggen har aldri filinnholdet", async () => {
    const { actor, organizationId } = await setupOrganization();
    const { photoId } = await photoWithOriginal(actor, organizationId);
    loggedInAs(actor);
    // TRIAL_UPLOAD_DIR peker på en fil, så skrivingen feiler og gir 500
    const notADir = path.join(uploadDir, "ikke-en-mappe");
    await writeFile(notADir, "x");
    vi.stubEnv("TRIAL_UPLOAD_DIR", notADir);
    const secret = "Oppdiktet-innhold-7391";
    const body = cleanDisplayCopy(textBytes(secret));
    const logged: unknown[][] = [];
    vi.spyOn(logger, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    for (const method of ["error", "warn", "log", "info", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(args);
      });
    }

    const response = await put(photoId, organizationId, body);

    expect(response.status).toBe(500);
    const text = JSON.stringify(logged, (_key, value: unknown) =>
      value instanceof Error ? { name: value.name, message: value.message } : value,
    );
    expect(text).not.toContain(secret);
    expect(JSON.stringify(await response.json())).not.toContain(secret);
  });
});
