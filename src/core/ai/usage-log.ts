import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { EmployeeGrant } from "@/core/access";
import { recordAuditEvent } from "@/core/audit";
import { db, type DbExecutor } from "@/db/client";
import { aiUsageLog, type AiSuggestionStatus, type AiTargetRef } from "@/db/schema";
import { AiRequestRejectedError } from "./errors";
import type { AiSuggestionResult } from "./types";

/*
 * Felles for lesing og skriving av `ai_usage_log` (docs/adr/0006-ki-i-bunnen.md del 5). Alle
 * spørringer filtrerer på `grant.organizationId`. Revisjonsloggen får bare id, gammel og ny
 * status, aldri `output_text` eller inndata.
 */

export const AI_USAGE_ENTITY_TYPE = "ai_usage_log";

/** Oppbevaringstid for raden (A157, spørsmål 56). */
export const AI_USAGE_RETENTION_YEARS = 10;

/**
 * Opprettet + antall år, i UTC. Finnes ikke datoen det året (29. februar), brukes 1. mars, så
 * raden alltid oppbevares minst så mange år (testplanen 6.3).
 */
export function addYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(date.getUTCFullYear() + years);
  return result;
}

export function retainUntilFrom(createdAt: Date): Date {
  return addYears(createdAt, AI_USAGE_RETENTION_YEARS);
}

/** Målet slik det lagres: bare type, id (små bokstaver) og feltkode. */
export function normalizeTarget(target: AiTargetRef): AiTargetRef {
  return { type: target.type, id: target.id.toLowerCase(), fieldKey: target.fieldKey };
}

export function sameTarget(a: AiTargetRef, b: AiTargetRef): boolean {
  return (
    a.type === b.type && a.id.toLowerCase() === b.id.toLowerCase() && a.fieldKey === b.fieldKey
  );
}

/** Samme mål: samme organisasjon, funksjon og `target_ref`, ikke slettet. */
export function sameTargetWhere(
  organizationId: string,
  feature: string,
  target: AiTargetRef,
): SQL | undefined {
  return and(
    eq(aiUsageLog.organizationId, organizationId),
    eq(aiUsageLog.feature, feature),
    sql`${aiUsageLog.targetRef} = ${JSON.stringify(normalizeTarget(target))}::jsonb`,
    isNull(aiUsageLog.deletedAt),
  );
}

/**
 * Låser målet til transaksjonen er ferdig, så to kall på samme mål ikke kan gi to åpne forslag.
 * Nøkkelen er laget av organisasjonen fra `grant`, funksjonen og målet.
 */
export async function lockTarget(
  tx: DbExecutor,
  organizationId: string,
  feature: string,
  target: AiTargetRef,
): Promise<void> {
  const { type, id, fieldKey } = normalizeTarget(target);
  const key = `ai:${organizationId}:${feature}:${type}:${id}:${fieldKey}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** Skriver statusendringen i revisjonsloggen. Bare gammel og ny status. */
export async function recordStatusChange(
  tx: DbExecutor,
  grant: EmployeeGrant,
  usageId: string,
  from: AiSuggestionStatus | null,
  to: AiSuggestionStatus,
): Promise<void> {
  await recordAuditEvent(tx, grant, {
    entityType: AI_USAGE_ENTITY_TYPE,
    entityId: usageId,
    action: "update",
    changes: { status: { from, to } },
  });
}

type ResultRow = {
  id: string;
  outcome: string;
  outputText: string | null;
};

/** Svaret til kalleren fra en lagret rad. */
export function toSuggestionResult(row: ResultRow): AiSuggestionResult {
  if (row.outcome === "ok") {
    return {
      kind: "suggestion",
      usageId: row.id,
      status: "suggested",
      text: row.outputText ?? "",
      candidateId: null,
    };
  }
  if (row.outcome === "no_match") return { kind: "no_match", usageId: row.id };
  if (row.outcome === "blocked") return { kind: "blocked" };
  return { kind: "error", usageId: row.id };
}

export type BlockedRowInput = {
  requestId: string;
  feature: string;
  provider: string;
  model: string;
  promptVersion: string;
  assignmentId: string | null;
  target: AiTargetRef;
  /** Bare feltkoder, aldri verdier. */
  sourceFields: string[];
};

/**
 * Skriver en sperret forespørsel (ad-1): utfallet `blocked`, leverandøren er ikke kalt. Ingen
 * forslag, status, feilkode, tokens, kostnad eller vaskede treff, og `input_summary` er tom
 * (ingen tekst). Forrige åpne forslag på samme mål avvises ikke, og ny rad gir ingen linje i
 * revisjonsloggen (bare statusendringer gjør det). Organisasjon og ansatt kommer bare fra `grant`.
 *
 * Kom et samtidig kall med samme id først, leses bare vår egen rad tilbake; ellers avslag.
 */
export async function insertBlockedRow(
  grant: EmployeeGrant,
  input: BlockedRowInput,
): Promise<AiSuggestionResult> {
  const now = new Date();
  const target = normalizeTarget(input.target);
  const [inserted] = await db
    .insert(aiUsageLog)
    .values({
      id: input.requestId,
      organizationId: grant.organizationId,
      employeeId: grant.employeeId,
      feature: input.feature,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      assignmentId: input.assignmentId,
      reportId: null,
      targetRef: target,
      sourceFields: [...input.sourceFields].sort(),
      inputSummary: {},
      outcome: "blocked",
      errorCode: null,
      outputText: null,
      status: null,
      tokensIn: 0,
      tokensOut: 0,
      cost: "0",
      currency: "NOK",
      redactedCount: 0,
      retainUntil: retainUntilFrom(now),
      createdAt: now,
      updatedAt: now,
      createdBy: grant.employeeId,
      updatedBy: grant.employeeId,
    })
    .onConflictDoNothing({ target: aiUsageLog.id })
    .returning({
      id: aiUsageLog.id,
      outcome: aiUsageLog.outcome,
      outputText: aiUsageLog.outputText,
    });
  if (inserted) return toSuggestionResult(inserted);

  const [winner] = await db
    .select({
      id: aiUsageLog.id,
      organizationId: aiUsageLog.organizationId,
      employeeId: aiUsageLog.employeeId,
      feature: aiUsageLog.feature,
      targetRef: aiUsageLog.targetRef,
      outcome: aiUsageLog.outcome,
      outputText: aiUsageLog.outputText,
      deletedAt: aiUsageLog.deletedAt,
    })
    .from(aiUsageLog)
    .where(
      and(eq(aiUsageLog.id, input.requestId), eq(aiUsageLog.organizationId, grant.organizationId)),
    );
  const ownRequest =
    winner !== undefined &&
    winner.deletedAt === null &&
    winner.organizationId === grant.organizationId &&
    winner.employeeId === grant.employeeId &&
    winner.feature === input.feature &&
    sameTarget(winner.targetRef, target);
  if (!winner || !ownRequest) throw new AiRequestRejectedError();
  return toSuggestionResult(winner);
}
