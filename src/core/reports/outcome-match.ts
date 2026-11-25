import { and, eq, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import {
  AI_CANDIDATE_TEXT_MAX_LENGTH,
  AiDecisionError,
  AiInputTooLargeError,
  OUTCOME_MATCH_CANDIDATES_MAX,
  OUTCOME_MATCH_NOTE_MAX,
  recordDecisionIn,
  requestSuggestion,
  type AiCandidateRef,
  type AiSuggestionResult,
} from "@/core/ai";
import { db } from "@/db/client";
import { aiUsageLog, type AiSuggestionStatus } from "@/db/schema";
import { REPORT_NEW_DEVIATION_FIELD_KEY } from "@/shared/config/ai-targets";
import { loadLockedTemplate, loadRoomContext, refKey, requireUuid, roomDocumentOf } from "./context";
import { createDeviationFromOutcome } from "./deviations";
import { guardReportErrors, ReportValidationError } from "./errors";
import { listOutcomeMatchCandidates, outcomeMatchCandidateText } from "./logic";
import {
  chooseOutcomeMatchInputSchema,
  findOutcomesInputSchema,
  parseOrThrow,
  rejectOutcomeMatchInputSchema,
} from "./schemas";
import type {
  ChooseOutcomeMatch,
  ChooseOutcomeMatchResult,
  FindOutcomes,
  FindOutcomesResult,
  OutcomeMatchHit,
  RejectOutcomeMatch,
} from "./types";
import { refreshOf, withRoomWrite, type WriteScope } from "./write";

/*
 * «Skriv det du ser»: KI finner utfallet (docs/funksjoner/fase2a-skriv-det-du-ser.md, A550–A567).
 * Takstmannen skriver hva han ser, og serveren bygger kandidatene selv fra rommets del av
 * rapportens låste malversjon. KI rangerer bare malens egne utfall og ser aldri TG. Valget lager
 * avviket nøyaktig som et manuelt valg, med beslutningen i samme transaksjon; KI setter aldri TG,
 * velger aldri utfall og lager aldri avviket selv.
 *
 * Notatet går bare til `requestSuggestion` (vasket der). Det lagres ikke her, og det står aldri i
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

/**
 * Bindingen av loggraden (A564, lærdommen fra PR #234). Leses i skrivetransaksjonen, etter at
 * rapportraden er låst: samme organisasjon, ikke slettet, `outcome_match`, denne rapporten, målet
 * `report` / `new_deviation` på rapporten, utfallet `ok`, og kandidaten (når den er med) i
 * `candidate_refs` med kilden `template_outcome`. Ellers 404, og ingenting er endret. Svaret er
 * radens status.
 */
async function bindOutcomeMatchRow(
  scope: WriteScope,
  usageId: string,
  candidate: AiCandidateRef | null,
): Promise<AiSuggestionStatus> {
  const [row] = await scope.tx
    .select({
      feature: aiUsageLog.feature,
      reportId: aiUsageLog.reportId,
      targetRef: aiUsageLog.targetRef,
      outcome: aiUsageLog.outcome,
      status: aiUsageLog.status,
      candidateRefs: aiUsageLog.candidateRefs,
    })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.organizationId, scope.orgId),
        eq(aiUsageLog.id, usageId),
        isNull(aiUsageLog.deletedAt),
      ),
    );
  const target = row?.targetRef;
  if (
    !row ||
    row.feature !== "outcome_match" ||
    row.reportId === null ||
    !sameId(row.reportId, scope.reportId) ||
    !target ||
    target.type !== "report" ||
    typeof target.id !== "string" ||
    !sameId(target.id, scope.reportId) ||
    target.fieldKey !== REPORT_NEW_DEVIATION_FIELD_KEY ||
    row.outcome !== "ok" ||
    row.status === null
  ) {
    throw new AccessDeniedError();
  }
  if (candidate !== null) {
    const listed =
      candidate.source === TEMPLATE_OUTCOME &&
      (row.candidateRefs ?? []).some(
        (ref) => ref.source === TEMPLATE_OUTCOME && sameId(ref.id, candidate.id),
      );
    if (!listed) throw new AccessDeniedError();
  }
  return row.status;
}

/**
 * Utfallet for kandidaten, utledet av `outcomes.id` i rapportens låste malversjon og kontrollert
 * mot rommets romtype. Aldri koder fra klienten. Ellers 404.
 */
function outcomeOfCandidate(scope: WriteScope, outcomeId: string) {
  const ref = scope.template.outcomeRefById.get(outcomeId);
  const inRoom =
    ref !== undefined &&
    scope.roomDoc.outcomes.some(
      (o) =>
        o.checkpoint_key === ref.checkpointKey &&
        o.question_key === ref.questionKey &&
        o.key === ref.outcomeKey,
    );
  if (!ref || !inRoom) throw new AccessDeniedError();
  return ref;
}

/** Se `ChooseOutcomeMatch` i `./types`. */
export const chooseOutcomeMatch: ChooseOutcomeMatch = async (
  actor,
  organizationId,
  room,
  input,
) => {
  try {
    return await withRoomWrite(
      actor,
      organizationId,
      room,
      async (scope): Promise<ChooseOutcomeMatchResult> => {
        requireUuid(input?.usageId, input?.candidate?.id, input?.deviationId);
        const values = parseOrThrow(chooseOutcomeMatchInputSchema, input);
        const usageId = values.usageId.toLowerCase();
        const candidate: AiCandidateRef = {
          source: values.candidate.source,
          id: values.candidate.id.toLowerCase(),
        };
        const status = await bindOutcomeMatchRow(scope, usageId, candidate);
        const ref = outcomeOfCandidate(scope, candidate.id);

        // 1. Nøyaktig samme avvik som «+ Avvik» gir for utfallet: ingen regel og ingen annen TG
        const created = await createDeviationFromOutcome(scope, {
          id: values.deviationId,
          checkpointKey: ref.checkpointKey,
          questionKey: ref.questionKey,
          outcomeKey: ref.outcomeKey,
          tg: values.tg,
          tgiuChoice: values.tgiuChoice,
          usageId,
        });
        // 2. TGIU på punktet: ingenting lagret, og ingen beslutning
        if (created.status === "tgiu_conflict") return { status: "tgiu_conflict" };
        if (created.status === "exists") {
          // 3. Gjentatt kall (A563): samme avvik og samme utfall, uten ny beslutning
          if (
            created.deviation.outcomeId === null ||
            !sameId(created.deviation.outcomeId, candidate.id)
          ) {
            throw new AccessDeniedError();
          }
        } else {
          // 4. Søket er brukt (A564): rull tilbake det nye avviket. `recordDecisionIn` ville tålt
          //    `accepted` to ganger og sluppet et avvik nummer to gjennom.
          if (status === "accepted") throw new AiDecisionError();
          // 5. Beslutningen i samme transaksjon. Avvist av et nyere søk gir `AiDecisionError`.
          await recordDecisionIn(scope.tx, scope.grant, usageId, "accepted", { candidate });
        }
        return {
          status: "saved",
          checkpointKey: ref.checkpointKey,
          deviationId: created.deviation.id,
          refresh: await refreshOf(scope),
        };
      },
    );
  } catch (error) {
    // Fanges utenfor transaksjonen, så avviket aldri blir stående (A563)
    if (error instanceof AiDecisionError) return { status: "suggestion_outdated" };
    throw error;
  }
};

/** Se `RejectOutcomeMatch` i `./types`. */
export const rejectOutcomeMatch: RejectOutcomeMatch = async (
  actor,
  organizationId,
  room,
  input,
) => {
  try {
    return await withRoomWrite(actor, organizationId, room, async (scope) => {
      requireUuid(input?.usageId);
      const values = parseOrThrow(rejectOutcomeMatchInputSchema, input);
      const usageId = values.usageId.toLowerCase();
      await bindOutcomeMatchRow(scope, usageId, null);
      // Alt avvist (for eksempel av et nyere søk) er uendret; godtatt kaster `AiDecisionError`
      await recordDecisionIn(scope.tx, scope.grant, usageId, "rejected");
      return { status: "saved" as const };
    });
  } catch (error) {
    if (error instanceof AiDecisionError) return { status: "already_decided" };
    throw error;
  }
};
