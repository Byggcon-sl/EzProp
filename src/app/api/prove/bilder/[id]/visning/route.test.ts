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
  ALL_ROLES,
  createDeactivatedEmployee,
  photoOp,
  putTrialForm,
  setupOrganization,
} from "../../../../../../../tests/offline-trial";
import { GET, PUT } from "./route";

// Prøve D: ruten for visningskopien (docs/funksjoner/fase1-prove-d-bilder.md pkt. 3, K4 løsning b).
// Testplan avsnitt 3.4. Bare innloggingen er mocket; tilgangssjekken kjøres ekte mot testdatabasen.
// Alle data er oppdiktet.

vi.mock("@/core/auth/session", () => ({ getCurrentActor: vi.fn() }));

const ROOT = process.cwd();
const ORIGINAL = new Uint8Array(readFileSync(path.join(ROOT, "e2e", "fixtures", "test-image.png")));
const NOT_UPLOADED = "Bildet er ikke lastet opp ennå.";

function segment(marker: number, payload: string): number[] {
  const data = [...Buffer.from(payload, "latin1")];
  const length = data.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...data];
}

function jpeg(...segments: number[][]): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0xff,
    0xd8,
    ...segments.flat(),
    ...segment(0xda, "\x01\x01\0\0\x3f\0"),
    0x12,
    0x34,
    0xff,
    0xd9,
  ]);
}

const APP0 = segment(0xe0, "JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
const COPY = jpeg(APP0);
const COPY_SHA = createHash("sha256").update(COPY).digest("hex");

let uploadDir: string;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(getCurrentActor).mockReset();
  uploadDir = await mkdtemp(path.join(os.tmpdir(), "trial-display-route-test-"));
  vi.stubEnv("TRIAL_UPLOAD_DIR", uploadDir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(uploadDir, { recursive: true, force: true });
});

function loggedInAs(actor: Actor | null) {
  vi.mocked(getCurrentActor).mockResolvedValue(actor);
}

function url(id: string, organizationId: string) {
  return `http://localhost/api/prove/bilder/${encodeURIComponent(id)}/visning?organisasjon=${organizationId}`;
}

function put(
  id: string,
  organizationId: string,
  body: Uint8Array | ReadableStream<Uint8Array>,
  headers: Record<string, string> = { "content-type": "image/jpeg" },
) {
  return PUT(
    new Request(url(id, organizationId), {
      method: "PUT",
      body,
      headers,
      duplex: "half",
    } as RequestInit),
    { params: Promise.resolve({ id }) },
  );
}

function get(id: string, organizationId: string) {
  return GET(new Request(url(id, organizationId)), { params: Promise.resolve({ id }) });
}

async function uploadOriginal(actor: Actor, organizationId: string) {
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
  return photoId;
}

async function displayFiles(): Promise<string[]> {
  if (!existsSync(uploadDir)) return [];
  const entries = await readdir(uploadDir, { recursive: true });
  return entries.map(String).filter((entry) => entry.endsWith(".display.jpg"));
}

describe("PUT og GET /api/prove/bilder/[id]/visning", () => {
  it("ikke innlogget gir 401 på PUT og GET uten fil", async () => {
    loggedInAs(null);
    const id = uuidv7();
    const request = new Request(url(id, uuidv7()), {
      method: "PUT",
      body: COPY,
      headers: { "content-type": "image/jpeg" },
    });
    const putResponse = await PUT(request, { params: Promise.resolve({ id }) });
    expect(putResponse.status).toBe(401);
    expect(await putResponse.json()).toEqual({ feil: "Du må logge inn." });
    expect(request.bodyUsed).toBe(false);
    const getResponse = await get(id, uuidv7());
    expect(getResponse.status).toBe(401);
    expect(await getResponse.json()).toEqual({ feil: "Du må logge inn." });
    expect(await displayFiles()).toEqual([]);
  });

  it.each(ALL_ROLES)("de fire rollene får PUT og GET (%s)", async (role) => {
    const { actor, organizationId } = await setupOrganization(role);
    const photoId = await uploadOriginal(actor, organizationId);
    loggedInAs(actor);

    const putResponse = await put(photoId, organizationId, COPY);
    expect(putResponse.status).toBe(200);
    expect(await putResponse.json()).toEqual({ sha256: COPY_SHA });
    expect(putResponse.headers.get("cache-control")).toBe("no-store");

    const getResponse = await get(photoId, organizationId);
    expect(getResponse.status).toBe(200);
    expect(Buffer.compare(Buffer.from(await getResponse.arrayBuffer()), COPY)).toBe(0);
  });

  it("deaktivert ansatt nektes PUT og GET", async () => {
    const owner = await setupOrganization("admin");
    const photoId = await uploadOriginal(owner.actor, owner.organizationId);
    const gone = await createDeactivatedEmployee(owner.organizationId);
    loggedInAs(gone);
    expect((await put(photoId, owner.organizationId, COPY)).status).toBe(403);
    expect((await get(photoId, owner.organizationId)).status).toBe(403);
    expect(await displayFiles()).toEqual([]);
  });

  it("fremmed organisasjon i adressen gir 403", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const photoB = await uploadOriginal(b.actor, b.organizationId);
    loggedInAs(a.actor);
    const putResponse = await put(photoB, b.organizationId, COPY);
    expect(putResponse.status).toBe(403);
    expect(putResponse.headers.get("cache-control")).toBe("private, no-store");
    expect((await get(photoB, b.organizationId)).status).toBe(403);
    expect(await displayFiles()).toEqual([]);
  });

  it("PUT svarer 400 for feil type, uten FF D8, med metadata og ødelagt fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    loggedInAs(actor);
    const exif = jpeg(APP0, segment(0xe1, "Exif\0\0Oppdiktet-GPS"));
    const cases: [Uint8Array, string][] = [
      [COPY, "image/png"],
      [COPY, "image/jpeg; charset=x"],
      [ORIGINAL, "image/jpeg"],
      [exif, "image/jpeg"],
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]), "image/jpeg"],
      [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x40, 0x01]), "image/jpeg"],
    ];
    for (const [bytes, type] of cases) {
      const response = await put(photoId, organizationId, bytes, { "content-type": type });
      expect(response.status, type).toBe(400);
      const body = (await response.json()) as Record<string, unknown>;
      expect(typeof body.feil).toBe("string");
      expect(JSON.stringify(body)).not.toContain("Oppdiktet-GPS");
    }
    expect(await displayFiles()).toEqual([]);
  });

  it("PUT svarer 413 for stor fil", async () => {
    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    loggedInAs(actor);
    vi.stubEnv("TRIAL_PHOTO_MAX_BYTES", "10");
    const response = await put(photoId, organizationId, COPY, {
      "content-type": "image/jpeg",
      "content-length": String(COPY.byteLength),
    });
    expect(response.status).toBe(413);
    expect(await displayFiles()).toEqual([]);
  });

  it("PUT og GET svarer 404 for ugyldig id, slettet rad og original som ikke er mottatt", async () => {
    const { actor, organizationId } = await setupOrganization();
    const deleted = await uploadOriginal(actor, organizationId);
    await db.update(trialPhotos).set({ deletedAt: new Date() }).where(eq(trialPhotos.id, deleted));
    const formId = await putTrialForm(actor, organizationId, "Testskjema 2");
    const notReceived = uuidv7();
    await applyTrialChanges(actor, organizationId, [
      photoOp(formId, "cover_photo", {}, notReceived),
    ]);
    loggedInAs(actor);

    for (const id of ["ikke-en-uuid", "..", uuidv7(), deleted, notReceived]) {
      expect((await put(id, organizationId, COPY)).status, id).toBe(404);
      const getResponse = await get(id, organizationId);
      expect(getResponse.status, id).toBe(404);
      expect(await getResponse.json()).toEqual({ feil: NOT_UPLOADED });
    }
    expect(await displayFiles()).toEqual([]);
  });

  it("GET gir bildet med riktige hoder", async () => {
    const { actor, organizationId } = await setupOrganization("inspector");
    const photoId = await uploadOriginal(actor, organizationId);
    loggedInAs(actor);
    expect((await put(photoId, organizationId, COPY)).status).toBe(200);

    const response = await get(photoId, organizationId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    const cacheControl = response.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).toContain("no-store");
    expect(response.headers.get("content-disposition")?.startsWith("inline")).toBe(true);
  });

  it("GET uten kopi gir 404 med Bildet er ikke lastet opp ennå.", async () => {
    const a = await setupOrganization("admin", "Organisasjon A");
    const b = await setupOrganization("admin", "Organisasjon B");
    const photoA = await uploadOriginal(a.actor, a.organizationId);
    const photoB = await uploadOriginal(b.actor, b.organizationId);
    loggedInAs(b.actor);
    expect((await put(photoB, b.organizationId, COPY)).status).toBe(200);
    loggedInAs(a.actor);

    // Uten kopi, og bilde-id fra B med kopi, gir samme svar
    for (const id of [photoA, photoB]) {
      const response = await get(id, a.organizationId);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await response.json()).toEqual({ feil: NOT_UPLOADED });
    }
  });

  it("loggen har aldri filinnholdet", async () => {
    const marker = "Oppdiktet-innhold-7391";
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" "));
    };
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation(capture);
    }
    const loggerError = vi.spyOn(logger, "error").mockImplementation((...args: unknown[]) => {
      lines.push(JSON.stringify(args, (_key, value: unknown) => String(value)));
    });

    const { actor, organizationId } = await setupOrganization();
    const photoId = await uploadOriginal(actor, organizationId);
    loggedInAs(actor);
    // Mappen byttes med en fil, så skrivingen feiler (500)
    const blocker = path.join(uploadDir, "fil-i-stedet-for-mappe");
    await writeFile(blocker, "x");
    vi.stubEnv("TRIAL_UPLOAD_DIR", blocker);

    const bytes = jpeg(APP0, segment(0xe2, marker));
    const response = await put(photoId, organizationId, bytes);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(marker);
    expect(loggerError).toHaveBeenCalled();
    for (const line of lines) expect(line).not.toContain(marker);
  });
});
