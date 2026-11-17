import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COST_AMOUNT_ROUNDING } from "./codes";
import {
  checkCostAmount,
  costDisplayText,
  costWarning,
  nearestRoundedAmount,
  parseCostAmount,
} from "./cost";
import { COST_BANDS } from "./cost-bands";
import {
  COST_AMOUNT_MESSAGES,
  COST_BAND_LABELS,
  costNotRoundedText,
  useRoundedAmountText,
} from "./labels";

/*
 * Kostnaden på et avvik (testplanen B1.5–B1.7 og B1.20, design avsnitt 11). Ren test.
 *
 * Hovedmål: færre reklamasjoner (beløpet rundes aldri av stille, og intervallene er faste koder)
 * og de ansatte (advarsel mens det skrives, aldri sperre, regel 12).
 */

/** Hardt mellomrom som vanlig mellomrom, så forventningene kan skrives slik de leses. */
const plain = (text: string) => text.replace(/ /gu, " ");

describe("B1.5 kostnadsadvarsel", () => {
  it.each([37500, 15000, 12345, 40001])("%i gir not_rounded", (amount) => {
    expect(costWarning(amount)).toBe("not_rounded");
    expect(checkCostAmount(amount)).toBe("not_rounded");
  });

  it.each([40000, 10000, 1000000])("%i gir ingen advarsel", (amount) => {
    expect(costWarning(amount)).toBe(null);
    expect(checkCostAmount(amount)).toBe("ok");
  });

  it.each([0, -10000, 12500.5, Number.NaN, Number.POSITIVE_INFINITY, 3_000_000_000])(
    "%d er ugyldig (feil, ikke advarsel)",
    (amount) => {
      expect(checkCostAmount(amount)).toBe("invalid");
      expect(costWarning(amount)).toBe(null);
    },
  );

  it("beløpet rundes aldri om: inn er ut", () => {
    const parsed = parseCostAmount("37 500");
    expect(parsed).toEqual({ ok: true, amount: 37500 });
    expect(costDisplayText("approx", { amount: 37500 })).toContain("37");
  });

  it("nærmeste rundede beløp vises som forslag, aldri 0", () => {
    expect(nearestRoundedAmount(37500)).toBe(40000);
    expect(nearestRoundedAmount(34999)).toBe(30000);
    expect(nearestRoundedAmount(1500)).toBe(COST_AMOUNT_ROUNDING);
    expect(plain(costNotRoundedText(40000))).toBe(
      "Beløpet er ikke rundet til nærmeste 10 000. Nærmeste er 40 000.",
    );
    expect(plain(useRoundedAmountText(40000))).toBe("Bruk 40 000");
  });
});

describe("B1.6 kostnad avvises med norsk melding", () => {
  it.each<[string, string]>([
    ["0", COST_AMOUNT_MESSAGES.not_whole_above_zero],
    ["-10 000", COST_AMOUNT_MESSAGES.not_whole_above_zero],
    ["−10000", COST_AMOUNT_MESSAGES.not_whole_above_zero],
    ["12 500,5", COST_AMOUNT_MESSAGES.not_whole_above_zero],
    ["10 000,00", COST_AMOUNT_MESSAGES.not_whole_above_zero],
    ["12500.5", COST_AMOUNT_MESSAGES.not_whole_above_zero],
    ["", COST_AMOUNT_MESSAGES.empty],
    ["   ", COST_AMOUNT_MESSAGES.empty],
    ["førti tusen", COST_AMOUNT_MESSAGES.not_number],
    ["40 000 kr", COST_AMOUNT_MESSAGES.not_number],
    ["1e5", COST_AMOUNT_MESSAGES.not_number],
    ["3000000000", COST_AMOUNT_MESSAGES.too_large],
  ])("«%s» avvises", (input, message) => {
    expect(parseCostAmount(input)).toEqual({ ok: false, message });
  });

  it.each<[string, number]>([
    ["40 000", 40000],
    ["40000", 40000],
    ["40 000", 40000],
    [" 1 000 000 ", 1000000],
    ["37 500", 37500],
  ])("«%s» godtas som %i", (input, amount) => {
    expect(parseCostAmount(input)).toEqual({ ok: true, amount });
  });
});

describe("B1.7 intervallene", () => {
  it("fem faste koder i låst rekkefølge og med låste grenser (regel 6)", () => {
    expect(COST_BANDS.map((b) => [b.key, b.min, b.max, b.sort_order])).toEqual([
      ["under_20000", null, 20000, 0],
      ["from_20000_to_100000", 20000, 100000, 1],
      ["from_100000_to_200000", 100000, 200000, 2],
      ["from_200000_to_500000", 200000, 500000, 3],
      ["over_500000", 500000, null, 4],
    ]);
  });

  it("alle er merket utkast og ingen er arkivert", () => {
    for (const band of COST_BANDS) {
      expect(band.status, band.key).toBe("draft");
      expect(band.archived, band.key).toBe(false);
    }
  });

  it.each(COST_BANDS.map((b) => [b.key, b] as const))(
    "etiketten for %s har grensene som tall",
    (key, band) => {
      const label = plain(COST_BAND_LABELS[key]);
      const bounds: (number | null)[] = [band.min, band.max];
      const numbers = bounds
        .filter((n): n is number => n !== null)
        .map((n) => n.toLocaleString("nb-NO").replace(/\s/gu, " "));
      for (const n of numbers) expect(label).toContain(n);
    },
  );
});

describe("B1.20 kostnad som tekst", () => {
  it("eget beløp gir «ca. 40 000 kr», aldri avrundet", () => {
    expect(plain(costDisplayText("approx", { amount: 40000 }))).toBe("ca. 40 000 kr");
    expect(plain(costDisplayText("approx", { amount: 37500 }))).toBe("ca. 37 500 kr");
    expect(plain(costDisplayText("approx", { amount: 1250000 }))).toBe("ca. 1 250 000 kr");
  });

  it("tusenskillet er hardt mellomrom, så beløpet ikke brytes", () => {
    expect(costDisplayText("approx", { amount: 40000 })).toBe("ca. 40 000 kr");
  });

  it.each([
    ["under_20000", "Under 20 000 kr"],
    ["from_20000_to_100000", "20 000–100 000 kr"],
    ["from_100000_to_200000", "100 000–200 000 kr"],
    ["from_200000_to_500000", "200 000–500 000 kr"],
    ["over_500000", "Over 500 000 kr"],
  ])("intervallet %s gir «%s»", (bandKey, expected) => {
    expect(plain(costDisplayText("band", { bandKey }))).toBe(expected);
  });

  it("hvert intervall i COST_BANDS har tekst", () => {
    for (const band of COST_BANDS) {
      expect(costDisplayText("band", { bandKey: band.key })).toMatch(/ kr$/u);
    }
  });

  it("ingen kostnad gir tom tekst, aldri «ca.»", () => {
    expect(costDisplayText("none", {})).toBe("");
    expect(costDisplayText("none", { amount: 40000 })).toBe("");
  });

  it("ukjent intervall eller ugyldig beløp gir tom tekst", () => {
    expect(costDisplayText("band", { bandKey: "unknown_band" })).toBe("");
    expect(costDisplayText("approx", { amount: null })).toBe("");
    expect(costDisplayText("approx", { amount: 0 })).toBe("");
  });

  it("ukjent cost_type er typefeil", () => {
    // @ts-expect-error: bare `band`, `approx` og `none` finnes
    expect(costDisplayText("free", {})).toBe("");
  });

  it("funksjonen ligger i logic/, så PDF-en kan bruke den", () => {
    const source = readFileSync(join(__dirname, "cost.ts"), "utf8");
    expect(source).toContain("export function costDisplayText");
  });
});
