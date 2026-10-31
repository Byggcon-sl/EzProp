import { describe, expect, it } from "vitest";
import { grantablePermissions } from "@/core/access";
import { employeeRoles } from "@/db/schema";
import {
  formatDate,
  formatIsoDate,
  formatOrgNumber,
  noticeText,
  permissionLabels,
  roleBadgeOrder,
  roleFormOrder,
  roleLabels,
  todayInNorway,
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
    expect(todayInNorway(lateNewYearsEve)).toBe("2027-01-01");
    expect(formatDate(lateNewYearsEve)).toBe("01.01.2027");
  });
});
