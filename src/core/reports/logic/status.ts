import { computeCheckpointTg } from "./tg";
import type { CheckpointState, ComputeCheckpointStatus } from "./types";

/**
 * Status og fremdrift per kontrollpunkt (docs/funksjoner/fase2a-badet-pc.md Omfang 7). Mykt
 * slettede rader sendes aldri inn, så de telles ikke.
 */

/**
 * `tgiu` når punktet har TGIU (vises i stedet for `done`), `done` når punktet er merket ferdig,
 * `in_progress` når noe er registrert, ellers `not_started`.
 */
export const computeCheckpointStatus: ComputeCheckpointStatus = (input) => {
  if (computeCheckpointTg(input) === "IU") return "tgiu";
  if (input.done) return "done";
  const started =
    input.hasContent ||
    input.tgDirect !== null ||
    input.tgiu !== null ||
    input.deviations.length > 0 ||
    input.decisions.length > 0;
  return started ? "in_progress" : "not_started";
};

/** Antall ferdige punkter for «x av 8 ferdig». Teller bare `done`, ikke status. */
export function countDoneCheckpoints(
  checkpoints: readonly Pick<CheckpointState, "done">[],
): number {
  return checkpoints.filter((checkpoint) => checkpoint.done).length;
}
