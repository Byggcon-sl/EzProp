import { cn } from "@/shared/lib/cn";

/*
 * TG-merket (A246, docs/funksjoner/fase2a-badet-pc-design.md avsnitt 14). Alltid med tekst, aldri
 * bare farge. Kort form («TG3») får `aria-label` med lang form, så skjermleseren alltid får hele
 * meningen. Importerer ingenting fra `src/core`: tekstene står her, og er de samme som i
 * oversettelsen av koder i rapporten (lang form har forskriften § 2-23 som kilde, ikke NS 3600).
 * Støtter hovedmål: færre reklamasjoner (TG leses som tekst) og de ansatte.
 */

export type TgBadgeValue = "0" | "1" | "2" | "3" | "IU";

export const TG_BADGE_SHORT: Record<TgBadgeValue, string> = {
  "0": "TG0",
  "1": "TG1",
  "2": "TG2",
  "3": "TG3",
  IU: "TGIU",
};

export const TG_BADGE_LONG: Record<TgBadgeValue, string> = {
  "0": "Ingen avvik",
  "1": "Mindre avvik",
  "2": "Vesentlige avvik",
  "3": "Store eller alvorlige avvik",
  IU: "Ikke undersøkt",
};

/** Flate og tekst fra TG-tokenene. Skrevet ut, så Tailwind finner klassene. */
const TONES: Record<TgBadgeValue, string> = {
  "0": "bg-tg0-bg text-tg0-text",
  "1": "bg-tg1-bg text-tg1-text",
  "2": "bg-tg2-bg text-tg2-text",
  "3": "bg-tg3-bg text-tg3-text",
  IU: "bg-tgiu-bg text-tgiu-text",
};

/** «TG3 Store eller alvorlige avvik». */
export function tgBadgeFullText(tg: TgBadgeValue): string {
  return `${TG_BADGE_SHORT[tg]} ${TG_BADGE_LONG[tg]}`;
}

export function TgBadge({
  tg,
  long = false,
  className,
}: {
  tg: TgBadgeValue;
  long?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap",
        TONES[tg],
        className,
      )}
      aria-label={long ? undefined : tgBadgeFullText(tg)}
      role={long ? undefined : "img"}
    >
      {long ? tgBadgeFullText(tg) : TG_BADGE_SHORT[tg]}
    </span>
  );
}
