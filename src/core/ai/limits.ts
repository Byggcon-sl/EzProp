/*
 * Grenser som både serveren og klientdelen (`src/core/ai/client`) bruker. Filen har ingen
 * importer, så den kan lastes i nettleseren uten at ledetekstene eller databasen følger med
 * (docs/adr/0006-ki-i-bunnen.md del 10).
 */

/** Høyeste antall tegn i hver verdi i `fields`. */
export const AI_FIELD_MAX_LENGTH = 5000;
