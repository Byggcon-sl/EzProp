import { cn } from "@/shared/lib/cn";

/*
 * Fanene (segmentknappene) i arbeidskøen og tilbudslisten: ett sted for utseendet (design A,
 * «A-dashbord»). Lenker i en `<nav>` med `aria-current="page"` på den valgte, minst 44 px høye.
 */

/** Rammen rundt fanene. Brytes til flere linjer på smale skjermer (ingen vannrett rulling). */
export const segmentList = "flex flex-wrap gap-1 rounded-xl bg-white/60 p-1 ring-1 ring-slate-200/60";

/** Én fane. */
export const segmentLink =
  "inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-base text-slate-700 hover:bg-white";

/** Tillegg for den valgte fanen. */
export const segmentCurrent = "bg-white font-medium text-slate-900 ring-1 ring-line";

/** Pillen med antallet etter etiketten. */
export const segmentCount = "rounded-full bg-slate-100 px-2 text-sm text-slate-700 tabular-nums";

/** Tillegg for pillen i den valgte fanen. */
export const segmentCountCurrent = "bg-brand-50 text-brand-700";

/** Klassene for én fane, valgt eller ikke. */
export function segmentClass(current: boolean): string {
  return cn(segmentLink, current && segmentCurrent);
}
