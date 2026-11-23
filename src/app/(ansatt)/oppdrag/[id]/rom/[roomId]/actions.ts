"use server";

import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  addDeviation,
  addMeasure,
  changeSuggestedDeviationTg,
  decideSuggestion,
  removeDeviation,
  removeMeasure,
  ReportTemplateMissingError,
  ReportValidationError,
  restoreDeviation,
  saveField,
  setCheckpointDone,
  setTgDirect,
  startReport,
} from "@/core/reports";
import type {
  ActionResult,
  AddDeviationInput,
  ChangeSuggestedDeviationTgInput,
  ChangeSuggestedDeviationTgResult,
  DecideSuggestionInput,
  DecideSuggestionResult,
  ReportFieldChange,
  RestoreDeviationInput,
  RestoreDeviationResult,
  RoomRef,
  SaveFieldResult,
  SetTgDirectInput,
} from "@/core/reports/types";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import {
  getEmployeeContext,
  getEmployeeContextForAction,
  type EmployeeContext,
} from "../../../../employee-context";
import { NO_ACCESS, SIGNED_OUT_MESSAGE, UNKNOWN_ERROR } from "../../../../form-state";
import { ROOM_ACTION_MESSAGES, type ActionError } from "./room-messages";

/*
 * Server actions for badet (docs/funksjoner/fase2a-badet-pc.md Omfang 1–8). Ingen tilgangslogikk
 * her: organisasjonen kommer fra `getEmployeeContext()`, og kjernen (`@/core/reports`) sjekker
 * `report.edit` og kjeden rom → etasje → bygning → oppdrag for hver handling. Id-er i adressen
 * sjekkes som uuid før kjernen kalles; resten av innholdet sjekkes med Zod i kjernen.
 *
 * Feil blir et svar med norsk melding, aldri et unntak: nettleseren skal vise meldingen ved feltet
 * og beholde teksten. Loggen får bare rute, bruker-id, id-er og feilnavn, aldri feltverdier.
 * Støtter hovedmål: de ansatte (lagring per felt, ingen tekst går tapt) og færre reklamasjoner.
 */

const ROUTE = "/oppdrag/[id]/rom/[roomId]";

function isRoomRef(ref: unknown): ref is RoomRef {
  if (typeof ref !== "object" || ref === null) return false;
  const { assignmentId, roomId } = ref as Record<string, unknown>;
  return (
    typeof assignmentId === "string" &&
    typeof roomId === "string" &&
    isUuid(assignmentId) &&
    isUuid(roomId)
  );
}

function errorOf(message: string): ActionError {
  return { status: "error", message };
}

/** Gjør en feil fra kjernen om til et svar. Ukjente feil logges uten innhold. */
function toActionError(
  error: unknown,
  log: { action: string; userId: string; assignmentId: string; roomId?: string },
): ActionError {
  if (error instanceof AccessDeniedError) return errorOf(NO_ACCESS);
  if (error instanceof ReportValidationError) return errorOf(error.message);
  if (error instanceof ReportTemplateMissingError) {
    return errorOf(ROOM_ACTION_MESSAGES.templateMissing);
  }
  if (error instanceof ZodError) return errorOf(ROOM_ACTION_MESSAGES.invalid);
  logger.error("Handling på badet feilet", {
    route: ROUTE,
    ...log,
    errorName: error instanceof Error ? error.name : "ukjent feil",
  });
  return errorOf(UNKNOWN_ERROR);
}

/** «Start rapporten» (egen serverhandling, aldri en lesing). */
export async function startReportAction(
  assignmentId: string,
): Promise<{ status: "started"; reportId: string } | ActionError> {
  const context = await getEmployeeContext();
  if (!context || typeof assignmentId !== "string" || !isUuid(assignmentId)) {
    return errorOf(NO_ACCESS);
  }
  try {
    const { reportId } = await startReport(context.actor, context.organizationId, assignmentId);
    return { status: "started", reportId };
  } catch (error) {
    return toActionError(error, { action: "start", userId: context.actor.id, assignmentId });
  }
}

/** Kjører en handling på rommet med felles kontroll av id-ene og felles feilhåndtering. */
async function onRoom<T>(
  action: string,
  ref: RoomRef,
  run: (context: EmployeeContext, room: RoomRef) => Promise<T>,
): Promise<T | ActionError> {
  const context = await getEmployeeContext();
  if (!context || !isRoomRef(ref)) return errorOf(NO_ACCESS);
  const room: RoomRef = { assignmentId: ref.assignmentId, roomId: ref.roomId };
  try {
    return await run(context, room);
  } catch (error) {
    return toActionError(error, { action, userId: context.actor.id, ...room });
  }
}

/** Lagrer ett felt (lagring per felt, ingen «Lagre»-knapp). */
export async function saveFieldAction(
  ref: RoomRef,
  change: ReportFieldChange,
): Promise<SaveFieldResult | ActionError> {
  return onRoom("save_field", ref, (context, room) =>
    saveField(context.actor, context.organizationId, room, change),
  );
}

export async function addDeviationAction(
  ref: RoomRef,
  input: AddDeviationInput,
): Promise<ActionResult | ActionError> {
  return onRoom("add_deviation", ref, (context, room) =>
    addDeviation(context.actor, context.organizationId, room, input),
  );
}

export async function removeDeviationAction(
  ref: RoomRef,
  deviationId: string,
): Promise<ActionResult | ActionError> {
  return onRoom("remove_deviation", ref, (context, room) =>
    removeDeviation(context.actor, context.organizationId, room, deviationId),
  );
}

export async function restoreDeviationAction(
  ref: RoomRef,
  input: RestoreDeviationInput,
): Promise<RestoreDeviationResult | ActionError> {
  return onRoom("restore_deviation", ref, (context, room) =>
    restoreDeviation(context.actor, context.organizationId, room, input),
  );
}

export async function addMeasureAction(
  ref: RoomRef,
  input: { id: string; deviationId: string },
): Promise<ActionResult | ActionError> {
  return onRoom("add_measure", ref, (context, room) =>
    addMeasure(context.actor, context.organizationId, room, input),
  );
}

export async function removeMeasureAction(
  ref: RoomRef,
  measureId: string,
): Promise<ActionResult | ActionError> {
  return onRoom("remove_measure", ref, (context, room) =>
    removeMeasure(context.actor, context.organizationId, room, measureId),
  );
}

export async function setTgDirectAction(
  ref: RoomRef,
  input: SetTgDirectInput,
): Promise<ActionResult | ActionError> {
  return onRoom("set_tg_direct", ref, (context, room) =>
    setTgDirect(context.actor, context.organizationId, room, input),
  );
}

/** Godta, Endre eller Avvis et regelforslag. Serveren regner forslaget selv. */
export async function decideSuggestionAction(
  ref: RoomRef,
  input: DecideSuggestionInput,
): Promise<DecideSuggestionResult | ActionError> {
  return onRoom("decide_suggestion", ref, (context, room) =>
    decideSuggestion(context.actor, context.organizationId, room, input),
  );
}

export async function setCheckpointDoneAction(
  ref: RoomRef,
  input: { checkpointKey: string; done: boolean },
): Promise<ActionResult | ActionError> {
  return onRoom("set_checkpoint_done", ref, (context, room) =>
    setCheckpointDone(context.actor, context.organizationId, room, input),
  );
}

/** «Logget ut» (T-0070): skjermen beholder valget og viser meldingen. Ingenting er lagret. */
export type SignedOutError = ActionError & { signedOut: true };

/**
 * TG-bytte på et avvik fra et regelforslag, med grunn i samme kall (A490). Organisasjonen kommer
 * fra tilgangssjekken; uten økt er svaret «logget ut», og kjernen kalles ikke.
 */
export async function changeSuggestedDeviationTgAction(
  ref: RoomRef,
  input: ChangeSuggestedDeviationTgInput,
): Promise<ChangeSuggestedDeviationTgResult | ActionError | SignedOutError> {
  const access = await getEmployeeContextForAction();
  if (access.status === "signed_out") {
    return { status: "error", message: SIGNED_OUT_MESSAGE, signedOut: true };
  }
  if (access.status !== "ok" || !isRoomRef(ref)) return errorOf(NO_ACCESS);
  const { context } = access;
  const room: RoomRef = { assignmentId: ref.assignmentId, roomId: ref.roomId };
  try {
    return await changeSuggestedDeviationTg(context.actor, context.organizationId, room, input);
  } catch (error) {
    return toActionError(error, {
      action: "change_suggested_deviation_tg",
      userId: context.actor.id,
      ...room,
    });
  }
}
