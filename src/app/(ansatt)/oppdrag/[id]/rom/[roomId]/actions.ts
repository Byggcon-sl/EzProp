"use server";

import { ZodError } from "zod";
import { AccessDeniedError } from "@/core/access";
import {
  AI_FIELD_MAX_LENGTH,
  AI_SUMMARY_FINDINGS_MAX,
  AiDecisionError,
  AiInputTooLargeError,
  AiRequestRejectedError,
} from "@/core/ai";
import {
  addDeviation,
  addMeasure,
  applyPhrase,
  decideAiText,
  decideSuggestion,
  draftSummary,
  getReportSummary,
  polishDescription,
  polishDeviation,
  removeDeviation,
  removeMeasure,
  ReportTemplateMissingError,
  ReportValidationError,
  restoreDeviation,
  saveField,
  saveSummary,
  setCheckpointDone,
  setTgDirect,
  startReport,
  suggestPhrases,
} from "@/core/reports";
import type {
  ActionResult,
  AddDeviationInput,
  ApplyPhraseInput,
  ApplyPhraseResult,
  DecideAiTextInput,
  DecideSuggestionInput,
  DecideSuggestionResult,
  DraftSummaryResult,
  PolishDeviationInput,
  PolishResult,
  ReportFieldChange,
  ReportSummaryView,
  RestoreDeviationInput,
  RoomRef,
  SaveFieldOptions,
  SaveFieldResult,
  SaveSummaryInput,
  SaveSummaryResult,
  SetTgDirectInput,
  SuggestPhrasesInput,
  SuggestPhrasesResult,
} from "@/core/reports/types";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { getEmployeeContext, type EmployeeContext } from "../../../../employee-context";
import { NO_ACCESS, UNKNOWN_ERROR } from "../../../../form-state";
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
  // KI-grunnmuren: faste meldinger uten innhold fra forespørselen
  if (error instanceof AiRequestRejectedError) return errorOf(error.message);
  if (error instanceof AiDecisionError) return errorOf(error.message);
  if (error instanceof AiInputTooLargeError) return errorOf(error.message);
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

/**
 * Lagrer ett felt (lagring per felt, ingen «Lagre»-knapp). `options.aiDecision` er «Bruk» på et
 * språkvasket felt: kjernen lagrer teksten og beslutningen i samme transaksjon (A469).
 */
export async function saveFieldAction(
  ref: RoomRef,
  change: ReportFieldChange,
  options?: SaveFieldOptions,
): Promise<SaveFieldResult | ActionError> {
  return onRoom("save_field", ref, (context, room) =>
    options?.aiDecision
      ? saveField(context.actor, context.organizationId, room, change, {
          aiDecision: options.aiDecision,
        })
      : saveField(context.actor, context.organizationId, room, change),
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
): Promise<ActionResult | ActionError> {
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

// --- KI i veien (docs/funksjoner/fase2a-ki-i-veien.md) -------------------------------------------
//
// Klienten sender bare `requestId`, målet og egen tekst. Kandidater, funn, rapport og oppdrag
// hentes av kjernen i organisasjonen fra konteksten. KI kalles bare gjennom `@/core/ai`, og ingen
// handling her setter TG.

/** «Forslag» ved et tekstfelt i avvikskortet (A433, A437). */
export async function suggestPhrasesAction(
  ref: RoomRef,
  input: SuggestPhrasesInput,
): Promise<SuggestPhrasesResult | ActionError> {
  return onRoom("suggest_phrases", ref, (context, room) =>
    suggestPhrases(context.actor, context.organizationId, room, {
      requestId: input?.requestId,
      deviationId: input?.deviationId,
      field: input?.field,
      text: input?.text,
    }),
  );
}

/** Valgt kandidat settes inn, og beslutningen lagres i samme transaksjon (A469). */
export async function applyPhraseAction(
  ref: RoomRef,
  input: ApplyPhraseInput,
): Promise<ApplyPhraseResult | ActionError> {
  return onRoom("apply_phrase", ref, (context, room) =>
    applyPhrase(context.actor, context.organizationId, room, input),
  );
}

/**
 * «Behold min», «Lukk» (lukket liste) og «Angre» på et KI-forslag. Bare `rejected` og `undo`:
 * «Bruk» går alltid sammen med teksten (`applyPhraseAction`, `saveFieldAction`,
 * `saveSummaryAction`). Tilgangen, raden og målet i rommet kontrollerer `decideAiText`.
 */
export async function decideAiSuggestionAction(
  ref: RoomRef,
  input: DecideAiTextInput,
): Promise<{ status: "saved" } | ActionError> {
  return onRoom("ai_decision", ref, (context, room) =>
    decideAiText(context.actor, context.organizationId, room, input),
  );
}

/** Svaret på språkvask, med grensen når teksten er for lang (A436). */
export type PolishActionResult =
  Exclude<PolishResult, { status: "too_long" }> | { status: "too_long"; limit: number };

function withPolishLimit(result: PolishResult): PolishActionResult {
  return result.status === "too_long" ? { status: "too_long", limit: AI_FIELD_MAX_LENGTH } : result;
}

/** «Språkvask avviket»: ett kall for alle feltene med tekst (A436, A460). */
export async function polishDeviationAction(
  ref: RoomRef,
  input: PolishDeviationInput,
): Promise<PolishActionResult | ActionError> {
  return onRoom("polish_deviation", ref, async (context, room) =>
    withPolishLimit(await polishDeviation(context.actor, context.organizationId, room, input)),
  );
}

/** «Språkvask» på beskrivelsen ved punktet. */
export async function polishDescriptionAction(
  ref: RoomRef,
  input: { requestId: string; checkpointKey: string; text: string },
): Promise<PolishActionResult | ActionError> {
  return onRoom("polish_description", ref, async (context, room) =>
    withPolishLimit(await polishDescription(context.actor, context.organizationId, room, input)),
  );
}

/** Sammendraget med advarslene. Kjøres også etter endringer i funnene (A435). */
export async function getSummaryAction(
  ref: RoomRef,
): Promise<{ status: "ok"; summary: ReportSummaryView | null } | ActionError> {
  return onRoom("summary_read", ref, async (context, room) => ({
    status: "ok" as const,
    summary: await getReportSummary(context.actor, context.organizationId, room.assignmentId),
  }));
}

/** Svaret på «Lag utkast», med grensen når det er for mange funn. */
export type DraftSummaryActionResult =
  | Exclude<DraftSummaryResult, { status: "too_many_findings" }>
  | { status: "too_many_findings"; limit: number };

/** «Lag utkast»: lagrer ingenting (A434). */
export async function draftSummaryAction(
  ref: RoomRef,
  input: { requestId: string },
): Promise<DraftSummaryActionResult | ActionError> {
  return onRoom("summary_draft", ref, async (context, room) => {
    const result = await draftSummary(context.actor, context.organizationId, room.assignmentId, {
      requestId: input?.requestId,
    });
    return result.status === "too_many_findings"
      ? { status: "too_many_findings" as const, limit: AI_SUMMARY_FINDINGS_MAX }
      : result;
  });
}

/** Lagrer sammendraget, også «Bruk» på et utkast (`draft`) og «Angre». */
export async function saveSummaryAction(
  ref: RoomRef,
  input: SaveSummaryInput,
): Promise<SaveSummaryResult | ActionError> {
  return onRoom("summary_save", ref, (context, room) =>
    saveSummary(context.actor, context.organizationId, room.assignmentId, input),
  );
}
