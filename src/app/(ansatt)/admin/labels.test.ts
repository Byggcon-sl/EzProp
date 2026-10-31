import { describe, expect, it } from "vitest";
import { grantablePermissions } from "@/core/access";
import { employeeRoles } from "@/db/schema";
import { todayInOslo } from "@/shared/lib/dates";
import {
  auditActionLabel,
  auditEntityLabel,
  formatAuditChanges,
  formatDate,
  formatIsoDate,
  formatOrgNumber,
  noticeText,
  permissionLabels,
  roleBadgeOrder,
  roleFormOrder,
  roleLabels,
} from "./labels";

describe("tekstene i adminområdet", () => {
  it("har etikett for hver rolle og hver rettighet som kan gis", () => {
    for (const role of employeeRoles) expect(roleLabels[role]).toBeTruthy();
    for (const permission of grantablePermissions)
      expect(permissionLabels[permission]).toBeTruthy();
    expect([...roleFormOrder].sort()).toEqual([...employeeRoles].sort());
    expect([...roleBadgeOrder].sort()).toEqual([...employeeRoles].sort());
  });

  it("viser rollene med navnene fra skissen", () => {
    expect(roleFormOrder.map((role) => roleLabels[role])).toEqual([
      "Takstmann",
      "Kontor",
      "Leder",
      "Admin",
    ]);
  });
});

describe("noticeText", () => {
  it.each([
    ["selskap", "Selskapet er lagret."],
    ["ny-ansatt", "Den ansatte er lagt inn."],
    ["sluttet", "Markert som sluttet."],
    ["angret", "Sluttet er angret."],
  ])("«%s» gir «%s»", (key, text) => {
    expect(noticeText(key)).toBe(text);
  });

  it.each([undefined, "", "ukjent", "toString", "__proto__", ["selskap"]])(
    "gir ingen tekst for %j (aldri tekst fra adressen)",
    (value) => {
      expect(noticeText(value as string | string[] | undefined)).toBeNull();
    },
  );
});

describe("formatering", () => {
  it.each([
    ["123456789", "123 456 789"],
    ["12345678", "12345678"],
    ["abc", "abc"],
  ])("org.nr. %s vises som %s", (input, output) => {
    expect(formatOrgNumber(input)).toBe(output);
  });

  it("viser datoer som DD.MM.ÅÅÅÅ", () => {
    expect(formatIsoDate("2027-12-31")).toBe("31.12.2027");
    expect(formatIsoDate("ikke-en-dato")).toBe("ikke-en-dato");
  });

  it("bruker norsk tid for dagens dato og for tidspunkt", () => {
    // 23:30 UTC 31. desember er 1. januar i Norge
    const lateNewYearsEve = new Date("2026-12-31T23:30:00Z");
    expect(todayInOslo(lateNewYearsEve)).toBe("2027-01-01");
    expect(formatDate(lateNewYearsEve)).toBe("01.01.2027");
  });
});

/*
 * Visningstekstene i revisjonsloggen (/admin/logg).
 * Testplan: docs/funksjoner/fase0b-revisjon-hendelser-testplan.md, avsnitt 5.
 * Ny `entityType` eller `action` i koden? Oppdater fasiten her.
 */
describe("revisjonsloggen: visningstekster", () => {
  it.each([
    ["employee", "Ansatt"],
    ["employee_permission", "Enkeltrettighet"],
    ["company", "Selskap"],
    ["office", "Kontor"],
    ["certification", "Sertifisering"],
  ])("1. entity_type %s vises som «%s»", (code, label) => {
    expect(auditEntityLabel(code)).toBe(label);
  });

  it.each([
    ["create", "Opprettet"],
    ["update", "Endret"],
    ["delete", "Slettet"],
    ["role_change", "Roller endret"],
    ["permission_change", "Rettigheter endret"],
    ["deactivate", "Deaktivert"],
    ["reactivate", "Aktivert igjen"],
  ])("2. action %s vises som «%s»", (code, label) => {
    expect(auditActionLabel(code)).toBe(label);
  });

  it("3. ukjent kode vises som koden selv, også navn fra Object.prototype", () => {
    expect(auditEntityLabel("x")).toBe("x");
    expect(auditActionLabel("y")).toBe("y");
    expect(auditEntityLabel("toString")).toBe("toString");
    expect(auditActionLabel("__proto__")).toBe("__proto__");
  });

  it("4. fra/til vises som «felt: fra → til» med norsk feltnavn", () => {
    expect(formatAuditChanges({ street: { from: "Storgata 1", to: "Storgata 2" } })).toEqual([
      "Gate: Storgata 1 → Storgata 2",
    ]);
  });

  it("4b. felt uten norsk navn vises med feltkoden", () => {
    expect(formatAuditChanges({ ukjentFelt: { from: "a", to: "b" } })).toEqual([
      "ukjentFelt: a → b",
    ]);
  });

  it("5. tomme verdier vises som «(tom)», aldri «null» eller «undefined»", () => {
    const lines = formatAuditChanges({
      street: { from: null, to: "Storgata 2" },
      city: { from: "Bodø", to: "" },
      postalCode: { from: undefined, to: "8006" },
    });
    expect(lines).toEqual([
      "Gate: (tom) → Storgata 2",
      "Sted: Bodø → (tom)",
      "Postnummer: (tom) → 8006",
    ]);
    for (const line of lines) {
      expect(line).not.toMatch(/null|undefined/);
    }
  });

  it("6. en fields-liste blir én linje «Endret: …»", () => {
    expect(formatAuditChanges({ fields: ["name", "jobTitle"] })).toEqual([
      "Endret: Navn, Stilling",
    ]);
  });

  it("7. annet innhold viser aldri rå id-er eller [object Object]", () => {
    const id = "0b7f6c1e-2d3a-4f5b-8c9d-0e1f2a3b4c5d";
    const lines = formatAuditChanges({
      employeeId: id,
      added: [],
      removed: [],
      roles: { added: ["admin"], removed: [] },
      nested: { from: { a: 1 }, to: [1, 2] },
    });
    expect(lines).toEqual([]);
    expect(lines.join(" ")).not.toContain(id);
    expect(lines.join(" ")).not.toContain("[object Object]");
  });

  it("8. tom changes gir ingen linjer", () => {
    expect(formatAuditChanges({})).toEqual([]);
  });
});
