/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Bildekøen (oppgavekortet pkt. 22). Kjører i siden, ikke i service workeren: mens appen er åpen
 * og nettet finnes, sendes bilder uten `uploaded_at` fra denne enheten ett om gangen. Den lokale
 * filen slettes bare når serveren svarte 200 og fingeravtrykket er likt (`shouldReleaseLocalPhoto`).
 * Alt annet: filen blir liggende og prøves igjen på neste runde.
 *
 * Kandidatuavhengig: bruker bare `listPendingPhotos`, `markPhotoUploaded` og `onStatusChange`
 * fra `TrialSyncStore`. `markPhotoUploaded` skriver bare lokalt, aldri i endringskøen.
 */
import { isUuid } from "@/shared/lib/uuid";
import { shouldReleaseLocalPhoto } from "./photo-upload";
import { deleteLocalPhoto, getLocalPhoto } from "./photo-store";
import type { PhotoUploadResponse, TrialPhotoRow, TrialSyncStore } from "./types";

export const PHOTO_UPLOAD_INTERVAL_MS = 10_000;

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function send(
  organizationId: string,
  photo: TrialPhotoRow,
  blob: Blob,
): Promise<PhotoUploadResponse | undefined> {
  const params = new URLSearchParams({
    organisasjon: organizationId,
    skjema: photo.trialFormId,
    felt: photo.fieldKey,
    navn: photo.name,
    bytes: String(blob.size),
  });
  try {
    const response = await fetch(`/api/prove/bilder/${photo.id}?${params}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": blob.type.startsWith("image/") ? blob.type : "image/jpeg" },
      body: blob,
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
  }
}

/** Én runde gjennom køen. Gir antall bilder som ble bekreftet av serveren. */
export async function uploadPendingPhotos(
  store: TrialSyncStore,
  organizationId: string,
): Promise<number> {
  const pending = await store.listPendingPhotos();
  let released = 0;
  for (const photo of pending) {
    if (typeof navigator !== "undefined" && !navigator.onLine) break;
    if (!isUuid(photo.id)) continue;
    const blob = await getLocalPhoto(photo.id);
    if (!blob) continue;
    const localSha = await sha256Hex(blob);
    const response = await send(organizationId, photo, blob);
    if (!shouldReleaseLocalPhoto(localSha, response)) continue;
    await store.markPhotoUploaded(photo.id, localSha);
    await deleteLocalPhoto(photo.id);
    released++;
  }
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
