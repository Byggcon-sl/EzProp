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
