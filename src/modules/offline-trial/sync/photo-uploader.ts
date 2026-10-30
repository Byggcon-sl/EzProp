/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Bildekøen (oppgavekortet pkt. 22). Kjører i siden, ikke i service workeren: mens appen er åpen
 * og nettet finnes, sendes bilder uten `uploaded_at` fra denne enheten ett om gangen. Den lokale
 * filen slettes bare når serveren svarte 200 og fingeravtrykket er likt (`shouldReleaseLocalPhoto`).
 * Alt annet: filen blir liggende og prøves igjen på neste runde.
 *
 * Kandidatuavhengig: bruker bare `listPendingPhotos`, `markPhotoUploaded` og `onStatusChange`
 * fra `TrialSyncStore`. `markPhotoUploaded` skriver bare lokalt, aldri i endringskøen, og aldri
 * `uploaded_at` (den setter bare serveren).
 *
 * Prøve D: før originalen sendes, lages visningskopien (`display-copy.ts`) og lagres lokalt under
 * `displayCopyKey(id)`. Etter originalene i samme runde sendes kopiene til visningsruten. Likt
 * fingeravtrykk eller 400 sletter kopien lokalt; alt annet gir nytt forsøk neste runde. Kopien
 * stopper aldri originalen.
 */
import { isUuid } from "@/shared/lib/uuid";
import { shouldReleaseLocalPhoto } from "./photo-upload";
import { makeDisplayCopy } from "./display-copy";
import {
  deleteLocalPhoto,
  displayCopyKey,
  getLocalPhoto,
  listLocalDisplayCopyIds,
  putLocalPhoto,
} from "./photo-store";
import type { PhotoUploadResponse, TrialPhotoRow, TrialSyncStore } from "./types";

export const PHOTO_UPLOAD_INTERVAL_MS = 10_000;

/**
 * Tidsavbrudd per opplasting: 30 sekunder pluss tid for filen på et svakt nett (ca. 25 kB/s).
 * Uten dette står køen fast for godt hvis én forespørsel aldri svarer (svakt nett på befaring).
 */
const PHOTO_UPLOAD_BASE_TIMEOUT_MS = 30_000;
const PHOTO_UPLOAD_SLOW_BYTES_PER_SECOND = 25_000;

export function photoUploadTimeoutMs(bytes: number): number {
  const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  return (
    PHOTO_UPLOAD_BASE_TIMEOUT_MS + Math.ceil((size / PHOTO_UPLOAD_SLOW_BYTES_PER_SECOND) * 1000)
  );
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Adressen for visningskopien. Bare organisasjonen står i spørrestrengen. */
export function displayCopyUrl(organizationId: string, photoId: string): string {
  return `/api/prove/bilder/${photoId}/visning?${new URLSearchParams({ organisasjon: organizationId })}`;
}

function originalUrl(organizationId: string, photo: TrialPhotoRow, blob: Blob): string {
  const params = new URLSearchParams({
    organisasjon: organizationId,
    skjema: photo.trialFormId,
    felt: photo.fieldKey,
    navn: photo.name,
    bytes: String(blob.size),
  });
  return `/api/prove/bilder/${photo.id}?${params}`;
}

/**
 * Sender ett bilde. Uten `url` går det til originalruten; med `url` (visningskopien) brukes den.
 * Gir `undefined` ved nettfeil eller tidsavbrudd (filen blir liggende).
 */
export async function sendPhoto(
  organizationId: string,
  photo: TrialPhotoRow,
  blob: Blob,
  url?: string,
): Promise<PhotoUploadResponse | undefined> {
  const target = url ?? originalUrl(organizationId, photo, blob);
  const contentType =
    url !== undefined ? "image/jpeg" : blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), photoUploadTimeoutMs(blob.size));
  try {
    const response = await fetch(target, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": contentType },
      body: blob,
      signal: controller.signal,
    });
    let body: PhotoUploadResponse["body"];
    try {
      body = (await response.json()) as PhotoUploadResponse["body"];
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}

/** Lager og lagrer visningskopien hvis den ikke finnes. Feil hopper bare over kopien. */
async function ensureDisplayCopy(photoId: string, original: Blob): Promise<void> {
  try {
    if (await getLocalPhoto(displayCopyKey(photoId))) return;
    const copy = await makeDisplayCopy(original);
    if (!copy) return;
    await putLocalPhoto(displayCopyKey(photoId), copy);
  } catch {
    console.warn("Bildekø: visningskopien ble ikke laget. Originalen sendes likevel.");
  }
}

/** Sender visningskopiene som ligger på enheten. Teller ikke med i svaret fra runden. */
async function uploadDisplayCopies(organizationId: string): Promise<void> {
  const ids = await listLocalDisplayCopyIds();
  for (const id of ids) {
    if (isOffline()) break;
    if (!isUuid(id)) continue;
    const key = displayCopyKey(id);
    const copy = await getLocalPhoto(key);
    if (!copy) continue;
    const localSha = await sha256Hex(copy);
    // Kopien trenger bare id-en fra raden; resten av adressen er visningsruten.
    const response = await sendPhoto(
      organizationId,
      { id } as TrialPhotoRow,
      copy,
      displayCopyUrl(organizationId, id),
    );
    if (shouldReleaseLocalPhoto(localSha, response) || response?.status === 400) {
      // 400: serveren avviser kopien; originalen er sannheten, så den prøves ikke igjen.
      await deleteLocalPhoto(key);
    }
  }
}

/**
 * Én runde gjennom køen: originalene først, så visningskopiene. Gir antall originaler som ble
 * bekreftet av serveren (kopiene telles ikke).
 */
export async function uploadPendingPhotos(
  store: TrialSyncStore,
  organizationId: string,
): Promise<number> {
  const pending = await store.listPendingPhotos();
  let released = 0;
  for (const photo of pending) {
    if (isOffline()) break;
    if (!isUuid(photo.id)) continue;
    const blob = await getLocalPhoto(photo.id);
    if (!blob) continue;
    await ensureDisplayCopy(photo.id, blob);
    const localSha = await sha256Hex(blob);
    const response = await sendPhoto(organizationId, photo, blob);
    if (!shouldReleaseLocalPhoto(localSha, response)) continue;
    // Sletter filen og merker bildet bekreftet lokalt (`confirmLocalPhoto`); aldri `uploaded_at`.
    await store.markPhotoUploaded(photo.id, localSha);
    released++;
  }
  await uploadDisplayCopies(organizationId);
  return released;
}

/**
 * Starter opplasteren: ved `online`, ved statusvarsel fra lageret og hvert 10. sekund. Bare én
 * runde om gangen. Returnerer stopp.
 */
export function startPhotoUploader(store: TrialSyncStore, organizationId: string): () => void {
  let running = false;
  let again = false;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await uploadPendingPhotos(store, organizationId);
      } while (again && !stopped);
    } catch {
      console.warn("Bildekø: runden feilet. Prøver igjen senere.");
    } finally {
      running = false;
    }
  }

  const onOnline = () => void tick();
  window.addEventListener("online", onOnline);
  const interval = setInterval(() => void tick(), PHOTO_UPLOAD_INTERVAL_MS);
  const disposeStatus = store.onStatusChange(() => void tick());
  void tick();

  return () => {
    stopped = true;
    window.removeEventListener("online", onOnline);
    clearInterval(interval);
    disposeStatus();
  };
}
