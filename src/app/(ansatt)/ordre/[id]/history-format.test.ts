import { describe, expect, it } from "vitest";
import { formatHistoryChange, formatHistoryValue } from "./history-format";

/*
 * Visning av verdiene i «Endringer» på ordresiden.
 * Testplan: docs/funksjoner/fase2a-rette-ordre-testplan.md 5.1 (regeltest).
 * Støtter hovedmål: færre reklamasjoner (det står tydelig hva som ble endret, aldri «null»).
 */

describe("5.1 formatHistoryValue", () => {
  it.each([
    ["null", null, "(tom)"],
    ["undefined", undefined, "(tom)"],
    ["tom tekst", "", "(tom)"],
    ["bare mellomrom", "   ", "(tom)"],
    ["true", true, "Ja"],
    ["false", false, "Nei"],
    ["tall", 12, "12"],
    ["null som tall", 0, "0"],
    ["tekst", "Testveien 14, 8000 Bodø", "Testveien 14, 8000 Bodø"],
    ["sifre som tekst", "0034", "0034"],
    // Vintertid: UTC + 1
    ["ISO-dato vinter", "2026-11-12T09:30:00.000Z", "12.11.2026 kl. 10:30"],
    // Sommertid: UTC + 2
    ["ISO-dato sommer", "2026-06-01T08:05:00Z", "01.06.2026 kl. 10:05"],
    ["ISO-dato over midnatt", "2026-12-31T23:30:00.000Z", "01.01.2027 kl. 00:30"],
    ["Date", new Date("2026-11-12T09:30:00.000Z"), "12.11.2026 kl. 10:30"],
    ["dato uten klokkeslett er tekst", "2026-11-12", "2026-11-12"],
    ["objekt vises aldri rått", { a: 1 }, "(tom)"],
    ["liste vises aldri rått", [1, 2], "(tom)"],
  ])("%s → «%s»", (_name, value, expected) => {
    expect(formatHistoryValue(value)).toBe(expected);
  });

  it("gir aldri «null», «undefined» eller «[object Object]»", () => {
    for (const value of [null, undefined, {}, [], Number.NaN, new Date("ugyldig")]) {
      expect(formatHistoryValue(value)).not.toMatch(/null|undefined|object|NaN|Invalid/);
    }
  });
});

describe("formatHistoryChange", () => {
  it("lager «Etikett: fra → til»", () => {
    expect(
      formatHistoryChange({
        label: "Adresse",
        from: "Testveien 12, 8000 Bodø",
        to: "Testveien 14, 8000 Bodø",
      }),
    ).toBe("Adresse: Testveien 12, 8000 Bodø → Testveien 14, 8000 Bodø");
  });

  it("tom fra-verdi og ja/nei", () => {
    expect(formatHistoryChange({ label: "Egenerklæring mottatt", from: false, to: true })).toBe(
      "Egenerklæring mottatt: Nei → Ja",
    );
    expect(formatHistoryChange({ label: "Gårdsnummer", from: null, to: "12" })).toBe(
      "Gårdsnummer: (tom) → 12",
    );
  });
});
