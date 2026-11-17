"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import {
  AI_FIELD_MAX_LENGTH,
  AiDecisionError,
  AiRequestRejectedError,
  recordDecision,
} from "@/core/ai";
import {
  getPublishCheck,
  getRoomView,
  HOLE_DRILLING_SIGNAL,
  publishReport,
  ReportTemplateMissingError,
  ReportValidationError,
  saveField,
  startNewVersion,
} from "@/core/reports";
import type { PublishCheckView, PublishReportResult } from "@/core/reports/publish-types";
import type { AnswerValue, RoomRef } from "@/core/reports/types";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { getEmployeeContext, type EmployeeContext } from "../../../employee-context";
import { NO_ACCESS, UNKNOWN_ERROR } from "../../../form-state";
import { aiFieldsOf, type AiFieldInfo } from "./ai-fields";
import { aiFieldTarget } from "./ai-target";
import { PUBLISH_LINK_TEXTS, PUBLISH_TEXTS } from "./publish-texts";

/*
 * Serverhandlingene for publiser-siden (docs/funksjoner/fase2a-publisering-badet.md Omfang 5–7
 * og 11, F2–F4). Tynne: aktør og organisasjon kommer fra økten (`getEmployeeContext`), og all
 * tilgang, sjekken, publiseringen og ny versjon ligger i `@/core/reports`. Rapport-id, ansatt,
 * tid, versjon og funn tas aldri fra skjemaet; Zod tar bort ekstra felt. «Rett nå» bruker de
 * samme skrivetjenestene som rommet. KI-forslag behandles med `recordDecision` i `@/core/ai`;
 * ingen nye KI-kall.
 *
 * Feil blir et svar med fast norsk melding, aldri et unntak. Loggen får bare rute, bruker-id,
 * id-er og feilnavn, aldri begrunnelser eller tekst fra rapporten.
 * Støtter hovedmål: færre reklamasjoner (serveren regner sjekken selv) og de ansatte.
 */

const ROUTE = "/oppdrag/[id]/publiser";

export type PublishActionError = {
  status: "error";
  message: string;
  /** Rapporten var alt publisert: skjermen viser lenken «Se utgivelsene». */
  code?: "already_published";
};

function errorOf(message: string, code?: PublishActionError["code"]): PublishActionError {
  return code ? { status: "error", message, code } : { status: "error", message };
}

function toActionError(
  error: unknown,
  log: { action: string; userId: string; assignmentId: string },
  fallback: string = UNKNOWN_ERROR,
): PublishActionError {
  // Utløpt økt gir omdirigering til innlogging; den skal ikke bli til «Noe gikk galt».
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return errorOf(NO_ACCESS);
  if (error instanceof ReportValidationError) {
    if (error.code === "report_published" && log.action === "publish") {
      return errorOf(PUBLISH_TEXTS.alreadyPublished, "already_published");
    }
    return errorOf(error.message);
  }
  if (error instanceof ReportTemplateMissingError) return errorOf(error.message);
  logger.error("Handling på publiser-siden feilet", {
    route: ROUTE,
    ...log,
    errorName: error instanceof Error ? error.name : "ukjent feil",
  });
  return errorOf(fallback);
}

/** Kjører handlingen med økten og felles feilhåndtering. Ugyldig id gir «ingen tilgang». */
async function withContext<T>(
  action: string,
  assignmentId: unknown,
  run: (context: EmployeeContext, assignmentId: string) => Promise<T>,
  fallback?: string,
): Promise<T | PublishActionError> {
  const context = await getEmployeeContext();
  if (!context || typeof assignmentId !== "string" || !isUuid(assignmentId)) {
    return errorOf(NO_ACCESS);
  }
  try {
    return await run(context, assignmentId);
  } catch (error) {
    return toActionError(
      error,
      { action, userId: context.actor.id, assignmentId },
      fallback ?? UNKNOWN_ERROR,
    );
  }
}

// --- Sjekken -----------------------------------------------------------------------------------

/** Listen på nytt (ren lesing). Brukes etter «Rett nå», KI-forslag og retur fra «Gå til». */
export async function refreshPublishCheckAction(
  assignmentId: string,
): Promise<
  | { status: "ok"; check: PublishCheckView; aiFields: Record<string, AiFieldInfo> }
  | PublishActionError
> {
  return withContext("refresh", assignmentId, async (context, id) => {
    const check = await getPublishCheck(context.actor, context.organizationId, id);
    const aiFields = await aiFieldsOf(context.actor, context.organizationId, id, check);
    return { status: "ok" as const, check, aiFields };
  });
}

const publishSchema = z.object({
  assignmentId: z.string(),
  fingerprint: z.string().max(128).nullable(),
  overrides: z
    .array(
      z.object({
        findingKey: z.string().min(1).max(4000),
        reasonCode: z.string().max(64).nullable(),
        text: z.string().max(20000).nullable().optional(),
      }),
    )
    .max(2000),
});

/**
 * «Publiser versjon N». Serveren kjører sjekken på nytt; ved endret liste kommer den nye listen
 * tilbake (`check_changed`), og ingenting er lagret.
 */
export async function publishAction(
  input: unknown,
): Promise<PublishReportResult | PublishActionError> {
  const parsed = publishSchema.safeParse(input);
  const assignmentId = parsed.success ? parsed.data.assignmentId : null;
  return withContext(
    "publish",
    assignmentId,
    async (context, id) => {
      const data = parsed.success ? parsed.data : null;
      if (!data) return errorOf(NO_ACCESS);
      return publishReport(context.actor, context.organizationId, {
        assignmentId: id,
        fingerprint: data.fingerprint,
        overrides: data.overrides.map((override) => ({
          findingKey: override.findingKey,
          // Koden sjekkes mot de faste grunnene i kjernen.
          reasonCode: override.reasonCode as never,
          text: override.text ?? null,
        })),
      });
    },
    PUBLISH_TEXTS.publishFailed,
  );
}

/** «Lag ny versjon» (krever `report.edit`, sjekkes i kjernen). */
export async function startNewVersionAction(
  assignmentId: string,
): Promise<{ status: "started"; nextVersionNumber: number } | PublishActionError> {
  return withContext(
    "start_new_version",
    assignmentId,
    async (context, id) => {
      const result = await startNewVersion(context.actor, context.organizationId, id);
      return { status: "started" as const, nextVersionNumber: result.nextVersionNumber };
    },
    PUBLISH_TEXTS.newVersionFailed,
  );
}

// --- «Rett nå» for hulltaking ------------------------------------------------------------------

export type ChoiceField = {
  elementKey: string;
  label: string;
  /** Svaret som finnes, eller en ny id når feltet ikke er besvart. */
  answerId: string;
  value: AnswerValue;
  options: { key: string; label: string }[];
};

export type HoleFixContext = {
  room: RoomRef;
  drilling: ChoiceField;
  reason: ChoiceField | null;
  notDoneOptionKey: string;
};

const EMPTY_VALUE: AnswerValue = { text: null, number: null, optionKeys: null };

/**
 * Valgene for hulltaking i rommet og svarene som står der nå, lest med `getRoomView` (samme
 * tilgang og kjede som rommet). `newIds` er id-er fra nettleseren til svar som ikke finnes ennå.
 */
export async function holeFixContextAction(
  assignmentId: string,
  roomId: string,
  newIds: { drilling: string; reason: string },
): Promise<{ status: "ok"; context: HoleFixContext } | PublishActionError> {
  return withContext("hole_fix_context", assignmentId, async (context, id) => {
    if (
      typeof roomId !== "string" ||
      !isUuid(roomId) ||
      typeof newIds?.drilling !== "string" ||
      !isUuid(newIds.drilling) ||
      typeof newIds?.reason !== "string" ||
      !isUuid(newIds.reason)
    ) {
      return errorOf(NO_ACCESS);
    }
    const room: RoomRef = { assignmentId: id, roomId };
    const view = await getRoomView(context.actor, context.organizationId, room);
    if (view.state !== "started") return errorOf(PUBLISH_TEXTS.saveFailed);
    const field = (elementKey: string, newId: string): ChoiceField | null => {
      const element = view.document.elements.find((e) => e.key === elementKey);
      if (!element) return null;
      const answer = view.answers.find((a) => a.elementKey === elementKey);
      return {
        elementKey,
        label: element.label,
        answerId: answer?.id ?? newId,
        value: answer?.value ?? EMPTY_VALUE,
        options: view.document.element_options
          .filter((o) => o.element_key === elementKey)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((o) => ({ key: o.key, label: o.label })),
      };
    };
    const drilling = field(HOLE_DRILLING_SIGNAL.elementKey, newIds.drilling);
    if (!drilling) return errorOf(PUBLISH_TEXTS.saveFailed);
    return {
      status: "ok" as const,
      context: {
        room,
        drilling,
        reason: field(HOLE_DRILLING_SIGNAL.reasonElementKey, newIds.reason),
        notDoneOptionKey: HOLE_DRILLING_SIGNAL.notDoneOptionKey,
      },
    };
  });
}

// --- KI-forslag (F4) ---------------------------------------------------------------------------

const aiDecisionSchema = z.object({
  assignmentId: z.string(),
  aiUsageId: z.string().refine(isUuid),
  decision: z.enum(["accepted", "rejected", "undo"]),
  /** Bare ved «Angre» etter «Bruk»: den ansattes egen tekst før «Bruk». */
  restoreText: z.string().max(AI_FIELD_MAX_LENGTH).nullable().optional(),
});

export type AiDecisionResponse =
  { status: "decided"; aiStatus: "suggested" | "accepted" | "rejected" } | PublishActionError;

/**
 * «Bruk», «Behold min tekst» eller «Angre» på et KI-forslag som venter. Serveren finner forslaget
 * blant de ventende på oppdragets rapport (aldri fra en id alene), og «Bruk» skriver
 * forslagsteksten fra loggen med `saveField`, aldri en tekst fra skjemaet.
 */
export async function decideAiSuggestionAction(input: unknown): Promise<AiDecisionResponse> {
  const parsed = aiDecisionSchema.safeParse(input);
  const assignmentId = parsed.success ? parsed.data.assignmentId : null;
  return withContext(
    "ai_decision",
    assignmentId,
    async (context, id): Promise<AiDecisionResponse> => {
      if (!parsed.success) return errorOf(NO_ACCESS);
      const { aiUsageId, decision, restoreText } = parsed.data;
      const grant = await requireOrganizationAccess(
        context.actor,
        context.organizationId,
        "organization.read",
      );
      const check = await getPublishCheck(context.actor, context.organizationId, id);
      if (check.state !== "draft") return errorOf(PUBLISH_LINK_TEXTS.publishedLine);

      if (decision === "accepted") {
        const pending = check.pendingAiSuggestions.find((s) => s.aiUsageId === aiUsageId);
        if (!pending || !pending.target.roomId) return errorOf(PUBLISH_TEXTS.aiNotAllowed);
        const room: RoomRef = { assignmentId: id, roomId: pending.target.roomId };
        const view = await getRoomView(context.actor, context.organizationId, room);
        const target = view.state === "started" ? aiFieldTarget(view, pending.field) : null;
        if (!target) return errorOf(PUBLISH_TEXTS.aiNotAllowed);
        const saved = await saveField(
          context.actor,
          context.organizationId,
          room,
          target.change(pending.outputText),
        );
        if (saved.status !== "saved") return errorOf(PUBLISH_TEXTS.aiNotAllowed);
      }

      try {
        await recordDecision(grant, aiUsageId, decision);
      } catch (error) {
        if (error instanceof AiDecisionError || error instanceof AiRequestRejectedError) {
          return errorOf(PUBLISH_TEXTS.aiNotAllowed);
        }
        throw error;
      }

      // «Angre» etter «Bruk»: den ansattes egen tekst settes tilbake med samme skrivetjeneste.
      if (decision === "undo" && restoreText !== undefined) {
        const after = await getPublishCheck(context.actor, context.organizationId, id);
        const pending =
          after.state === "draft"
            ? after.pendingAiSuggestions.find((s) => s.aiUsageId === aiUsageId)
            : undefined;
        if (pending?.target.roomId) {
          const room: RoomRef = { assignmentId: id, roomId: pending.target.roomId };
          const view = await getRoomView(context.actor, context.organizationId, room);
          const target = view.state === "started" ? aiFieldTarget(view, pending.field) : null;
          if (target && target.currentText === pending.outputText) {
            await saveField(
              context.actor,
              context.organizationId,
              room,
              target.change(restoreText ?? ""),
            );
          }
        }
      }

      return {
        status: "decided",
        aiStatus: decision === "undo" ? "suggested" : decision,
      };
    },
    PUBLISH_TEXTS.aiFailed,
  );
}
