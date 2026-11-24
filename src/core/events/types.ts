/**
 * Hendelsestypene (docs/05-domenemodell.md 4.9) som faste koder. Kodene står bare her.
 * Nye koder legges bare til her. En kode endres aldri; skal den få ny betydning, arkiveres
 * den og det lages en ny (regel 6).
 */
export const EVENT_TYPES = [
  "order.received",
  "order.rejected",
  /** Ordren er endret etter lagring (T1). `data: { orderId, fields }`, aldri verdier. */
  "order.updated",
  "assignment.created",
  /**
   * Bestillingsopplysningene på oppdraget er endret etter lagring (ADR 0011).
   * `data: { assignmentId, fields }`, aldri verdier.
   */
  "assignment.booking_updated",
  "assignment.assigned",
  "assignment.handed_over",
  "assignment.status_changed",
  "assignment.on_hold",
  "assignment.resumed",
  "assignment.cancelled",
  "assignment.closed",
  "assignment.reopened",
  "assignment.team_changed",
  "assignment.company_changed",
  "assignment.agreement_changed",
  "assignment.party_added",
  "assignment.party_updated",
  "assignment.party_removed",
  "assignment.party_restored",
  "assignment.property_saved",
  "assignment.common_areas_saved",
  "assignment.building_saved",
  "assignment.building_removed",
  "assignment.building_restored",
  "assignment.floor_saved",
  "assignment.floor_removed",
  "assignment.floor_restored",
  "assignment.floor_area_saved",
  "assignment.room_saved",
  "assignment.room_removed",
  "assignment.room_restored",
  "inspection.scheduled",
  "inspection.rescheduled",
  "inspection.cancelled",
  "inspection.started",
  "inspection.finished",
  "seller_declaration.received",
  "document.received",
  "peer_review.requested",
  "peer_review.changes_requested",
  "peer_review.approved",
  "report.published",
  "report.revised",
  "report.publish_override",
  "report.sent",
  /**
   * PDF-utkast laget (ADR 0016). `data` har bare feltene i `PDF_EVENT_DATA_FIELDS`. Vises og telles
   * aldri per ansatt, bare samlet bak `statistics.read`.
   */
  "report.draft_pdf_created",
  /** PDF av en utgivelse laget (ADR 0016, F7). Som over, pluss `versionNumber`. */
  "report.release_pdf_created",
  "invoice.draft_created",
  "invoice.sent",
  "invoice.paid",
  "invoice.overdue",
  "message.failed",
  "report.validity_expiring",
  "certification.expiring",
  "device.blocked",
  "claim.registered",
  "survey.answered",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * De eneste feltene i `data` på PDF-hendelsene (docs/funksjoner/fase2a-pdf-badet.md, «KI i
 * bunnen»). Aldri adresse, oppdragsnummer, filnavn, selskapsnavn eller tekst fra rapporten.
 * `durationMs` er maskintid, ikke arbeidstid.
 */
export const PDF_EVENT_DATA_FIELDS = {
  "report.draft_pdf_created": ["reportId", "profileCode", "pageCount", "imageCount", "durationMs"],
  "report.release_pdf_created": [
    "reportId",
    "profileCode",
    "pageCount",
    "imageCount",
    "durationMs",
    "versionNumber",
  ],
} as const;

export type DraftPdfEventData = {
  reportId: string;
  profileCode: string;
  pageCount: number;
  imageCount: number;
  durationMs: number;
};

export type ReleasePdfEventData = DraftPdfEventData & { versionNumber: number };
