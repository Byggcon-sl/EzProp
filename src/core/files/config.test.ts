import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFileStorage, FileStorageConfigError } from "@/core/files";

// Testplan: docs/funksjoner/fase0b-filtjeneste-testplan.md, avsnitt 3.
// `createFileStorage` får et eget env-objekt; `process.env` endres ikke i denne filen.

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "filtjeneste-config-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmp, { recursive: true, force: true });
});

function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

describe("createFileStorage", () => {
  it("1. standard er lokal adapter, og ingenting skrives i var/files", () => {
    const varFiles = path.resolve("var/files");
    const existedBefore = existsSync(varFiles);
    const storage = createFileStorage({});
    expect(storage).toHaveProperty("driver", "local");
    expect(existsSync(varFiles)).toBe(existedBefore);
  });

  it("1. FILE_STORAGE_DRIVER=local gir også lokal adapter", () => {
    const storage = createFileStorage({ FILE_STORAGE_DRIVER: "local", FILE_STORAGE_DIR: tmp });
    expect(storage).toHaveProperty("driver", "local");
  });

  it("2. FILE_STORAGE_DIR brukes: filen havner under mappen", async () => {
    const storage = createFileStorage({ FILE_STORAGE_DIR: tmp });
    await storage.put("org/photo/a", new Uint8Array([1, 2, 3]), "image/jpeg");
    expect(existsSync(path.join(tmp, "org", "photo", "a"))).toBe(true);
    expect((await readdir(tmp, { recursive: true })).map(String).sort()).toEqual([
      "org",
      path.join("org", "photo"),
      path.join("org", "photo", "a"),
    ]);
    expect(Array.from(await storage.get("org/photo/a"))).toEqual([1, 2, 3]);
  });

  it("3. azure uten tilkoblingsstreng gir FileStorageConfigError som nevner variabelen", () => {
    const error = thrownBy(() =>
      createFileStorage({ FILE_STORAGE_DRIVER: "azure", FILE_STORAGE_AZURE_CONTAINER: "bilder" }),
    );
    expect(error).toBeInstanceOf(FileStorageConfigError);
    expect((error as Error).message).toContain("FILE_STORAGE_AZURE_CONNECTION_STRING");
  });

  it("4. azure uten container nevner variabelen, men aldri verdien av tilkoblingsstrengen", () => {
    const error = thrownBy(() =>
      createFileStorage({
        FILE_STORAGE_DRIVER: "azure",
        FILE_STORAGE_AZURE_CONNECTION_STRING: "hemmelig-test-verdi",
      }),
    );
    expect(error).toBeInstanceOf(FileStorageConfigError);
    expect((error as Error).message).toContain("FILE_STORAGE_AZURE_CONTAINER");
    expect((error as Error).message).not.toContain("hemmelig-test-verdi");
    expect(String(error)).not.toContain("hemmelig-test-verdi");
  });

  it.each(["s3", "tull"])(
    "5. ukjent driver (%s) gir FileStorageConfigError, ingen stille fallback",
    (driver) => {
      const error = thrownBy(() =>
        createFileStorage({ FILE_STORAGE_DRIVER: driver, FILE_STORAGE_DIR: tmp }),
      );
      expect(error).toBeInstanceOf(FileStorageConfigError);
      expect((error as Error).message).toContain("FILE_STORAGE_DRIVER");
    },
  );

  it("6. azure med begge innstillingene gir Azure-adapteren uten nettkall", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    // Oppdiktet og ugyldig konto; klienten kobler ikke til før første put eller get
    const storage = createFileStorage({
      FILE_STORAGE_DRIVER: "azure",
      FILE_STORAGE_AZURE_CONNECTION_STRING:
        "DefaultEndpointsProtocol=https;AccountName=oppdiktet;AccountKey=b3BwZGlrdGV0;EndpointSuffix=core.windows.net",
      FILE_STORAGE_AZURE_CONTAINER: "filer",
    });
    const put = vi.spyOn(storage, "put");
    const get = vi.spyOn(storage, "get");

    expect(storage).toHaveProperty("driver", "azure");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
