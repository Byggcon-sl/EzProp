import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TYPES,
  NUMBER_SEQUENCE_SCOPES,
  assignmentStatusLabel,
} from "@/core/assignments/codes";
import { ORDER_SOURCES, ORDER_STATUSES, orderStatusLabel } from "./codes";
import * as ordersApi from "./index";

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
 * Feltlisten for «Endre ordren» og etikettene (docs/funksjoner/fase2a-rette-ordre-testplan.md
 * avsnitt 1). Fasiten står her, ikke importert fra koden (regel 6). Kortet kaller listen «for
 * eksempel `ORDER_EDITABLE_FIELDS`»; testen finner den eksporterte listen ut fra innholdet, så
 * navnet ikke er låst.
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

function exportedFieldList(): unknown {
  const api = ordersApi as Record<string, unknown>;
  if (Array.isArray(api.ORDER_EDITABLE_FIELDS)) return api.ORDER_EDITABLE_FIELDS;
  return Object.values(api).find(
    (value) =>
      Array.isArray(value) && value.includes("addressText") && value.includes("orderedByFirmId"),
  );
}

function fieldLabel(code: string): string {
  const label = (ordersApi as Record<string, unknown>).orderFieldLabel;
  expect(typeof label, "orderFieldLabel eksporteres fra @/core/orders").toBe("function");
  return (label as (code: string) => string)(code);
}

describe("feltlisten for endring av ordre", () => {
  it("1.1 listen er nøyaktig de elleve feltkodene i fast rekkefølge", () => {
    expect(exportedFieldList()).toEqual(EXPECTED_EDITABLE_FIELDS);
  });

  it.each(EXPECTED_EDITABLE_FIELDS)("1.2 orderFieldLabel(%s) er en norsk etikett", (code) => {
    const label = fieldLabel(code);
    expect(typeof label).toBe("string");
    expect(label.trim()).not.toBe("");
    expect(label).not.toBe(code);
    // Norsk tekst: begynner med stor bokstav og har ingen camelCase
    expect(label).toMatch(/^[A-ZÆØÅ]/);
    expect(label).not.toMatch(/[a-zæøå][A-ZÆØÅ]/);
  });

  it.each(["ukjentFelt", "toString", "__proto__", ""])(
    "1.3 ukjent kode «%s» gir koden eller en nøytral tekst, aldri unntak",
    (code) => {
      let label: unknown;
      expect(() => {
        label = fieldLabel(code);
      }).not.toThrow();
      expect(typeof label).toBe("string");
    },
  );

  it("1.4 ingen etikett bruker «rett» eller «rettet» (reservert for rapportversjon 2)", () => {
    for (const code of EXPECTED_EDITABLE_FIELDS) {
      expect(fieldLabel(code)).not.toMatch(/\brett(et)?\b/i);
    }
  });
});
