import { or, sql, type AnyColumn, type SQL } from "drizzle-orm";

/*
 * Mønsteret for søket lages av den felles hjelperen `likePattern` i `@/shared/lib/like-pattern`
 * (ADR 0010), som også ordrelisten og arbeidskøen bruker. Her står bare grensen for listene og
 * vilkåret i Drizzle.
 */

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

/** Treff når minst én av kolonnene inneholder mønsteret (uten hensyn til store og små bokstaver). */
export function matchesAny(pattern: string, columns: AnyColumn[]): SQL | undefined {
  return or(...columns.map((column) => sql`${column} ilike ${pattern} escape '\\'`));
}
