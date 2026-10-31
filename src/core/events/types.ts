/**
 * Hendelsestypene (docs/05-domenemodell.md 4.9) som faste koder. Kodene står bare her.
 * Nye koder legges bare til her. En kode endres aldri; skal den få ny betydning, arkiveres
 * den og det lages en ny (regel 6).
 */
export const EVENT_TYPES = [
  "order.received",
  "order.rejected",
  "assignment.created",
  "assignment.assigned",
  "assignment.handed_over",
  "assignment.status_changed",
  "assignment.on_hold",
  "assignment.resumed",
  "assignment.cancelled",
  "assignment.closed",
  "assignment.reopened",
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
