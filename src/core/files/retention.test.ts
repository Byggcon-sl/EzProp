import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileRetention } from "@/core/files";
import { logger } from "@/shared/lib/logger";

// Testplan: docs/funksjoner/fase0b-filtjeneste-testplan.md, avsnitt 4.
// Fasiten (nøkler, standardverdier, gyldige og ugyldige verdier) er skrevet inn her for hånd.

const orgId = "00000000-0000-4000-8000-000000000001";

const DEFAULTS = { deviationOriginalYears: 10, otherOriginalYears: 2, displayYears: 10 };

const KEYS = [
  { key: "photo.retention.deviation_original_years", field: "deviationOriginalYears" },
  { key: "photo.retention.other_original_years", field: "otherOriginalYears" },
  { key: "photo.retention.display_years", field: "displayYears" },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readFileRetention", () => {
  it.each([
    { name: "{}", settings: {} },
    { name: "null", settings: null },
    { name: "undefined", settings: undefined },
    { name: "[]", settings: [] },
    { name: '"tekst"', settings: "tekst" },
  ])("1. settings $name gir standard 10/2/10 uten advarsel", ({ settings }) => {
    const warn = vi.spyOn(logger, "warn");
    expect(readFileRetention(orgId, settings)).toEqual(DEFAULTS);
    expect(warn).not.toHaveBeenCalled();
  });

  it("2. egne verdier brukes (15/3/12)", () => {
    const warn = vi.spyOn(logger, "warn");
    expect(
      readFileRetention(orgId, {
        "photo.retention.deviation_original_years": 15,
        "photo.retention.other_original_years": 3,
        "photo.retention.display_years": 12,
      }),
    ).toEqual({ deviationOriginalYears: 15, otherOriginalYears: 3, displayYears: 12 });
    expect(warn).not.toHaveBeenCalled();
  });

  const invalidValues = [
    { label: "0", value: 0 },
    { label: "-1", value: -1 },
    { label: "2.5", value: 2.5 },
    { label: '"10" (tekst)', value: "10" },
    { label: "null", value: null },
    { label: "NaN", value: Number.NaN },
    { label: "101", value: 101 },
  ];

  // Hele fasiten for den første nøkkelen, og én ugyldig verdi for hver av de to andre
  const [firstKey, ...otherKeys] = KEYS;
  const invalidCases = [
    ...invalidValues.map((v) => ({ ...firstKey, ...v })),
    ...otherKeys.map((k) => ({ ...k, ...invalidValues[0]! })),
  ];

  it.each(invalidCases)(
    "3. ugyldig $label i $key gir standard og én advarsel med bare organisasjon og nøkkel",
    ({ key, field, value }) => {
      const warn = vi.spyOn(logger, "warn");
      // De to andre nøklene har egne gyldige verdier som skal stå uendret
      const others = { deviationOriginalYears: 20, otherOriginalYears: 5, displayYears: 30 };
      const settings: Record<string, unknown> = {
        "photo.retention.deviation_original_years": 20,
        "photo.retention.other_original_years": 5,
        "photo.retention.display_years": 30,
        [key]: value,
      };
      expect(readFileRetention(orgId, settings)).toEqual({ ...others, [field]: DEFAULTS[field] });
      expect(warn).toHaveBeenCalledTimes(1);
      const fields = warn.mock.calls[0]![1];
      expect(fields).toEqual({ organizationId: orgId, key });
    },
  );

  const validCases = [
    ...[1, 10, 100].map((value) => ({ ...firstKey, value })),
    // 7 er ingen standardverdi, så testen viser at verdien faktisk leses
    ...otherKeys.map((k) => ({ ...k, value: 7 })),
  ];

  it.each(validCases)("4. gyldig $value i $key brukes uten advarsel", ({ key, field, value }) => {
    const warn = vi.spyOn(logger, "warn");
    expect(readFileRetention(orgId, { [key]: value })).toEqual({ ...DEFAULTS, [field]: value });
    expect(warn).not.toHaveBeenCalled();
  });

  it("5. ukjente nøkler påvirker ingenting og gir ingen advarsel", () => {
    const warn = vi.spyOn(logger, "warn");
    expect(
      readFileRetention(orgId, {
        "photo.retention.unknown_years": 0,
        "file.retention.default_years": 50,
        "access.inspectors_edit_all": false,
        photo: { retention: { display_years: 1 } },
      }),
    ).toEqual(DEFAULTS);
    expect(warn).not.toHaveBeenCalled();
  });
});
