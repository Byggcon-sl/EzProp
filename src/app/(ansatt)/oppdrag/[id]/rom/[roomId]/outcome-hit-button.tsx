"use client";

import type { KeyboardEvent } from "react";
import type { OutcomeSearchHit } from "@/core/reports/logic";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { TgBadge } from "@/shared/ui/tg-badge";
import { OUTCOME_MATCH_TEXTS } from "./room-messages";
import { outcomeName, outcomeTgLabel } from "./room-model";

/*
 * Én treffknapp i «+ Avvik» (skisse for «Skriv det du ser», avsnitt 4): punktnavnet, malens
 * avvikstekst og TG med tekst, og «Registrert fra før» når rommet alt har avviket. Brukes av
 * KI-treffene, tekstsøket og «Nærmeste treff (uten KI)», så de tre ser like ut. Ren visning; hva
 * trykket gjør, bestemmer panelet. Knappen er aldri markert som valgt (ingen forhåndsvalg).
 * Hovedmål: færre reklamasjoner (bygningsdel og alvor står på hvert treff) og de ansatte.
 */

export type OutcomeHitButtonProps = {
  hit: OutcomeSearchHit;
  /** Punktet som er åpent, så skjermleseren får «Annet punkt.» når treffet er et annet sted. */
  openCheckpointKey: string;
  /** Nummeret på avviket som alt finnes for utfallet, eller `null`. */
  registeredNumber: number | null;
  disabled: boolean;
  /** Grå når teksten er endret etter svaret fra KI (skisse 3.5). Kan fortsatt velges. */
  stale?: boolean;
  onChoose(): void;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
};

/**
 * Tilgjengelig navn i én streng (skisse 4.4), så ingenting leses to ganger. Synlig tekst står i
 * samme rekkefølge inne i navnet (punkt, avvikstekst, «Registrert fra før», TG), slik at den som
 * styrer med tale kan si det han ser (WCAG 2.5.3, axe `label-content-name-mismatch`).
 */
export function outcomeHitLabel(input: {
  hit: OutcomeSearchHit;
  openCheckpointKey: string;
  registeredNumber: number | null;
}): string {
  const text = outcomeName({ deviation_text: input.hit.deviationText });
  const parts = [`${input.hit.checkpointName}: ${/[.!?…]$/u.test(text) ? text : `${text}.`}`];
  if (input.registeredNumber !== null) parts.push(`${OUTCOME_MATCH_TEXTS.registered}.`);
  parts.push(`${outcomeTgLabel(input.hit.outcomeKind).long}.`);
  if (input.hit.checkpointKey !== input.openCheckpointKey) {
    parts.push(OUTCOME_MATCH_TEXTS.otherCheckpoint);
  }
  if (input.registeredNumber !== null) {
    parts.push(OUTCOME_MATCH_TEXTS.opensDeviation(input.registeredNumber));
  }
  return parts.join(" ");
}

export function OutcomeHitButton({
  hit,
  openCheckpointKey,
  registeredNumber,
  disabled,
  stale = false,
  onChoose,
  onKeyDown,
}: OutcomeHitButtonProps) {
  const tg = outcomeTgLabel(hit.outcomeKind);
  return (
    <button
      type="button"
      data-testid="outcome-match-hit"
      data-checkpoint={hit.checkpointKey}
      data-registered={registeredNumber !== null ? "true" : "false"}
      aria-label={outcomeHitLabel({ hit, openCheckpointKey, registeredNumber })}
      disabled={disabled}
      onClick={onChoose}
      onKeyDown={onKeyDown}
      className={cn(
        "grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 rounded-card border bg-white px-4 py-3 text-left hover:bg-snow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fjord disabled:text-slate-500",
        stale ? "border-line text-slate-500" : "border-line",
      )}
    >
      {/* Rekkefølgen i koden er rekkefølgen i navnet; rutenettet legger merkene øverst til høyre. */}
      <span
        className={cn(
          "col-start-1 row-start-1 self-center text-sm font-semibold",
          stale ? "text-slate-500" : "text-slate-900",
        )}
      >
        {hit.checkpointName}
      </span>{" "}
      <span
        className={cn(
          "col-span-2 row-start-2 text-base leading-snug break-words",
          stale ? "text-slate-500" : "text-slate-900",
        )}
      >
        {outcomeName({ deviation_text: hit.deviationText })}
      </span>{" "}
      <span aria-hidden="true" className="col-start-2 row-start-1 flex flex-wrap justify-end gap-2">
        {registeredNumber !== null && <Badge>{OUTCOME_MATCH_TEXTS.registered}</Badge>}
        {tg.tg !== null ? <TgBadge tg={tg.tg} /> : <Badge>{tg.text}</Badge>}
      </span>
    </button>
  );
}
