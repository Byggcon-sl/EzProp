import { describe, expect, it } from "vitest";
import { EVENT_TYPES, type EventType } from "@/core/events";

/*
 * Hendelsestypene som faste koder (docs/05-domenemodell.md 4.9).
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md avsnitt 1.
 * Fasiten skrives her, ikke importert, slik at en endret eller fjernet kode stopper testen
 * (regel 6: en kode endres aldri, den arkiveres). Ny kode i 4.9? Legg den til i fasiten.
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

describe("EVENT_TYPES", () => {
  it("har nøyaktig de 35 kodene fra domenemodellen 4.9", () => {
    expect(EXPECTED_EVENT_TYPES).toHaveLength(35);
    expect([...EVENT_TYPES].sort()).toEqual([...EXPECTED_EVENT_TYPES].sort());
  });

  it("har ingen duplikater", () => {
    expect(new Set(EVENT_TYPES).size).toBe(EVENT_TYPES.length);
  });

  it("har formen «ord.ord_med_understrek» på hver kode", () => {
    for (const type of EVENT_TYPES) {
      expect(type).toMatch(/^[a-z]+(_[a-z]+)*\.[a-z]+(_[a-z]+)*$/);
    }
  });

  it("har ikke followup.received (forkastet 27.10.2026)", () => {
    expect(EVENT_TYPES as readonly string[]).not.toContain("followup.received");
  });

  it("godtar bare kjente koder i typen EventType (fanges av pnpm typecheck)", () => {
    const known: EventType = "inspection.started";
    // @ts-expect-error ukjent kode er ikke en EventType
    const unknown: EventType = "assignment.unknown";
    expect(known).toBe("inspection.started");
    expect(unknown).toBe("assignment.unknown");
  });
});
