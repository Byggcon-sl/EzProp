import { describe, expect, it } from "vitest";
import * as codes from "./codes";
import {
  HOUSING_TYPES,
  hasCommonAreas,
  housingTypeLabel,
  OWNERSHIP_FORMS,
  ownershipFormLabel,
  YES_NO_UNKNOWN,
} from "./codes";

/*
 * Faste koder for eiendommen: boligtype, eierform og ja/nei/vet ikke, og dataregelen
 * `hasCommonAreas` (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 1). Ren
 * enhetstest. Kodene endres aldri (regel 6); en ny kode kan legges til, men da må testsakene
 * under utvides, ellers blir 1.5 rød.
 *
 * Etiketten for ja/nei/vet ikke kan hete `yesNoUnknownLabel` eller noe tilsvarende (testplanen,
 * «Avtale om signaturer»); testen finner den under de vanlige navnene.
 *
 * Støtter hovedmål: reklamasjoner (boligtype og eierform er låste koder som senere velger
 * kontrollpunkter, og leiligheter mangler aldri fellesdeler) og KI først (faste koder som et
 * senere oppslag eller KI kan foreslå mot).
 */

const HOUSING_LABELS: Record<string, string> = {
  detached: "Enebolig",
  semi_detached: "Tomannsbolig",
  terraced: "Rekkehus",
  apartment: "Leilighet",
  apartment_in_house: "Leilighet i tomannsbolig eller flermannsbolig uten sameie",
  holiday_home: "Fritidsbolig",
  farm: "Våningshus",
  other: "Annet",
};

const OWNERSHIP_LABELS: Record<string, string> = {
  freehold: "Selveier",
  section: "Eierseksjon i sameie",
  cooperative: "Andel i borettslag",
  share: "Aksjeleilighet",
};

const YES_NO_LABELS: Record<string, string> = { yes: "Ja", no: "Nei", unknown: "Vet ikke" };

const YES_NO_LABEL_NAMES = ["yesNoUnknownLabel", "yesNoLabel", "yesNoUnknownLabelOf"] as const;

function yesNoLabel(): (code: string) => string {
  const found = YES_NO_LABEL_NAMES.map(
    (name) => (codes as unknown as Record<string, unknown>)[name],
  ).find((value) => typeof value === "function");
  if (!found) {
    throw new Error(
      `fant ikke etiketten for ja/nei/vet ikke i ./codes (prøvde ${YES_NO_LABEL_NAMES.join(", ")})`,
    );
  }
  return found as (code: string) => string;
}

describe("1.1–1.3 faste koder og etiketter", () => {
  it("1.1 HOUSING_TYPES er de åtte kodene i fast rekkefølge", () => {
    expect([...HOUSING_TYPES]).toEqual([
      "detached",
      "semi_detached",
      "terraced",
      "apartment",
      "apartment_in_house",
      "holiday_home",
      "farm",
      "other",
    ]);
  });

  it("1.2 OWNERSHIP_FORMS er de fire kodene i fast rekkefølge, uten bond (A64)", () => {
    expect([...OWNERSHIP_FORMS]).toEqual(["freehold", "section", "cooperative", "share"]);
    expect(OWNERSHIP_FORMS as readonly string[]).not.toContain("bond");
  });

  it("1.3 YES_NO_UNKNOWN er ja, nei og vet ikke i fast rekkefølge", () => {
    expect([...YES_NO_UNKNOWN]).toEqual(["yes", "no", "unknown"]);
  });

  it.each(Object.entries(HOUSING_LABELS))("1.3 boligtypen %s har etiketten «%s»", (code, label) => {
    expect(housingTypeLabel(code as (typeof HOUSING_TYPES)[number])).toBe(label);
  });

  it.each(Object.entries(OWNERSHIP_LABELS))(
    "1.3 eierformen %s har etiketten «%s»",
    (code, label) => {
      expect(ownershipFormLabel(code as (typeof OWNERSHIP_FORMS)[number])).toBe(label);
    },
  );

  it.each(Object.entries(YES_NO_LABELS))("1.3 svaret %s har etiketten «%s»", (code, label) => {
    expect(yesNoLabel()(code)).toBe(label);
  });

  it("1.3 etikettene står i samme rekkefølge som kodene", () => {
    expect(HOUSING_TYPES.map((code) => housingTypeLabel(code))).toEqual(
      Object.values(HOUSING_LABELS),
    );
    expect(OWNERSHIP_FORMS.map((code) => ownershipFormLabel(code))).toEqual(
      Object.values(OWNERSHIP_LABELS),
    );
    expect(YES_NO_UNKNOWN.map((code) => yesNoLabel()(code))).toEqual(Object.values(YES_NO_LABELS));
  });

  it("1.3 ukjent kode gir koden tilbake, aldri undefined", () => {
    const housing = housingTypeLabel as (code: string) => string;
    const ownership = ownershipFormLabel as (code: string) => string;
    expect(housing("villa")).toBe("villa");
    expect(ownership("bond")).toBe("bond");
    expect(yesNoLabel()("maybe")).toBe("maybe");
  });
});

/*
 * 1.4 Dataregelen `hasCommonAreas` som testsaker (A67): fellesdeler gjelder når boligtypen er
 * leilighet, eller eierformen er eierseksjon, borettslag eller aksje.
 */

/** Hver boligtype med selveier. Bare leilighet har fellesdeler; «leilighet i tomannsbolig» ikke. */
const FREEHOLD_CASES: Record<string, boolean> = {
  detached: false,
  semi_detached: false,
  terraced: false,
  apartment: true,
  apartment_in_house: false,
  holiday_home: false,
  farm: false,
  other: false,
};

/** Eierformene utenom selveier gir alltid fellesdeler. */
const SHARED_OWNERSHIP_CASES: Record<string, boolean> = {
  section: true,
  cooperative: true,
  share: true,
};

const SHARED_HOUSING = ["detached", "terraced", "apartment"] as const;

type HousingType = (typeof HOUSING_TYPES)[number];
type OwnershipForm = (typeof OWNERSHIP_FORMS)[number];

describe("1.4 hasCommonAreas (A67)", () => {
  it.each(Object.entries(FREEHOLD_CASES))(
    "%s med selveier gir fellesdeler = %s",
    (housingType, expected) => {
      expect(
        hasCommonAreas({
          housingType: housingType as HousingType,
          ownershipForm: "freehold",
        }),
      ).toBe(expected);
    },
  );

  const sharedCases = SHARED_HOUSING.flatMap((housingType) =>
    Object.entries(SHARED_OWNERSHIP_CASES).map(([ownershipForm, expected]) => ({
      housingType,
      ownershipForm,
      expected,
    })),
  );

  it.each(sharedCases)(
    "$housingType med $ownershipForm gir fellesdeler = $expected",
    ({ housingType, ownershipForm, expected }) => {
      expect(
        hasCommonAreas({
          housingType: housingType as HousingType,
          ownershipForm: ownershipForm as OwnershipForm,
        }),
      ).toBe(expected);
    },
  );

  it("leilighet i tomannsbolig uten sameie med selveier får ikke fellesdeler (A67)", () => {
    expect(hasCommonAreas({ housingType: "apartment_in_house", ownershipForm: "freehold" })).toBe(
      false,
    );
  });

  it("alle kombinasjoner av koder gir et svar (aldri undefined eller kast)", () => {
    for (const housingType of HOUSING_TYPES) {
      for (const ownershipForm of OWNERSHIP_FORMS) {
        const expected = housingType === "apartment" || ownershipForm !== "freehold";
        expect(
          hasCommonAreas({ housingType, ownershipForm }),
          `${housingType}/${ownershipForm}`,
        ).toBe(expected);
      }
    }
  });
});

describe("1.5 alle koder er dekket av testsakene", () => {
  it("testsakene med selveier har én rad per boligtype (ny boligtype uten testsak gjør testen rød)", () => {
    expect(Object.keys(FREEHOLD_CASES).sort()).toEqual([...HOUSING_TYPES].sort());
    expect(Object.keys(HOUSING_LABELS).sort()).toEqual([...HOUSING_TYPES].sort());
  });

  it("testsakene for enebolig har én rad per eierform utenom selveier (ny eierform uten testsak gjør testen rød)", () => {
    expect(Object.keys(SHARED_OWNERSHIP_CASES).sort()).toEqual(
      OWNERSHIP_FORMS.filter((code) => code !== "freehold").sort(),
    );
    expect(Object.keys(OWNERSHIP_LABELS).sort()).toEqual([...OWNERSHIP_FORMS].sort());
    expect(Object.keys(YES_NO_LABELS).sort()).toEqual([...YES_NO_UNKNOWN].sort());
  });
});
