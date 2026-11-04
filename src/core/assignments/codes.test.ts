import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TYPES,
  assignmentStatusLabel,
  NUMBER_SEQUENCE_SCOPES,
} from "./index";

/*
 * Faste koder for oppdrag og nummerserier (testplan fase2a-manuell-ordre 1.1–1.2). Kodene endres
 * aldri (regel 6). Støtter hovedmål: reklamasjoner (de fire statusene fra 27.10.2026 er låst).
 */

describe("faste koder for oppdrag", () => {
  it("1.1 ASSIGNMENT_STATUSES er de fire fra 27.10.2026 i rekkefølgen bestilt → fakturert", () => {
    expect([...ASSIGNMENT_STATUSES]).toEqual(["ordered", "in_progress", "completed", "invoiced"]);
  });

  it("1.1 ASSIGNMENT_TYPES og NUMBER_SEQUENCE_SCOPES har én kode hver", () => {
    expect([...ASSIGNMENT_TYPES]).toEqual(["condition_report"]);
    expect([...NUMBER_SEQUENCE_SCOPES]).toEqual(["assignment"]);
  });

  it.each([
    ["ordered", "Bestilt"],
    ["in_progress", "Under arbeid"],
    ["completed", "Ferdig"],
    ["invoiced", "Fakturert"],
  ])("1.2 %s har etiketten «%s»", (code, label) => {
    expect(assignmentStatusLabel(code)).toBe(label);
  });

  it("1.2 ukjent kode gir koden tilbake, aldri undefined", () => {
    expect(assignmentStatusLabel("cancelled")).toBe("cancelled");
  });
});
