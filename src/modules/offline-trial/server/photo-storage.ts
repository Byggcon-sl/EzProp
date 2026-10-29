/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Tar imot én bildefil fra enheten (`PUT /api/prove/bilder/[id]`) og lagrer den i en lokal mappe
 * på serveren (`TRIAL_UPLOAD_DIR/<organizationId>/<photoId>`). Ingen felles filtjeneste ennå
 * (fase 0b). Svaret er SHA-256 av filen; enheten sletter sin kopi bare når fingeravtrykket er likt.
 * Raden i `trial_photos` lages her hvis synken ikke har levert den ennå, så bildet kommer fram selv
 * om synktjenesten er nede.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { requireOrganizationAccess, type Actor } from "@/core/access";
import { db } from "@/db/client";
import { trialForms, trialPhotos } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { requireTrialField } from "./apply-changes";
import { trialNameSchema } from "./change-schema";
import {
  InvalidTrialChangeError,
  TrialPhotoNotFoundError,
  TrialPhotoTooLargeError,
} from "./errors";
import {
  TRIAL_PHOTO_DEFAULT_MAX_BYTES,
  type StoreTrialPhoto,
  type StoreTrialPhotoResult,
  type TrialPhotoMeta,
} from "./types";

const DEFAULT_UPLOAD_DIR = "var/uploads/trial";

/** Mappen bildene lagres i, som absolutt sti. Leses ved hvert kall. */
export function trialUploadDir(): string {
  const configured = process.env.TRIAL_UPLOAD_DIR?.trim();
  return path.resolve(configured ? configured : DEFAULT_UPLOAD_DIR);
}

/** Største tillatte fil i byte. Leses ved hvert kall; ugyldig verdi gir standarden (25 MB). */
export function trialPhotoMaxBytes(): number {
  const configured = Number(process.env.TRIAL_PHOTO_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured > 0
    ? configured
    : TRIAL_PHOTO_DEFAULT_MAX_BYTES;
}

/**
 * Leser kroppen i bilderuten, men aldri mer enn `maxBytes` inn i minnet (småfunn 8). Et for stort
 * `Content-Length` avvises før noe leses; ellers stoppes lesingen straks grensen passeres.
 * Kaster `TrialPhotoTooLargeError` (413).
 */
export async function readTrialPhotoBody(
  request: Request,
  maxBytes: number = trialPhotoMaxBytes(),
): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new TrialPhotoTooLargeError();
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TrialPhotoTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export const storeTrialPhoto: StoreTrialPhoto = async (
  actor: Actor,
  organizationId: string,
  photoId: string,
  meta: TrialPhotoMeta,
  bytes: Uint8Array,
): Promise<StoreTrialPhotoResult> => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  // Id-en sjekkes før noen sti bygges (ingen «../»)
  if (!isUuid(photoId)) throw new TrialPhotoNotFoundError();
  if (typeof meta.contentType !== "string" || !meta.contentType.startsWith("image/")) {
    throw new InvalidTrialChangeError("Filen er ikke et bilde.");
  }
  if (bytes.byteLength > trialPhotoMaxBytes()) throw new TrialPhotoTooLargeError();

  const [foreign] = await db
    .select({ id: trialPhotos.id })
    .from(trialPhotos)
    .where(and(eq(trialPhotos.id, photoId), ne(trialPhotos.organizationId, grant.organizationId)))
    .limit(1);
  if (foreign) throw new TrialPhotoNotFoundError();

  const [existing] = await db
    .select({ id: trialPhotos.id })
    .from(trialPhotos)
    .where(and(eq(trialPhotos.id, photoId), eq(trialPhotos.organizationId, grant.organizationId)))
    .limit(1);
  if (!existing) {
    if (!isUuid(meta.trialFormId)) throw new InvalidTrialChangeError("Testskjemaet finnes ikke.");
    requireTrialField(meta.fieldKey);
    const name = trialNameSchema.safeParse(meta.name);
    if (!name.success) throw new InvalidTrialChangeError(name.error.issues[0]!.message);
    const [form] = await db
      .select({ id: trialForms.id })
      .from(trialForms)
      .where(
        and(
          eq(trialForms.id, meta.trialFormId),
          eq(trialForms.organizationId, grant.organizationId),
        ),
      )
      .limit(1);
    if (!form) throw new InvalidTrialChangeError("Testskjemaet finnes ikke.");
    const sizeBytes =
      Number.isSafeInteger(meta.sizeBytes) && meta.sizeBytes >= 0
        ? meta.sizeBytes
        : bytes.byteLength;
    await db
      .insert(trialPhotos)
      .values({
        id: photoId,
        organizationId: grant.organizationId,
        trialFormId: meta.trialFormId,
        fieldKey: meta.fieldKey,
        name: meta.name,
        sizeBytes,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      // Synken kan ha laget raden i mellomtiden; da gjelder den
      .onConflictDoNothing({ target: trialPhotos.id });
  }

  const root = trialUploadDir();
  const filePath = path.resolve(root, grant.organizationId, photoId);
  if (!filePath.startsWith(root + path.sep)) throw new TrialPhotoNotFoundError();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await db
    .update(trialPhotos)
    .set({ sha256, storagePath: filePath, uploadedAt: new Date(), updatedBy: actor.id })
    .where(and(eq(trialPhotos.id, photoId), eq(trialPhotos.organizationId, grant.organizationId)));
  return { sha256 };
};
