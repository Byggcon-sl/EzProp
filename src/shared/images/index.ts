// Bildesjekken (A12, ADR 0016). Ren, uten avhengigheter. Se `check.ts`.
export {
  checkImage,
  detectImageFormat,
  hasMetadataSegment,
  hasPngMetadata,
  isAllowedJpegMarker,
  PNG_ALLOWED_CHUNKS,
  type CheckedImageFormat,
  type ImageCheckResult,
} from "./check";
