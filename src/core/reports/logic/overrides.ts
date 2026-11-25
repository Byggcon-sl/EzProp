import { addDays } from "@/shared/lib/dates";
import type { ComputeOverrideShare, OverrideSummaryMonths } from "../override-types";

/*
 * Rene funksjoner for «Overstyringer for leder» (docs/funksjoner/fase2a-overstyringer-leder.md,
 * A570, A572, A573 og A577). Ingen database og ingen dagens dato: klokka sendes inn.
 *
 * Støtter hovedmål: KI i bunnen (serveren regner alle tall og prosenter, KI formulerer bare) og
 * færre reklamasjoner (riktige tall uten dobbelttelling ved ny versjon).
 */

/**
 * Færre rapporter enn dette i en måned: bare antall, ingen prosent (A570). Samme tall som
 * `AI_OVERRIDE_SHARE_MIN_REPORTS` i `@/core/ai/limits`; står her fordi filen er et rent blad
 * uten import fra KI-modulen. Testen holder dem like.
 */
export const OVERRIDE_SHARE_MIN_REPORTS = 5;

/** Listen viser overstyringer fra i dag og så mange dager tilbake (dag 90 er med, A572). */
export const OVERRIDE_LIST_DAYS = 90;

/** Første dag i listen (norsk dato): `today` minus 90 dager. */
export function overrideListFromDate(today: string): string {
  return addDays(today, -OVERRIDE_LIST_DAYS);
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Kalendermåneden i norsk tid for tidspunktet, `YYYY-MM`. */
export function osloMonthOf(time: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(time).slice(0, 7);
}

/** Måneden `delta` måneder fra `month` (`YYYY-MM`). */
export function shiftMonth(month: string, delta: number): string {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new Error("Ugyldig måned");
  const index = Number(match[1]) * 12 + (Number(match[2]) - 1) + delta;
  const year = Math.floor(index / 12);
  const monthNumber = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

/** Se `OverrideSummaryMonths`: inneværende og de tre siste hele månedene, nyeste først. */
export const overrideSummaryMonths: OverrideSummaryMonths = (now) => {
  const current = osloMonthOf(now);
  return [current, shiftMonth(current, -1), shiftMonth(current, -2), shiftMonth(current, -3)];
};

/** Om `month` er en av de fire månedene som kan velges nå. Alt annet avvises av serveren. */
export function isOverrideSummaryMonth(month: unknown, now: Date): month is string {
  return (
    typeof month === "string" &&
    MONTH_PATTERN.test(month) &&
    overrideSummaryMonths(now).includes(month)
  );
}

/** Se `ComputeOverrideShare`: hele prosent, `null` under fem rapporter (også 0). */
export const computeOverrideShare: ComputeOverrideShare = (count, reportCount) => {
  if (!Number.isInteger(reportCount) || reportCount < OVERRIDE_SHARE_MIN_REPORTS) return null;
  return Math.round((count * 100) / reportCount);
};
