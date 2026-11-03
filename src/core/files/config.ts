import { createAzureFileStorageFromConnectionString } from "./azure-storage";
import { FileStorageConfigError } from "./errors";
import { createLocalFileStorage } from "./local-storage";
import type { FileStorage } from "./storage";

const DEFAULT_FILE_STORAGE_DIR = "var/files";

/**
 * Velger adapter ut fra miljøvariablene (A40, til tilkoblingslaget kommer):
 * - `FILE_STORAGE_DRIVER` tom eller `local`: lokal mappe `FILE_STORAGE_DIR` (standard `var/files`)
 * - `azure`: krever `FILE_STORAGE_AZURE_CONNECTION_STRING` og `FILE_STORAGE_AZURE_CONTAINER`
 * - alt annet: feil (ingen stille fallback)
 *
 * Feilmeldingene nevner variabelnavnet, aldri verdien. Ingen mellomlagring og ingen nettkall.
 */
export function createFileStorage(env: Record<string, string | undefined>): FileStorage {
  const driver = env.FILE_STORAGE_DRIVER?.trim() ?? "";

  if (driver === "" || driver === "local") {
    return createLocalFileStorage(env.FILE_STORAGE_DIR?.trim() || DEFAULT_FILE_STORAGE_DIR);
  }

  if (driver === "azure") {
    const connectionString = env.FILE_STORAGE_AZURE_CONNECTION_STRING?.trim();
    if (!connectionString) {
      throw new FileStorageConfigError(
        "FILE_STORAGE_AZURE_CONNECTION_STRING må være satt når FILE_STORAGE_DRIVER er azure.",
      );
    }
    const container = env.FILE_STORAGE_AZURE_CONTAINER?.trim();
    if (!container) {
      throw new FileStorageConfigError(
        "FILE_STORAGE_AZURE_CONTAINER må være satt når FILE_STORAGE_DRIVER er azure.",
      );
    }
    return createAzureFileStorageFromConnectionString(connectionString, container);
  }

  throw new FileStorageConfigError("FILE_STORAGE_DRIVER må være local eller azure.");
}
