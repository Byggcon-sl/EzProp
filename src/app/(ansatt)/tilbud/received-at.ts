/**
 * Tidspunktet «Mottatt» i skjemaet (`datetime-local`, uten tidssone) regnes alltid i norsk tid,
 * uansett hvilken tidssone serveren står i.
 */

const TIME_ZONE = "Europe/Oslo";

const osloParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partsInOslo(date: Date) {
  const parts = Object.fromEntries(
    osloParts.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    year: parts.year ?? "",
    month: parts.month ?? "",
    day: parts.day ?? "",
    hour: parts.hour ?? "",
    minute: parts.minute ?? "",
  };
}

/** Hvor mange millisekunder norsk tid ligger foran UTC på tidspunktet. */
function osloOffset(date: Date): number {
  const p = partsInOslo(date);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** «2026-11-04T10:30» i norsk tid, til forhåndsutfylling av feltet. */
export function osloDateTimeLocal(now: Date): string {
  const p = partsInOslo(now);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** «2026-11-04T10:30» (norsk tid) blir et tidspunkt. Annet format gir `null`. */
export function parseOsloDateTimeLocal(text: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute] = [1, 2, 3, 4, 5].map((index) => Number(match[index]));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = new Date(guess - osloOffset(new Date(guess)));
  const result = new Date(guess - osloOffset(first));
  return Number.isNaN(result.getTime()) ? null : result;
}

/** «04.11.2026» i norsk tid. */
export function formatOsloDate(value: Date | string): string {
  const p = partsInOslo(new Date(value));
  return `${p.day}.${p.month}.${p.year}`;
}

/** «04.11.2026 kl. 10:30» i norsk tid. */
export function formatOsloDateTime(value: Date | string): string {
  const p = partsInOslo(new Date(value));
  return `${p.day}.${p.month}.${p.year} kl. ${p.hour}:${p.minute}`;
}
