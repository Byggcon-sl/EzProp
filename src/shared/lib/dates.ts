/**
 * Rene datoer («ÅÅÅÅ-MM-DD») i norsk tid. «I dag» regnes her, ikke i databasen, fordi
 * databasen kan stå i UTC og testene må kunne sette datoen selv.
 */

/** Dagens dato i Norge som «ÅÅÅÅ-MM-DD». `now` kan sendes inn i tester. */
export function todayInOslo(now: Date = new Date()): string {
  // Svensk format gir ÅÅÅÅ-MM-DD
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(now);
}

/** Legger til (eller trekker fra) hele dager på en ren dato. Regnes i UTC, så sommertid spiller ingen rolle. */
export function addDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Ugyldig dato: ${isoDate}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Klokkeslett fra skjemaet uten tidssone («2026-11-03T10:15»): leses som norsk tid. */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

const osloParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Oslo",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Hvor mange millisekunder norsk tid ligger foran UTC i øyeblikket `time`. */
function osloOffset(time: number): number {
  const parts = Object.fromEntries(
    osloParts.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(time / 1000) * 1000;
}

/**
 * Gjør tekst eller dato om til et tidspunkt. Tekst uten tidssone («2026-11-03T10:15», fra
 * `datetime-local`) leses som norsk tid. Ugyldig gir `null`.
 */
export function parseOsloDateTime(value: string | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = value.trim();
  const local = LOCAL_DATE_TIME.exec(text);
  if (local) {
    const [year, month, day, hour, minute, second] = local.slice(1).map((v) => Number(v ?? 0));
    const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
    const check = new Date(wall);
    if (
      check.getUTCMonth() !== month! - 1 ||
      check.getUTCDate() !== day! ||
      hour! > 23 ||
      minute! > 59 ||
      second! > 59
    ) {
      return null;
    }
    // To runder, så tidspunkt rett ved bytte til og fra sommertid blir riktig.
    const first = wall - osloOffset(wall);
    return new Date(wall - osloOffset(first));
  }
  // Ellers bare ISO-tekst med dato først (med eller uten tidssone).
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  // Avvis datoer som ikke finnes, for eksempel 2026-02-30
  if (text.length === 10 && parsed.toISOString().slice(0, 10) !== text) return null;
  return parsed;
}
