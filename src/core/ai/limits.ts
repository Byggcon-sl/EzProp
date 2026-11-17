/*
 * Grenser som både serveren og klientdelen (`src/core/ai/client`) bruker. Filen har ingen
 * importer, så den kan lastes i nettleseren uten at ledetekstene eller databasen følger med
 * (docs/adr/0006-ki-i-bunnen.md del 10).
 */

/** Høyeste antall tegn i hver verdi i `fields`. */
export const AI_FIELD_MAX_LENGTH = 5000;

/*
 * Grensene under gjelder «KI i veien» (docs/funksjoner/fase2a-ki-i-veien.md). Over en grense gir
 * kjernen en tydelig melding (`AiInputTooLargeError`), aldri stille kutt av kandidater eller funn.
 */

/** Høyeste antall kandidater som sendes til KI i ett kall (`phrase_suggest`). */
export const AI_CANDIDATES_MAX = 60;
/** Høyeste antall tegn i hver kandidattekst. */
export const AI_CANDIDATE_TEXT_MAX_LENGTH = 2000;
/** Høyeste antall kandidater i svaret. Lik `AI_CANDIDATE_REFS_MAX` i `@/db/schema` (CHECK-regelen). */
export const AI_SUGGESTED_CANDIDATES_MAX = 5;
/** Høyeste antall forespørsler i ett trykk: avvik, årsak, konsekvens og 20 tiltak. */
export const AI_BATCH_MAX_REQUESTS = 23;
/** Høyeste antall funn i ett utkast til sammendrag. */
export const AI_SUMMARY_FINDINGS_MAX = 60;
/** Høyeste antall tegn i alle funnene til ett utkast, samlet og etter vask. */
export const AI_SUMMARY_INPUT_MAX_LENGTH = 40000;
