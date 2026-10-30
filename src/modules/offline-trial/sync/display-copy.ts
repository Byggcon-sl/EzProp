/**
 * Prøve fase 1, kastes eller gjøres om etter ADR.
 *
 * Visningskopien på iPaden (prøve D, beslutning A8 i docs/09-apne-sporsmal.md): lengste side høyst
 * 2000 punkter, JPEG med kvalitet 0,8, rettet etter retningen kameraet har lagret. Tegnes på et
 * canvas, så kopien får aldri EXIF eller GPS (A7). Bare det nettleseren har (`createImageBitmap`
 * og canvas), ingen avhengighet. Originalen røres aldri.
 */

export const DISPLAY_MAX_EDGE_PX = 2000;
export const DISPLAY_JPEG_QUALITY = 0.8;

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * Målene for kopien: lengste side høyst `maxEdge`, samme forhold, aldri forstørret, hele tall og
 * aldri under 1. Gir `null` for ugyldige mål.
 */
export function displaySize(
  width: number,
  height: number,
  maxEdge: number = DISPLAY_MAX_EDGE_PX,
): { width: number; height: number } | null {
  if (!isPositiveFinite(width) || !isPositiveFinite(height) || !isPositiveFinite(maxEdge)) {
    return null;
  }
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function drawToJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Mangler canvas.");
  context.drawImage(bitmap, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Kunne ikke lage JPEG."))),
      "image/jpeg",
      DISPLAY_JPEG_QUALITY,
    );
  });
}

function hasCanvas(): boolean {
  return typeof document !== "undefined" && typeof document.createElement === "function";
}

/**
 * Lager visningskopien. Kaster aldri: klarer nettleseren ikke å dekode filen (for eksempel HEIC i
 * Chromium), gir den `null`, og originalen lastes opp som vanlig. Logger bare feilnavnet, aldri
 * filnavn eller noe fra filen.
 */
export async function makeDisplayCopy(original: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    // Canvas sjekkes etter dekodingen, så en fil som ikke kan dekodes alltid gir samme logg.
    if (!hasCanvas()) return null;
    const size = displaySize(bitmap.width, bitmap.height);
    if (!size) return null;
    return await drawToJpeg(bitmap, size.width, size.height);
  } catch (error) {
    const name = error instanceof Error || error instanceof DOMException ? error.name : "Error";
    console.warn("Visningskopi: kunne ikke lage kopi.", name);
    return null;
  } finally {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}
