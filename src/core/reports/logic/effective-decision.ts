import type { DecisionState, IsEffectiveDecision } from "./types";

/**
 * Gjeldende beslutning om et regelforslag (A491, A495, ADR 0013 punkt 9b). Én regel for serveren
 * og skjermen. Rent blad: ingen database, ingen KI og ingen nettleser-API, så samme kode kan kjøre
 * på iPaden uten nett.
 *
 * Funksjonene setter aldri TG. De sier bare om en beslutning fortsatt står ved lag, slik at et
 * forslag som ikke lenger er avgjort, vises åpent igjen (Godta, Endre, Avvis).
 */

/** Valgt TG på en beslutning uten avvik, som må stå på punktet for at beslutningen skal gjelde. */
const DIRECT_CHOSEN_TG: readonly string[] = ["0", "1", "IU"];

/**
 * Om siste beslutningsrad for en regel på et punkt er gjeldende:
 * - `rejected` er alltid gjeldende.
 * - Rad som laget avvik: gjeldende bare når avviket står (`deviationId !== null`).
 * - Rad uten avvik med valgt TG 0, 1 eller IU: gjeldende bare når punktets `tgDirect` er den valgte.
 * - Alt annet er ikke gjeldende.
 */
export const isEffectiveDecision: IsEffectiveDecision = (decision, { tgDirect }) => {
  if (decision.decision === "rejected") return true;
  if (decision.madeDeviation) return decision.deviationId !== null;
  const chosen = decision.chosenTg;
  if (chosen === null || !DIRECT_CHOSEN_TG.includes(chosen)) return false;
  return tgDirect === chosen;
};

/** Det `latestDecisionPerRule` trenger av en beslutningsrad. */
export type DecisionRowKey = Pick<DecisionState, "ruleKey"> & {
  suggestion: { checkpoint_key: string };
};

/**
 * Siste rad per regel og punkt. Radene kommer eldst først (sortert på `decided_at`, så `id`), og
 * siste rad vinner. Eldre rader vurderes aldri, heller ikke når den siste ikke er gjeldende: en
 * eldre gjeldende rad «gjenoppstår» ikke. Rekkefølgen i svaret følger første rad per regel og punkt.
 */
export function latestDecisionPerRule<T extends DecisionRowKey>(decisions: readonly T[]): T[] {
  const latest = new Map<string, T>();
  for (const decision of decisions) {
    latest.set(`${decision.suggestion.checkpoint_key}|${decision.ruleKey}`, decision);
  }
  return [...latest.values()];
}
