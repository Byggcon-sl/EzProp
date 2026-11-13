import { describe, expect, it } from "vitest";
import { formatHistoryValue } from "./history-format";

/*
 * Verdiene i «Endringer» på ordresiden (docs/funksjoner/fase2a-rette-ordre-testplan.md 5.1).
 * Støtter hovedmål: færre reklamasjoner (gammel og ny verdi leses uten tolkning).
 */

describe("formatHistoryValue", () => {
  it.each<[string, unknown, string]>([
    ["null", null, "(tom)"],
    ["udefinert", undefined, "(tom)"],
    ["tom tekst", "", "(tom)"],
    ["bare mellomrom", "   ", "(tom)"],
    ["sann", true, "Ja"],
    ["usann", false, "Nei"],
    ["tall", 12, "12"],
    ["null som tall", 0, "0"],
    ["sifre som tekst", "0012", "0012"],
    ["vanlig tekst", "Testveien 12, 8000 Bodø", "Testveien 12, 8000 Bodø"],
    ["ISO-tidspunkt vinter", "2026-11-04T09:30:00.000Z", "04.11.2026 kl. 10:30"],
    ["ISO-tidspunkt sommer", "2026-06-15T08:05:00Z", "15.06.2026 kl. 10:05"],
    ["Date", new Date("2026-11-04T09:30:00.000Z"), "04.11.2026 kl. 10:30"],
    ["objekt", { a: 1 }, "(tom)"],
    ["liste", ["a"], "(tom)"],
  ])("%s → %s", (_name, value, expected) => {
    expect(formatHistoryValue(value)).toBe(expected);
  });

  it("tekst som bare ligner en dato, vises som den er", () => {
    expect(formatHistoryValue("2026-11-04")).toBe("2026-11-04");
    expect(formatHistoryValue("2026-13-45T99:99:00Z")).toBe("2026-13-45T99:99:00Z");
  });
});
