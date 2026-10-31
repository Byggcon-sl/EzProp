import { describe, expect, it } from "vitest";
import { auditActionLabel, auditEntityLabel, formatAuditChanges } from "./labels";

/*
 * Visningstekstene i revisjonsloggen på /admin/logg.
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md avsnitt 5.
 * Fasiten for entity_type og action er det som skrives i src/core i dag. Ny kode i
 * recordAuditEvent? Legg den til her.
 */

const ENTITY_TYPES_IN_USE = [
  "employee",
  "employee_permission",
  "company",
  "office",
  "certification",
];

const ACTIONS_IN_USE = [
  "create",
  "update",
  "delete",
  "role_change",
  "permission_change",
  "deactivate",
  "reactivate",
];

/** Ingen linje skal vise rå uuid-er, «[object Object]», «null» eller «undefined». */
function expectNoRawValues(lines: string[]) {
  for (const line of lines) {
    expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(line).not.toContain("[object Object]");
    expect(line).not.toMatch(/\bnull\b/);
    expect(line).not.toMatch(/\bundefined\b/);
  }
}

describe("auditEntityLabel", () => {
  it.each([
    ["employee", "Ansatt"],
    ["company", "Selskap"],
    ["office", "Kontor"],
    ["certification", "Sertifisering"],
  ])("5.1 %s vises som «%s»", (code, label) => {
    expect(auditEntityLabel(code)).toBe(label);
  });

  it("5.1 har norsk navn for alle entity_type som skrives i dag", () => {
    for (const code of ENTITY_TYPES_IN_USE) {
      const label = auditEntityLabel(code);
      expect(label, code).toBeTruthy();
      expect(label, code).not.toBe(code);
    }
  });

  it("5.3 viser ukjent kode som koden selv", () => {
    expect(auditEntityLabel("x")).toBe("x");
  });
});

describe("auditActionLabel", () => {
  it.each([
    ["create", "Opprettet"],
    ["update", "Endret"],
  ])("5.2 %s vises som «%s»", (code, label) => {
    expect(auditActionLabel(code)).toBe(label);
  });

  it("5.2 har norsk navn for alle action som skrives i dag", () => {
    for (const code of ACTIONS_IN_USE) {
      const label = auditActionLabel(code);
      expect(label, code).toBeTruthy();
      expect(label, code).not.toBe(code);
    }
  });

  it("5.3 viser ukjent kode som koden selv", () => {
    expect(auditActionLabel("y")).toBe("y");
  });
});

describe("formatAuditChanges", () => {
  it("5.4 viser fra/til som «felt: fra → til»", () => {
    const lines = formatAuditChanges({ street: { from: "Storgata 1", to: "Storgata 2" } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^(Gate|street): Storgata 1 → Storgata 2$/);
  });

  it("5.4 viser adressen på et kontor (det e2e-testen endrer)", () => {
    const lines = formatAuditChanges({ address: { from: "Testveien 1", to: "Testveien 2" } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^(Adresse|address): Testveien 1 → Testveien 2$/);
  });

  it("5.5 viser tomme verdier likt, aldri som «null» eller «undefined»", () => {
    const [fromNull] = formatAuditChanges({ address: { from: null, to: "Testveien 2" } });
    const [toEmpty] = formatAuditChanges({ address: { from: "Testveien 1", to: "" } });
    expect(fromNull).toBeDefined();
    expect(toEmpty).toBeDefined();
    expectNoRawValues([fromNull!, toEmpty!]);

    const emptyFrom = /^(?:Adresse|address): (.+) → Testveien 2$/.exec(fromNull!)?.[1];
    const emptyTo = /^(?:Adresse|address): Testveien 1 → (.+)$/.exec(toEmpty!)?.[1];
    // Valget som låses: tom verdi vises som «(tom)» eller «–», og likt for null og "".
    expect(["(tom)", "–"]).toContain(emptyFrom);
    expect(emptyTo).toBe(emptyFrom);
  });

  it("5.6 viser en fields-liste som én linje «Endret: …»", () => {
    const lines = formatAuditChanges({ fields: ["name", "jobTitle"] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Endret: /);
    expect(lines[0]).toMatch(/(Navn|name)/);
    expect(lines[0]).toMatch(/(Stilling|jobTitle)/);
  });

  it("5.7 viser aldri rå uuid-er eller [object Object] for annet innhold", () => {
    const employeeId = "0192f1a2-3b4c-7d5e-8f60-123456789abc";
    expectNoRawValues(formatAuditChanges({ employeeId }));
    expectNoRawValues(formatAuditChanges({ added: [], removed: [] }));
    expectNoRawValues(
      formatAuditChanges({ employeeId, added: ["report.publish"], removed: [], nested: { a: 1 } }),
    );
  });

  it("5.8 gir ingen linjer for tom changes", () => {
    expect(formatAuditChanges({})).toEqual([]);
  });
});
