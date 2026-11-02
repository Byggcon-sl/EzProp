/**
 * Faste koder for hva en fil er (regel 6: en kode endres aldri, den arkiveres). Flere koder
 * (`logo`, `signature`, `attachment`) legges til når en funksjon trenger dem (fase 2).
 */
export const FILE_KINDS = ["document", "photo", "report_pdf"] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/**
 * Gyldige filtyper per `kind`. Fast liste: ingen `image/svg+xml`, `text/html` eller annet som
 * kan kjøre kode når filen vises.
 */
export const ALLOWED_MIME_TYPES: Readonly<Record<FileKind, readonly string[]>> = {
  document: ["application/pdf", "image/jpeg", "image/png"],
  photo: ["image/jpeg", "image/png", "image/heic", "image/webp"],
  report_pdf: ["application/pdf"],
};

/** Største filstørrelse: 25 MB, samme grense som prøve D. Nøyaktig 25 MB godtas. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
