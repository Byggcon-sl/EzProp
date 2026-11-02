import { ContainerClient } from "@azure/storage-blob";
import {
  FileAlreadyExistsError,
  FileNotFoundError,
  FileStorageConfigError,
  FileStorageError,
} from "./errors";
import { assertValidStorageKey, toPlainBytes, type FileStorage } from "./storage";

/*
 * Adapter for Azure Blob Storage. Bare kode: ingen ressurser i Azure er opprettet. Slås på med
 * `FILE_STORAGE_DRIVER=azure` når Ståle har laget lagringskontoen (Sweden Central, privat
 * container). Dette er den eneste filen som importerer `@azure/storage-blob`.
 */

type UploadOptions = {
  blobHTTPHeaders?: { blobContentType?: string };
  conditions?: { ifNoneMatch?: string };
};

/**
 * Den delen av `ContainerClient` adapteren bruker. Den ekte klienten passer (se kontrollen
 * nederst), og testene kan sende inn en falsk klient uten nett.
 */
export type AzureContainerClientLike = {
  getBlockBlobClient(blobName: string): {
    uploadData(data: Uint8Array, options?: UploadOptions): Promise<unknown>;
    downloadToBuffer(): Promise<Uint8Array>;
  };
};

type AzureErrorShape = { statusCode?: unknown; code?: unknown } | null | undefined;

function isAlreadyExists(error: unknown): boolean {
  const { statusCode, code } = (error ?? {}) as NonNullable<AzureErrorShape>;
  // 409 BlobAlreadyExists; 412 ConditionNotMet kan også komme fra betingelsen ifNoneMatch
  return statusCode === 409 || statusCode === 412 || code === "BlobAlreadyExists";
}

function isNotFound(error: unknown): boolean {
  const { statusCode, code } = (error ?? {}) as NonNullable<AzureErrorShape>;
  return statusCode === 404 || code === "BlobNotFound" || code === "ContainerNotFound";
}

/** Lager adapteren med en klient som sendes inn. Ingen nettkall her. */
export function createAzureFileStorage(containerClient: AzureContainerClientLike): FileStorage {
  return {
    driver: "azure",

    async put(storageKey, bytes, mimeType) {
      assertValidStorageKey(storageKey);
      try {
        await containerClient.getBlockBlobClient(storageKey).uploadData(bytes, {
          blobHTTPHeaders: { blobContentType: mimeType },
          // Skriver aldri over en fil som finnes
          conditions: { ifNoneMatch: "*" },
        });
      } catch (error) {
        if (isAlreadyExists(error)) throw new FileAlreadyExistsError();
        // Den opprinnelige feilen kan inneholde nøkler eller signatur; den sendes ikke videre
        throw new FileStorageError();
      }
    },

    async get(storageKey) {
      assertValidStorageKey(storageKey);
      try {
        return toPlainBytes(
          await containerClient.getBlockBlobClient(storageKey).downloadToBuffer(),
        );
      } catch (error) {
        if (isNotFound(error)) throw new FileNotFoundError();
        throw new FileStorageError();
      }
    },
  };
}

/**
 * Lager adapteren fra en tilkoblingsstreng og et containernavn. Klienten kobler ikke til før
 * første `put` eller `get`. Feil i tilkoblingsstrengen gir en feil som bare nevner variabelnavnet.
 */
export function createAzureFileStorageFromConnectionString(
  connectionString: string,
  containerName: string,
): FileStorage {
  let client: ContainerClient;
  try {
    client = new ContainerClient(connectionString, containerName);
  } catch {
    throw new FileStorageConfigError(
      "FILE_STORAGE_AZURE_CONNECTION_STRING eller FILE_STORAGE_AZURE_CONTAINER er ugyldig.",
    );
  }
  return createAzureFileStorage(client);
}

// Kontroll ved typesjekk: den ekte klienten passer i grensesnittet over
const _realClientFits: (client: ContainerClient) => AzureContainerClientLike = (client) => client;
void _realClientFits;
