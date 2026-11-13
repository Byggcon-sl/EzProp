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
 * Feltene som kan endres på en lagret ordre (docs/funksjoner/fase2a-rette-ordre-testplan.md
 * avsnitt 1). Fasiten står her, ikke importert: feltkodene endres aldri (regel 6).
 * Støtter hovedmål: KI i bunnen (feltkodene er grunnlaget for treffprosent per felt senere).
 */
const EXPECTED_EDITABLE_FIELDS = [
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
];

describe("feltene som kan endres på ordren", () => {
  it("1.1 feltlisten er fast, i fast rekkefølge", () => {
    expect([...ORDER_EDITABLE_FIELDS]).toEqual(EXPECTED_EDITABLE_FIELDS);
  });

  it.each(EXPECTED_EDITABLE_FIELDS)("1.2 %s har en norsk etikett", (code) => {
    const label = orderFieldLabel(code);
    expect(label.trim()).not.toBe("");
    expect(label).not.toBe(code);
    expect(label).toMatch(/^[A-ZÆØÅ]/);
  });

  it("1.2 kjente etiketter", () => {
    expect(orderFieldLabel("addressText")).toBe("Adresse");
    expect(orderFieldLabel("orderedByContactId")).toBe("Bestiller");
    expect(orderFieldLabel("receivedAt")).toBe("Mottatt");
  });

  it.each(["secretField", "", "__proto__", "constructor", "toString"])(
    "1.3 ukjent kode «%s» gir koden tilbake, aldri unntak",
    (code) => {
      expect(orderFieldLabel(code)).toBe(code);
    },
  );

  it("1.4 ingen etikett bruker ordet «rett»/«rettet» (reservert for rapportversjon 2)", () => {
    for (const code of EXPECTED_EDITABLE_FIELDS) {
      expect(orderFieldLabel(code).toLowerCase()).not.toMatch(/(^|[^a-zæøå])rett(et)?([^a-zæøå]|$)/);
    }
  });
});
