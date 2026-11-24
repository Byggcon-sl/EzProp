import { and, eq } from "drizzle-orm";
import { AccessDeniedError } from "@/core/access";
import { recordDecisionIn } from "@/core/ai";
import { aiUsageLog, checkpointResults, deviationMeasures, deviations } from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { requireUuid } from "./context";
import { PHRASE_FIELDS } from "./logic";
import { decideAiTextInputSchema, parseOrThrow } from "./schemas";
import type { DecideAiText } from "./types";
import { withRoomWrite, type WriteScope } from "./write";

/*
 * «Behold min», «Lukk» og «Angre» på et KI-forslag i rommet (docs/funksjoner/fase2a-ki-i-veien.md,
 * A469 og A470). Tilgangen og rapporten under arbeid gir `withRoomWrite`. Raden bindes til
 * rapporten og rommet før beslutningen lagres i samme transaksjon, så en `usageId` fra en annen
 * rapport, et annet rom eller en ferdig rapport aldri kan endres herfra.
 *
 * Støtter hovedmål: KI i bunnen (hver beslutning logges riktig) og færre reklamasjoner (et forslag
 * i en ferdig rapport kan ikke endres i ettertid).
 */

/** Er målet et avvik i rommet (i denne rapporten)? Også et mykt slettet avvik. */
async function deviationInRoom(scope: WriteScope, deviationId: string): Promise<boolean> {
  const [row] = await scope.tx
    .select({ id: deviations.id })
    .from(deviations)
    .innerJoin(
      checkpointResults,
      and(
        eq(checkpointResults.id, deviations.checkpointResultId),
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.roomId, scope.context.room.id),
      ),
    )
    .where(
      and(
        eq(deviations.organizationId, scope.orgId),
        eq(deviations.reportId, scope.reportId),
        eq(deviations.id, deviationId),
      ),
    );
  return row !== undefined;
}

async function measureInRoom(scope: WriteScope, measureId: string): Promise<boolean> {
  const [row] = await scope.tx
    .select({ deviationId: deviationMeasures.deviationId })
    .from(deviationMeasures)
    .where(
      and(
        eq(deviationMeasures.organizationId, scope.orgId),
        eq(deviationMeasures.reportId, scope.reportId),
        eq(deviationMeasures.id, measureId),
      ),
    );
  return row !== undefined && deviationInRoom(scope, row.deviationId);
}

async function checkpointResultInRoom(scope: WriteScope, resultId: string): Promise<boolean> {
  const [row] = await scope.tx
    .select({ id: checkpointResults.id })
    .from(checkpointResults)
    .where(
      and(
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.roomId, scope.context.room.id),
        eq(checkpointResults.id, resultId),
      ),
    );
  return row !== undefined;
}

/**
 * Loggraden for forslaget: samme organisasjon, ikke slettet, denne rapporten, og målet i rommet
 * for funksjonen. Ellers 404, og ingenting endres.
 */
async function requireRoomUsageRow(scope: WriteScope, usageId: string): Promise<void> {
  const [row] = await scope.tx
    .select({
      feature: aiUsageLog.feature,
      reportId: aiUsageLog.reportId,
      targetRef: aiUsageLog.targetRef,
      deletedAt: aiUsageLog.deletedAt,
    })
    .from(aiUsageLog)
    .where(and(eq(aiUsageLog.organizationId, scope.orgId), eq(aiUsageLog.id, usageId)));
  const target = row?.targetRef;
  if (
    !row ||
    row.deletedAt !== null ||
    row.reportId !== scope.reportId ||
    !target ||
    typeof target.id !== "string" ||
    !isUuid(target.id)
  ) {
    throw new AccessDeniedError();
  }
  let ok = false;
  if (row.feature === "phrase_suggest") {
    ok =
      target.type === "deviation" &&
      (PHRASE_FIELDS as readonly string[]).includes(target.fieldKey) &&
      (await deviationInRoom(scope, target.id));
  } else if (row.feature === "language_polish") {
    ok =
      target.type === "deviation"
        ? await deviationInRoom(scope, target.id)
        : target.type === "deviation_measure"
          ? await measureInRoom(scope, target.id)
          : target.type === "checkpoint_result"
            ? await checkpointResultInRoom(scope, target.id)
            : false;
  } else if (row.feature === "summary_draft") {
    // Sammendraget hører til rapporten, ikke til ett rom
    ok = target.type === "report" && target.id === scope.reportId;
  }
  if (!ok) throw new AccessDeniedError();
}

/** Se `DecideAiText` i `./types`. */
export const decideAiText: DecideAiText = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope) => {
    requireUuid(input?.usageId);
    const values = parseOrThrow(decideAiTextInputSchema, input);
    const usageId = values.usageId.toLowerCase();
    await requireRoomUsageRow(scope, usageId);
    if (values.decision === "undo_and_reject") {
      // «Angre» etter «Bruk»: teksten er tatt bort, og forslaget skal ikke stå åpent
      await recordDecisionIn(scope.tx, scope.grant, usageId, "undo");
      await recordDecisionIn(scope.tx, scope.grant, usageId, "rejected");
    } else {
      await recordDecisionIn(scope.tx, scope.grant, usageId, values.decision);
    }
    return { status: "saved" as const };
  });
