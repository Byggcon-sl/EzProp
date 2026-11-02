import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalFileStorage,
  FileAlreadyExistsError,
  FileNotFoundError,
  FileStorageError,
  FileValidationError,
  isInsideRoot,
} from "@/core/files";

// Testplan: docs/funksjoner/fase0b-filtjeneste-testplan.md, avsnitt 1.
// Fasiten (ugyldige nøkler, stier) er skrevet inn her og hentes ikke fra koden.

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "filtjeneste-lokal-"));
  // Roten er en undermappe som ikke finnes ennå
  root = path.join(tmp, "rot");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const bytes = (...values: number[]) => new Uint8Array(values);

/** Alle stier under `dir`, relativt til `dir`, sortert. */
async function listAll(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true });
  return entries.map(String).sort();
}

/** Venter på løftet og gir feilen (eller null hvis det lyktes). */
async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("lokal adapter", () => {
  it("1. rundtur: get gir nøyaktig samme byte som put", async () => {
    const storage = createLocalFileStorage(root);
    await storage.put("org/photo/a", bytes(0xff, 0xd8, 0xff, 0x00, 0x01, 0xfe), "image/jpeg");
    const read = await storage.get("org/photo/a");
    expect(Array.from(read)).toEqual([0xff, 0xd8, 0xff, 0x00, 0x01, 0xfe]);
  });

  it("2. lager mappen selv ved første put", async () => {
    const storage = createLocalFileStorage(root);
    expect(existsSync(root)).toBe(false);
    await storage.put("org/photo/a", bytes(1, 2, 3), "image/jpeg");
    expect(existsSync(root)).toBe(true);
    expect(existsSync(path.join(root, "org", "photo", "a"))).toBe(true);
  });

  it("3. skriver aldri over: andre put gir FileAlreadyExistsError, første innhold står", async () => {
    const storage = createLocalFileStorage(root);
    await storage.put("org/photo/a", bytes(1, 2, 3), "image/jpeg");
    expect(
      await caught(storage.put("org/photo/a", bytes(9, 9, 9, 9), "image/jpeg")),
    ).toBeInstanceOf(FileAlreadyExistsError);
    expect(Array.from(await storage.get("org/photo/a"))).toEqual([1, 2, 3]);
  });

  describe("4. ugyldige nøkler avvises", () => {
    const invalidKeys = [
      "../x",
      "a/../../x",
      "a/..",
      "/etc/passwd",
      "a//b",
      "/a",
      "a/",
      "",
      "a\\b",
    ];

    function expectRejectedByAdapter(error: unknown) {
      expect(error).not.toBeNull();
      // Avvist av adapteren selv, ikke en rå feil fra filsystemet (den har stien i meldingen)
      expect(
        error instanceof FileValidationError ||
          error instanceof FileNotFoundError ||
          error instanceof FileStorageError,
      ).toBe(true);
    }

    it.each(invalidKeys)("put med %j avvises og lager ingen fil utenfor roten", async (key) => {
      const storage = createLocalFileStorage(root);
      // Én gyldig fil først, slik at roten finnes
      await storage.put("org/photo/ok", bytes(1), "image/jpeg");
      const parentBefore = await listAll(tmp);

      expectRejectedByAdapter(await caught(storage.put(key, bytes(6, 6, 6), "image/jpeg")));

      // Foreldremappen til roten (og roten) er uendret: ingen fil skrevet noe sted
      expect(await listAll(tmp)).toEqual(parentBefore);
    });

    it.each(invalidKeys)("get med %j avvises", async (key) => {
      const storage = createLocalFileStorage(root);
      await storage.put("org/photo/ok", bytes(1), "image/jpeg");
      expectRejectedByAdapter(await caught(storage.get(key)));
    });
  });

  describe("5. isInsideRoot", () => {
    it.each([
      { root: "/tmp/rot", target: "/tmp/rot/a/b", expected: true },
      { root: "/tmp/rot", target: "/tmp/rot", expected: false },
      // Søskenmappe med samme begynnelse: grunnen til at sjekken bruker root + path.sep
      { root: "/tmp/rot", target: "/tmp/rotte/a", expected: false },
      { root: "/tmp/rot", target: "/tmp/a", expected: false },
    ])("($root, $target) gir $expected", ({ root: rootDir, target, expected }) => {
      expect(isInsideRoot(rootDir, target)).toBe(expected);
    });
  });

  it("6. ukjent nøkkel ved get gir FileNotFoundError uten rot eller nøkkel i meldingen", async () => {
    const storage = createLocalFileStorage(root);
    await storage.put("org/photo/finnes", bytes(1), "image/jpeg");
    const key = "org/photo/finnes-ikke";
    const error = await caught(storage.get(key));
    expect(error).toBeInstanceOf(FileNotFoundError);
    for (const text of [(error as Error).message, String(error)]) {
      expect(text).not.toContain(tmp);
      expect(text).not.toContain(root);
      expect(text).not.toContain(key);
      expect(text).not.toContain("finnes-ikke");
    }
  });
});
