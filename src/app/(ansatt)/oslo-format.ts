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

/** Kalenderdagen i norsk tid som «ÅÅÅÅ-MM-DD». */
const osloDay = new Intl.DateTimeFormat("sv-SE", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: TIME_ZONE,
});

/** Dagen før en kalenderdag «ÅÅÅÅ-MM-DD». Regnes på datoen, så sommertid ikke flytter den. */
function previousDay(isoDay: string): string {
  const date = middayOf(isoDay);
  if (!date) return isoDay;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * «Sist brukt» for en innlogging (docs/funksjoner/fase2a-mine-innlogginger.md Omfang 4): «Aktiv
 * nå» på denne enheten, ellers «Aktiv i dag», «Aktiv i går» eller «Aktiv 12. nov.» (med årstall
 * når året er et annet). Dagen regnes i norsk tid. Aldri klokkeslett: `updated_at` fornyes høyst
 * én gang i døgnet, så et klokkeslett ville lovet mer enn dataene holder (A427).
 */
export function sessionLastUsedLabel(lastUsed: Date, now: Date, isCurrent: boolean): string {
  if (isCurrent) return "Aktiv nå";
  const day = osloDay.format(lastUsed);
  const today = osloDay.format(now);
  if (day === today) return "Aktiv i dag";
  if (day === previousDay(today)) return "Aktiv i går";
  return `Aktiv ${shortDate(lastUsed, now)}`;
}

/** «logget inn 3. nov.» (med årstall når året er et annet), uten klokkeslett. */
export function sessionCreatedLabel(createdAt: Date, now: Date): string {
  return `logget inn ${shortDate(createdAt, now)}`;
}
