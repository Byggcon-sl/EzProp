import { AI_CANDIDATE_REFS_MAX } from "@/shared/config/ai-targets";
import type { AiCandidate, AiCandidateRef } from "./types";

/*
 * Kandidatkontrakten for `phrase_suggest` (docs/funksjoner/fase2a-ki-i-veien.md «Kandidatkontrakten»,
 * ADR 0006 del 8, A432). Ren: ingen database, ingen leverandør.
 *
 * - Kandidatene får korte merker K1…Kn i den rekkefølgen de kom inn. Tabellen lages på nytt for
 *   hvert kall og lagres aldri, så samme kandidat kan ha ulikt merke i to kall. Id-ene sendes
 *   aldri til leverandøren.
 * - Svaret tolkes strengt: bare merker som ble sendt, doble tas bort, høyst
 *   `AI_CANDIDATE_REFS_MAX` beholdes. Alt annet telles som ukjent. Ingen gyldige gir tom liste
 *   (`no_match`), aldri unntak.
 * - Kalleren får aldri merkene, bare `{ source, id }`.
 */

export type LabeledCandidate = { label: string; candidate: AiCandidate };

/** Merker kandidatene K1…Kn for dette ene kallet. */
export function labelCandidates(candidates: readonly AiCandidate[]): LabeledCandidate[] {
  return candidates.map((candidate, index) => ({ label: `K${index + 1}`, candidate }));
}

export type ParsedCandidateAnswer = {
  /** De gyldige kandidatene, den beste først. Tom liste betyr «ingen passer». */
  refs: AiCandidateRef[];
  /** Merker som ikke ble sendt, og alt i svaret som ikke er et merke. */
  unknownLabels: number;
  /** Merker som sto mer enn én gang. */
  duplicateLabels: number;
};

const LABEL_TOKEN = /^K([1-9]\d*)$/u;
const NO_MATCH_TOKEN = /^ingen$/iu;

/**
 * Tolker svaret fra leverandøren. `answer` er rå tekst («K3, K1»); alt som ikke er tekst, gir tom
 * liste. Merkene leses fra venstre mot høyre, skilt med komma, semikolon, punktum, kolon eller
 * mellomrom.
 */
export function parseCandidateAnswer(
  answer: unknown,
  labeled: readonly LabeledCandidate[],
): ParsedCandidateAnswer {
  const result: ParsedCandidateAnswer = { refs: [], unknownLabels: 0, duplicateLabels: 0 };
  if (typeof answer !== "string") return result;
  const byLabel = new Map(labeled.map((entry) => [entry.label, entry.candidate]));
  const seen = new Set<string>();
  const tokens = answer
    .normalize("NFC")
    .split(/[\s,;.:]+/u)
    .filter((token) => token !== "");
  for (const token of tokens) {
    if (NO_MATCH_TOKEN.test(token)) continue;
    const match = LABEL_TOKEN.exec(token.toUpperCase());
    const label = match ? `K${match[1]}` : null;
    const candidate = label === null ? undefined : byLabel.get(label);
    if (label === null || candidate === undefined) {
      result.unknownLabels += 1;
      continue;
    }
    if (seen.has(label)) {
      result.duplicateLabels += 1;
      continue;
    }
    seen.add(label);
    if (result.refs.length < AI_CANDIDATE_REFS_MAX) {
      result.refs.push({ source: candidate.source, id: candidate.id.toLowerCase() });
    }
  }
  return result;
}

/** Om `ref` står i listen (samme kilde og id, id uten hensyn til store og små bokstaver). */
export function containsCandidate(
  list: readonly AiCandidateRef[] | null | undefined,
  ref: AiCandidateRef,
): boolean {
  if (!list) return false;
  return list.some(
    (entry) => entry.source === ref.source && entry.id.toLowerCase() === ref.id.toLowerCase(),
  );
}
