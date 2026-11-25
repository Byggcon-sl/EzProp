import type { PdfRenderErrorCode } from "./types";

/**
 * Feil fra PDF-gjengivelsen (ADR 0016 punkt 12). Har bare en fast kode. Meldingen og stakken fra
 * motoren tas aldri med, fordi de kan sitere rapporttekst. Loggen får `code`, aldri mer.
 */
export class PdfRenderError extends Error {
  readonly code: PdfRenderErrorCode;

  constructor(code: PdfRenderErrorCode) {
    super(`PDF-en kunne ikke lages (${code}).`);
    this.name = "PdfRenderError";
    this.code = code;
  }
}
