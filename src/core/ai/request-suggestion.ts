import { and, eq, isNull, ne } from "drizzle-orm";
import { AccessDeniedError, grantHasPermission, type EmployeeGrant } from "@/core/access";
import { db } from "@/db/client";
import { aiUsageLog, assignments, type AiErrorCode } from "@/db/schema";
import { stripUnstorableText } from "@/shared/lib/clean-text";
import { logger } from "@/shared/lib/logger";
import { AiRequestRejectedError } from "./errors";
import { AI_TRIAL_TARGET_TYPE, buildPrompt, getFeatureDefinition } from "./features";
import { resolveAiProvider } from "./provider-resolution";
import { fakeAiProvider } from "./providers/fake";
import type { AiProviderResult } from "./providers/types";
import { aiSuggestionRequestShapeSchema, hasOnlyAllowedFields } from "./request";
import type { AiSuggestionRequest, AiSuggestionResult } from "./types";
import {
  lockTarget,
  normalizeTarget,
  recordStatusChange,
  retainUntilFrom,
  sameTarget,
  sameTargetWhere,
  toSuggestionResult,
} from "./usage-log";

/*
 * Be om et KI-forslag (docs/funksjoner/fase2a-ki-modul-logg.md Omfang 3, ADR 0006 del 1 og 4).
 * Rekkefølgen er fast: valider → rettighet → tillatt-liste → oppdrag → samme `requestId` → KI
 * av/på (prøvemålet bare med den falske leverandøren) → kall leverandøren → én transaksjon med
 * ny rad, avvisning av forrige forslag og revisjonslogg. Alle avslag før kallet gir ingen rad,
 * intet kall og ingen linje i `audit_log`. Organisasjon og ansatt kommer bare fra `grant`.
 */

const resultColumns = {
  id: aiUsageLog.id,
  organizationId: aiUsageLog.organizationId,
  employeeId: aiUsageLog.employeeId,
  feature: aiUsageLog.feature,
  targetRef: aiUsageLog.targetRef,
  outcome: aiUsageLog.outcome,
  outputText: aiUsageLog.outputText,
  deletedAt: aiUsageLog.deletedAt,
};

type StoredRow = {
  organizationId: string;
  employeeId: string;
  feature: string;
  targetRef: { type: string; id: string; fieldKey: string };
  deletedAt: Date | null;
};

/** Om den lagrede raden er samme forespørsel fra samme ansatt i samme organisasjon. */
function isOwnRequest(
  row: StoredRow,
  grant: EmployeeGrant,
  feature: string,
  target: { type: string; id: string; fieldKey: string },
): boolean {
  return (
    row.deletedAt === null &&
    row.organizationId === grant.organizationId &&
    row.employeeId === grant.employeeId &&
    row.feature === feature &&
    sameTarget(row.targetRef, target)
  );
}

/** Kaller leverandøren. Et unntak gir `error` med `unknown`; feilen sendes aldri videre. */
async function callProvider(call: () => Promise<AiProviderResult>): Promise<AiProviderResult> {
  try {
    return await call();
  } catch {
    return { outcome: "error", errorCode: "unknown" };
  }
}

/** Svaret fra leverandøren uten tegn databasen ikke tar, før det lagres i `ai_usage_log`. */
function cleanProviderResult(result: AiProviderResult): AiProviderResult {
  return result.outcome === "ok" ? { ...result, text: stripUnstorableText(result.text) } : result;
}

export async function requestSuggestion(
  grant: EmployeeGrant,
  request: AiSuggestionRequest,
): Promise<AiSuggestionResult> {
  // 1. Forespørselen valideres strengt
  const parsed = aiSuggestionRequestShapeSchema.safeParse(request);
  if (!parsed.success) throw new AiRequestRejectedError();
  const input = parsed.data;
  const definition = getFeatureDefinition(input.feature);
  if (!definition) throw new AiRequestRejectedError();

  // 2. Rettigheten fra funksjonen (admin har alle)
  if (!grantHasPermission(grant, definition.permission)) throw new AccessDeniedError();

  // 3. Bare feltkoder fra tillatt-listen
  if (!hasOnlyAllowedFields(definition, input.fields)) throw new AiRequestRejectedError();

  // Verdiene vaskes for tegn databasen ikke tar (T-0001). Feltkodene er sjekket mot
  // tillatt-listen over og vaskes ikke. Tom tekst etter vask går videre som tom tekst.
  const fields: Record<string, string> = Object.fromEntries(
    Object.entries(input.fields).map(([key, value]) => [key, stripUnstorableText(value)]),
  );

  // 4. Oppdraget hører til organisasjonen og er ikke slettet
  if (input.assignmentId !== null) {
    const [assignment] = await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.id, input.assignmentId),
          eq(assignments.organizationId, grant.organizationId),
          isNull(assignments.deletedAt),
        ),
      );
    if (!assignment) throw new AiRequestRejectedError();
  }

  // 5. Samme requestId på nytt: svaret fra første gang, uten nytt kall
  const target = normalizeTarget(input.target);
  const [existing] = await db
    .select(resultColumns)
    .from(aiUsageLog)
    .where(
      and(eq(aiUsageLog.id, input.requestId), eq(aiUsageLog.organizationId, grant.organizationId)),
    );
  if (existing) {
    if (!isOwnRequest(existing, grant, definition.code, target)) {
      throw new AiRequestRejectedError();
    }
    return toSuggestionResult(existing);
  }
  // Id-en finnes hos en annen organisasjon eller er mykt slettet: avslag før leverandøren kalles
  const [taken] = await db
    .select({ id: aiUsageLog.id })
    .from(aiUsageLog)
    .where(eq(aiUsageLog.id, input.requestId));
  if (taken) throw new AiRequestRejectedError();

  // 6. KI av: ingen rad, intet kall
  const resolved = await resolveAiProvider(grant);
  if (resolved.kind === "disabled") return { kind: "disabled" };
  const { provider, model } = resolved;
  // Prøvesiden (A166): fritekst uten vask, så målet godtas bare med den falske leverandøren.
  // Ellers samme svar som KI av: ingen rad, intet kall.
  if (target.type === AI_TRIAL_TARGET_TYPE && provider !== fakeAiProvider) {
    return { kind: "disabled" };
  }

  // 7. Ledeteksten bygges bare av feltene på tillatt-listen, og leverandøren kalles
  const prompt = buildPrompt(definition, fields);
  const result = cleanProviderResult(
    await callProvider(() =>
      provider.complete({
        feature: definition.code,
        promptVersion: definition.promptVersion,
        prompt,
        model,
      }),
    ),
  );
  if (result.outcome === "error") {
    logger.warn("KI-kallet ga feil", {
      feature: definition.code,
      provider: provider.code,
      errorCode: result.errorCode,
      usageId: input.requestId,
    });
  }

  // 8. Én transaksjon: ny rad, forrige forslag på samme mål avvist, revisjonslogg
  const now = new Date();
  const fieldKeys = Object.keys(fields).sort();
  const inputSummary = Object.fromEntries(fieldKeys.map((key) => [key, fields[key]!.length]));
  const errorCode: AiErrorCode | null = result.outcome === "error" ? result.errorCode : null;

  return db.transaction(async (tx) => {
    await lockTarget(tx, grant.organizationId, definition.code, target);
    const [inserted] = await tx
      .insert(aiUsageLog)
      .values({
        id: input.requestId,
        organizationId: grant.organizationId,
        employeeId: grant.employeeId,
        feature: definition.code,
        provider: provider.code,
        model,
        promptVersion: definition.promptVersion,
        assignmentId: input.assignmentId,
        reportId: null,
        targetRef: target,
        sourceFields: fieldKeys,
        inputSummary,
        outcome: result.outcome,
        errorCode,
        outputText: result.outcome === "ok" ? result.text : null,
        status: result.outcome === "ok" ? "suggested" : null,
        tokensIn: result.outcome === "error" ? 0 : result.tokensIn,
        tokensOut: result.outcome === "error" ? 0 : result.tokensOut,
        cost: result.outcome === "error" ? "0" : String(result.cost),
        currency: result.outcome === "error" ? "NOK" : result.currency,
        retainUntil: retainUntilFrom(now),
        createdAt: now,
        updatedAt: now,
        createdBy: grant.employeeId,
        updatedBy: grant.employeeId,
      })
      .onConflictDoNothing({ target: aiUsageLog.id })
      .returning(resultColumns);

    if (!inserted) {
      // Et samtidig kall med samme id kom først. Bare vår egen rad leses tilbake.
      const [winner] = await tx
        .select(resultColumns)
        .from(aiUsageLog)
        .where(
          and(
            eq(aiUsageLog.id, input.requestId),
            eq(aiUsageLog.organizationId, grant.organizationId),
          ),
        );
      if (!winner || !isOwnRequest(winner, grant, definition.code, target)) {
        throw new AiRequestRejectedError();
      }
      return toSuggestionResult(winner);
    }

    // Avklaring A: forrige forslag avvises bare når det nye er brukbart
    if (inserted.outcome === "ok") {
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
            sameTargetWhere(grant.organizationId, definition.code, target),
            eq(aiUsageLog.status, "suggested"),
            ne(aiUsageLog.id, inserted.id),
          ),
        )
        .returning({ id: aiUsageLog.id });
      for (const row of replaced) {
        await recordStatusChange(tx, grant, row.id, "suggested", "rejected");
      }
    }
    return toSuggestionResult(inserted);
  });
}
