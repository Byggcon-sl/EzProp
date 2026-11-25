/*
 * Bildesjekken (A12, ADR 0016). Ren funksjon uten avhengigheter, brukt av prøven med bilder
 * (`src/modules/offline-trial`), PDF-gjengivelsen (`src/core/pdf`) og senere filmodulen.
 *
 * Formatet kjennes på innholdet, aldri på filnavn eller oppgitt type. Bare en liste over lovlige
 * felt slipper gjennom; alt annet (EXIF med posisjon, XMP, IPTC, kommentarer, tekstfelt) avvises,
 * fordi det kan ha posisjon, navn eller takstmannens notater.
 *
 * Støtter hovedmål: færre reklamasjoner (ingen skjulte opplysninger i rapporten kunden får).
 */

export type CheckedImageFormat = "jpeg" | "png";

export type ImageCheckResult =
  | { ok: true; format: CheckedImageFormat; widthPx: number; heightPx: number }
  | { ok: false; reason: "unknown_format" | "metadata" | "corrupt" };

/**
 * Merker som er lov i JPEG før `FF DA`: APP0 (JFIF), APP2 (ICC-fargeprofil), APP14
 * (Adobe-fargeinfo), `C0`–`CF` (bildeoppsett og tabeller), `DB` (DQT) og `DD` (DRI). TEM og
 * RST0–RST7 har ikke lengdefelt og håndteres for seg.
 */
export function isAllowedJpegMarker(marker: number): boolean {
  if (marker === 0xe0 || marker === 0xe2 || marker === 0xee) return true;
  if (marker >= 0xc0 && marker <= 0xcf) return true;
  return marker === 0xdb || marker === 0xdd;
}

/** Bildeoppsettet (SOFn): `C0`–`CF` unntatt DHT (`C4`), JPG (`C8`) og DAC (`CC`). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

type JpegScan = { metadata: boolean; widthPx: number | null; heightPx: number | null };

/**
 * Går gjennom merkene fra `FF D8` fram til `FF DA` (starten på bildedataene) og ser ikke lenger.
 * Indeksen øker i hver runde, så funksjonen henger aldri. Ødelagt fil regnes som metadata.
 */
function scanJpeg(bytes: Uint8Array): JpegScan {
  const reject: JpegScan = { metadata: true, widthPx: null, heightPx: null };
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return reject;
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  let index = 2;
  while (index < bytes.length) {
    if (bytes[index] !== 0xff) return reject;
    // Fyllbytes FF foran merket hoppes over
    while (index < bytes.length && bytes[index] === 0xff) index += 1;
    if (index >= bytes.length) return reject;
    const marker = bytes[index]!;
    index += 1;
    if (marker === 0xda) return { metadata: false, widthPx, heightPx };
    // Merker uten lengdefelt (TEM og RST0–RST7)
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // Alt som ikke står på listen avvises, også nye start- og sluttmerker og 00
    if (!isAllowedJpegMarker(marker)) return reject;
    if (index + 1 >= bytes.length) return reject;
    const length = (bytes[index]! << 8) | bytes[index + 1]!;
    if (length < 2 || index + length > bytes.length) return reject;
    if (isStartOfFrame(marker) && length >= 7) {
      heightPx = (bytes[index + 3]! << 8) | bytes[index + 4]!;
      widthPx = (bytes[index + 5]! << 8) | bytes[index + 6]!;
    }
    index += length;
  }
  return reject;
}

/**
 * Sjekker om en JPEG har felt som ikke er lov. `true` betyr avvis. Bare merkene i
 * `isAllowedJpegMarker` (og TEM, RST0–RST7) slipper gjennom. Alt annet avvises, blant annet APP1
 * (EXIF, XMP), APP3–APP13 (blant annet IPTC), APP15, COM (kommentar), JPGn (`F0`–`FD`), `DE` og
 * `DF`. APP2 (ICC-fargeprofil) kan ha korte tekstfelt som beskrivelse og opphavsrett, men ikke
 * posisjon eller notater. En ødelagt fil gir også `true`.
 */
export function hasMetadataSegment(bytes: Uint8Array): boolean {
  return scanJpeg(bytes).metadata;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * Felt (chunks) som er lov i PNG: bildet, paletten, gjennomsiktighet og fargeinformasjon. Alt
 * annet avvises, blant annet `eXIf` (EXIF), `tEXt`, `zTXt` og `iTXt` (tekst, XMP, IPTC,
 * kommentar), `tIME` og animasjon (`acTL`, `fcTL`, `fdAT`).
 */
export const PNG_ALLOWED_CHUNKS: ReadonlySet<string> = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "cHRM",
  "gAMA",
  "iCCP",
  "sBIT",
  "sRGB",
  "cICP",
  "bKGD",
  "pHYs",
]);

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!
  );
}

type PngScan = { metadata: boolean; widthPx: number | null; heightPx: number | null };

/** Går gjennom feltene til `IEND`. Ødelagt fil regnes som metadata. Henger aldri. */
function scanPng(bytes: Uint8Array): PngScan {
  const reject: PngScan = { metadata: true, widthPx: null, heightPx: null };
  if (!hasPngSignature(bytes)) return reject;
  let widthPx: number | null = null;
  let heightPx: number | null = null;
  let index = 8;
  let first = true;
  while (index + 12 <= bytes.length) {
    const length = readUint32(bytes, index);
    const type = String.fromCharCode(
      bytes[index + 4]!,
      bytes[index + 5]!,
      bytes[index + 6]!,
      bytes[index + 7]!,
    );
    const end = index + 12 + length;
    if (end > bytes.length) return reject;
    if (!PNG_ALLOWED_CHUNKS.has(type)) return reject;
    if (first) {
      if (type !== "IHDR" || length !== 13) return reject;
      widthPx = readUint32(bytes, index + 8);
      heightPx = readUint32(bytes, index + 12);
      first = false;
    }
    if (type === "IEND") return { metadata: false, widthPx, heightPx };
    index = end;
  }
  return reject;
}

/** `true` betyr avvis: PNG med felt utenfor `PNG_ALLOWED_CHUNKS`, eller ødelagt fil. */
export function hasPngMetadata(bytes: Uint8Array): boolean {
  return scanPng(bytes).metadata;
}

/** Formatet kjent på de første bytene, aldri på navnet. */
export function detectImageFormat(bytes: Uint8Array): CheckedImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (hasPngSignature(bytes)) return "png";
  return null;
}

/**
 * Hele sjekken: formatet på innholdet, ingen metadata, og målene fra filen. Kaster aldri.
 */
export function checkImage(bytes: Uint8Array): ImageCheckResult {
  const format = detectImageFormat(bytes);
  if (!format) return { ok: false, reason: "unknown_format" };
  const scan = format === "jpeg" ? scanJpeg(bytes) : scanPng(bytes);
  if (scan.metadata) return { ok: false, reason: "metadata" };
  if (!scan.widthPx || !scan.heightPx) return { ok: false, reason: "corrupt" };
  return { ok: true, format, widthPx: scan.widthPx, heightPx: scan.heightPx };
}
