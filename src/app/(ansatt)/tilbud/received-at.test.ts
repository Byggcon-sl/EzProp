import { describe, expect, it } from "vitest";
import { formatIsoDate, formatOsloDate } from "./received-at";

/* Datoene på tilbudet i norsk form («Gyldig til 14.11.2026»). Støtter hovedmål: de ansatte. */

describe("formatIsoDate", () => {
  it.each([
    ["2026-11-14", "14.11.2026"],
    ["2028-02-29", "29.02.2028"],
    ["2026-01-01", "01.01.2026"],
  ])("%s → %s", (input, expected) => {
    expect(formatIsoDate(input)).toBe(expected);
  });

  it("annet format gis tilbake uendret", () => {
    expect(formatIsoDate("14.11.2026")).toBe("14.11.2026");
  });

  it("ren dato blir ikke flyttet av tidssonen (ingen Date-omregning)", () => {
    // Midnatt UTC er 01:00 i Oslo; en ren dato skal likevel stå som den er.
    expect(formatIsoDate("2026-06-30")).toBe("30.06.2026");
    expect(formatOsloDate(new Date("2026-06-30T22:30:00Z"))).toBe("01.07.2026");
  });
});
