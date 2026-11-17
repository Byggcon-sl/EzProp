import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TYPES,
  NUMBER_SEQUENCE_SCOPES,
  assignmentStatusLabel,
} from "@/core/assignments/codes";
import { BOOKING_EDITABLE_FIELDS } from "@/core/assignments/booking/codes";
import { EVENT_TYPES } from "@/core/events/types";
import {
  OFFER_DISPLAY_STATUSES,
  OFFER_LIST_FILTERS,
  OFFER_REJECTION_REASON_KEYS,
  ORDER_EDITABLE_FIELDS,
  ORDER_SOURCES,
  ORDER_STATUSES,
  isOfferRejectionReasonKey,
  isOrderEditableField,
  offerDisplayStatusLabel,
  offerListFilterLabel,
  offerRejectionReasonLabel,
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
  // Tilbud (ADR 0012, testplan 1.2.1): kodene er de samme, tekstene er nye
  it.each([
    ["received", "Åpent"],
    ["converted", "Gjort om til oppdrag"],
    ["rejected", "Avslått"],
  ] as const)("1.2 ordrestatus %s heter «%s»", (code, label) => {
    expect(orderStatusLabel(code)).toBe(label);
  });

  it.each([
    ["open", "Åpent"],
    ["expired", "Utløpt"],
    ["converted", "Gjort om til oppdrag"],
    ["rejected", "Avslått"],
  ] as const)("1.2.1 visningsstatus %s heter «%s»", (code, label) => {
    expect(offerDisplayStatusLabel(code)).toBe(label);
  });

  it("1.2.1 hver visningsstatus og hvert filter har tekst", () => {
    for (const code of OFFER_DISPLAY_STATUSES) {
      expect(offerDisplayStatusLabel(code), code).not.toBe(code);
    }
    for (const code of OFFER_LIST_FILTERS) expect(offerListFilterLabel(code), code).not.toBe(code);
    expect(offerListFilterLabel("open")).toBe("Åpne");
    expect(offerListFilterLabel("all")).toBe("Alle");
  });

  it("1.2.4 hendelseskodene for tilbud er uendret, og order.converted finnes ikke (A326)", () => {
    const types = EVENT_TYPES as readonly string[];
    for (const type of ["order.received", "order.rejected", "order.updated"]) {
      expect(types, type).toContain(type);
    }
    expect(types).not.toContain("order.converted");
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
  it("1.1 ORDER_EDITABLE_FIELDS er nøyaktig de elleve bestillingsfeltene og validUntil, i fast rekkefølge", () => {
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
      "validUntil",
    ]);
  });

  it("1.3.1 validUntil er bare på tilbudet, aldri i bestillingslisten til oppdraget", () => {
    expect(ORDER_EDITABLE_FIELDS as readonly string[]).toContain("validUntil");
    expect(BOOKING_EDITABLE_FIELDS as readonly string[]).not.toContain("validUntil");
    expect(isOrderEditableField("validUntil")).toBe(true);
    expect(isOrderEditableField("status")).toBe(false);
  });

  it("1.3.2 tilbudslisten er bestillingslisten i samme rekkefølge, med validUntil sist", () => {
    expect(ORDER_EDITABLE_FIELDS.slice(0, -1)).toEqual([...BOOKING_EDITABLE_FIELDS]);
    expect(ORDER_EDITABLE_FIELDS.at(-1)).toBe("validUntil");
  });

  it("1.3.3 validUntil heter «Gyldig til»", () => {
    expect(orderFieldLabel("validUntil")).toBe("Gyldig til");
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

/*
 * Faste avslagsgrunner (F4, A361, testplan 7.4.1). Kodene er faste (regel 6) og står også i
 * CHECK-regelen `orders_rejected_reason_key_check`.
 */
describe("7.4.1 avslagsgrunnene", () => {
  it("kodene er nøyaktig de fem, i fast rekkefølge", () => {
    expect([...OFFER_REJECTION_REASON_KEYS]).toEqual([
      "price",
      "timing",
      "chose_other",
      "customer_withdrew",
      "other",
    ]);
  });

  it.each([
    ["price", "Pris"],
    ["timing", "Tidspunkt passet ikke"],
    ["chose_other", "Valgte en annen"],
    ["customer_withdrew", "Kunden trakk seg"],
    ["other", "Annet"],
  ] as const)("%s heter «%s»", (code, label) => {
    expect(offerRejectionReasonLabel(code)).toBe(label);
    expect(isOfferRejectionReasonKey(code)).toBe(true);
  });

  it("ukjent kode er ikke en grunn og gir koden tilbake", () => {
    expect(isOfferRejectionReasonKey("pris")).toBe(false);
    expect(isOfferRejectionReasonKey(undefined)).toBe(false);
    expect(offerRejectionReasonLabel("__proto__")).toBe("__proto__");
  });
});
