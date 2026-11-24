/*
 * Grenser som både serveren og klientdelen (`src/core/ai/client`) bruker. Filen har ingen
 * importer, så den kan lastes i nettleseren uten at ledetekstene eller databasen følger med
 * (docs/adr/0006-ki-i-bunnen.md del 10).
 */

/** Høyeste antall tegn i hver verdi i `fields`. */
export const AI_FIELD_MAX_LENGTH = 5000;

/*
 * Grensene under gjelder «KI i veien» (docs/funksjoner/fase2a-ki-i-veien.md). Over en grense gir
 * kjernen en tydelig melding (`AiInputTooLargeError`). Kjernen kutter aldri selv.
 */

/**
 * Høyeste antall kandidater som sendes til KI i ett kall (`phrase_suggest`). Kandidatkilden i
 * `@/core/reports` kutter etter prioritet ned til grensen og fører antallet i `input_summary`
 * (A467). Kommer det likevel flere inn til kjernen, er det en feil hos kalleren.
 */
export const AI_CANDIDATES_MAX = 60;
/** Høyeste antall tegn i hver kandidattekst. */
export const AI_CANDIDATE_TEXT_MAX_LENGTH = 2000;
/*
 * Høyeste antall kandidater i svaret står ikke her: `AI_SUGGESTED_CANDIDATES_MAX` i `index.ts` er
 * `AI_CANDIDATE_REFS_MAX` fra `@/shared/config/ai-targets`, samme tall som CHECK-regelen bruker.
 * Nettleseren leser `AI_CANDIDATE_REFS_MAX` direkte derfra.
 */
/** Høyeste antall forespørsler i ett trykk: avvik, årsak, konsekvens og 20 tiltak. */
export const AI_BATCH_MAX_REQUESTS = 23;
/** Høyeste antall funn i ett utkast til sammendrag. */
export const AI_SUMMARY_FINDINGS_MAX = 60;
/** Høyeste antall tegn i alle funnene til ett utkast, samlet og etter vask. */
export const AI_SUMMARY_INPUT_MAX_LENGTH = 40000;

/*
 * Grensene under gjelder «Skriv det du ser» (`outcome_match`,
 * docs/funksjoner/fase2a-skriv-det-du-ser.md, ADR 0006 tillegg 24.11.2026). Skjermen, rapportkjernen
 * og KI-kjernen leser de samme tallene herfra.
 */

/** Høyeste antall treff i svaret fra `outcome_match` (A553). Innenfor `AI_CANDIDATE_REFS_MAX`. */
export const OUTCOME_MATCH_MAX = 3;
/**
 * Høyeste antall utfall som sendes som kandidater i ett `outcome_match`-kall (A554). Innenfor
 * `AI_CANDIDATES_MAX`. Har rommets romtype flere utfall, gjøres det ikke noe kall, og ingenting
 * kuttes: rapportkjernen svarer `too_many_candidates`, og tekstsøket står.
 */
export const OUTCOME_MATCH_CANDIDATES_MAX = 60;
/**
 * Høyeste antall tegn i notatet til `outcome_match` (A560), regnet etter `trim()`. Over grensen
 * gjøres ikke noe kall og ingen rad logges.
 */
export const OUTCOME_MATCH_NOTE_MAX = 500;
