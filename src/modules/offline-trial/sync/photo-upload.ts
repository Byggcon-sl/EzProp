/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Når kan iPaden gi slipp på en bildefil (oppgavekortet pkt. 22)? Bare når serveren svarte 200
 * og fingeravtrykket (SHA-256) er likt det som ble regnet lokalt. Alt annet gir «behold».
 */
import type { PhotoUploadResponse } from "./types";

const SHA256_HEX = /^[0-9a-f]{64}$/i;

export function shouldReleaseLocalPhoto(
  localSha256: string,
  response: PhotoUploadResponse | undefined | null,
): boolean {
  if (!response || response.status !== 200) return false;
  const remote = response.body?.sha256;
  if (typeof remote !== "string") return false;
  if (!SHA256_HEX.test(localSha256) || !SHA256_HEX.test(remote)) return false;
  return localSha256.toLowerCase() === remote.toLowerCase();
}

/** Det `isPhotoWaiting` trenger fra en `trial_photos`-rad (snake_case som lokalt). */
export interface PhotoWaitingRow {
  id?: unknown;
  uploaded_at?: unknown;
  device_id?: unknown;
  deleted_at?: unknown;
}

/**
 * Venter bildet på opplasting fra denne enheten? Ja når serveren ikke har satt `uploaded_at`,
 * raden er fra denne enheten og ikke slettet, og serveren ikke allerede har bekreftet filen
 * (`confirmedIds` fra `photo-store.ts`). Enheten skriver aldri `uploaded_at` selv (småfunn 6).
 */
export function isPhotoWaiting(
  row: PhotoWaitingRow,
  deviceId: string,
  confirmedIds: ReadonlySet<string>,
): boolean {
  return (
    row.uploaded_at == null &&
    row.device_id === deviceId &&
    row.deleted_at == null &&
    typeof row.id === "string" &&
    !confirmedIds.has(row.id)
  );
}
