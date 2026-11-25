"use client";

import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import { AiSparkIcon } from "@/shared/ui/ai-text-mark";
import { OUTCOME_MATCH_TEXTS } from "./room-messages";

/*
 * Gruppen med treff i «+ Avvik» (skisse for «Skriv det du ser», avsnitt 5 og 8). `match` er «Forslag
 * fra KI (velg ett)» med KI-tonen og spark-ikonet; ellers er det «Nærmeste treff (uten KI)» uten
 * KI-tone. Treffknappene kommer inn som barn i rekkefølgen de skal stå: ingen nummerering, ingen
 * «beste treff» og ingen poeng (spørsmål 120). Ren visning; tilstand og handlinger er panelets.
 * Hovedmål: KI i bunnen (KI foreslår, takstmannen velger) og de ansatte.
 */

export function OutcomeMatchHits({
  variant,
  busy,
  stale = false,
  children,
}: {
  variant: "match" | "nearest";
  /** Et valg lagres: gruppen får `aria-busy`. */
  busy: boolean;
  /** Teksten er endret etter svaret: kanten blir grå (skisse 3.5). */
  stale?: boolean;
  /** Én `<li>` per treff. */
  children: ReactNode;
}) {
  const ai = variant === "match";
  const headingId = ai ? "outcome-match-heading" : "outcome-nearest-heading";
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={busy || undefined}
      data-testid={ai ? "outcome-match-group" : "outcome-nearest-group"}
      className={cn(
        "space-y-3 rounded-card border p-4",
        ai
          ? stale
            ? "border-l-4 border-line bg-ai-50"
            : "border-l-4 border-ai-line bg-ai-50"
          : "",
        ai ? "" : "border-line bg-white",
      )}
    >
      <h4
        id={headingId}
        className={cn(
          "flex items-center gap-2 text-base font-semibold",
          ai ? "text-ai-900" : "text-slate-900",
        )}
      >
        {ai && <AiSparkIcon className="text-ai-700" />}
        {ai ? OUTCOME_MATCH_TEXTS.groupHeading : OUTCOME_MATCH_TEXTS.nearestHeading}
      </h4>
      <ul role="list" className="space-y-2">
        {children}
      </ul>
      {ai && <p className="text-sm text-slate-700">{OUTCOME_MATCH_TEXTS.groupHelp}</p>}
    </section>
  );
}
