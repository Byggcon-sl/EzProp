import type { TemplateDocument } from "@/core/templates";
import type { OutcomeKind } from "@/db/schema";

/**
 * Søk etter avvik i «+ Avvik» (A382). Kjøres i nettleseren over maldokumentet som alt er lastet:
 * ingen KI og ingen serverkall. Dokumentet er rapportens låste malversjon, så utfall som er
 * arkivert (fjernet fra versjonen) eller hører til andre versjoner, kommer aldri med.
 */

export type OutcomeSearchDocument = Pick<
  TemplateDocument,
  "checkpoints" | "deviation_questions" | "outcomes"
>;

export type OutcomeSearchHit = {
  checkpointKey: string;
  /** Punktnavnet, slik at treff på andre punkter kan vises med det. */
  checkpointName: string;
  questionKey: string;
  questionText: string;
  outcomeKey: string;
  outcomeKind: OutcomeKind;
  /** Avviksteksten fra malen, som vises som utfallets navn. */
  deviationText: string;
};

/** Søketekst: små bokstaver (også Æ, Ø og Å), samme Unicode-form og ett mellomrom mellom ordene. */
export function normalizeSearchText(text: string): string {
  return text.normalize("NFC").toLocaleLowerCase("nb").replace(/\s+/gu, " ").trim();
}

function sortKey(...orders: (number | undefined)[]): number[] {
  return orders.map((order) => order ?? Number.MAX_SAFE_INTEGER);
}

function compareOrders(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Utfallene der alle ordene i søket står i avviksteksten, spørsmålet eller punktnavnet, i malens
 * rekkefølge (punkt, spørsmål, utfall). Tomt søk gir alle utfall. Ingen treff gir tom liste.
 */
export function searchOutcomes(document: OutcomeSearchDocument, query: string): OutcomeSearchHit[] {
  const terms = normalizeSearchText(query)
    .split(" ")
    .filter((term) => term !== "");
  const checkpoints = new Map(document.checkpoints.map((c) => [c.key, c]));
  const questions = new Map(
    document.deviation_questions.map((q) => [`${q.checkpoint_key}/${q.key}`, q]),
  );

  const hits: { hit: OutcomeSearchHit; order: number[] }[] = [];
  for (const outcome of document.outcomes) {
    const checkpoint = checkpoints.get(outcome.checkpoint_key);
    const question = questions.get(`${outcome.checkpoint_key}/${outcome.question_key}`);
    if (!checkpoint || !question) continue;
    const deviationText = outcome.deviation_text ?? "";
    const haystack = normalizeSearchText([deviationText, question.text, checkpoint.name].join(" "));
    if (!terms.every((term) => haystack.includes(term))) continue;
    hits.push({
      hit: {
        checkpointKey: checkpoint.key,
        checkpointName: checkpoint.name,
        questionKey: question.key,
        questionText: question.text,
        outcomeKey: outcome.key,
        outcomeKind: outcome.kind,
        deviationText,
      },
      order: sortKey(checkpoint.sort_order, question.sort_order, outcome.sort_order),
    });
  }
  return hits.sort((a, b) => compareOrders(a.order, b.order)).map(({ hit }) => hit);
}
