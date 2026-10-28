import { describe, expect, it } from "vitest";
import { shouldReleaseLocalPhoto } from "./photo-upload";
import type { PhotoUploadResponse } from "./types";

// Ingenting går tapt: den lokale bildefilen slettes bare når serveren har bekreftet nøyaktig
// samme fingeravtrykk (docs/funksjoner/fase1-kandidat-powersync.md pkt. 22). Testplan avsnitt 2.4.

const SHA = "a3f1c2d4e5b6a7980123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_SHA = "b3f1c2d4e5b6a7980123456789abcdef0123456789abcdef0123456789abcdef";

describe("shouldReleaseLocalPhoto", () => {
  it("fingeravtrykkene i testen er 64 hex-tegn", () => {
    expect(SHA).toMatch(/^[0-9a-f]{64}$/);
    expect(OTHER_SHA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("lik sha256 og status 200 gir slipp", () => {
    expect(shouldReleaseLocalPhoto(SHA, { status: 200, body: { sha256: SHA } })).toBe(true);
  });

  it("ulik sha256 gir behold", () => {
    expect(shouldReleaseLocalPhoto(SHA, { status: 200, body: { sha256: OTHER_SHA } })).toBe(false);
  });

  it("status 201, 400, 404, 500 gir behold selv om sha er lik", () => {
    for (const status of [201, 204, 400, 404, 409, 413, 500, 503]) {
      expect(shouldReleaseLocalPhoto(SHA, { status, body: { sha256: SHA } }), String(status)).toBe(
        false,
      );
    }
  });

  it("manglende svar gir behold", () => {
    expect(shouldReleaseLocalPhoto(SHA, undefined)).toBe(false);
    expect(shouldReleaseLocalPhoto(SHA, null as unknown as PhotoUploadResponse)).toBe(false);
    // Nettverksfeil: opplasteren har ikke noe svar å gi videre
    let response: PhotoUploadResponse | undefined;
    try {
      throw new TypeError("Failed to fetch");
    } catch {
      response = undefined;
    }
    expect(shouldReleaseLocalPhoto(SHA, response)).toBe(false);
    expect(shouldReleaseLocalPhoto(SHA, { status: 200 })).toBe(false);
  });

  it("tom eller manglende sha256 i svaret gir behold", () => {
    expect(shouldReleaseLocalPhoto(SHA, { status: 200, body: { sha256: "" } })).toBe(false);
    expect(shouldReleaseLocalPhoto(SHA, { status: 200, body: {} })).toBe(false);
    // Tomt lokalt fingeravtrykk skal heller aldri gi slipp
    expect(shouldReleaseLocalPhoto("", { status: 200, body: { sha256: "" } })).toBe(false);
  });

  it("sammenligningen skiller store og små bokstaver ikke, men krever 64 hex-tegn", () => {
    expect(shouldReleaseLocalPhoto(SHA, { status: 200, body: { sha256: SHA.toUpperCase() } })).toBe(
      true,
    );
    expect(shouldReleaseLocalPhoto(SHA.toUpperCase(), { status: 200, body: { sha256: SHA } })).toBe(
      true,
    );
    const short = SHA.slice(0, 63);
    expect(shouldReleaseLocalPhoto(short, { status: 200, body: { sha256: short } })).toBe(false);
    const notHex = "z".repeat(64);
    expect(shouldReleaseLocalPhoto(notHex, { status: 200, body: { sha256: notHex } })).toBe(false);
  });
});
