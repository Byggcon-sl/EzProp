import type { StandardMeasureDoc } from "@/core/templates";
import type { DeviationTg } from "@/db/schema";
import type { OutcomeTg, PickStandardMeasures } from "./types";

/**
 * Standardtiltak per TG (T-0060, docs/funksjoner/fase2a-badet-pc.md Omfang 4 og 5). Utfall av
 * typen «velg TG2 eller TG3» kan ha én tekst for TG2 («bør») og én for TG3 («må») via
 * `applies_to_tg`. Valgt TG avgjør hvilken som legges inn.
 */

function bySortOrder(a: StandardMeasureDoc, b: StandardMeasureDoc): number {
  return a.sort_order - b.sort_order;
}

/**
 * Tiltakene uten `applies_to_tg`, og de som gjelder denne TG-en, i malens rekkefølge. `null`
 * (HMS) gir bare dem uten `applies_to_tg`.
 */
export const pickStandardMeasures: PickStandardMeasures = (measures, tg) =>
  measures
    .filter((measure) => measure.applies_to_tg === null || measure.applies_to_tg === tg)
    .sort(bySortOrder);

/** Om malen har egne tiltak for denne TG-en (`DeviationState.hasMeasuresForTg`). */
export function hasMeasuresForTg(
  measures: readonly StandardMeasureDoc[],
  tg: DeviationTg | null,
): boolean {
  return tg !== null && measures.some((measure) => measure.applies_to_tg === tg);
}

/**
 * Om tekstene på utfallet er skrevet for en annen TG enn den som er valgt. Gjelder når utfallet
 * har én fast TG, takstmannen har valgt en annen, og malen ikke har egne tiltak for den valgte.
 */
export function textsWrittenForOtherTg(
  outcomeTg: OutcomeTg | null,
  tg: DeviationTg | null,
  measuresForTg: boolean,
): boolean {
  if (tg === null || outcomeTg === null || outcomeTg === "choose") return false;
  return tg !== outcomeTg && !measuresForTg;
}

/**
 * Tiltakene som legges inn når avviket får eller bytter TG, og om takstmannen må se over teksten
 * (`texts_written_for_other_tg`). Tiltak med `applies_to_tg` byttes stille.
 */
export function measureForTg(
  measures: readonly StandardMeasureDoc[],
  tg: DeviationTg | null,
  outcomeTg: OutcomeTg | null,
): { measures: StandardMeasureDoc[]; warning: "texts_written_for_other_tg" | null } {
  const forTg = hasMeasuresForTg(measures, tg);
  return {
    measures: pickStandardMeasures(measures, tg),
    warning: textsWrittenForOtherTg(outcomeTg, tg, forTg) ? "texts_written_for_other_tg" : null,
  };
}
