import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TYPES,
  NUMBER_SEQUENCE_SCOPES,
  assignmentStatusLabel,
} from "@/core/assignments/codes";
import {
  ORDER_EDITABLE_FIELDS,
  ORDER_SOURCES,
  ORDER_STATUSES,
  orderFieldLabel,
  orderStatusLabel,
} from "./codes";

/*
 * Faste koder for ordre og oppdrag (docs/funksjoner/fase2a-manuell-ordre-testplan.md 1.1–1.2,
 * med rettelsen i runde 1: `ORDER_SOURCES` er `manual` og `email`).
 *
 * Kodene endres aldri (regel 6). Får en kode ny betydning, arkiveres den gamle og det lages en
 * ny. Rød test her betyr at en kode er endret eller fjernet, ikke at testen skal rettes.
 *
 * Støtter hovedmål: KI først (`email` er kroken for ordreforslag fra e-post) og reklamasjoner
 * (statusene fra 27.10.2026 er låst).
 */

describe("faste koder", () => {
  it("1.1 ordrekildene er nøyaktig manual og email", () => {
    expect([...ORDER_SOURCES]).toEqual(["manual", "email"]);
  });

  it("1.1 ordrestatusene er nøyaktig received, converted, rejected", () => {
    expect([...ORDER_STATUSES]).toEqual(["received", "converted", "rejected"]);
  });

  it("1.1 oppdragsstatusene er de fire fra 27.10.2026, fra bestilt til fakturert", () => {
    expect([...ASSIGNMENT_STATUSES]).toEqual(["ordered", "in_progress", "completed", "invoiced"]);
  });

  it("1.1 oppdragstype og nummerserie har én kode hver", () => {
    expect([...ASSIGNMENT_TYPES]).toEqual(["condition_report"]);
    expect([...NUMBER_SEQUENCE_SCOPES]).toEqual(["assignment"]);
  });
});

describe("etiketter", () => {
  it.each([
    ["received", "Mottatt"],
    ["converted", "Gjort om til oppdrag"],
    ["rejected", "Avvist"],
  ] as const)("1.2 ordrestatus %s heter «%s»", (code, label) => {
    expect(orderStatusLabel(code)).toBe(label);
  });

  it.each([
    ["ordered", "Bestilt"],
    ["in_progress", "Under arbeid"],
    ["completed", "Ferdig"],
    ["invoiced", "Fakturert"],
  ] as const)("1.2 oppdragsstatus %s heter «%s»", (code, label) => {
    expect(assignmentStatusLabel(code)).toBe(label);
  });

  it("1.2 ukjent kode gir koden tilbake, aldri undefined", () => {
    expect(orderStatusLabel("lost" as never)).toBe("lost");
    expect(assignmentStatusLabel("cancelled" as never)).toBe("cancelled");
  });
});

/*
 * Endre en ordre etter at den er lagret (docs/funksjoner/fase2a-rette-ordre-testplan.md 1.1–1.3).
 * Feltkodene er faste (regel 6). Rød test her betyr at listen er endret, ikke at testen skal rettes.
 * Støtter hovedmål: KI i bunnen (feltkodene i loggen er grunnlaget for treffprosent per felt når
 * e-post-til-ordre kommer) og færre reklamasjoner (status og oppdrag kan aldri bli et ordrefelt).
 */
describe("felt som kan endres på en ordre", () => {
  it("1.1 ORDER_EDITABLE_FIELDS er nøyaktig de elleve feltene, i fast rekkefølge", () => {
    expect([...ORDER_EDITABLE_FIELDS]).toEqual([
      "receivedAt",
      "externalRef",
      "orderedByText",
      "orderedByContactId",
      "orderedByFirmId",
      "addressText",
      "gnr",
      "bnr",
      "snr",
      "housingAssociationName",
      "sellerDeclarationReceived",
    ]);
  });

  it.each([
    "status",
    "rejectReason",
    "rejectedReason",
    "assignmentId",
    "source",
    "requestedReportType",
    "organizationId",
  ])("1.1 %s kan aldri bli en feltkode", (code) => {
    expect(ORDER_EDITABLE_FIELDS as readonly string[]).not.toContain(code);
  });

  it("1.2 orderFieldLabel gir en norsk etikett for hver feltkode, aldri koden selv", () => {
    for (const code of ORDER_EDITABLE_FIELDS) {
      const label = orderFieldLabel(code);
      expect(typeof label, code).toBe("string");
      expect(label.trim(), code).not.toBe("");
      expect(label, code).not.toBe(code);
    }
    expect(orderFieldLabel("addressText")).toBe("Adresse");
  });

  it("1.2 to feltkoder deler ikke etikett (ellers kan «Endringer» ikke leses)", () => {
    const labels = ORDER_EDITABLE_FIELDS.map((code) => orderFieldLabel(code));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("1.3 ukjent kode gir koden selv, også navn fra Object.prototype", () => {
    expect(orderFieldLabel("ukjentFelt")).toBe("ukjentFelt");
    expect(orderFieldLabel("__proto__")).toBe("__proto__");
    expect(orderFieldLabel("toString")).toBe("toString");
    expect(orderFieldLabel("constructor")).toBe("constructor");
  });
});
