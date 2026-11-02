import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileRetention } from "@/core/files";
import { logger } from "@/shared/lib/logger";

// Testplan docs/funksjoner/fase0b-filtjeneste-testplan.md avsnitt 4. Fasiten (standard 10/2/10,
// gyldig heltall 1–100) står her, ikke hentet fra koden.

const orgId = "00000000-0000-4000-8000-000000000001";
const DEVIATION = "photo.retention.deviation_original_years";
const OTHER = "photo.retention.other_original_years";
const DISPLAY = "photo.retention.display_years";
const DEFAULTS = { deviationOriginalYears: 10, otherOriginalYears: 2, displayYears: 10 };
const FIELD = {
  [DEVIATION]: "deviationOriginalYears",
  [OTHER]: "otherOriginalYears",
  [DISPLAY]: "displayYears",
} as const;
const KEYS = [DEVIATION, OTHER, DISPLAY] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readFileRetention", () => {
  it.each([
    { name: "{}", settings: {} },
    { name: "null", settings: null },
    { name: "[]", settings: [] },
    { name: '"tekst"', settings: "tekst" },
  ])("1. settings $name gir 10/2/10 uten advarsel", ({ settings }) => {
    const warn = vi.spyOn(logger, "warn");
    expect(readFileRetention(orgId, settings)).toEqual(DEFAULTS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("2. egne verdier brukes", () => {
    const warn = vi.spyOn(logger, "warn");
    expect(readFileRetention(orgId, { [DEVIATION]: 15, [OTHER]: 3, [DISPLAY]: 12 })).toEqual({
      deviationOriginalYears: 15,
      otherOriginalYears: 3,
      displayYears: 12,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  const invalid: { label: string; value: unknown }[] = [
    { label: "0", value: 0 },
    { label: "-1", value: -1 },
    { label: "2.5", value: 2.5 },
    { label: '"10"', value: "10" },
    { label: "null", value: null },
    { label: "NaN", value: Number.NaN },
    { label: "101", value: 101 },
  ];
  const invalidCases = KEYS.flatMap((key) => invalid.map((entry) => ({ key, ...entry })));

  it.each(invalidCases)(
    "3. ugyldig $label i $key gir standard, de andre uendret, og én advarsel med bare organisasjon og nøkkel",
    ({ key, value }) => {
      const warn = vi.spyOn(logger, "warn");
      // De to andre nøklene har egne gyldige verdier, så vi ser at de står uendret
      const own = { [DEVIATION]: 20, [OTHER]: 5, [DISPLAY]: 30 };
      const expected = { deviationOriginalYears: 20, otherOriginalYears: 5, displayYears: 30 };
      const result = readFileRetention(orgId, { ...own, [key]: value });
      expect(result).toEqual({ ...expected, [FIELD[key]]: DEFAULTS[FIELD[key]] });
      expect(warn).toHaveBeenCalledTimes(1);
      const fields = warn.mock.calls[0]![1];
      expect(fields).toEqual({ organizationId: orgId, key });
    },
  );

  const validCases = KEYS.flatMap((key) => [1, 10, 100].map((value) => ({ key, value })));

  it.each(validCases)("4. gyldig $value i $key brukes uten advarsel", ({ key, value }) => {
    const warn = vi.spyOn(logger, "warn");
    const result = readFileRetention(orgId, { [key]: value });
    expect(result).toEqual({ ...DEFAULTS, [FIELD[key]]: value });
    expect(warn).not.toHaveBeenCalled();
  });

  it("5. ukjente nøkler påvirker ingenting og gir ingen advarsel", () => {
    const warn = vi.spyOn(logger, "warn");
    const result = readFileRetention(orgId, {
      "photo.retention.ukjent_years": 0,
      "file.retention.default_years": "tull",
      "access.inspectors_edit_all": false,
    });
    expect(result).toEqual(DEFAULTS);
    expect(warn).not.toHaveBeenCalled();
  });
});
