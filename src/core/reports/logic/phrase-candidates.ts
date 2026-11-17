import type { DeviationTg, OutcomeKind, TextStatus } from "@/db/schema";
import { PHRASE_MOST_USED_MIN_COUNT } from "./codes";
import { normalizeSearchText } from "./deviation-search";
import { mergeFieldsText } from "./merge-fields";
import type {
  ListPhraseCandidates,
  MergeFieldKey,
  MergeValues,
  MostUsedPhraseCandidate,
  PhraseCandidate,
  PhraseCandidateContext,
  PhraseCandidateDocument,
  PhraseCandidateOtherTg,
  PhraseField,
  PhraseUsageCount,
  SearchPhraseCandidates,
} from "./types";

/*
 * Forslag fra frasebanken (docs/funksjoner/fase2a-ki-i-veien.md, A426, A433, A437, A463, A467 og
 * A468). Rent blad: samme kode i nettleseren (tekstsøket uten nett) og på serveren (kandidatkilden
 * før KI). Ingen database, ingen KI, ingen ansatt-id.
 */

/** Ledd i rekkefølgen (A433). Lavere tall kommer først. */
const TIER_OWN_OUTCOME = 0;
const TIER_SAME_CHECKPOINT_AND_TG = 1;
const TIER_REST_OF_CHECKPOINT = 2;
const TIER_REST_OF_ROOM = 3;

/** TG teksten er skrevet for. `null` = gjelder begge (velg TG2 eller TG3) eller HMS. */
function candidateTgOf(
  outcomeKind: OutcomeKind,
  appliesToTg: DeviationTg | null,
): DeviationTg | null {
  if (appliesToTg !== null) return appliesToTg;
  if (outcomeKind === "tg2") return 2;
  if (outcomeKind === "tg3") return 3;
  return null;
}

/** Om kandidaten passer avvikets TG (eller HMS). */
function fitsTg(
  context: Pick<PhraseCandidateContext, "kind" | "tg">,
  outcomeKind: OutcomeKind,
  appliesToTg: DeviationTg | null,
): boolean {
  if (context.kind === "hms") return true;
  if (context.tg === null) return false;
  const tg = candidateTgOf(outcomeKind, appliesToTg);
  return tg === null ? outcomeKind === "choose_tg2_tg3" : tg === context.tg;
}

/** Teksten på utfallet for feltet. `new_measure` har ingen utfallstekst. */
function outcomeTextFor(
  outcome: PhraseCandidateDocument["outcomes"][number],
  field: PhraseField,
): string | null {
  switch (field) {
    case "deviation_text":
      return outcome.deviation_text;
    case "cause_text":
      return outcome.default_cause_text;
    case "consequence_text":
      return outcome.default_consequence_text;
    case "new_measure":
      return null;
  }
}

/** Nøkkelen tellingen (A468) og kandidaten deler: feltet og malens faste koder. */
export function phraseUsageKey(
  field: PhraseField,
  checkpointKey: string,
  questionKey: string,
  outcomeKey: string,
  measureSortOrder: number | null,
): string {
  return [field, checkpointKey, questionKey, outcomeKey, measureSortOrder ?? ""].join("|");
}

function compareNumbers(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Om kandidatens slag passer avvikets (A463): HMS bare til HMS, TG aldri til HMS. */
function sameKindGroup(context: Pick<PhraseCandidateContext, "kind">, kind: OutcomeKind): boolean {
  return context.kind === "hms" ? kind === "hms" : kind !== "hms";
}

/** Se `ListPhraseCandidates` i `./types`. */
export const listPhraseCandidates: ListPhraseCandidates = (document, context) => {
  const checkpoints = new Map(document.checkpoints.map((c) => [c.key, c]));
  const questions = new Map(
    document.deviation_questions.map((q) => [`${q.checkpoint_key}|${q.key}`, q]),
  );
  const outcomes = new Map(
    document.outcomes.map((o) => [`${o.checkpoint_key}|${o.question_key}|${o.key}`, o]),
  );
  const counts = new Map<string, number>();
  for (const usage of context.usage) {
    if (usage.field !== context.field || !Number.isInteger(usage.count) || usage.count < 1)
      continue;
    const key = phraseUsageKey(
      usage.field,
      usage.checkpointKey,
      usage.questionKey,
      usage.outcomeKey,
      usage.measureSortOrder,
    );
    counts.set(key, (counts.get(key) ?? 0) + usage.count);
  }

  type Ranked = { candidate: PhraseCandidate; tier: number; order: number[] };
  const ranked: Ranked[] = [];
  const push = (
    outcome: PhraseCandidateDocument["outcomes"][number],
    text: string | null,
    textStatus: TextStatus,
    measure: { appliesToTg: DeviationTg | null; sortOrder: number } | null,
  ) => {
    if (text === null || text.trim() === "") return;
    if (!sameKindGroup(context, outcome.kind)) return;
    const checkpoint = checkpoints.get(outcome.checkpoint_key);
    const question = questions.get(`${outcome.checkpoint_key}|${outcome.question_key}`);
    if (!checkpoint || !question) return;
    const appliesToTg = measure?.appliesToTg ?? null;
    const own =
      outcome.checkpoint_key === context.checkpointKey &&
      outcome.question_key === context.questionKey &&
      outcome.key === context.outcomeKey;
    const sameCheckpoint = outcome.checkpoint_key === context.checkpointKey;
    const tgFits = fitsTg(context, outcome.kind, appliesToTg);
    const tier =
      own && (tgFits || context.tg === null)
        ? TIER_OWN_OUTCOME
        : sameCheckpoint && tgFits
          ? TIER_SAME_CHECKPOINT_AND_TG
          : sameCheckpoint
            ? TIER_REST_OF_CHECKPOINT
            : TIER_REST_OF_ROOM;
    const measureSortOrder = measure?.sortOrder ?? null;
    ranked.push({
      candidate: {
        ref: null,
        checkpointKey: checkpoint.key,
        checkpointName: checkpoint.name,
        questionKey: question.key,
        questionText: question.text,
        outcomeKey: outcome.key,
        outcomeKind: outcome.kind,
        appliesToTg,
        measureSortOrder,
        chosenCount:
          counts.get(
            phraseUsageKey(
              context.field,
              checkpoint.key,
              question.key,
              outcome.key,
              measureSortOrder,
            ),
          ) ?? 0,
        text,
        textStatus,
      },
      tier,
      order: [
        checkpoint.sort_order,
        question.sort_order,
        outcome.sort_order,
        measureSortOrder ?? 0,
      ],
    });
  };

  if (context.field === "new_measure") {
    for (const measure of document.standard_measures) {
      const outcome = outcomes.get(
        `${measure.checkpoint_key}|${measure.question_key}|${measure.outcome_key}`,
      );
      if (!outcome) continue;
      push(outcome, measure.text, measure.text_status, {
        appliesToTg: measure.applies_to_tg,
        sortOrder: measure.sort_order,
      });
    }
  } else {
    for (const outcome of document.outcomes) {
      push(outcome, outcomeTextFor(outcome, context.field), outcome.text_status, null);
    }
  }

  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.candidate.chosenCount - a.candidate.chosenCount ||
      compareNumbers(a.order, b.order),
  );

  const seen = new Set(context.currentTexts.map(normalizeSearchText).filter((t) => t !== ""));
  const out: PhraseCandidate[] = [];
  for (const { candidate } of ranked) {
    const normalized = normalizeSearchText(candidate.text);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(candidate);
  }
  return out;
};

/**
 * Kutter listen etter prioritet (A467): de første `max` beholdes, så de nærmeste leddene i A433
 * aldri kuttes før resten av rommet. `cut` er antallet som falt bort.
 */
export function cutPhraseCandidates<T>(
  candidates: readonly T[],
  max: number,
): { candidates: T[]; cut: number } {
  const keep = Math.max(0, Math.floor(max));
  return {
    candidates: candidates.slice(0, keep),
    cut: Math.max(0, candidates.length - keep),
  };
}

/** Se `SearchPhraseCandidates` i `./types`. Samme normalisering som `searchOutcomes` (A382). */
export const searchPhraseCandidates: SearchPhraseCandidates = (candidates, query, limit) => {
  const max = Math.max(0, Math.floor(limit));
  const terms = normalizeSearchText(query)
    .split(" ")
    .filter((term) => term !== "");
  const hits: PhraseCandidate[] = [];
  for (const candidate of candidates) {
    if (hits.length >= max) break;
    const haystack = normalizeSearchText(
      [candidate.text, candidate.checkpointName, candidate.questionText].join(" "),
    );
    if (terms.every((term) => haystack.includes(term))) hits.push(candidate);
  }
  return hits;
};

/** Se `MostUsedPhraseCandidate` i `./types`. */
export const mostUsedPhraseCandidate: MostUsedPhraseCandidate = (candidates) => {
  let best: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (candidate.chosenCount < PHRASE_MOST_USED_MIN_COUNT) continue;
    if (best === null || candidate.chosenCount > best.chosenCount) best = candidate;
  }
  return best;
};

/** Se `PhraseCandidateOtherTg` i `./types`. */
export const phraseCandidateOtherTg: PhraseCandidateOtherTg = (candidate, deviationTg) => {
  if (deviationTg === null) return null;
  const tg = candidateTgOf(candidate.outcomeKind, candidate.appliesToTg);
  return tg !== null && tg !== deviationTg ? tg : null;
};

/**
 * Kandidatteksten slik den havner i feltet: flettefeltene fylt med verdiene (`fillMergeFields`),
 * og manglende felt tydelig merket, aldri som `{…}`. `missing` gir samme advarsel som ellers i
 * avvikskortet.
 */
export function phraseCandidateText(
  candidate: Pick<PhraseCandidate, "text">,
  values: MergeValues,
): { text: string; missing: MergeFieldKey[] } {
  return mergeFieldsText(candidate.text, values);
}

/** Tellingen samlet for organisasjonen, slått sammen når samme kandidat står flere ganger. */
export function mergePhraseUsage(usage: readonly PhraseUsageCount[]): PhraseUsageCount[] {
  const merged = new Map<string, PhraseUsageCount>();
  for (const entry of usage) {
    if (!Number.isInteger(entry.count) || entry.count < 1) continue;
    const key = phraseUsageKey(
      entry.field,
      entry.checkpointKey,
      entry.questionKey,
      entry.outcomeKey,
      entry.measureSortOrder,
    );
    const existing = merged.get(key);
    merged.set(key, existing ? { ...existing, count: existing.count + entry.count } : { ...entry });
  }
  return [...merged.values()];
}

// --- «Utkast»-merket per felt (designvalg D4) ------------------------------------------------

const MERGE_FIELD = /\{[^{}]+\}/gu;
const HAS_MERGE_FIELD = /\{[^{}]+\}/u;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Malteksten som mønster: flettefeltene kan ha hvilken som helst verdi. */
function templatePattern(templateText: string): RegExp {
  const normalized = normalizeSearchText(templateText);
  let pattern = "";
  let last = 0;
  for (const match of normalized.matchAll(MERGE_FIELD)) {
    pattern += escapeRegExp(normalized.slice(last, match.index));
    pattern += "[\\s\\S]*?";
    last = match.index + match[0].length;
  }
  pattern += escapeRegExp(normalized.slice(last));
  return new RegExp(`^${pattern}$`, "u");
}

export type TemplateTextEntry = { text: string; textStatus: TextStatus };

/**
 * Status for teksten i et felt (designvalg D4): er teksten en av malens tekster for samme felttype
 * (med flettefeltene fylt inn), gis malens `text_status`; ellers `null` (egen eller endret tekst).
 * Store og små bokstaver og mellomrom regnes likt.
 */
export function templateTextStatusMatcher(
  entries: readonly TemplateTextEntry[],
): (text: string | null) => TextStatus | null {
  const exact = new Map<string, TextStatus>();
  const patterns: { pattern: RegExp; status: TextStatus }[] = [];
  for (const entry of entries) {
    if (entry.text.trim() === "") continue;
    const normalized = normalizeSearchText(entry.text);
    if (HAS_MERGE_FIELD.test(normalized)) {
      patterns.push({ pattern: templatePattern(entry.text), status: entry.textStatus });
    } else if (!exact.has(normalized)) {
      exact.set(normalized, entry.textStatus);
    }
  }
  return (text) => {
    if (text === null || text.trim() === "") return null;
    const normalized = normalizeSearchText(text);
    const found = exact.get(normalized);
    if (found) return found;
    return patterns.find((p) => p.pattern.test(normalized))?.status ?? null;
  };
}
