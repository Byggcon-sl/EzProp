import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileAlreadyExistsError, FileNotFoundError, FileStorageError } from "@/core/files";
import { createLocalFileStorage, isInsideRoot } from "./local-storage";

// Testplan docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 1. Bare midlertidig mappe,
// aldri var/files. Innholdet er oppdiktede byte.

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ezprop-local-storage-"));
  root = join(tmp, "rot");
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const bytesOf = (text: string) => new TextEncoder().encode(text);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe("lokal adapter", () => {
  it("1. rundtur: put og get gir nøyaktig samme byte", async () => {
    const storage = createLocalFileStorage(root);
    const bytes = Uint8Array.from([0xff, 0xd8, 0x00, 0x01, 0x7f, 0x80, 0xff, 0xd9]);
    await storage.put("org/photo/a", bytes, "image/jpeg");
    expect(same(await storage.get("org/photo/a"), bytes)).toBe(true);
  });

  it("2. lager mappen selv ved første put", async () => {
    const deepRoot = join(tmp, "ny", "rot");
    expect(existsSync(deepRoot)).toBe(false);
    const storage = createLocalFileStorage(deepRoot);
    await storage.put("org/photo/a", bytesOf("første"), "image/jpeg");
    expect(existsSync(deepRoot)).toBe(true);
    expect(existsSync(join(deepRoot, "org", "photo", "a"))).toBe(true);
  });

  it("3. skriver aldri over: andre put på samme nøkkel gir FileAlreadyExistsError", async () => {
    const storage = createLocalFileStorage(root);
    await storage.put("org/photo/a", bytesOf("første innhold"), "image/jpeg");
    await expect(
      storage.put("org/photo/a", bytesOf("andre innhold"), "image/jpeg"),
    ).rejects.toThrow(FileAlreadyExistsError);
    expect(same(await storage.get("org/photo/a"), bytesOf("første innhold"))).toBe(true);
  });

  // Fasit skrevet inn her, ikke hentet fra koden.
  it.each(["../x", "a/../../x", "a/..", "/etc/passwd", "a//b", "/a", "a/", "", "a\\b"])(
    "4. ugyldig nøkkel %j avvises av både put og get, og ingenting skrives utenfor roten",
    async (key) => {
      const storage = createLocalFileStorage(root);
      // Lager roten med en gyldig fil, så foreldremappen har et kjent innhold
      await storage.put("org/photo/gyldig", bytesOf("gyldig"), "image/jpeg");
      const parentBefore = (await readdir(tmp)).sort();
      const rootBefore = (await readdir(root, { recursive: true })).sort();

      await expect(storage.put(key, bytesOf("ondsinnet"), "image/jpeg")).rejects.toThrow();
      await expect(storage.get(key)).rejects.toThrow();

      expect((await readdir(tmp)).sort()).toEqual(parentBefore);
      expect((await readdir(root, { recursive: true })).sort()).toEqual(rootBefore);
      expect(existsSync(join(tmp, "x"))).toBe(false);
    },
  );

  it("5. isInsideRoot krever en sti under roten (med path.sep, ikke søskenmappe)", () => {
    expect(isInsideRoot("/tmp/rot", "/tmp/rot/a/b")).toBe(true);
    expect(isInsideRoot("/tmp/rot", "/tmp/rot")).toBe(false);
    expect(isInsideRoot("/tmp/rot", "/tmp/rotte/a")).toBe(false);
    expect(isInsideRoot("/tmp/rot", "/tmp/a")).toBe(false);
  });

  it("6. ukjent nøkkel ved get gir feil uten rot eller nøkkel i meldingen", async () => {
    const storage = createLocalFileStorage(root);
    await storage.put("org/photo/finnes", bytesOf("x"), "image/jpeg");
    const key = "org/photo/ukjent-nokkel-123";
    const error = await storage.get(key).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).not.toBeNull();
    expect(error instanceof FileNotFoundError || error instanceof FileStorageError).toBe(true);
    const text = `${(error as Error).message} ${String(error)}`;
    expect(text).not.toContain(root);
    expect(text).not.toContain(tmp);
    expect(text).not.toContain("ukjent-nokkel-123");
  });
});
