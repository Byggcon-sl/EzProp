import { describe, expect, it } from "vitest";
import { ORDER_SOURCES, ORDER_STATUSES, orderStatusLabel } from "./index";

/*
 * Faste koder for ordre (testplan docs/funksjoner/fase2a-manuell-ordre-testplan.md 1.1–1.2).
 * Kodene endres aldri (regel 6); får en kode ny betydning, arkiveres den og det lages en ny.
 * Støtter hovedmål: KI først (`email` er kroken for e-post-til-ordre) og reklamasjoner (statusene
 * er låst, så en ordre aldri får en status skjermene ikke kjenner).
 */

describe("faste koder for ordre", () => {
  it("1.1 ORDER_SOURCES er nøyaktig manual og email", () => {
    expect([...ORDER_SOURCES]).toEqual(["manual", "email"]);
  });

  it("1.1 ORDER_STATUSES er nøyaktig received, converted og rejected", () => {
    expect([...ORDER_STATUSES]).toEqual(["received", "converted", "rejected"]);
  });

  it.each([
    ["received", "Mottatt"],
    ["converted", "Gjort om til oppdrag"],
    ["rejected", "Avvist"],
  ])("1.2 %s har etiketten «%s»", (code, label) => {
    expect(orderStatusLabel(code)).toBe(label);
  });

  it("1.2 ukjent kode gir koden tilbake, aldri undefined", () => {
    expect(orderStatusLabel("lost")).toBe("lost");
    expect(orderStatusLabel("")).toBe("");
  });
});
