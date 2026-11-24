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

// --- Implementasjonen -----------------------------------------------------------------------------

/**
 * Laveste poeng (andel av notatets ord) som regnes som treff. Under grensen for alle tekster er
 * svaret «ingen passer». Samme grense i den falske leverandøren og i «Nærmeste treff (uten KI)».
 */
export const SIMILARITY_MIN_SCORE = 0.5;

/** Ord som ikke sier noe om hva takstmannen så. Fast liste (A558). */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "i",
  "ved",
  "litt",
  "på",
  "og",
  "er",
  "en",
  "et",
  "ei",
  "av",
  "til",
  "med",
  "som",
  "det",
  "den",
  "de",
  "dette",
  "denne",
  "for",
  "fra",
  "om",
  "har",
  "var",
  "at",
  "å",
  "så",
  "men",
  "eller",
  "noe",
  "noen",
  "lite",
  "bare",
  "veldig",
  "mye",
  "nok",
  "seg",
]);

/** Omtaler av TG. Tas bort, så alvor aldri flytter et treff. */
const TG_WORDS = /^(?:tg|tg[0-3]|tgiu|tilstandsgrad|tilstandsgrader|tilstandsgraden)$/u;

/** Uregelmessige former som ikke følger endelsene under. */
const IRREGULAR_STEMS: Readonly<Record<string, string>> = {
  sprukket: "sprekk",
  sprukne: "sprekk",
  sprukken: "sprekk",
  sprakk: "sprekk",
};

/** Bøyningsendelser, lengste først. Stammen er alltid minst tre bokstaver. */
const SUFFIXES = ["ene", "ane", "er", "en", "et", "a", "e"] as const;
const MIN_STEM_LENGTH = 3;
const FUZZY_MIN_LENGTH = 5;

function stem(word: string): string {
  if (Object.prototype.hasOwnProperty.call(IRREGULAR_STEMS, word)) {
    return IRREGULAR_STEMS[word] as string;
  }
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM_LENGTH) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

export const similarityTerms: SimilarityTerms = (text) => {
  const words = text
    .normalize("NFC")
    .toLocaleLowerCase("nb-NO")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && !STOP_WORDS.has(word) && !TG_WORDS.test(word));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const term = stem(word);
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
  }
  return out;
};

/**
 * Om to ord skiller seg med høyst én bokstav: byttet, manglende, ekstra, eller to naboer som har
 * byttet plass («membarn» / «membran»).
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) {
        diff.push(i);
        if (diff.length > 2) return false;
      }
    }
    if (diff.length === 1) return true;
    const first = diff[0] as number;
    const second = diff[1] as number;
    return second === first + 1 && a[first] === b[second] && a[second] === b[first];
  }
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      j += 1;
    }
  }
  return true;
}

function termMatches(term: string, textTerms: readonly string[]): boolean {
  for (const other of textTerms) {
    if (other === term) return true;
    if (
      term.length >= FUZZY_MIN_LENGTH &&
      other.length >= FUZZY_MIN_LENGTH &&
      withinOneEdit(term, other)
    ) {
      return true;
    }
  }
  return false;
}

function scoreTerms(queryTerms: readonly string[], textTerms: readonly string[]): number {
  if (queryTerms.length === 0) return 0;
  let found = 0;
  for (const term of queryTerms) if (termMatches(term, textTerms)) found += 1;
  return found / queryTerms.length;
}

export const scoreTextSimilarity: ScoreTextSimilarity = (queryTerms, text) =>
  scoreTerms(queryTerms, similarityTerms(text));

export const rankBySimilarity: RankBySimilarity = (query, items, textOf, options) => {
  const queryTerms = similarityTerms(query);
  const limit = Math.floor(options.limit);
  if (queryTerms.length === 0 || !(limit >= 1)) return [];
  const minScore = options.minScore ?? SIMILARITY_MIN_SCORE;
  const scored: { item: (typeof items)[number]; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const score = scoreTerms(queryTerms, similarityTerms(textOf(item)));
    if (score > 0 && score >= minScore) scored.push({ item, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, limit).map(({ item, score }) => ({ item, score }));
};
