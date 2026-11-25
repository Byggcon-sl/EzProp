import "server-only";
import { nodeWorkerEngine } from "./engine.node";
import { createReportPagesRenderer, createReportPdfRenderer } from "./render";
import type { RenderReportPages, RenderReportPdf } from "./types";

/** Gjengivelsen på serveren: arbeidstråden med motoren (ADR 0016). Eneste vei ruten bruker. */
export const renderReportPdf: RenderReportPdf = createReportPdfRenderer(nodeWorkerEngine);

/** Sidene som SVG og sidekartet for forhåndsvisningen (tillegget til ADR 0016), samme motor. */
export const renderReportPages: RenderReportPages = createReportPagesRenderer(nodeWorkerEngine);
