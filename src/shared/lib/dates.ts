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
