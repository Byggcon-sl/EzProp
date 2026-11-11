"use server";

import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { AccessDeniedError, requireOrganizationAccess, type EmployeeGrant } from "@/core/access";
import {
  AI_DECISIONS,
  AI_FIELD_MAX_LENGTH,
  AI_TRIAL_TARGET_TYPE,
  AiDecisionError,
  AiRequestRejectedError,
  getSuggestionStatus,
  recordDecision,
  requestSuggestion,
  type AiOutcome,
  type AiSuggestionStatus,
} from "@/core/ai";
import type { AiQueueFailureReason } from "@/core/ai/client";
import { logger } from "@/shared/lib/logger";
import { isUuid } from "@/shared/lib/uuid";
import { getEmployeeContext } from "../../employee-context";

/*
 * Serverhandlingene for prøvesiden /prove/ki (docs/funksjoner/fase2a-forslagsmonster.md Omfang 5).
 * Ingen tilgangslogikk her: aktør og organisasjon kommer fra økten (`getEmployeeContext`), og
 * rettigheten sjekkes i `@/core/access`. Organisasjons-id, ansatt-id og andre ekstra felt fra
 * klienten leses aldri (Zod tar dem bort). All KI går gjennom `@/core/ai`. Feil til klienten er
 * faste norske meldinger. Loggen får bare id-er og feilnavn, aldri teksten.
 * Støtter hovedmål: KI i bunnen (forslaget vises, takstmannen avgjør, loggen viser det) og
 * reklamasjoner (organisasjonen kommer alltid fra serveren).
 */

const ROUTE = "/prove/ki";
const TRIAL_FIELD_KEY = "text";

const NO_ACCESS = "Du har ikke tilgang til dette.";
const INVALID_TEXT = `Skriv en setning på høyst ${AI_FIELD_MAX_LENGTH} tegn.`;
const NOT_FOUND = "Forslaget finnes ikke.";
const DECISION_NOT_ALLOWED = "Valget kan ikke gjøres nå. Forslaget er endret.";
const UNKNOWN = "Noe gikk galt. Teksten din er uendret. Prøv igjen.";

/** Status og utfall lest fra KI-loggen for ett forslag, eller `null` («finnes ikke»). */
export type TrialLogged = { status: AiSuggestionStatus | null; outcome: AiOutcome } | null;

/**
 * Feil med fast norsk melding og fast kode `reason`. Køen på klienten leser bare koden, aldri
 * meldingen (docs/funksjoner/fase2a-ki-ko.md Omfang 2).
 */
export type TrialFailure = { kind: "failed"; message: string; reason: AiQueueFailureReason };

export type TrialSuggestionResponse =
  | { kind: "suggestion"; usageId: string; text: string; logged: TrialLogged }
  | { kind: "no_match"; usageId: string; logged: TrialLogged }
  | { kind: "error"; usageId: string; logged: TrialLogged }
  | { kind: "disabled" }
  | TrialFailure;

export type TrialDecisionResponse =
  | { kind: "decided"; usageId: string; logged: TrialLogged }
  /** Valget var ikke lov (for eksempel angre når et nyere forslag finnes). Status fra loggen. */
  | { kind: "not_allowed"; usageId: string; message: string; logged: TrialLogged }
  | TrialFailure;

export type TrialStatusResponse = { kind: "status"; logged: TrialLogged } | TrialFailure;

const uuid = z.string().refine(isUuid);

const requestSchema = z.object({
  requestId: uuid,
  targetId: uuid,
  text: z.string().min(1).max(AI_FIELD_MAX_LENGTH),
});

const decisionSchema = z.object({
  usageId: uuid,
  decision: z.enum(AI_DECISIONS),
});

const statusSchema = z.object({ usageId: uuid });

/** Tilgangen fra økten: `report.edit` i organisasjonen der den innloggede er ansatt. */
async function trialGrant(): Promise<{ grant: EmployeeGrant; userId: string } | null> {
  const context = await getEmployeeContext();
  if (!context) return null;
  const grant = await requireOrganizationAccess(
    context.actor,
    context.organizationId,
    "report.edit",
  );
  return { grant, userId: context.actor.id };
}

function failed(message: string, reason: AiQueueFailureReason): TrialFailure {
  return { kind: "failed", message, reason };
}

/** Kjente feil gir faste meldinger. Ukjente logges bare med feilnavn og id-er. */
function failure(
  error: unknown,
  log: { action: string; userId?: string; usageId?: string },
  rejectedMessage: string = NOT_FOUND,
): TrialFailure {
  // Utløpt økt gir omdirigering til innlogging; den skal ikke bli til «Noe gikk galt».
  unstable_rethrow(error);
  if (error instanceof AccessDeniedError) return failed(NO_ACCESS, "no_access");
  if (error instanceof AiRequestRejectedError) return failed(rejectedMessage, "invalid");
  logger.error("Prøvesiden for KI feilet", {
    route: ROUTE,
    ...log,
    errorName: error instanceof Error ? error.name : "ukjent feil",
  });
  return failed(UNKNOWN, "unknown");
}

/** Be om et forslag til språkvask av teksten. Målet er prøvesidens egen id (`ai_trial`). */
export async function requestTrialSuggestion(input: unknown): Promise<TrialSuggestionResponse> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return failed(INVALID_TEXT, "invalid");
  const { requestId, targetId, text } = parsed.data;

  let userId: string | undefined;
  try {
    const access = await trialGrant();
    if (!access) return failed(NO_ACCESS, "no_access");
    userId = access.userId;
    const result = await requestSuggestion(access.grant, {
      requestId,
      feature: "language_polish",
      assignmentId: null,
      reportId: null,
      target: { type: AI_TRIAL_TARGET_TYPE, id: targetId, fieldKey: TRIAL_FIELD_KEY },
      fields: { [TRIAL_FIELD_KEY]: text },
    });
    // Sperret forespørsel (ad-1) viser samme tekst som KI av. Raden står i loggen som `blocked`.
    if (result.kind === "disabled" || result.kind === "blocked") return { kind: "disabled" };
    const logged = await getSuggestionStatus(access.grant, result.usageId);
    if (result.kind === "suggestion") {
      return { kind: "suggestion", usageId: result.usageId, text: result.text, logged };
    }
    return { kind: result.kind, usageId: result.usageId, logged };
  } catch (error) {
    // Når man ber om et nytt forslag, finnes det ikke noe forslag ennå: avslag gir «Noe gikk galt».
    return failure(
      error,
      { action: "requestTrialSuggestion", userId, usageId: requestId },
      UNKNOWN,
    );
  }
}

/** «Bruk», «Behold min tekst» eller «Angre». Svaret har status lest fra loggen. */
export async function decideTrialSuggestion(input: unknown): Promise<TrialDecisionResponse> {
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return failed(NOT_FOUND, "invalid");
  const { usageId, decision } = parsed.data;

  let userId: string | undefined;
  try {
    const access = await trialGrant();
    if (!access) return failed(NO_ACCESS, "no_access");
    userId = access.userId;
    try {
      await recordDecision(access.grant, usageId, decision);
    } catch (error) {
      if (!(error instanceof AiDecisionError)) throw error;
      const logged = await getSuggestionStatus(access.grant, usageId);
      return { kind: "not_allowed", usageId, message: DECISION_NOT_ALLOWED, logged };
    }
    const logged = await getSuggestionStatus(access.grant, usageId);
    return { kind: "decided", usageId, logged };
  } catch (error) {
    return failure(error, { action: "decideTrialSuggestion", userId, usageId });
  }
}

/** Status og utfall for ett forslag, lest fra loggen. */
export async function readTrialStatus(input: unknown): Promise<TrialStatusResponse> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return failed(NOT_FOUND, "invalid");
  let userId: string | undefined;
  try {
    const access = await trialGrant();
    if (!access) return failed(NO_ACCESS, "no_access");
    userId = access.userId;
    return { kind: "status", logged: await getSuggestionStatus(access.grant, parsed.data.usageId) };
  } catch (error) {
    return failure(error, { action: "readTrialStatus", userId, usageId: parsed.data.usageId });
  }
}
