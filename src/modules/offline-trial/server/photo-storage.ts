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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNull, ne } from "drizzle-orm";
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
    .select({ id: trialPhotos.id, deletedAt: trialPhotos.deletedAt })
    .from(trialPhotos)
    .where(and(eq(trialPhotos.id, photoId), eq(trialPhotos.organizationId, grant.organizationId)))
    .limit(1);
  // Et slettet bilde tar ikke imot ny fil; filen og raden røres ikke (myk sletting)
  if (existing?.deletedAt) throw new TrialPhotoNotFoundError();
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
    .where(
      and(
        eq(trialPhotos.id, photoId),
        eq(trialPhotos.organizationId, grant.organizationId),
        isNull(trialPhotos.deletedAt),
      ),
    );
  return { sha256 };
};

/** Den eneste typen visningskopien kan ha. Parametre (`image/jpeg; charset=x`) godtas ikke. */
const DISPLAY_COPY_CONTENT_TYPE = "image/jpeg";

/**
 * Merker som er lov før `FF DA`: APP0 (JFIF), APP2 (ICC-fargeprofil), APP14 (Adobe-fargeinfo),
 * `C0`–`CF` (bildeoppsett og tabeller), `DB` (DQT) og `DD` (DRI). TEM og RST0–RST7 har ikke
 * lengdefelt og håndteres for seg.
 */
function isAllowedMarker(marker: number): boolean {
  if (marker === 0xe0 || marker === 0xe2 || marker === 0xee) return true;
  if (marker >= 0xc0 && marker <= 0xcf) return true;
  return marker === 0xdb || marker === 0xdd;
}

/**
 * Sjekker om en JPEG har felt som ikke er lov i visningskopien. `true` betyr avvis.
 * Går gjennom merkene fra `FF D8` fram til `FF DA` (starten på bildedataene) og ser ikke lenger.
 * Bare en liste over lovlige merker slipper gjennom (`isAllowedMarker`, TEM og RST0–RST7). Alt
 * annet avvises, blant annet APP1 (EXIF, XMP), APP3–APP13 (blant annet IPTC), APP15, COM
 * (kommentar), JPGn (`F0`–`FD`), `DE` og `DF`. APP2 (ICC-fargeprofil) kan ha korte tekstfelt som
 * beskrivelse og opphavsrett, men ikke posisjon eller takstmannens notater; Chromium skriver bare
 * en standard sRGB-profil. En ødelagt fil gir også `true`. Indeksen øker i hver runde, så
 * funksjonen henger aldri.
 */
export function hasMetadataSegment(bytes: Uint8Array): boolean {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return true;
  let index = 2;
  while (index < bytes.length) {
    if (bytes[index] !== 0xff) return true;
    // Fyllbytes FF foran merket hoppes over
    while (index < bytes.length && bytes[index] === 0xff) index += 1;
    if (index >= bytes.length) return true;
    const marker = bytes[index]!;
    index += 1;
    if (marker === 0xda) return false;
    // Merker uten lengdefelt (TEM og RST0–RST7)
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // Alt som ikke står på listen avvises, også nye start- og sluttmerker og 00
    if (!isAllowedMarker(marker)) return true;
    if (index + 1 >= bytes.length) return true;
    const length = (bytes[index]! << 8) | bytes[index + 1]!;
    if (length < 2 || index + length > bytes.length) return true;
    index += length;
  }
  return true;
}

/**
 * Krever at bildet finnes i organisasjonen og ikke er slettet. Med `requireOriginal` må også
 * originalen være mottatt (`sha256` og `uploaded_at`). Alle tilfellene gir samme feil.
 */
async function requireTrialPhotoRow(
  organizationId: string,
  photoId: string,
  requireOriginal: boolean,
): Promise<void> {
  const [row] = await db
    .select({
      sha256: trialPhotos.sha256,
      uploadedAt: trialPhotos.uploadedAt,
      deletedAt: trialPhotos.deletedAt,
    })
    .from(trialPhotos)
    .where(and(eq(trialPhotos.id, photoId), eq(trialPhotos.organizationId, organizationId)))
    .limit(1);
  if (!row || row.deletedAt) throw new TrialPhotoNotFoundError();
  if (requireOriginal && (!row.sha256 || !row.uploadedAt)) throw new TrialPhotoNotFoundError();
}

/** Stien til visningskopien, bygget fra organisasjonen i tilgangssjekken. */
function displayCopyPath(organizationId: string, photoId: string): string {
  const root = trialUploadDir();
  const filePath = path.resolve(root, organizationId, `${photoId}.display.jpg`);
  if (!filePath.startsWith(root + path.sep)) throw new TrialPhotoNotFoundError();
  return filePath;
}

/**
 * Lagrer visningskopien (JPEG laget på iPaden, med bare de lovlige feltene i `hasMetadataSegment`)
 * ved siden av originalen, som
 * `TRIAL_UPLOAD_DIR/<organizationId>/<photoId>.display.jpg`. Originalen må være mottatt først.
 * En ny kopi overskriver den gamle. Raden i `trial_photos` endres ikke. Svaret er SHA-256 av kopien.
 */
export async function storeTrialDisplayCopy(
  actor: Actor,
  organizationId: string,
  photoId: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<{ sha256: string }> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  // Id-en sjekkes før noen sti bygges (ingen «../»)
  if (!isUuid(photoId)) throw new TrialPhotoNotFoundError();
  if (contentType !== DISPLAY_COPY_CONTENT_TYPE) {
    throw new InvalidTrialChangeError("Visningskopien må være JPEG.");
  }
  if (bytes.byteLength > trialPhotoMaxBytes()) throw new TrialPhotoTooLargeError();
  if (hasMetadataSegment(bytes)) {
    throw new InvalidTrialChangeError("Visningskopien er ikke en gyldig JPEG uten metadata.");
  }
  await requireTrialPhotoRow(grant.organizationId, photoId, true);

  const filePath = displayCopyPath(grant.organizationId, photoId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  return { sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * Leser visningskopien. Ukjent, fremmed eller slettet bilde, eller ingen kopi, gir
 * `TrialPhotoNotFoundError`.
 */
export async function readTrialDisplayCopy(
  actor: Actor,
  organizationId: string,
  photoId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  if (!isUuid(photoId)) throw new TrialPhotoNotFoundError();
  await requireTrialPhotoRow(grant.organizationId, photoId, false);

  const filePath = displayCopyPath(grant.organizationId, photoId);
  try {
    return new Uint8Array(await readFile(filePath));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TrialPhotoNotFoundError();
    throw error;
  }
}
