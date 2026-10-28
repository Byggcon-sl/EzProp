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
    if (typeof meta.name !== "string") throw new InvalidTrialChangeError();
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
