import { or, sql, type AnyColumn, type SQL } from "drizzle-orm";

/** Søket kortes til så mange tegn. Lengre tekst gir ingen feil. */
export const MAX_QUERY_LENGTH = 100;

/** Listene gir høyst så mange rader. */
export const LIST_LIMIT = 200;

/** `limit` kan bare gjøre listen kortere (høyst `LIST_LIMIT`), for eksempel 10 i kontaktvelgeren. */
export type ListOptions = { query?: string | null; limit?: number };

/** Antall rader: `limit` når den er et positivt heltall under `LIST_LIMIT`, ellers `LIST_LIMIT`. */
export function listLimit(options: ListOptions): number {
  const limit = options.limit;
  if (limit === undefined || !Number.isInteger(limit) || limit <= 0) return LIST_LIMIT;
  return Math.min(limit, LIST_LIMIT);
}

/**
 * Gjør søketeksten om til et `ILIKE`-mønster: trimmet, høyst 100 tegn, og `\`, `%` og `_`
 * escapes slik at de søker etter tegnet. Tom tekst gir `null` (ingen filtrering).
 */
export function searchPattern(query: string | null | undefined): string | null {
  const trimmed = query?.trim().slice(0, MAX_QUERY_LENGTH).trim();
  if (!trimmed) return null;
  return `%${trimmed.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/** Treff når minst én av kolonnene inneholder mønsteret (uten hensyn til store og små bokstaver). */
export function matchesAny(pattern: string, columns: AnyColumn[]): SQL | undefined {
  return or(...columns.map((column) => sql`${column} ilike ${pattern} escape '\\'`));
}
