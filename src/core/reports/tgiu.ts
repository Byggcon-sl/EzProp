import { and, eq } from "drizzle-orm";
import { checkpointResults, type CheckpointResult, type TgDirect } from "@/db/schema";
import { ReportValidationError } from "./errors";
import { directTgConflictsWithDeviations } from "./logic";
import { parseOrThrow, setCheckpointDoneInputSchema, setTgDirectInputSchema } from "./schemas";
import type { ActionResult, SetCheckpointDone, SetTgDirect, TgDeviationChoice } from "./types";
import {
  auditReport,
  ensureCheckpointResult,
  findCheckpointResult,
  liveDeviationsOf,
  refreshOf,
  requireRoomCheckpoint,
  softDeleteDeviations,
  withRoomWrite,
  writeTgDirect,
  type WriteScope,
} from "./write";

/*
 * TG direkte, TGIU og «Ferdig med punktet» (docs/funksjoner/fase2a-badet-pc.md Omfang 3, 6 og 7).
 * TGIU og TG0 står aldri sammen med avvik med TG2 eller TG3, og ingenting fjernes stille (A395):
 * uten aktivt valg er svaret `tgiu_conflicts_with_deviation`, og ingenting er lagret. Fjernet TGIU
 * slettes mykt, og settes TGIU igjen, kommer de samme opplysningene tilbake.
 */

/**
 * Setter TG direkte på punktet med reglene for avvik med TG. `conflict` = takstmannen må velge
 * aktivt; ingenting er endret. TG1 på et punkt med avvik med TG avvises (skjermen tilbyr det ikke).
 */
export async function applyDirectTg(
  scope: WriteScope,
  result: CheckpointResult,
  target: TgDirect | null,
  choice: TgDeviationChoice | undefined,
): Promise<"saved" | "conflict"> {
  if (target !== null) {
    const live = await liveDeviationsOf(scope, result.id);
    const withTg = live.filter((d) => d.kind === "tg" && d.tg !== null);
    if (target === "1" && withTg.length > 0) {
      throw new ReportValidationError("tg_direct_with_deviations");
    }
    if (directTgConflictsWithDeviations(target, live)) {
      if (choice !== "remove_tg_deviations") return "conflict";
      await softDeleteDeviations(
        scope,
        withTg.map((d) => d.id),
      );
    }
  }
  await writeTgDirect(scope, result, target);
  return "saved";
}

/** Setter eller fjerner TG direkte (`report.edit`). */
export const setTgDirect: SetTgDirect = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<ActionResult> => {
    const values = parseOrThrow(setTgDirectInputSchema, input);
    const { checkpointId } = requireRoomCheckpoint(scope, values.checkpointKey);
    const current = await findCheckpointResult(scope, checkpointId);
    if ((current?.tgDirect ?? null) !== values.base) {
      return { status: "conflict", refresh: await refreshOf(scope) };
    }
    if ((current?.tgDirect ?? null) === values.tgDirect) {
      return { status: "saved", refresh: await refreshOf(scope) };
    }
    const result = current ?? (await ensureCheckpointResult(scope, values.checkpointKey));
    const applied = await applyDirectTg(scope, result, values.tgDirect, values.tgDeviationChoice);
    if (applied === "conflict") return { status: "tgiu_conflicts_with_deviation" };
    return { status: "saved", refresh: await refreshOf(scope) };
  });

/**
 * Merker punktet ferdig eller ikke ferdig (`report.edit`). Kan alltid gjøres; mangler er
 * advarsler i svaret, aldri sperre (regel 12).
 */
export const setCheckpointDone: SetCheckpointDone = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<ActionResult> => {
    const values = parseOrThrow(setCheckpointDoneInputSchema, input);
    const result = await ensureCheckpointResult(scope, values.checkpointKey);
    if (result.done !== values.done) {
      await scope.tx
        .update(checkpointResults)
        .set(
          values.done
            ? {
                done: true,
                doneBy: scope.grant.employeeId,
                doneAt: scope.now,
                updatedBy: scope.grant.employeeId,
              }
            : { done: false, doneBy: null, doneAt: null, updatedBy: scope.grant.employeeId },
        )
        .where(
          and(
            eq(checkpointResults.organizationId, scope.orgId),
            eq(checkpointResults.reportId, scope.reportId),
            eq(checkpointResults.id, result.id),
          ),
        );
      await auditReport(scope, "checkpoint_result", result.id, "update", {
        field: "done",
        to: values.done,
      });
    }
    return { status: "saved", refresh: await refreshOf(scope) };
  });
