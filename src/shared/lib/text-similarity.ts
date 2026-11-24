/*
 * Likhet mellom et kort notat og en liste tekster (A558 og A561,
 * docs/funksjoner/fase2a-skriv-det-du-ser.md «Lagt til av forbedreren» punkt 1). Ren kode uten
 * importer: ingen database, ingen KI og ingen kunnskap om maler eller avvik. Kjøres likt i
 * nettleseren, på iPaden uten nett og på serveren.
 *
 * Hovedmål: best for de ansatte (takstmannen står aldri fast uten nett) og KI i bunnen (den falske
 * leverandøren og «Nærmeste treff (uten KI)» gir samme svar, så det som prøves i test, er det
 * takstmannen får uten KI).
 *
 * Ligger i `src/shared` fordi tre steder bruker den, og de får ikke importere hverandre:
 * `src/core/reports/logic` (utfall og fraser), `src/core/ai/providers/fake.ts` og
 * evalueringssettet i `src/core/ai/evals`.
 *
 * Filen har bare kontrakten. Utvikleren legger funksjonene (`similarityTerms`,
 * `scoreTextSimilarity`, `rankBySimilarity`) og grensen `SIMILARITY_MIN_SCORE` her, med
 * `text-similarity.test.ts` ved siden av. Grensen settes sammen med evalueringssettet: sakene for
 * hulltaking og normal slitasje skal gi tom liste hver for seg.
 */

/**
 * Ordene i en tekst slik likheten regner dem, i rekkefølgen de står, uten doble:
 * - samme Unicode-form (NFC) og små bokstaver (også Æ, Ø og Å);
 * - bare bokstaver og tall teller, alt annet skiller ord;
 * - småord tas bort («i», «ved», «litt», «på» og lignende; fast liste i filen);
 * - omtaler av TG tas bort («tg», «tg0»–«tg3», «tgiu», «tilstandsgrad»), så «dette er TG3» i
 *   notatet aldri flytter et treff (KI og søket rangerer likhet, aldri alvor);
 * - enkle bøyningsendelser kuttes («sprekker» → «sprekk», «flisene» → «flis»).
 *
 * Samme funksjon brukes på notatet og på teksten det sammenlignes med.
 */
export type SimilarityTerms = (text: string) => string[];

/**
 * Hvor godt en tekst passer notatet: andelen av notatets ord som finnes i teksten, fra 0 til 1.
 * Et ord finnes når det er likt et ord i teksten, eller når begge har minst fem bokstaver og
 * skiller seg med én bokstav (byttet, manglende eller ekstra). Ingen ord i notatet gir 0.
 * Rekkefølgen på ordene teller ikke.
 */
export type ScoreTextSimilarity = (queryTerms: readonly string[], text: string) => number;

export type SimilarityMatch<T> = { item: T; score: number };

export type SimilarityOptions = {
  /** Høyeste antall treff. Heltall fra 1. */
  limit: number;
  /** Laveste poeng som regnes som treff. Standard `SIMILARITY_MIN_SCORE`. */
  minScore?: number;
};

/**
 * De beste treffene, høyest poeng først. Likt poeng beholder rekkefølgen i `items`, så samme
 * inndata alltid gir samme svar. Under grensen for alle, eller et notat uten ord igjen etter
 * rensingen, gir tom liste («ingen passer»): aldri «alle».
 *
 * Kaster aldri og logger aldri: notatet og tekstene finnes bare i minnet.
 */
export type RankBySimilarity = <T>(
  query: string,
  items: readonly T[],
  textOf: (item: T) => string,
  options: SimilarityOptions,
) => SimilarityMatch<T>[];
