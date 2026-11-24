import type { SuggestedTgChangeDecision } from "./types";

/**
 * Hva beslutningsraden blir når TG byttes på et avvik som kom fra et regelforslag (A490). Ren
 * funksjon for skjermen (grunnvalget vises før noe sendes) og serveren
 * (`ChangeSuggestedDeviationTg`). Setter aldri TG.
 *
 * - `accepted` (ingen grunn): forslaget gjelder et utfall, avviket har forslagets spørsmål og
 *   utfall, og ny TG er utfallets faste TG, eller utfallet er «velg TG2 eller TG3» (da er TG-valget
 *   en del av å godta, også tom TG).
 * - `changed`: alt annet. Grunnen sjekkes av den som kaller, med `checkOverrideReason`.
 */
export const suggestedTgChangeDecision: SuggestedTgChangeDecision = ({
  suggestion,
  questionKey,
  outcomeKey,
  outcomeTg,
  tg,
}) => {
  if (suggestion.kind !== "outcome") return "changed";
  const sameOutcome =
    questionKey === suggestion.question_key && outcomeKey === suggestion.outcome_key;
  if (!sameOutcome) return "changed";
  if (outcomeTg === "choose") return "accepted";
  return outcomeTg !== null && tg === outcomeTg ? "accepted" : "changed";
};
