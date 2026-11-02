import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileStorage, FileStorageConfigError } from "@/core/files";

// Testplan docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 3. `createFileStorage` får et
// eget env-objekt; process.env endres ikke. Ingen skriving i var/files.

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ezprop-file-config-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function configError(env: Record<string, string | undefined>): Error {
  try {
    createFileStorage(env);
  } catch (error) {
    return error as Error;
  }
  throw new Error("createFileStorage kastet ikke");
}

describe("createFileStorage", () => {
  it("1. standard er lokal adapter", () => {
    const storage = createFileStorage({}) as unknown as { driver?: unknown };
    expect(storage.driver).toBe("local");
  });

  it("2. FILE_STORAGE_DIR brukes som rot for den lokale adapteren", async () => {
    const storage = createFileStorage({ FILE_STORAGE_DIR: tmp });
    await storage.put("org/photo/a", new TextEncoder().encode("oppdiktet"), "image/jpeg");
    expect(existsSync(join(tmp, "org", "photo", "a"))).toBe(true);
  });

  it("3. azure uten tilkoblingsstreng kaster og nevner variabelnavnet", () => {
    const error = configError({ FILE_STORAGE_DRIVER: "azure", FILE_STORAGE_AZURE_CONTAINER: "c" });
    expect(error).toBeInstanceOf(FileStorageConfigError);
    expect(error.message).toContain("FILE_STORAGE_AZURE_CONNECTION_STRING");
  });

  it("4. azure uten container kaster, nevner variabelnavnet og aldri verdien", () => {
    const error = configError({
      FILE_STORAGE_DRIVER: "azure",
      FILE_STORAGE_AZURE_CONNECTION_STRING: "hemmelig-test-verdi",
    });
    expect(error).toBeInstanceOf(FileStorageConfigError);
    expect(error.message).toContain("FILE_STORAGE_AZURE_CONTAINER");
    expect(error.message).not.toContain("hemmelig-test-verdi");
    expect(String(error)).not.toContain("hemmelig-test-verdi");
  });

  it("5. ukjent driver gir feil i stedet for å falle tilbake stille", () => {
    const error = configError({ FILE_STORAGE_DRIVER: "s3", FILE_STORAGE_DIR: tmp });
    expect(error).toBeInstanceOf(FileStorageConfigError);
    expect(error.message).toContain("FILE_STORAGE_DRIVER");
  });
});
