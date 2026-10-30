/**
 * Små JPEG-byte for testene av visningskopien (prøve D, docs/funksjoner/fase1-prove-d-bilder-
 * testplan.md avsnitt 2.2). Bygges i testen, ingen fixtur og ingen ekte bilder. Innholdet i
 * feltene er oppdiktet; bare merkene og lengdene betyr noe.
 */

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

/** Ett felt: `FF <merke>`, lengde (to byte, regnet med seg selv) og innholdet. */
export function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

export const APP0 = segment(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const APP2 = segment(0xe2, [...ascii("ICC_PROFILE"), 0, 1, 1, 0x10, 0x20, 0x30]);
export const DQT = segment(0xdb, [0x00, ...new Array<number>(8).fill(0x10)]);
export const SOF0 = segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]);
export const DHT = segment(0xc4, [0x00, 1, ...new Array<number>(15).fill(0), 0x05]);
/** EXIF med et oppdiktet GPS-felt (0,0). */
export const APP1_EXIF = segment(0xe1, [
  ...ascii("Exif"),
  0,
  0,
  ...ascii("MM"),
  0,
  0x2a,
  ...ascii("GPS 0/1,0/1,0/1 N"),
]);
export const APP1_XMP = segment(0xe1, [
  ...ascii("http://ns.adobe.com/xap/1.0/"),
  0,
  ...ascii("<x:xmpmeta/>"),
]);
export const APP13 = segment(0xed, [...ascii("Photoshop 3.0"), 0, ...ascii("8BIM")]);

/** Start på bildedataene (`FF DA`) med et kort hode. */
export const SOS = segment(0xda, [1, 1, 0, 0, 0x3f, 0]);

/** `FF D8`, feltene, `FF DA`, noen bytes bildedata og `FF D9`. */
export function jpeg(...segments: number[][]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), ...SOS, 0x12, 0x34, 0x56, 0xff, 0xd9]);
}

/** Som `jpeg`, men med egne bytes i bildedataene etter `FF DA`. */
export function jpegWithScan(segments: number[][], scan: number[]): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, ...segments.flat(), ...SOS, ...scan, 0xff, 0xd9]);
}

/** En gyldig visningskopi uten metadata (bare `APP0`). */
export function cleanDisplayCopy(extra: number[] = []): Uint8Array {
  return jpegWithScan([APP0], [0x12, 0x34, 0x56, ...extra]);
}

/** Tekst som bytes (for å vise at innhold aldri havner i loggen). */
export function textBytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}
