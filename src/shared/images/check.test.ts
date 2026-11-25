import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP0,
  APP1_EXIF,
  APP1_XMP,
  APP13,
  APP2,
  DHT,
  DQT,
  SOF0,
  cleanDisplayCopy,
  jpeg,
  segment,
} from "../../../tests/jpeg-bytes";
import { pngBytes } from "../../../tests/pdf-fixtures";
import {
  PNG_ALLOWED_CHUNKS,
  checkImage,
  detectImageFormat,
  hasMetadataSegment,
  hasPngMetadata,
  isAllowedJpegMarker,
} from "./index";

/*
 * Bildesjekken (testplanen 3.4). Ren, uten database. Støtter hovedmål: færre reklamasjoner (ingen
 * posisjon, navn eller notater i bildene i rapporten).
 */

const ascii = (text: string) => new TextEncoder().encode(text);
const repoRoot = join(__dirname, "..", "..", "..");

describe("3.4.1 formatet kjennes på innholdet", () => {
  it("JPEG og PNG godtas med målene fra filen", () => {
    expect(checkImage(jpeg(APP0, DQT, SOF0, DHT))).toEqual({
      ok: true,
      format: "jpeg",
      widthPx: 1,
      heightPx: 1,
    });
    expect(checkImage(pngBytes(16, 9))).toEqual({
      ok: true,
      format: "png",
      widthPx: 16,
      heightPx: 9,
    });
  });

  it.each([
    ["GIF", ascii("GIF89a\u0001\u0000\u0001\u0000")],
    ["WebP", ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")],
    ["SVG", ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ["HTML med .jpg-navn", ascii("<html><body>x</body></html>")],
    ["tomme byte", new Uint8Array(0)],
  ])("%s avvises med fast kode", (_name, bytes) => {
    expect(detectImageFormat(bytes)).toBeNull();
    expect(checkImage(bytes)).toEqual({ ok: false, reason: "unknown_format" });
  });

  it("JPEG uten bildeoppsett (SOF) har ingen mål og avvises", () => {
    expect(checkImage(jpeg(APP0))).toEqual({ ok: false, reason: "corrupt" });
  });
});

describe("3.4.2 JPEG med metadata avvises", () => {
  it.each([
    ["EXIF med GPS (APP1)", jpeg(APP0, APP1_EXIF, SOF0)],
    ["XMP (APP1)", jpeg(APP0, APP1_XMP, SOF0)],
    ["IPTC (APP13)", jpeg(APP0, APP13, SOF0)],
    ["kommentarfelt (COM)", jpeg(APP0, segment(0xfe, [...ascii("notat")]), SOF0)],
  ])("%s", (_name, bytes) => {
    expect(hasMetadataSegment(bytes)).toBe(true);
    expect(checkImage(bytes)).toEqual({ ok: false, reason: "metadata" });
  });

  it("ICC-fargeprofil (APP2) er lov", () => {
    expect(checkImage(jpeg(APP0, APP2, SOF0)).ok).toBe(true);
  });

  it("tillatt-listen: APP0, APP2, APP14, C0–CF, DB og DD", () => {
    const allowed = Array.from({ length: 256 }, (_, marker) => marker).filter(isAllowedJpegMarker);
    expect(allowed).toEqual([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce,
      0xcf, 0xdb, 0xdd, 0xe0, 0xe2, 0xee,
    ]);
  });
});

describe("3.4.3 PNG med metadata avvises", () => {
  it.each([
    ["eXIf", { type: "eXIf", data: ascii("MM\u0000*GPS") }],
    ["tEXt med kommentar", { type: "tEXt", data: ascii("Comment\u0000notat") }],
    [
      "iTXt med XMP",
      { type: "iTXt", data: ascii("XML:com.adobe.xmp\u0000\u0000\u0000\u0000\u0000<x:xmpmeta/>") },
    ],
    ["zTXt", { type: "zTXt", data: ascii("Comment\u0000\u0000x") }],
    ["tIME", { type: "tIME", data: new Uint8Array(7) }],
    ["animasjon (acTL)", { type: "acTL", data: new Uint8Array(8) }],
  ])("%s", (_name, chunk) => {
    const bytes = pngBytes(4, 4, [chunk]);
    expect(hasPngMetadata(bytes)).toBe(true);
    expect(checkImage(bytes)).toEqual({ ok: false, reason: "metadata" });
  });

  it("fargeinformasjon (sRGB, gAMA, pHYs) er lov", () => {
    const bytes = pngBytes(4, 4, [
      { type: "sRGB", data: new Uint8Array([0]) },
      { type: "gAMA", data: new Uint8Array([0, 0, 0xb1, 0x8f]) },
      { type: "pHYs", data: new Uint8Array(9) },
    ]);
    expect(checkImage(bytes).ok).toBe(true);
  });

  it("ødelagt PNG (feil lengde, uten IEND, IHDR ikke først) avvises", () => {
    const good = pngBytes(4, 4);
    expect(hasPngMetadata(good.subarray(0, good.length - 12))).toBe(true);
    const broken = new Uint8Array(good);
    broken[11] = 0xff; // lengden på IHDR
    expect(hasPngMetadata(broken)).toBe(true);
    const noHeader = pngBytes(4, 4, [{ type: "sRGB", data: new Uint8Array([0]) }]);
    // Bytt om IHDR og sRGB: IHDR er ikke lenger først.
    const swapped = new Uint8Array([
      ...noHeader.subarray(0, 8),
      ...noHeader.subarray(33, 46),
      ...noHeader.subarray(8, 33),
      ...noHeader.subarray(46),
    ]);
    expect(hasPngMetadata(swapped)).toBe(true);
  });

  it("listen over lovlige felt har ingen tekst- eller EXIF-felt", () => {
    for (const type of ["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]) {
      expect(PNG_ALLOWED_CHUNKS.has(type)).toBe(false);
    }
  });
});

describe("3.4.4 og 3.4.5 visningskopien og felles sjekk", () => {
  it("ren visningskopi godtas av metadatasjekken", () => {
    expect(hasMetadataSegment(cleanDisplayCopy())).toBe(false);
  });

  it("prøven bruker sjekken herfra, og har ingen egen kopi av tillatt-listen", () => {
    const source = readFileSync(
      join(repoRoot, "src/modules/offline-trial/server/photo-storage.ts"),
      "utf8",
    );
    expect(source).toContain('from "@/shared/images"');
    expect(source).not.toMatch(/function isAllowedMarker|function hasMetadataSegment/);
  });

  it("henger aldri på tilfeldige byte", { timeout: 2000 }, () => {
    let seed = 7;
    for (let round = 0; round < 200; round += 1) {
      const bytes = new Uint8Array(64).map(() => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed & 0xff;
      });
      bytes[0] = round % 2 === 0 ? 0xff : 0x89;
      bytes[1] = round % 2 === 0 ? 0xd8 : 0x50;
      expect(() => checkImage(bytes)).not.toThrow();
    }
  });
});
