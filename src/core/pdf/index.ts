// PDF-gjengivelsen (ADR 0016). Rent blad: se `types.ts`. Inngangen er bare for serveren, fordi
// `renderReportPdf` og `loadPdfAssets` bruker arbeidstråden og filene. `core/reports` bruker bare
// `import type` herfra. I nettleseren (2b) brukes `createReportPdfRenderer` med en annen motor.
export * from "./codes";
export type * from "./types";
export { loadPdfAssets } from "./assets.node";
export { PdfRenderError } from "./errors";
export { BYGGCON_STANDARD_PROFILE, getPdfProfile, PDF_PROFILES } from "./profiles";
export { createReportPdfRenderer } from "./render";
export { renderReportPdf } from "./render.node";
