import { describe, expect, it } from "vitest";
import type { StandardMeasureDoc } from "@/core/templates";
import { textsWrittenForTgText } from "./labels";
import { hasMeasuresForTg, measureForTg, pickStandardMeasures } from "./measures";

/*
 * Tiltak per TG (testplanen B1.9, T-0060). Ren test med oppdiktede tiltak.
 *
 * Hovedmål: færre reklamasjoner (TG2 får «bør», TG3 får «må», og tekst skrevet for en annen TG gir
 * advarsel).
 */

function measure(text: string, appliesToTg: 2 | 3 | null, sortOrder: number): StandardMeasureDoc {
  return {
    checkpoint_key: "cp",
    question_key: "cp.q",
    outcome_key: "o",
    text,
    applies_to_tg: appliesToTg,
    text_status: "draft",
    sort_order: sortOrder,
  };
}

const general = measure("Felles tiltak.", null, 0);
const should = measure("Bør utbedres.", 2, 1);
const must = measure("Må utbedres.", 3, 2);
const CHOOSE = [must, should, general];

describe("B1.9 tiltak per TG", () => {
  it("«velg TG2 eller TG3» med TG2 gir «bør»-tiltaket og det felles", () => {
    expect(pickStandardMeasures(CHOOSE, 2)).toEqual([general, should]);
    expect(measureForTg(CHOOSE, 2, "choose")).toEqual({
      measures: [general, should],
      warning: null,
    });
  });

  it("«velg TG2 eller TG3» med TG3 gir «må»-tiltaket og det felles", () => {
    expect(pickStandardMeasures(CHOOSE, 3)).toEqual([general, must]);
    expect(measureForTg(CHOOSE, 3, "choose").warning).toBe(null);
  });

  it("HMS (ingen TG) gir bare tiltakene uten applies_to_tg", () => {
    expect(pickStandardMeasures(CHOOSE, null)).toEqual([general]);
  });

  it("utfall med bare én tekst og annen TG gir advarselen", () => {
    const single = [measure("Må skiftes.", null, 0)];
    expect(measureForTg(single, 2, 3)).toEqual({
      measures: single,
      warning: "texts_written_for_other_tg",
    });
    expect(measureForTg(single, 3, 2).warning).toBe("texts_written_for_other_tg");
  });

  it("samme TG som utfallet gir ingen advarsel", () => {
    const single = [measure("Må skiftes.", null, 0)];
    expect(measureForTg(single, 3, 3).warning).toBe(null);
  });

  it("annen TG med egen tekst for den TG-en gir ingen advarsel", () => {
    expect(measureForTg([general, should], 2, 3).warning).toBe(null);
  });

  it("hasMeasuresForTg ser bare på tiltak med applies_to_tg", () => {
    expect(hasMeasuresForTg(CHOOSE, 2)).toBe(true);
    expect(hasMeasuresForTg([general], 2)).toBe(false);
    expect(hasMeasuresForTg(CHOOSE, null)).toBe(false);
  });

  it("advarselsteksten sier hvilken TG teksten hører til", () => {
    expect(textsWrittenForTgText(3)).toBe("Se over konsekvens og tiltak. Teksten hører til TG3.");
  });
});
