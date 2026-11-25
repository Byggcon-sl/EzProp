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
 * Kontrakten står øverst, funksjonene (`similarityTerms`, `scoreTextSimilarity`,
 * `rankBySimilarity`) og grensen `SIMILARITY_MIN_SCORE` under, med `text-similarity.test.ts` ved
 * siden av. Grensen er satt sammen med evalueringssettet: sakene for hulltaking og normal slitasje
 * gir tom liste hver for seg, mens motsakene treffer.
 *
 * I tillegg til kontrakten (valgt av utvikleren 24.11.2026, lett å endre): ord på under fire
 * bokstaver er småord, første del (minst fire bokstaver) eller siste del (minst fem) av et sammensatt ord finnes
 * («hull» i «hulltaking»), og et tall i notatet finnes når teksten har et flettefelt.
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

// --- Gjennomføringen ----------------------------------------------------------------------------

/**
 * Laveste poeng som regnes som treff («ingen passer» under). Satt sammen med evalueringssettet
 * (`src/core/ai/evals/outcome_match.cases.json`): et notat der bare halvparten av ordene finnes i
 * teksten («litt slitt fuge», «hulltaking ikke utført, eier nektet»), gir ingen treff, mens et
 * notat der de fleste ordene finnes («riss i fuge på gulvet», «sprekk i flis ved sluket»), treffer.
 */
export const SIMILARITY_MIN_SCORE = 0.55;

/**
 * Korteste ord som teller. Kortere ord er småord («i», «på», «ved», «løs», «noe»). Tall teller
 * alltid.
 */
const MIN_WORD_LENGTH = 4;
/** Korteste ord der én bokstav feil tillates. */
const MIN_TYPO_LENGTH = 5;
/** Korteste første del av et sammensatt ord som teller («hull» i «hulltaking», «gulv» i «gulvflis»). */
const MIN_COMPOUND_FIRST_PART = 4;
/**
 * Korteste siste del av et sammensatt ord som teller («membran» i «smøremembran»). Lengre enn
 * første del, så «merker» ikke finnes i «bruksmerker» og «flis» ikke i «gulvflis» på veggen.
 */
const MIN_COMPOUND_LAST_PART = 5;
/** Korteste stamme etter at en endelse er kuttet. */
const MIN_STEM_LENGTH = 3;

/**
 * Småord som aldri gir poeng. Ord på under fire bokstaver tas bort uansett, så listen har bare de
 * lengre. Fast liste: endres den, endres treffene i evalueringssettet.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  "alle",
  "andre",
  "både",
  "bare",
  "blir",
  "dette",
  "denne",
  "disse",
  "eller",
  "etter",
  "ganske",
  "hele",
  "hver",
  "ikke",
  "ingen",
  "inne",
  "kanskje",
  "kunne",
  "litt",
  "mange",
  "mellom",
  "nede",
  "noen",
  "også",
  "oppe",
  "over",
  "samme",
  "siden",
  "skal",
  "slik",
  "under",
  "veldig",
  "være",
  "vært",
]);

/** Omtaler av TG. KI og søket rangerer likhet, aldri alvor. */
const TG_WORD = /^(?:tg|tg[0-3]|tgiu|tilstandsgrad(?:er|en|ene)?)$/u;
const TG_DIGIT = /^[0-3]$/u;
const NUMBER = /^\p{N}+$/u;
const MERGE_FIELD = /\{[^{}]+\}/u;
const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

/** Bøyde former som ikke følger de faste endelsene. */
const IRREGULAR_FORMS: ReadonlyMap<string, string> = new Map([
  ["sprakk", "sprekk"],
  ["sprekt", "sprekk"],
  ["sprukken", "sprekk"],
  ["sprukket", "sprekk"],
  ["sprukne", "sprekk"],
  ["golv", "gulv"],
  ["golvet", "gulv"],
]);

/** Enkle bøyningsendelser, lengste først. Bare én kuttes. */
const SUFFIXES = ["ene", "ane", "er", "en", "et", "a", "e"] as const;

function stem(word: string): string {
  const irregular = IRREGULAR_FORMS.get(word);
  if (irregular !== undefined) return irregular;
  for (const suffix of SUFFIXES) {
    if (word.endsWith(suffix) && [...word].length - suffix.length >= MIN_STEM_LENGTH) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/**
 * Se `SimilarityTerms`. Ord på under fire bokstaver regnes som småord; tall teller alltid. Stammen
 * kan bli kortere enn ordet («fuge» → «fug»).
 */
export const similarityTerms: SimilarityTerms = (text) => {
  if (typeof text !== "string" || text === "") return [];
  const words = text.normalize("NFC").toLocaleLowerCase("nb").split(WORD_SPLIT);
  const terms: string[] = [];
  const seen = new Set<string>();
  let afterTg = false;
  for (const word of words) {
    if (word === "") continue;
    if (TG_WORD.test(word)) {
      // «TG 3» og «TG-3»: tallet etter «tg» er også en omtale av TG.
      afterTg = word === "tg";
      continue;
    }
    if (afterTg && TG_DIGIT.test(word)) {
      afterTg = false;
      continue;
    }
    afterTg = false;
    let term: string;
    if (NUMBER.test(word)) {
      term = word;
    } else {
      if ([...word].length < MIN_WORD_LENGTH || STOP_WORDS.has(word)) continue;
      term = stem(word);
    }
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
};

/**
 * Om to ord skiller seg med høyst én bokstav: byttet, manglende, ekstra, eller to naboer som har
 * byttet plass («membarn» og «membran»).
 */
function withinOneEdit(a: readonly string[], b: readonly string[]): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const restEquals = (x: number, y: number) => a.slice(x).join("") === b.slice(y).join("");
  if (a.length === b.length) {
    if (restEquals(i + 1, i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && restEquals(i + 2, i + 2);
  }
  return a.length > b.length ? restEquals(i + 1, i) : restEquals(i, i + 1);
}

/**
 * Om ordet fra notatet finnes blant ordene i teksten: likt, én bokstav feil (begge minst fem
 * bokstaver), eller første del (minst fire bokstaver) eller siste del (minst fem) av et sammensatt ord («hull» i
 * «hulltaking», «membran» i «smøremembran»). Et tall i notatet finnes også når malens tekst har
 * et flettefelt (`{måleverdi}`, `{årstall}`), fordi målingen eller årstallet skal stå der.
 */
function termFound(
  queryTerm: string,
  textTerms: readonly string[],
  textHasMergeField: boolean,
): boolean {
  if (NUMBER.test(queryTerm)) return textHasMergeField || textTerms.includes(queryTerm);
  const query = [...queryTerm];
  for (const textTerm of textTerms) {
    if (textTerm === queryTerm) return true;
    if (NUMBER.test(textTerm)) continue;
    const other = [...textTerm];
    if (
      query.length >= MIN_TYPO_LENGTH &&
      other.length >= MIN_TYPO_LENGTH &&
      withinOneEdit(query, other)
    ) {
      return true;
    }
    const [shorter, longer] =
      query.length <= other.length ? [queryTerm, textTerm] : [textTerm, queryTerm];
    const partLength = [...shorter].length;
    if (
      (partLength >= MIN_COMPOUND_FIRST_PART && longer.startsWith(shorter)) ||
      (partLength >= MIN_COMPOUND_LAST_PART && longer.endsWith(shorter))
    ) {
      return true;
    }
  }
  return false;
}

/** Se `ScoreTextSimilarity`. */
export const scoreTextSimilarity: ScoreTextSimilarity = (queryTerms, text) => {
  try {
    if (!Array.isArray(queryTerms) || queryTerms.length === 0 || typeof text !== "string") return 0;
    const textTerms = similarityTerms(text);
    const textHasMergeField = MERGE_FIELD.test(text);
    let found = 0;
    for (const term of queryTerms) {
      if (typeof term === "string" && termFound(term, textTerms, textHasMergeField)) found++;
    }
    return found / queryTerms.length;
  } catch {
    return 0;
  }
};

/** Se `RankBySimilarity`. */
export const rankBySimilarity: RankBySimilarity = (query, items, textOf, options) => {
  try {
    const limit = Number.isFinite(options.limit) ? Math.floor(options.limit) : 0;
    if (limit < 1 || !Array.isArray(items) || items.length === 0) return [];
    const minScore =
      typeof options.minScore === "number" && Number.isFinite(options.minScore)
        ? options.minScore
        : SIMILARITY_MIN_SCORE;
    const queryTerms = similarityTerms(typeof query === "string" ? query : "");
    if (queryTerms.length === 0) return [];
    type Scored = { item: (typeof items)[number]; score: number; index: number };
    const scored: Scored[] = [];
    items.forEach((item, index) => {
      let text: string;
      try {
        text = textOf(item);
      } catch {
        return;
      }
      const score = scoreTextSimilarity(queryTerms, text);
      if (score > 0 && score >= minScore) scored.push({ item, score, index });
    });
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.slice(0, limit).map(({ item, score }) => ({ item, score }));
  } catch {
    return [];
  }
};
