/*
 * Felles hjelper for tekstsøk (docs/funksjoner/fase2a-sok-ordre-arbeidsko.md, ADR 0010). Ren
 * strengfunksjon uten database, slik at den kan brukes både i kjernen og i tolkingen av adressen.
 * Søketeksten kan inneholde navn, adresse og matrikkel: den logges aldri og sendes aldri til KI.
 */

/** Søket kortes til så mange tegn. Lengre tekst gir ingen feil. */
export const SEARCH_QUERY_MAX_LENGTH = 100;

/**
 * Gjør søketeksten om til et `ILIKE`-mønster for delvis treff: trimmet, høyst
 * `SEARCH_QUERY_MAX_LENGTH` tegn, med `%` foran og bak. `\`, `%` og `_` i teksten escapes, slik at
 * de søker etter tegnet selv. Mønsteret brukes med `escape '\'`. Tom tekst gir `null` (ingen
 * filtrering).
 */
export function likePattern(query: string | null | undefined): string | null {
  const trimmed = query?.trim().slice(0, SEARCH_QUERY_MAX_LENGTH).trim();
  if (!trimmed) return null;
  return `%${trimmed.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
