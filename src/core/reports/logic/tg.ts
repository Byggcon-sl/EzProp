import type { TgDirect } from "@/db/schema";
import type {
  CheckDirectTgConflict,
  CheckpointTg,
  ComputeCheckpointTg,
  DeviationState,
  DirectTgConflictsWithDeviations,
} from "./types";

/**
 * TG-logikken på et kontrollpunkt (docs/funksjoner/fase2a-badet-pc.md Omfang 3). Gjelder bare
 * systemmalen for tilstandsrapport (regel 5); den som kaller, sjekker det. Funksjonene setter
 * aldri TG: de regner ut hva som vises, og sier fra når takstmannen må velge selv.
 */

/** Høyeste TG blant avvikene med valgt TG. HMS-avvik og avvik uten valgt TG teller ikke. */
function highestDeviationTg(
  deviations: readonly Pick<DeviationState, "kind" | "tg">[],
): 2 | 3 | null {
  let highest: 2 | 3 | null = null;
  for (const deviation of deviations) {
    if (deviation.kind !== "tg" || deviation.tg === null) continue;
    if (highest === null || deviation.tg > highest) highest = deviation.tg;
  }
  return highest;
}

/**
 * TG for kontrollpunktet: høyeste TG blant avvikene, ellers `tg_direct`. Mykt slettede avvik
 * sendes aldri inn. Lagres aldri (A342).
 */
export const computeCheckpointTg: ComputeCheckpointTg = ({ tgDirect, deviations }) => {
  const fromDeviations = highestDeviationTg(deviations);
  if (fromDeviations !== null) return String(fromDeviations) as CheckpointTg;
  return tgDirect;
};

/**
 * Hva som skjer med `tg_direct` når punktet får et avvik av denne arten. HMS gir aldri konflikt.
 * TG0 og TG1 tømmes (avviket gjelder). TGIU overskrives aldri stille: takstmannen må velge.
 */
export const checkDirectTgConflict: CheckDirectTgConflict = (tgDirect, kind) => {
  if (kind === "hms" || tgDirect === null) return "none";
  if (tgDirect === "IU") return "choose_tgiu_or_deviation";
  return "clear_direct";
};

/** TG direkte som ikke kan stå sammen med avvik med TG2 eller TG3 (serverstatus `tgiu_conflicts_with_deviation`). */
const DIRECT_TG_IN_CONFLICT: readonly TgDirect[] = ["IU", "0"];

/**
 * Om `tg_direct` kommer i konflikt med avvikene på punktet. TGIU og TG0 sammen med avvik med TG2
 * eller TG3 gir `true`. HMS-avvik og avvik uten valgt TG gir aldri konflikt.
 */
export const directTgConflictsWithDeviations: DirectTgConflictsWithDeviations = (
  tgDirect,
  deviations,
) => DIRECT_TG_IN_CONFLICT.includes(tgDirect) && highestDeviationTg(deviations) !== null;
