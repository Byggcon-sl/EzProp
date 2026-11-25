import "server-only";
import { nodeWorkerEngine } from "./engine.node";
import { createReportPdfRenderer } from "./render";
import type { RenderReportPdf } from "./types";

/** Gjengivelsen på serveren: arbeidstråden med motoren (ADR 0016). Eneste vei ruten bruker. */
export const renderReportPdf: RenderReportPdf = createReportPdfRenderer(nodeWorkerEngine);
