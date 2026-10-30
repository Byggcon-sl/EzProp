import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DISPLAY_JPEG_QUALITY,
  DISPLAY_MAX_EDGE_PX,
  displaySize,
  makeDisplayCopy,
} from "./display-copy";

// Prøve D – bilder: visningskopien på iPaden (docs/funksjoner/fase1-prove-d-bilder.md pkt. 1,
// A8). Testplan avsnitt 2.1. Skaleringen er en teknisk regel, testet som data (tabell). Selve
// tegningen (canvas, JPEG, rotering) testes i e2e, der det finnes en ekte nettleser.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** [bredde, høyde] inn → [bredde, høyde] ut, med lengste side 2000. */
const SIZE_CASES: ReadonlyArray<[number, number, number, number]> = [
  [4032, 3024, 2000, 1500],
  [3024, 4032, 1500, 2000],
  [3000, 1000, 2000, 667],
  [1000, 3000, 667, 2000],
  [4000, 4000, 2000, 2000],
  [2000, 1500, 2000, 1500], // nøyaktig grensen
  [2001, 1, 2000, 1], // aldri 0
  [64, 64, 64, 64], // ikke forstørret
  [1, 1, 1, 1],
];

describe("displaySize", () => {
  it("konstantene er 2000 punkter og kvalitet 0,8", () => {
    // Endres de, må testen endres bevisst (A8)
    expect(DISPLAY_MAX_EDGE_PX).toBe(2000);
    expect(DISPLAY_JPEG_QUALITY).toBe(0.8);
  });

  // Obligatorisk
  it.each(SIZE_CASES)(
    "displaySize følger lengste side på 2000 (%ix%i → %ix%i)",
    (width, height, expectedWidth, expectedHeight) => {
      expect(displaySize(width, height)).toEqual({
        width: expectedWidth,
        height: expectedHeight,
      });
    },
  );

  it.each([
    [0, 100, undefined],
    [100, 0, undefined],
    [-1, 100, undefined],
    [Number.NaN, 100, undefined],
    [100, Number.POSITIVE_INFINITY, undefined],
    [100, 100, 0],
  ] as const)("displaySize gir null for ugyldige mål (%s, %s, maxEdge %s)", (w, h, maxEdge) => {
    expect(displaySize(w, h, maxEdge)).toBeNull();
  });

  it("displaySize gir alltid hele tall", () => {
    for (const [width, height] of SIZE_CASES) {
      const size = displaySize(width, height);
      expect(size, `${width}x${height}`).not.toBeNull();
      expect(Number.isInteger(size!.width), `${width}x${height} bredde`).toBe(true);
      expect(Number.isInteger(size!.height), `${width}x${height} høyde`).toBe(true);
    }
  });
});

describe("makeDisplayCopy", () => {
  // Obligatorisk (loggregelen: aldri filnavn eller innhold i loggen)
  it("makeDisplayCopy gir null og logger bare feilnavnet når dekoding feiler", async () => {
    vi.stubGlobal("createImageBitmap", () =>
      Promise.reject(
        new DOMException("oppdiktet-bilde-7391.heic kan ikke leses", "InvalidStateError"),
      ),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const blob = new File(["oppdiktet-bilde-7391"], "oppdiktet-bilde-7391.heic", {
      type: "image/heic",
    });

    await expect(makeDisplayCopy(blob)).resolves.toBeNull();

    const calls = [...warn.mock.calls, ...error.mock.calls];
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls)).toContain("InvalidStateError");
    const everything = [...calls, ...log.mock.calls, ...info.mock.calls];
    expect(JSON.stringify(everything)).not.toContain("oppdiktet-bilde-7391");
    // Feilobjektet selv sendes ikke til loggen (meldingen har filnavnet)
    for (const args of everything) {
      for (const arg of args)
        expect(arg instanceof Error || arg instanceof DOMException).toBe(false);
    }
  });

  it("makeDisplayCopy gir null når nettleseren mangler createImageBitmap eller canvas", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    await expect(makeDisplayCopy(blob)).resolves.toBeNull();
  });

  it("makeDisplayCopy ber om retning fra bildet", async () => {
    const decode = vi.fn((_image: unknown, _options?: unknown) =>
      Promise.reject(new DOMException("x", "InvalidStateError")),
    );
    vi.stubGlobal("createImageBitmap", decode);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

    await makeDisplayCopy(blob);

    expect(decode).toHaveBeenCalled();
    expect(decode.mock.calls[0]![0]).toBe(blob);
    expect(decode.mock.calls[0]![1]).toMatchObject({ imageOrientation: "from-image" });
  });
});
