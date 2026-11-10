import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db } from "@/db/client";
import { aiUsageLog, assignments } from "@/db/schema";
import { logger } from "@/shared/lib/logger";
import { AiRequestRejectedError } from "./errors";
import { assertAllowedFields, parseAiRequest } from "./request";
import { resolveAiProvider } from "./resolve-provider";
import { computeAiRetainUntil } from "./retention";
import type {
  AiErrorCode,
  AiProviderResult,
  AiSuggestionRequest,
  AiSuggestionResult,
  AiTargetRef,
} from "./types";

/*
 * Den ene veien inn til KI (ADR 0006 del 1, kortet Omfang 3). Rekkefølgen er fast:
 * 1 valider, 2 rettighet, 3 tillatt-liste, 4 oppdrag, 5 samme requestId, 6 KI av/på,
 * 7 kall til leverandøren, 8 én transaksjon (ny rad og avvisning av forrige forslag).
 * Alle avslag før trinn 7 gir ingen rad, intet kall og ingen linje i revisjonsloggen.
 * Alle spørringer filtrerer på `grant.organizationId`.
 */

export const AI_USAGE_ENTITY_TYPE = "ai_usage_log";

type UsageRow = typeof aiUsageLog.$inferSelect;

/** Samme mål: samme organisasjon, funksjon og `target_ref` (type, id, feltkode). */
export function sameTargetCondition(
  organizationId: string,
  feature: string,
  target: AiTargetRef,
): SQL {
  return and(
    eq(aiUsageLog.organizationId, organizationId),
    eq(aiUsageLog.feature, feature),
    sql`${aiUsageLog.targetRef}->>'type' = ${target.type}`,
    sql`${aiUsageLog.targetRef}->>'id' = ${target.id}`,
    sql`${aiUsageLog.targetRef}->>'fieldKey' = ${target.fieldKey}`,
  )!;
}

function sameTarget(a: AiTargetRef, b: AiTargetRef): boolean {
  return a.type === b.type && a.id === b.id && a.fieldKey === b.fieldKey;
}

/** Svaret slik det ble gitt første gang, fra den lagrede raden. */
function responseFromRow(row: UsageRow): AiSuggestionResult {
  if (row.outcome === "ok") {
    return {
      kind: "suggestion",
      usageId: row.id,
      status: "suggested",
      text: row.outputText ?? "",
      candidateId: null,
    };
  }
  return row.outcome === "no_match"
    ? { kind: "no_match", usageId: row.id }
    : { kind: "error", usageId: row.id };
}

/**
 * Egen rad med samme id må være laget av samme ansatt for samme funksjon og mål, og ikke være
 * slettet. Ellers nøytralt avslag (A164 C), og raden returneres aldri.
 */
function matchOwnRow(
  row: UsageRow,
  grant: EmployeeGrant,
  feature: string,
  target: AiTargetRef,
): UsageRow {
  if (
    row.deletedAt !== null ||
    row.employeeId !== grant.employeeId ||
    row.feature !== feature ||
    !sameTarget(row.targetRef, target)
  ) {
    throw new AiRequestRejectedError();
  }
  return row;
}

async function callProvider(
  call: () => Promise<AiProviderResult>,
  context: { feature: string; provider: string; usageId: string },
): Promise<AiProviderResult> {
  let result: AiProviderResult;
  try {
    result = await call();
  } catch {
    // Feilobjektet og meldingen sendes aldri videre og logges aldri (kan ha innhold)
    result = { outcome: "error", errorCode: "unknown" };
  }
  if (result.outcome === "error") {
    const errorCode: AiErrorCode = result.errorCode;
    logger.warn("KI-kallet feilet", { ...context, errorCode });
  }
  return result;
}

export async function requestSuggestion(
  grant: EmployeeGrant,
  input: AiSuggestionRequest,
): Promise<AiSuggestionResult> {
  // 1. Streng validering. Typen er ingen garanti: verdien kan komme fra en server action.
  const { request, definition } = parseAiRequest(input as unknown);

  // 2. Rettigheten (admin får den alltid fra tilgangslaget)
  if (!grantHasPermission(grant, definition.permission)) throw new AccessDeniedError();

  // 3. Tillatt-listen
  assertAllowedFields(definition, request.fields);

  // 4. Oppdraget må finnes i egen organisasjon og ikke være slettet
  if (request.assignmentId !== null) {
    const [assignment] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, request.assignmentId),
          eq(assignments.organizationId, grant.organizationId),
          isNull(assignments.deletedAt),
        ),
      );
    if (!assignment) throw new AiRequestRejectedError();
  }

  // 5. Samme requestId på nytt: lagret svar, eller nøytralt avslag
  const [ownRow] = await db
    .select()
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.id, request.requestId),
        eq(aiUsageLog.organizationId, grant.organizationId),
      ),
    );
  if (ownRow) {
    return responseFromRow(matchOwnRow(ownRow, grant, request.feature, request.target));
  }
  // Id-en kan finnes i en annen organisasjon. Bare om den finnes, sjekkes; raden leses aldri.
  const [taken] = await db
    .select({ found: sql<number>`1` })
    .from(aiUsageLog)
    .where(eq(aiUsageLog.id, request.requestId));
  if (taken) throw new AiRequestRejectedError();

  // 6. KI av: ingen rad, intet kall
  const resolved = await resolveAiProvider(grant);
  if (!resolved) return { kind: "disabled" };

  // 7. Kallet. Unntak gir `error` med `unknown`.
  const result = await callProvider(
    () =>
      resolved.provider.complete({
        feature: definition.code,
        promptVersion: definition.promptVersion,
        prompt: definition.buildPrompt(request.fields),
        model: resolved.model,
      }),
    { feature: definition.code, provider: resolved.provider.code, usageId: request.requestId },
  );

  // 8. Én transaksjon: ny rad, og forrige åpne forslag på samme mål avvises (bare ved `ok`)
  const now = new Date();
  const sourceFields = Object.keys(request.fields);
  const inputSummary = Object.fromEntries(
    sourceFields.map((key) => [key, request.fields[key]?.length ?? 0]),
  );

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(aiUsageLog)
      .values({
        id: request.requestId,
        organizationId: grant.organizationId,
        createdAt: now,
        createdBy: grant.employeeId,
        updatedAt: now,
        updatedBy: grant.employeeId,
        employeeId: grant.employeeId,
        feature: definition.code,
        provider: resolved.provider.code,
        model: resolved.model,
        promptVersion: definition.promptVersion,
        assignmentId: request.assignmentId,
        reportId: null,
        targetRef: request.target,
        sourceFields,
        inputSummary,
        outcome: result.outcome,
        errorCode: result.outcome === "error" ? result.errorCode : null,
        outputText: result.outcome === "ok" ? result.text : null,
        status: result.outcome === "ok" ? "suggested" : null,
        tokensIn: result.outcome === "error" ? 0 : Math.max(0, Math.round(result.tokensIn)),
        tokensOut: result.outcome === "error" ? 0 : Math.max(0, Math.round(result.tokensOut)),
        cost: result.outcome === "error" ? "0" : String(result.cost),
        currency: result.outcome === "error" ? "NOK" : result.currency,
        retainUntil: computeAiRetainUntil(now),
      })
      .onConflictDoNothing({ target: aiUsageLog.id })
      .returning({ id: aiUsageLog.id });

    if (inserted.length === 0) {
      // Et samtidig kall med samme id kom først: gi samme svar, eller avslag hvis den ikke er vår
      const [row] = await tx
        .select()
        .from(aiUsageLog)
        .where(
          and(
            eq(aiUsageLog.id, request.requestId),
            eq(aiUsageLog.organizationId, grant.organizationId),
          ),
        );
      if (!row) throw new AiRequestRejectedError();
      return responseFromRow(matchOwnRow(row, grant, request.feature, request.target));
    }

    if (result.outcome !== "ok") {
      return result.outcome === "no_match"
        ? { kind: "no_match", usageId: request.requestId }
        : { kind: "error", usageId: request.requestId };
    }

    const replaced = await tx
      .update(aiUsageLog)
      .set({
        status: "rejected",
        decidedBy: grant.employeeId,
        decidedAt: now,
        updatedBy: grant.employeeId,
      })
      .where(
        and(
          sameTargetCondition(grant.organizationId, definition.code, request.target),
          eq(aiUsageLog.status, "suggested"),
          isNull(aiUsageLog.deletedAt),
          ne(aiUsageLog.id, request.requestId),
        ),
      )
      .returning({ id: aiUsageLog.id });
    for (const { id } of replaced) {
      await recordAuditEvent(tx, grant, {
        entityType: AI_USAGE_ENTITY_TYPE,
        entityId: id,
        action: "update",
        changes: { status: { from: "suggested", to: "rejected" } },
      });
    }

    return {
      kind: "suggestion",
      usageId: request.requestId,
      status: "suggested",
      text: result.text,
      candidateId: null,
    };
  });
}
