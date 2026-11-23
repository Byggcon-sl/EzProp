import { and, eq, inArray, isNull } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import {
  AI_FIELD_MAX_LENGTH,
  AiInputTooLargeError,
  isBlankText,
  requestSuggestion,
  requestSuggestionBatch,
  type AiSuggestionRequest,
  type AiSuggestionResult,
} from "@/core/ai";
import { db } from "@/db/client";
import { checkpointResults, checkpoints, deviationMeasures, deviations } from "@/db/schema";
import { loadRoomContext, requireUuid, type RoomContext } from "./context";
import { guardReportErrors } from "./errors";
import { parseOrThrow, polishDescriptionInputSchema, polishDeviationInputSchema } from "./schemas";
import type {
  PolishDescription,
  PolishDeviation,
  PolishFieldResult,
  PolishResult,
  PolishTarget,
  RoomRef,
} from "./types";

/*
 * Språkvask i avvikskortet (docs/funksjoner/fase2a-ki-i-veien.md, A436, A460 og T-0111). Rapport-
 * kjernen kontrollerer at målene hører til avviket i rommet, tar bort tomme felt og sender resten
 * gjennom KI-grunnmuren (`requestSuggestionBatch`): ett kall til serveren, ett leverandørkall,
 * én loggrad og vaktene per felt. Ingenting lagres her; «Bruk» går gjennom `saveField` med
 * beslutningen i samme transaksjon. Ingenting her leser eller skriver TG.
 */

function fieldResult(result: AiSuggestionResult): PolishFieldResult {
  switch (result.kind) {
    case "suggestion":
      return { status: "suggestion", usageId: result.usageId, text: result.text };
    case "stopped":
      return { status: "stopped", usageId: result.usageId, guard: result.guard };
    case "no_match":
      return { status: "no_match", usageId: result.usageId };
    case "disabled":
    case "blocked":
      return { status: "ai_off" };
    default:
      return { status: "ai_error" };
  }
}

/** Rommet med en rapport under arbeid. Ellers 404, som for et ukjent mål. */
async function requireDraftRoom(
  grant: EmployeeGrant,
  room: RoomRef,
): Promise<RoomContext & { report: NonNullable<RoomContext["report"]> }> {
  const context = await loadRoomContext(db, grant, room, { lock: false });
  if (!context.report || context.report.status !== "draft") throw new AccessDeniedError();
  return { ...context, report: context.report };
}

function polishRequest(requestId: string, target: PolishTarget, text: string): AiSuggestionRequest {
  return {
    requestId,
    feature: "language_polish",
    // Kjernen slår opp målet og utleder rapport og oppdrag selv
    assignmentId: null,
    reportId: null,
    target: { type: target.type, id: target.id, fieldKey: target.fieldKey },
    fields: { text },
  };
}

/** Se `PolishDeviation` i `./types`. */
export const polishDeviation: PolishDeviation = async (actor, organizationId, room, input) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(room?.assignmentId, room?.roomId, input?.deviationId);
  const values = parseOrThrow(polishDeviationInputSchema, input);
  return guardReportErrors("language_polish", async (): Promise<PolishResult> => {
    const context = await requireDraftRoom(grant, room);
    const orgId = grant.organizationId;
    const reportId = context.report.id;

    // Avviket må stå i rommet, og hvert mål må være avviket eller et av tiltakene dets
    const [deviation] = await db
      .select({ id: deviations.id })
      .from(deviations)
      .innerJoin(
        checkpointResults,
        and(
          eq(checkpointResults.id, deviations.checkpointResultId),
          eq(checkpointResults.organizationId, orgId),
          eq(checkpointResults.reportId, reportId),
          eq(checkpointResults.roomId, context.room.id),
          isNull(checkpointResults.deletedAt),
        ),
      )
      .where(
        and(
          eq(deviations.organizationId, orgId),
          eq(deviations.reportId, reportId),
          eq(deviations.id, values.deviationId),
          isNull(deviations.deletedAt),
        ),
      );
    if (!deviation) throw new AccessDeniedError();
    const measureIds = values.items
      .filter((item) => item.target.type === "deviation_measure")
      .map((item) => item.target.id);
    const liveMeasures =
      measureIds.length === 0
        ? []
        : await db
            .select({ id: deviationMeasures.id })
            .from(deviationMeasures)
            .where(
              and(
                eq(deviationMeasures.organizationId, orgId),
                eq(deviationMeasures.reportId, reportId),
                eq(deviationMeasures.deviationId, deviation.id),
                inArray(deviationMeasures.id, measureIds),
                isNull(deviationMeasures.deletedAt),
              ),
            );
    const measureSet = new Set(liveMeasures.map((m) => m.id));
    for (const item of values.items) {
      const ok =
        item.target.type === "deviation"
          ? item.target.id === deviation.id
          : measureSet.has(item.target.id);
      if (!ok) throw new AccessDeniedError();
    }

    // Felt uten tekst tas ikke med; alle tomme gir intet kall og ingen rad (T-0111). Samme regel
    // som kjernen (`isBlankText`): også nullbreddetegn er tomt
    const items = values.items.filter((item) => !isBlankText(item.text));
    if (items.length === 0) return { status: "nothing_to_polish" };
    if (items.some((item) => item.text.length > AI_FIELD_MAX_LENGTH)) return { status: "too_long" };

    let results: AiSuggestionResult[];
    try {
      results = await requestSuggestionBatch(
        grant,
        items.map((item) => polishRequest(item.requestId, item.target, item.text)),
      );
    } catch (error) {
      if (error instanceof AiInputTooLargeError) return { status: "too_long" };
      throw error;
    }
    return {
      status: "done",
      fields: items.map((item, index) => {
        const result = results[index];
        return {
          requestId: item.requestId,
          target: item.target,
          result: result ? fieldResult(result) : { status: "ai_error" },
        };
      }),
    };
  });
};

/** Se `PolishDescription` i `./types`. */
export const polishDescription: PolishDescription = async (actor, organizationId, room, input) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(room?.assignmentId, room?.roomId, input?.requestId);
  const values = parseOrThrow(polishDescriptionInputSchema, input);
  return guardReportErrors("language_polish", async (): Promise<PolishResult> => {
    const context = await requireDraftRoom(grant, room);
    if (isBlankText(values.text)) return { status: "nothing_to_polish" };
    if (values.text.length > AI_FIELD_MAX_LENGTH) return { status: "too_long" };

    const orgId = grant.organizationId;
    const [result] = await db
      .select({ id: checkpointResults.id })
      .from(checkpointResults)
      .innerJoin(
        checkpoints,
        and(
          eq(checkpoints.id, checkpointResults.checkpointId),
          eq(checkpoints.organizationId, orgId),
          eq(checkpoints.versionId, context.report.templateVersionId),
          eq(checkpoints.key, values.checkpointKey),
          isNull(checkpoints.deletedAt),
        ),
      )
      .where(
        and(
          eq(checkpointResults.organizationId, orgId),
          eq(checkpointResults.reportId, context.report.id),
          eq(checkpointResults.roomId, context.room.id),
          isNull(checkpointResults.deletedAt),
        ),
      );
    // Uten resultatrad har punktet ingen lagret beskrivelse å språkvaske
    if (!result) throw new AccessDeniedError();

    const target: PolishTarget = {
      type: "checkpoint_result",
      id: result.id,
      fieldKey: "description_text",
    };
    let answer: AiSuggestionResult;
    try {
      answer = await requestSuggestion(grant, polishRequest(values.requestId, target, values.text));
    } catch (error) {
      if (error instanceof AiInputTooLargeError) return { status: "too_long" };
      throw error;
    }
    return {
      status: "done",
      fields: [
        {
          requestId: values.requestId,
          target,
          result: fieldResult(answer),
        },
      ],
    };
  });
};
