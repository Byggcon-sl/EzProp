// PDF-gjengivelsen (ADR 0016). Rent blad: se `types.ts`. Inngangen er bare for serveren, fordi
// `renderReportPdf`, `renderReportPages` og `loadPdfAssets` bruker arbeidstråden og filene.
// `core/reports` bruker bare `import type` herfra. I nettleseren (2b) brukes
// `createReportPdfRenderer` og `createReportPagesRenderer` med en annen motor. Klienten importerer
// aldri verdier herfra, bare fra `codes.ts` og `page-map.ts` (uten importer av verdier).
export * from "./codes";
export type * from "./types";
export { loadPdfAssets } from "./assets.node";
export { PdfRenderError } from "./errors";
export { isPdfPageAnchor, pdfPageAnchorKey, samePdfPageAnchor } from "./page-map";
export { buildPdfPageMap } from "./page-map-build";
export { cleanPageSvg, isSafePageSvg } from "./page-svg";
export { BYGGCON_STANDARD_PROFILE, getPdfProfile, PDF_PROFILES } from "./profiles";
export { createReportPagesRenderer, createReportPdfRenderer } from "./render";
export { renderReportPages, renderReportPdf } from "./render.node";
