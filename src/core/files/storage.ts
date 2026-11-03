import { FileValidationError } from "./errors";

/**
 * Porten for filinnhold. Alle adaptere (lokal mappe, Azure Blob Storage, senere et lokalt arkiv
 * hos Byggcon) har bare disse to operasjonene. Det finnes ingen slette-operasjon (regel 3):
 * «slette» er bare `deleted_at` på raden i `files`, innholdet blir liggende.
 */
export type FileStorage = {
  /** Hvilken adapter dette er. Brukes av testene og ved feilsøking. */
  readonly driver: "local" | "azure";
  /** Lagrer innholdet. Skriver aldri over: finnes nøkkelen, kastes `FileAlreadyExistsError`. */
  put(storageKey: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  /** Henter innholdet. Ukjent nøkkel gir `FileNotFoundError`. */
  get(storageKey: string): Promise<Uint8Array>;
};

// Hver del av nøkkelen: bare bokstaver, siffer, punktum, bindestrek og understrek
const KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;
const MAX_KEY_LENGTH = 512;

/**
 * Kontrollerer en lagringsnøkkel før noe leses eller skrives. Avviser tom nøkkel, absolutt sti,
 * tomme deler (`a//b`, `a/`), `.` og `..`, bakstrek og andre tegn enn de få som trengs.
 * Nøkkelen står aldri i feilmeldingen.
 */
export function assertValidStorageKey(storageKey: string): void {
  const invalid =
    typeof storageKey !== "string" ||
    storageKey.length === 0 ||
    storageKey.length > MAX_KEY_LENGTH ||
    storageKey.split("/").some((part) => part === "." || part === ".." || !KEY_SEGMENT.test(part));
  if (invalid) throw new FileValidationError("Ugyldig lagringsnøkkel.");
}
