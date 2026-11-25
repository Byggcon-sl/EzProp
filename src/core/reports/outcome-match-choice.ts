import { and, eq, isNull } from "drizzle-orm";
import { AccessDeniedError } from "@/core/access";
import { AiDecisionError, recordDecisionIn, type AiCandidateRef } from "@/core/ai";
import { aiUsageLog, type AiSuggestionStatus } from "@/db/schema";
import { REPORT_NEW_DEVIATION_FIELD_KEY } from "@/shared/config/ai-targets";
import { requireUuid } from "./context";
import { createDeviationFromOutcome } from "./deviations";
import {
  chooseOutcomeMatchInputSchema,
  parseOrThrow,
  rejectOutcomeMatchInputSchema,
} from "./schemas";
import type { ChooseOutcomeMatch, ChooseOutcomeMatchResult, RejectOutcomeMatch } from "./types";
import { refreshOf, withRoomWrite, type WriteScope } from "./write";

/*
 * «Skriv det du ser»: valget og avvisningen av et KI-søk (docs/funksjoner/fase2a-skriv-det-du-ser.md,
 * A563, A564). Søket står i `./outcome-match`. Valget lager avviket nøyaktig som «+ Avvik» for
 * utfallet, med TG fra malen og takstmannen; KI-svaret brukes bare til å finne utfallet, aldri TG.
 * Filen kaller derfor ikke `requestSuggestion` (K2.8: en fil som kaller KI, skriver aldri TG).
 *
 * Hovedmål: færre reklamasjoner (samme avvik som manuelt valg, og et søk gir høyst ett avvik) og
 * KI i bunnen (beslutningen i samme transaksjon som avviket).
 */

const TEMPLATE_OUTCOME = "template_outcome";

function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

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
