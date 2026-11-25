import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import {
  AI_CANDIDATE_TEXT_MAX_LENGTH,
  AiInputTooLargeError,
  OUTCOME_MATCH_CANDIDATES_MAX,
  OUTCOME_MATCH_NOTE_MAX,
  requestSuggestion,
  type AiSuggestionResult,
} from "@/core/ai";
import { db } from "@/db/client";
import { REPORT_NEW_DEVIATION_FIELD_KEY } from "@/shared/config/ai-targets";
import {
  loadLockedTemplate,
  loadRoomContext,
  refKey,
  requireUuid,
  roomDocumentOf,
} from "./context";
import { guardReportErrors, ReportValidationError } from "./errors";
import { listOutcomeMatchCandidates, outcomeMatchCandidateText } from "./logic";
import { findOutcomesInputSchema, parseOrThrow } from "./schemas";
import type { FindOutcomes, FindOutcomesResult, OutcomeMatchHit } from "./types";

/*
 * «Skriv det du ser»: KI finner utfallet (docs/funksjoner/fase2a-skriv-det-du-ser.md, A550–A567).
 * Takstmannen skriver hva han ser, og serveren bygger kandidatene selv fra rommets del av
 * rapportens låste malversjon. KI rangerer bare malens egne utfall og ser aldri TG. Valget lager
 * avviket nøyaktig som et manuelt valg, med beslutningen i samme transaksjon; KI setter aldri TG,
 * velger aldri utfall og lager aldri avviket selv.
 *
 * Valget og avvisningen står i `./outcome-match-choice` (K2.8: filen som kaller KI, skriver aldri
 * TG). Notatet går bare til `requestSuggestion` (vasket der). Det lagres ikke her, og det står aldri i
 * `ai_usage_log`, `audit_log`, logger eller feil.
 *
 * Hovedmål: KI i bunnen (forslag, beslutning og logg gjennom `@/core/ai`) og færre reklamasjoner
 * (et valgt treff gir samme avvik som manuelt valg, og et søk gir høyst ett avvik, A564).
 */

const TEMPLATE_OUTCOME = "template_outcome";

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Treffene i rekkefølgen KI ga. En kandidat som ikke står i listen, eller står to ganger, tas bort. */
function hitsFrom(
  result: Extract<AiSuggestionResult, { kind: "candidates" }>,
  candidates: readonly OutcomeMatchHit[],
): OutcomeMatchHit[] {
  const out: OutcomeMatchHit[] = [];
  for (const ref of result.candidates) {
    const found = candidates.find((c) => c.ref.source === ref.source && sameId(c.ref.id, ref.id));
    if (found && !out.includes(found)) out.push(found);
  }
  return out;
}

/** Se `FindOutcomes` i `./types`. */
export const findOutcomes: FindOutcomes = async (actor, organizationId, room, input) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(room?.assignmentId, room?.roomId, input?.requestId);
  // Fødselsnummer stoppes her, før rommet leses; feilen gjengir aldri notatet (A567)
  const values = parseOrThrow(findOutcomesInputSchema, input);
  return guardReportErrors("outcome_match", async (): Promise<FindOutcomesResult> => {
    const context = await loadRoomContext(db, grant, room, { lock: false });
    // Publisert rapport: ingen nye KI-forslag før «Lag ny versjon» (ADR 0015 punkt 15)
    if (context.report?.status === "published") {
      throw new ReportValidationError("report_published");
    }
    if (!context.report || context.report.status !== "draft") throw new AccessDeniedError();
    const reportId = context.report.id;
    const template = await loadLockedTemplate(db, actor, grant, context.report.templateVersionId);
    // TG-logikken og utfallene finnes bare i systemmalen for tilstandsrapport (regel 5)
    if (template.kind !== "system" || template.reportType !== "condition_report") {
      throw new ReportValidationError("not_applicable");
    }
    const roomDoc = roomDocumentOf(template.document, context.room.group);
    if (
      values.openCheckpointKey !== null &&
      !roomDoc.checkpoints.some((c) => c.key === values.openCheckpointKey)
    ) {
      throw new ReportValidationError("unknown_key");
    }

    const note = values.note.trim();
    if (note === "") throw new ReportValidationError("invalid_input");
    if (note.length > OUTCOME_MATCH_NOTE_MAX) return { status: "note_too_long" };

    // Alle utfallene for rommets romtype i den låste versjonen, det åpne punktet først (A554)
    const listed = listOutcomeMatchCandidates(roomDoc, values.openCheckpointKey);
    // Romtype uten utfall: «Ingen utfall passer» uten kall og uten rad
    if (listed.length === 0) return { status: "no_match", usageId: null };
    // Aldri stille kutt (A554): for mange gir egen melding, uten kall og uten rad
    if (listed.length > OUTCOME_MATCH_CANDIDATES_MAX) return { status: "too_many_candidates" };

    const candidates: (OutcomeMatchHit & { text: string })[] = listed.map((hit) => {
      const id = template.outcomeIdByRef.get(
        refKey(hit.checkpointKey, hit.questionKey, hit.outcomeKey),
      );
      // Dokumentet og radene kommer fra samme låste versjon; mangler id-en, er malen ødelagt
      if (!id) throw new Error("outcome_match: utfallet mangler rad i malversjonen");
      return {
        ...hit,
        ref: { source: TEMPLATE_OUTCOME, id: id.toLowerCase() },
        text: outcomeMatchCandidateText(hit),
      };
    });
    if (candidates.some((c) => c.text.length > AI_CANDIDATE_TEXT_MAX_LENGTH)) {
      return { status: "too_many_candidates" };
    }

    let result: AiSuggestionResult;
    try {
      result = await requestSuggestion(
        grant,
        {
          requestId: values.requestId,
          feature: "outcome_match",
          assignmentId: null,
          reportId: null,
          // Målet deles av hele rapporten (A550, A555); rommet er aldri en del av det
          target: { type: "report", id: reportId, fieldKey: REPORT_NEW_DEVIATION_FIELD_KEY },
          fields: { text: note },
        },
        {
          candidates: candidates.map((c) => ({ source: c.ref.source, id: c.ref.id, text: c.text })),
        },
      );
    } catch (error) {
      if (error instanceof AiInputTooLargeError) return { status: "too_many_candidates" };
      throw error;
    }
    switch (result.kind) {
      case "candidates": {
        const hits = hitsFrom(
          result,
          candidates.map(({ text: _text, ...hit }) => hit),
        );
        if (hits.length === 0) return { status: "no_match", usageId: result.usageId };
        return { status: "ranked", usageId: result.usageId, hits };
      }
      case "no_match":
        return { status: "no_match", usageId: result.usageId };
      case "disabled":
      case "blocked":
        return { status: "ai_off" };
      default:
        // `error`, og svar som ikke hører til funksjonen (tekst, stoppet): tekstsøket står
        return { status: "ai_error" };
    }
  });
};
