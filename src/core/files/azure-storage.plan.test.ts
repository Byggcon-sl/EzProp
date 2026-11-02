import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { FileAlreadyExistsError, FileStorageError } from "@/core/files";
import { formatLogLine } from "@/shared/lib/logger";
import { createAzureFileStorage } from "./azure-storage";

// Testplan docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 2. Ingen nett: klienten er
// falsk og lagrer i et Map. `@azure/storage-blob` importeres ikke her (punkt 5).

type UploadOptions = {
  blobHTTPHeaders?: { blobContentType?: string };
  conditions?: { ifNoneMatch?: string };
};

type Upload = { key: string; contentType: string | undefined; ifNoneMatch: string | undefined };

function statusError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

/**
 * Falsk container-klient. Skriver over med mindre opplastingen har `ifNoneMatch: "*"`; da gir den
 * 409 når blob-en finnes (som Azure). Støtter `uploadData`/`upload` og
 * `downloadToBuffer`/`download`, så testen ikke låser hvilken metode adapteren bruker.
 */
function fakeContainer(options: { failWith?: Error } = {}) {
  const blobs = new Map<string, { bytes: Buffer; contentType: string | undefined }>();
  const uploads: Upload[] = [];

  const blob = (key: string) => {
    const store = (data: Uint8Array, opts: UploadOptions = {}) => {
      if (options.failWith) throw options.failWith;
      uploads.push({
        key,
        contentType: opts.blobHTTPHeaders?.blobContentType,
        ifNoneMatch: opts.conditions?.ifNoneMatch,
      });
      if (opts.conditions?.ifNoneMatch === "*" && blobs.has(key)) {
        throw statusError(409, "The specified blob already exists.");
      }
      blobs.set(key, {
        bytes: Buffer.from(data),
        contentType: opts.blobHTTPHeaders?.blobContentType,
      });
      return { etag: "fiktiv" };
    };
    const fetch = () => {
      if (options.failWith) throw options.failWith;
      const found = blobs.get(key);
      if (!found) throw statusError(404, "The specified blob does not exist.");
      return found.bytes;
    };
    return {
      uploadData: async (data: Uint8Array, opts?: UploadOptions) => store(data, opts),
      upload: async (data: Uint8Array, _length: number, opts?: UploadOptions) => store(data, opts),
      downloadToBuffer: async () => Buffer.from(fetch()),
      download: async () => ({ readableStreamBody: Readable.from([Buffer.from(fetch())]) }),
    };
  };

  const client = { getBlockBlobClient: blob, getBlobClient: blob };
  return {
    client: client as unknown as Parameters<typeof createAzureFileStorage>[0],
    blobs,
    uploads,
  };
}

const bytesOf = (text: string) => new TextEncoder().encode(text);
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe("Azure-adapter med falsk klient", () => {
  it("1. rundtur: put og get gir samme byte, og innholdstypen sendes med", async () => {
    const fake = fakeContainer();
    const storage = createAzureFileStorage(fake.client);
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    await storage.put("org/report_pdf/a", bytes, "application/pdf");
    expect(same(await storage.get("org/report_pdf/a"), bytes)).toBe(true);
    expect(fake.blobs.get("org/report_pdf/a")?.contentType).toBe("application/pdf");
  });

  it("2. skriver aldri over: andre put gir FileAlreadyExistsError, første innhold står", async () => {
    const fake = fakeContainer();
    const storage = createAzureFileStorage(fake.client);
    await storage.put("org/photo/a", bytesOf("første"), "image/jpeg");
    await expect(storage.put("org/photo/a", bytesOf("andre"), "image/jpeg")).rejects.toThrow(
      FileAlreadyExistsError,
    );
    expect(same(fake.blobs.get("org/photo/a")!.bytes, bytesOf("første"))).toBe(true);
    expect(same(await storage.get("org/photo/a"), bytesOf("første"))).toBe(true);
  });

  it('3. hver opplasting sender betingelsen ifNoneMatch: "*"', async () => {
    const fake = fakeContainer();
    const storage = createAzureFileStorage(fake.client);
    await storage.put("org/photo/a", bytesOf("a"), "image/jpeg");
    await storage.put("org/photo/b", bytesOf("b"), "image/png");
    await storage.put("org/photo/a", bytesOf("c"), "image/jpeg").catch(() => undefined);
    expect(fake.uploads).toHaveLength(3);
    for (const upload of fake.uploads) expect(upload.ifNoneMatch).toBe("*");
  });

  it.each(["put", "get"] as const)(
    "4. feil fra klienten ved %s pakkes inn i FileStorageError uten nøkkel eller signatur",
    async (operation) => {
      const original = new Error("AccountKey=fiktivNokkel==; sig=abc123");
      const fake = fakeContainer({ failWith: original });
      const storage = createAzureFileStorage(fake.client);
      const call =
        operation === "put"
          ? storage.put("org/photo/a", bytesOf("a"), "image/jpeg")
          : storage.get("org/photo/a");
      const error = await call.then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(FileStorageError);
      const err = error as Error & { cause?: unknown };
      expect(err).not.toBe(original);
      expect(err.cause).not.toBe(original);
      const texts = [
        err.message,
        String(err),
        JSON.stringify(formatLogLine("error", "test", { error: err })),
      ];
      for (const text of texts) {
        expect(text).not.toContain("fiktivNokkel");
        expect(text).not.toContain("abc123");
      }
    },
  );
});
