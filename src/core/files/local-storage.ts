import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FileAlreadyExistsError, FileNotFoundError, FileStorageError } from "./errors";
import { assertValidStorageKey, type FileStorage } from "./storage";

/**
 * Sann bare hvis `resolvedPath` ligger under `root` (ikke roten selv, og ikke en søskenmappe
 * med samme begynnelse, som `/tmp/rotte` for roten `/tmp/rot`).
 */
export function isInsideRoot(root: string, resolvedPath: string): boolean {
  const normalizedRoot = path.resolve(root);
  const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return path.resolve(resolvedPath).startsWith(prefix);
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

/**
 * Adapter for en lokal mappe (utvikling og test). Mappen lages ved første skriving. Nøkkelen
 * kan ikke gå ut av mappen, og en fil skrives aldri over (flagget `wx`). Ingen sletting.
 */
export function createLocalFileStorage(rootDir: string): FileStorage {
  const root = path.resolve(rootDir);

  function resolveKey(storageKey: string): string {
    assertValidStorageKey(storageKey);
    const target = path.resolve(root, storageKey);
    // Ekstra forsvar i tillegg til nøkkelkontrollen
    if (!isInsideRoot(root, target)) throw new FileNotFoundError();
    return target;
  }

  return {
    driver: "local",

    async put(storageKey, bytes) {
      const target = resolveKey(storageKey);
      try {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: "wx" });
      } catch (error) {
        if (errorCode(error) === "EEXIST") throw new FileAlreadyExistsError();
        // Feilen fra filsystemet har stien i meldingen, så den sendes ikke videre
        throw new FileStorageError();
      }
    },

    async get(storageKey) {
      const target = resolveKey(storageKey);
      try {
        const buffer = await readFile(target);
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
          throw new FileNotFoundError();
        }
        throw new FileStorageError();
      }
    },
  };
}
