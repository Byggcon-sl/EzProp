import {
  isReportPublishedForAssignment,
  REPORT_PUBLISHED_MESSAGE,
} from "@/core/reports/published-lock";
import type { DbExecutor } from "@/db/client";

/** En ny bygning krever aktiv eiendom på oppdraget. Ingenting er lagret. */
export class PropertyMissingError extends Error {
  constructor() {
    super("Legg inn eiendommen før du legger til bygninger.");
    this.name = "PropertyMissingError";
  }
}

/**
 * Oppdragets rapport er publisert, og rom, etasjer og bygninger er låst (A447, ADR 0015 punkt 15).
 * Ingenting er lagret. «Lag ny versjon» åpner rapporten igjen. Meldingen står i rapportkjernen,
 * så den er lik overalt.
 */
export class ReportPublishedError extends Error {
  readonly code = "report_published";
  constructor() {
    super(REPORT_PUBLISHED_MESSAGE);
    this.name = "ReportPublishedError";
  }
}

/**
 * Avviser skrivingen når oppdragets rapport er publisert. Kalles i samme transaksjon som
 * skrivingen, etter at raden er låst, med `grant.organizationId` og oppdraget slått opp fra raden.
 */
export async function assertReportNotPublished(
  tx: DbExecutor,
  organizationId: string,
  assignmentId: string,
): Promise<void> {
  if (await isReportPublishedForAssignment(tx, organizationId, assignmentId)) {
    throw new ReportPublishedError();
  }
}
