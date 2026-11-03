import { describe, expect, it } from "vitest";
import {
  FileAlreadyExistsError,
  FileNotFoundError,
  FileStorageError,
  FileValidationError,
} from "@/core/files";
import { createAzureFileStorage } from "./azure-storage";
import { formatLogLine } from "@/shared/lib/logger";

// Testplan: docs/funksjoner/fase0b-filtjeneste-testplan.md, avsnitt 2.
// Ingen nett: adapteren får en falsk klient som lagrer i et Map. `@azure/storage-blob`
// importeres ikke her. Hemmelighetene under er oppdiktet.

type ContainerClientParam = Parameters<typeof createAzureFileStorage>[0];

type UploadCall = {
  name: string;
  contentType: string | undefined;
  ifNoneMatch: string | undefined;
};

type FakeOptions = {
  blobHTTPHeaders?: { blobContentType?: string };
  conditions?: { ifNoneMatch?: string };
};

/**
 * Falsk container-klient. Skriver over med mindre kallet har `conditions.ifNoneMatch === "*"`;
 * da kaster den en feil med `statusCode: 409` når navnet finnes. Slik viser testene at
 * adapteren faktisk sender betingelsen.
 */
function createFakeContainerClient(failWith?: () => unknown) {
  const blobs = new Map<string, { bytes: Uint8Array; contentType: string | undefined }>();
  const uploads: UploadCall[] = [];

  const client = {
    getBlockBlobClient(name: string) {
      return {
        async uploadData(data: Uint8Array, options?: FakeOptions) {
          const contentType = options?.blobHTTPHeaders?.blobContentType;
          const ifNoneMatch = options?.conditions?.ifNoneMatch;
          uploads.push({ name, contentType, ifNoneMatch });
          if (failWith) throw failWith();
          if (ifNoneMatch === "*" && blobs.has(name)) {
            throw Object.assign(new Error("The specified blob already exists."), {
              statusCode: 409,
              code: "BlobAlreadyExists",
            });
          }
          blobs.set(name, { bytes: new Uint8Array(data), contentType });
          return {};
        },
        async downloadToBuffer() {
          if (failWith) throw failWith();
          const blob = blobs.get(name);
          if (!blob) {
            throw Object.assign(new Error("The specified blob does not exist."), {
              statusCode: 404,
              code: "BlobNotFound",
            });
          }
          return Buffer.from(blob.bytes);
        },
      };
    },
  };

  return { client: client as unknown as ContainerClientParam, blobs, uploads };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe("Azure-adapter med falsk klient", () => {
  it("1. rundtur: get gir samme byte, og innholdstypen sendes med", async () => {
    const fake = createFakeContainerClient();
    const storage = createAzureFileStorage(fake.client);
    await storage.put("org/photo/a", bytes(0xff, 0xd8, 0x00, 0x7f), "image/jpeg");
    const read = await storage.get("org/photo/a");
    expect(Array.from(read)).toEqual([0xff, 0xd8, 0x00, 0x7f]);
    expect(read instanceof Uint8Array).toBe(true);
    expect(fake.blobs.get("org/photo/a")?.contentType).toBe("image/jpeg");
  });

  it("2. skriver aldri over: andre put gir FileAlreadyExistsError, første innhold står", async () => {
    const fake = createFakeContainerClient();
    const storage = createAzureFileStorage(fake.client);
    await storage.put("org/photo/a", bytes(1, 2, 3), "image/jpeg");
    expect(await caught(storage.put("org/photo/a", bytes(9, 9), "image/png"))).toBeInstanceOf(
      FileAlreadyExistsError,
    );
    expect(Array.from(fake.blobs.get("org/photo/a")!.bytes)).toEqual([1, 2, 3]);
    expect(Array.from(await storage.get("org/photo/a"))).toEqual([1, 2, 3]);
  });

  it('3. betingelsen ifNoneMatch: "*" sendes på hver opplasting', async () => {
    const fake = createFakeContainerClient();
    const storage = createAzureFileStorage(fake.client);
    await storage.put("org/photo/a", bytes(1), "image/jpeg");
    await storage.put("org/report_pdf/b", bytes(2), "application/pdf");
    await caught(storage.put("org/photo/a", bytes(3), "image/jpeg"));
    expect(fake.uploads).toHaveLength(3);
    for (const upload of fake.uploads) expect(upload.ifNoneMatch).toBe("*");
  });

  describe("4. feil fra Azure pakkes inn uten hemmeligheter", () => {
    const secretMessage = "AccountKey=fiktivNokkel==; sig=abc123";

    function expectWrapped(error: unknown, original: Error) {
      expect(error).toBeInstanceOf(FileStorageError);
      const wrapped = error as Error;
      const logged = JSON.stringify(formatLogLine("error", "test", { error: wrapped }));
      for (const text of [wrapped.message, String(wrapped), logged]) {
        expect(text).not.toContain("fiktivNokkel");
        expect(text).not.toContain("abc123");
      }
      expect(wrapped.cause).not.toBe(original);
    }

    it("ved put", async () => {
      const original = new Error(secretMessage);
      const storage = createAzureFileStorage(createFakeContainerClient(() => original).client);
      expectWrapped(await caught(storage.put("org/photo/a", bytes(1), "image/jpeg")), original);
    });

    it("ved get", async () => {
      const original = new Error(secretMessage);
      const storage = createAzureFileStorage(createFakeContainerClient(() => original).client);
      expectWrapped(await caught(storage.get("org/photo/a")), original);
    });
  });

  it("5. ukjent nøkkel ved get gir FileNotFoundError", async () => {
    const storage = createAzureFileStorage(createFakeContainerClient().client);
    expect(await caught(storage.get("org/photo/finnes-ikke"))).toBeInstanceOf(FileNotFoundError);
  });

  // Resten av nøkkelfasiten står i local-storage.test.ts 4; her vises bare at kontrollen kjører
  // før klienten
  it("6. ugyldig nøkkel ../x avvises før klienten kalles", async () => {
    const key = "../x";
    const fake = createFakeContainerClient();
    const calls: string[] = [];
    const client = {
      getBlockBlobClient(name: string) {
        calls.push(name);
        return (
          fake.client as unknown as { getBlockBlobClient(n: string): unknown }
        ).getBlockBlobClient(name);
      },
    } as unknown as ContainerClientParam;
    const storage = createAzureFileStorage(client);

    expect(await caught(storage.put(key, bytes(1), "image/jpeg"))).toBeInstanceOf(
      FileValidationError,
    );
    expect(await caught(storage.get(key))).toBeInstanceOf(FileValidationError);
    expect(calls).toEqual([]);
    expect(fake.uploads).toEqual([]);
  });
});
