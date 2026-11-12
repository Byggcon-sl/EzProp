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
  orderHistoryActionLabel,
  orderStatusLabel,
} from "./codes";
import { OrderChangedError } from "./errors";

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
 * Rette en ordre etter lagring (docs/funksjoner/fase2a-rette-ordre-testplan.md 1.1–1.3 og 1.5).
 * Feltkodene står i `changedFields` i revisjonsloggen og hendelsen `order.updated`, og endres
 * aldri (regel 6). Støtter hovedmål: KI i bunnen (fast form på loggen, slik at KI-treff per felt
 * kan måles) og de ansatte (norske etiketter i «Endringer»).
 */
describe("rettbare felt (rette ordre)", () => {
  it("1.1 ORDER_EDITABLE_FIELDS har nøyaktig de rettbare feltene, i fast rekkefølge", () => {
    expect([...ORDER_EDITABLE_FIELDS]).toEqual([
      "addressText",
      "receivedAt",
      "orderedByContactId",
      "orderedByText",
      "externalRef",
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
    "orderedByFirmId",
  ])("1.1 %s kan ikke bli en feltkode", (field) => {
    expect(ORDER_EDITABLE_FIELDS as readonly string[]).not.toContain(field);
  });

  it("1.1 ingen kode står to ganger", () => {
    expect(new Set(ORDER_EDITABLE_FIELDS).size).toBe(ORDER_EDITABLE_FIELDS.length);
  });

  it.each([...ORDER_EDITABLE_FIELDS])("1.2 %s har en norsk etikett som ikke er koden", (code) => {
    const label = orderFieldLabel(code);
    expect(label.trim()).not.toBe("");
    expect(label).not.toBe(code);
  });

  it("1.2 noen etiketter er som i grensesnittet («Rettet: adresse, gårdsnummer»)", () => {
    expect(orderFieldLabel("addressText")).toBe("adresse");
    expect(orderFieldLabel("gnr")).toBe("gårdsnummer");
  });

  it.each(["unknownField", "orderedByFirmId", "", "constructor", "toString"])(
    "1.3 ukjent kode «%s» gir koden selv, aldri unntak",
    (code) => {
      expect(() => orderFieldLabel(code)).not.toThrow();
      expect(orderFieldLabel(code)).toBe(code);
    },
  );

  it.each([
    ["create", "Opprettet"],
    ["update", "Rettet"],
    ["reject", "Avvist"],
    ["convert", "Gjort om til oppdrag"],
  ] as const)("1.2 handlingen %s i endringsloggen heter «%s»", (code, label) => {
    expect(orderHistoryActionLabel(code)).toBe(label);
  });

  it("1.3 ukjent handling gir koden selv", () => {
    expect(orderHistoryActionLabel("archive")).toBe("archive");
    expect(orderHistoryActionLabel("constructor")).toBe("constructor");
  });
});

describe("OrderChangedError", () => {
  it("1.5 har riktig melding og navn", () => {
    const error = new OrderChangedError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("OrderChangedError");
    expect(error.message).toBe("Ordren er endret av en annen. Last siden på nytt.");
  });
});
