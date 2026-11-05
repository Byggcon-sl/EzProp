/*
 * Datoer og klokkeslett for arbeidskøen og kortet «Befaring og frist», alltid i norsk tid
 * (Europe/Oslo). Rene funksjoner; `now` sendes inn, så testene kan sette datoen selv.
 */

const TIME_ZONE = "Europe/Oslo";

const dayMonth = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "short",
  timeZone: TIME_ZONE,
});
const dayMonthYear = new Intl.DateTimeFormat("nb-NO", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
});
const clock = new Intl.DateTimeFormat("nb-NO", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});
/** Svensk format gir «ÅÅÅÅ-MM-DD TT:MM», som passer til `datetime-local`. */
const isoLocal = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: TIME_ZONE,
});
const year = new Intl.DateTimeFormat("sv-SE", { year: "numeric", timeZone: TIME_ZONE });

/** Et tidspunkt midt på dagen i UTC for en ren dato, så datoen ikke flytter seg med tidssonen. */
function middayOf(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

/** «6. nov.», med årstall når datoen ikke er i inneværende år («6. nov. 2027»). */
function shortDate(date: Date, now: Date): string {
  return year.format(date) === year.format(now) ? dayMonth.format(date) : dayMonthYear.format(date);
}

/** Frist (ren dato «ÅÅÅÅ-MM-DD») i kortform. Ugyldig verdi vises som den er. */
export function formatDueDate(isoDate: string, now: Date): string {
  const date = middayOf(isoDate);
  return date ? shortDate(date, now) : isoDate;
}

/** Befaring i kortform med klokkeslett: «6. nov. kl. 09:00». */
export function formatInspectionAt(at: Date, now: Date): string {
  return `${shortDate(at, now)} kl. ${clock.format(at).replace(".", ":")}`;
}

/** Verdien til et `datetime-local`-felt («ÅÅÅÅ-MM-DDTTT:MM») i norsk tid. */
export function toDateTimeLocal(at: Date): string {
  return isoLocal.format(at).replace(" ", "T");
}
