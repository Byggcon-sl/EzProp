import { rankBySimilarity } from "@/shared/lib/text-similarity";
import { searchOutcomes } from "./deviation-search";
import type {
  FindRegisteredDeviation,
  ListOutcomeMatchCandidates,
  OutcomeMatchCandidateText,
  RankOutcomesBySimilarity,
} from "./types";

/*
 * «Skriv det du ser» (docs/funksjoner/fase2a-skriv-det-du-ser.md, A554, A558 og A559). Rent blad:
 * samme kode på serveren (kandidatene til KI) og i nettleseren («Nærmeste treff (uten KI)» og
 * «Registrert fra før»). Ingen database, ingen KI og ingen grenser fra KI-kjernen eller
 * konfigurasjonen: antallet treff kommer inn som parameter (ADR 0013).
 *
 * Hovedmål: best for de ansatte (samme hjelp uten nett) og færre reklamasjoner (avviket lages fra
 * malens eget utfall, og samme avvik registreres ikke to ganger).
 */

/** Om et element fra dokumentet er mykt slettet eller arkivert, når det har feltene. */
function isRemoved(element: object): boolean {
  const record = element as { deleted_at?: unknown; archived_at?: unknown };
  return (
    (record.deleted_at !== undefined && record.deleted_at !== null) ||
    (record.archived_at !== undefined && record.archived_at !== null)
  );
}

/** Se `ListOutcomeMatchCandidates` i `./types`. */
export const listOutcomeMatchCandidates: ListOutcomeMatchCandidates = (
  document,
  openCheckpointKey,
) => {
  // Dokumentet fra en låst malversjon har bare det som gjelder. Sjekken under er en ekstra sikring
  // når et dokument likevel har med slettede eller arkiverte elementer.
  const live = {
    checkpoints: document.checkpoints.filter((c) => !isRemoved(c)),
    deviation_questions: document.deviation_questions.filter((q) => !isRemoved(q)),
    outcomes: document.outcomes.filter((o) => !isRemoved(o)),
  };
  const all = searchOutcomes(live, "");
  if (openCheckpointKey === null) return all;
  const open = all.filter((hit) => hit.checkpointKey === openCheckpointKey);
  if (open.length === 0) return all;
  return [...open, ...all.filter((hit) => hit.checkpointKey !== openCheckpointKey)];
};

/**
 * Se `OutcomeMatchCandidateText` i `./types`. Hver del får en merkelapp («Punkt: … Spørsmål: …
 * Avvikstekst: …»), så KI ser hva som er punkt, spørsmål og tekst, og punktnavnet og spørsmålet
 * aldri flyter sammen til én setning. Tomme deler hoppes over.
 */
export const outcomeMatchCandidateText: OutcomeMatchCandidateText = (hit) =>
  (
    [
      ["Punkt", hit.checkpointName],
      ["Spørsmål", hit.questionText],
      ["Avvikstekst", hit.deviationText],
    ] as const
  )
    .map(([label, text]) => [label, text.replace(/\s+/gu, " ").trim()] as const)
    .filter(([, text]) => text !== "")
    .map(([label, text]) => `${label}: ${/[.!?]$/u.test(text) ? text : `${text}.`}`)
    .join(" ");

/** Se `RankOutcomesBySimilarity` i `./types`. */
export const rankOutcomesBySimilarity: RankOutcomesBySimilarity = (document, note, options) =>
  rankBySimilarity(
    note,
    listOutcomeMatchCandidates(document, options.openCheckpointKey),
    outcomeMatchCandidateText,
    { limit: options.limit },
  ).map((match) => match.item);

/**
 * Se `FindRegisteredDeviation` i `./types`. Et avvik med `deletedAt` satt (når visningen har feltet)
 * teller ikke.
 */
export const findRegisteredDeviation: FindRegisteredDeviation = (hit, checkpoints) => {
  for (const checkpoint of checkpoints) {
    if (checkpoint.checkpointKey !== hit.checkpointKey) continue;
    for (const deviation of checkpoint.deviations) {
      const deletedAt = (deviation as { deletedAt?: unknown }).deletedAt;
      if (deletedAt !== undefined && deletedAt !== null) continue;
      if (deviation.questionKey === hit.questionKey && deviation.outcomeKey === hit.outcomeKey) {
        return deviation.id;
      }
    }
  }
  return null;
};
