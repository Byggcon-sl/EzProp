import { describe, expect, it } from "vitest";
import * as codes from "./codes";
import {
  hasCommonAreas,
  HOUSING_TYPES,
  housingTypeLabel,
  OWNERSHIP_FORMS,
  ownershipFormLabel,
  YES_NO_UNKNOWN,
} from "./codes";

/*
 * Faste koder for eiendommen og dataregelen `hasCommonAreas`
 * (docs/funksjoner/fase2a-eiendom-matrikkel-testplan.md avsnitt 1). Ren enhetstest.
 *
 * Kodene endres aldri, de arkiveres (regel 6). Ny kode uten testsak gjør testene under røde.
 * Etiketten for ja/nei/vet ikke kan hete `yesNoUnknownLabel` eller noe tilsvarende (testplanen,
 * «Avtale om signaturer»); testen finner den under de vanlige navnene.
 *
 * Støtter hovedmål: reklamasjoner (boligtype og eierform er låste koder, og leiligheter mangler
 * aldri fellesdeler) og KI først (kodene er data som et senere oppslag kan fylle ut).
 */

const HOUSING_TYPE_LABELS = [
  ["detached", "Enebolig"],
  ["semi_detached", "Tomannsbolig"],
  ["terraced", "Rekkehus"],
  ["apartment", "Leilighet"],
  ["apartment_in_house", "Leilighet i tomannsbolig eller flermannsbolig uten sameie"],
  ["holiday_home", "Fritidsbolig"],
  ["farm", "Våningshus"],
  ["other", "Annet"],
] as const;

const OWNERSHIP_FORM_LABELS = [
  ["freehold", "Selveier"],
  ["section", "Eierseksjon i sameie"],
  ["cooperative", "Andel i borettslag"],
  ["share", "Aksjeleilighet"],
] as const;

const YES_NO_LABELS = [
  ["yes", "Ja"],
  ["no", "Nei"],
  ["unknown", "Vet ikke"],
] as const;

const YES_NO_LABEL_NAMES = [
  "yesNoUnknownLabel",
  "yesNoLabel",
  "yesNoUnknownLabelOf",
  "commonAreaStatusLabel",
  "statusLabel",
] as const;

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

type HousingType = (typeof HOUSING_TYPES)[number];
type OwnershipForm = (typeof OWNERSHIP_FORMS)[number];
type Case = { housingType: HousingType; ownershipForm: OwnershipForm; expected: boolean };

/** 1.4 Testsakene med selveier: bare leilighet har fellesdeler (A67). */
const FREEHOLD_CASES: Case[] = [
  { housingType: "detached", ownershipForm: "freehold", expected: false },
  { housingType: "semi_detached", ownershipForm: "freehold", expected: false },
  { housingType: "terraced", ownershipForm: "freehold", expected: false },
  { housingType: "apartment", ownershipForm: "freehold", expected: true },
  { housingType: "apartment_in_house", ownershipForm: "freehold", expected: false },
  { housingType: "holiday_home", ownershipForm: "freehold", expected: false },
  { housingType: "farm", ownershipForm: "freehold", expected: false },
  { housingType: "other", ownershipForm: "freehold", expected: false },
];

/** 1.4 Eierseksjon, borettslag og aksje gir alltid fellesdeler, også for enebolig og rekkehus. */
const SHARED_OWNERSHIP_CASES: Case[] = (["detached", "terraced", "apartment"] as const).flatMap(
  (housingType) =>
    (["section", "cooperative", "share"] as const).map((ownershipForm) => ({
      housingType,
      ownershipForm,
      expected: true,
    })),
);

describe("1.1–1.2 kodene er låst (regel 6: endres aldri, arkiveres)", () => {
  it("1.1 HOUSING_TYPES er nøyaktig de åtte kodene i fast rekkefølge", () => {
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

  it("1.2 OWNERSHIP_FORMS er selveier, eierseksjon, borettslag og aksje; obligasjon finnes ikke (A64)", () => {
    expect([...OWNERSHIP_FORMS]).toEqual(["freehold", "section", "cooperative", "share"]);
    expect([...OWNERSHIP_FORMS] as string[]).not.toContain("bond");
  });

  it("1.2 YES_NO_UNKNOWN er ja, nei og vet ikke", () => {
    expect([...YES_NO_UNKNOWN]).toEqual(["yes", "no", "unknown"]);
  });
});

describe("1.3 etiketter", () => {
  it.each(HOUSING_TYPE_LABELS)("boligtypen %s har etiketten «%s»", (code, label) => {
    expect(housingTypeLabel(code)).toBe(label);
  });

  it.each(OWNERSHIP_FORM_LABELS)("eierformen %s har etiketten «%s»", (code, label) => {
    expect(ownershipFormLabel(code)).toBe(label);
  });

  it.each(YES_NO_LABELS)("ja/nei/vet ikke: %s har etiketten «%s»", (code, label) => {
    expect(yesNoLabel()(code)).toBe(label);
  });

  it("etikettene dekker alle kodene, i samme rekkefølge som listene", () => {
    expect(HOUSING_TYPE_LABELS.map(([code]) => code)).toEqual([...HOUSING_TYPES]);
    expect(OWNERSHIP_FORM_LABELS.map(([code]) => code)).toEqual([...OWNERSHIP_FORMS]);
    expect(YES_NO_LABELS.map(([code]) => code)).toEqual([...YES_NO_UNKNOWN]);
  });

  it("ukjent kode gir koden tilbake, aldri undefined", () => {
    expect(housingTypeLabel("villa")).toBe("villa");
    expect(ownershipFormLabel("bond")).toBe("bond");
    expect(yesNoLabel()("maybe")).toBe("maybe");
  });
});

describe("1.4 hasCommonAreas som testsaker (A67)", () => {
  it.each(FREEHOLD_CASES)(
    "$housingType med $ownershipForm → $expected",
    ({ housingType, ownershipForm, expected }) => {
      expect(hasCommonAreas({ housingType, ownershipForm })).toBe(expected);
    },
  );

  it.each(SHARED_OWNERSHIP_CASES)(
    "$housingType med $ownershipForm → $expected",
    ({ housingType, ownershipForm, expected }) => {
      expect(hasCommonAreas({ housingType, ownershipForm })).toBe(expected);
    },
  );

  it("leilighet i tomannsbolig uten sameie med selveier får ikke fellesdeler", () => {
    expect(hasCommonAreas({ housingType: "apartment_in_house", ownershipForm: "freehold" })).toBe(
      false,
    );
  });
});

describe("1.5 alle koder er dekket av testsakene", () => {
  it("testsakene med selveier har én rad per boligtype", () => {
    expect(FREEHOLD_CASES).toHaveLength(HOUSING_TYPES.length);
    expect(FREEHOLD_CASES.map((c) => c.housingType)).toEqual([...HOUSING_TYPES]);
  });

  it("testsakene for enebolig har én rad per eierform utenom selveier", () => {
    const detached = SHARED_OWNERSHIP_CASES.filter((c) => c.housingType === "detached");
    const others = OWNERSHIP_FORMS.filter((form) => form !== "freehold");
    expect(detached).toHaveLength(others.length);
    expect(detached.map((c) => c.ownershipForm)).toEqual([...others]);
  });
});
