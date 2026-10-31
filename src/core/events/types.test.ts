import { describe, expect, it } from "vitest";
import { EVENT_TYPES, type EventType } from "@/core/events";

/*
 * Hendelseskodene (docs/05-domenemodell.md 4.9) som faste koder.
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md, avsnitt 1.
 * Fasiten står her med vilje (ikke importert): en kode endres aldri, den arkiveres (regel 6).
 * Ny kode i 4.9 legges både i `src/core/events/types.ts` og her.
 */

const EXPECTED_EVENT_TYPES = [
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
];

describe("hendelseskodene", () => {
  it("1. har nøyaktig de 35 kodene fra domenemodellen 4.9", () => {
    expect(EXPECTED_EVENT_TYPES).toHaveLength(35);
    expect([...EVENT_TYPES].sort()).toEqual([...EXPECTED_EVENT_TYPES].sort());
  });

  it("2. har ingen duplikater", () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });

  it.each([...EVENT_TYPES])("3. %s har formen «ord.ord_med_understrek»", (code) => {
    expect(code).toMatch(/^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$/);
  });

  it("4. followup.received finnes ikke (forkastet 27.10.2026)", () => {
    expect(EVENT_TYPES as readonly string[]).not.toContain("followup.received");
  });

  it("5. typen godtar bare kjente koder (fanges av pnpm typecheck)", () => {
    const known: EventType = "inspection.started";
    // @ts-expect-error ukjent kode skal gi typefeil
    const unknown: EventType = "assignment.unknown";
    expect(EVENT_TYPES).toContain(known);
    expect(EVENT_TYPES as readonly string[]).not.toContain(unknown);
  });
});
