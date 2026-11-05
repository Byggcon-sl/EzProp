import { or, sql, type AnyColumn, type SQL } from "drizzle-orm";

/** Søket kortes til så mange tegn. Lengre tekst gir ingen feil. */
export const MAX_QUERY_LENGTH = 100;

/** Listene gir høyst så mange rader. */
export const LIST_LIMIT = 200;

export type ListOptions = { query?: string | null };

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
