import { and, eq, isNull, max } from "drizzle-orm";
import { AccessDeniedError, requireOrganizationAccess } from "@/core/access";
import {
  AiInputTooLargeError,
  recordDecisionIn,
  requestSuggestion,
  type AiSuggestionResult,
} from "@/core/ai";
import { db } from "@/db/client";
import {
  aiUsageLog,
  deviationMeasures,
  deviationQuestions,
  deviations,
  outcomes,
  standardMeasures,
  type Deviation,
  type DeviationTg,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { loadRoomContext, requireUuid } from "./context";
import { mergeValuesFor } from "./deviations";
import { guardReportErrors, ReportValidationError } from "./errors";
import {
  MAX_MEASURES_PER_DEVIATION,
  mergeFieldsText,
  PHRASE_FIELDS,
  type PhraseField,
} from "./logic";
import { loadPhraseCandidatesWith } from "./phrase-source";
import { requireLiveRoomDeviation } from "./save-field";
import { applyPhraseInputSchema, parseOrThrow, suggestPhrasesInputSchema } from "./schemas";
import type {
  ApplyPhrase,
  ApplyPhraseResult,
  RankedPhraseCandidate,
  SuggestPhrases,
  SuggestPhrasesResult,
} from "./types";
import { auditReport, refreshOf, withRoomWrite, type WriteScope } from "./write";

/*
 * Forslag fra frasebanken (docs/funksjoner/fase2a-ki-i-veien.md, A423, A433, A437, A469 og A470).
 * Serveren bygger kandidatene selv fra den låste malversjonen; nettleseren sender bare
 * `requestId`, avviket, feltet og egen tekst. KI rangerer bare: teksten som settes inn, er alltid
 * malens egen. Ingenting her endrer TG eller velger utfall.
 */

/** TG-gruppen som sendes til KI (`group`): bare en fast kode, aldri tekst. */
export function phraseGroupOf(kind: Deviation["kind"], tg: DeviationTg | null): string {
  if (kind === "hms") return "hms";
  if (tg === 2) return "tg2";
  if (tg === 3) return "tg3";
  return "tg";
}

function isPhraseField(value: unknown): value is PhraseField {
  return typeof value === "string" && (PHRASE_FIELDS as readonly string[]).includes(value);
}

function rankedFrom(
  result: Extract<AiSuggestionResult, { kind: "candidates" }>,
  candidates: readonly RankedPhraseCandidate[],
): RankedPhraseCandidate[] {
  const out: RankedPhraseCandidate[] = [];
  for (const ref of result.candidates) {
    const found = candidates.find((c) => c.ref.source === ref.source && c.ref.id === ref.id);
    if (found && !out.includes(found)) out.push(found);
  }
  return out;
}

/** Se `SuggestPhrases` i `./types`. */
export const suggestPhrases: SuggestPhrases = async (actor, organizationId, room, input) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "report.edit");
  requireUuid(room?.assignmentId, room?.roomId, input?.requestId, input?.deviationId);
  const values = parseOrThrow(suggestPhrasesInputSchema, input);
  return guardReportErrors("phrase_suggest", async (): Promise<SuggestPhrasesResult> => {
    const context = await loadRoomContext(db, grant, room, { lock: false });
    if (!context.report || context.report.status !== "draft") throw new AccessDeniedError();
    const { candidates, cut } = await loadPhraseCandidatesWith(db, grant, {
      reportId: context.report.id,
      roomId: context.room.id,
      deviationId: values.deviationId,
      field: values.field,
    });
    // 0 kandidater: «Ingen treff» uten kall og uten rad
    if (candidates.length === 0) return { status: "no_match", usageId: null };

    const deviation = await deviationCodes(
      grant.organizationId,
      context.report.id,
      values.deviationId,
    );
    const fields: Record<string, string> = {
      text: values.text,
      group: phraseGroupOf(deviation.kind, deviation.tg),
    };
    if (deviation.outcomeCode) fields.outcome_key = deviation.outcomeCode;

    let result: AiSuggestionResult;
    try {
      result = await requestSuggestion(
        grant,
        {
          requestId: values.requestId,
          feature: "phrase_suggest",
          assignmentId: null,
          reportId: null,
          target: { type: "deviation", id: values.deviationId, fieldKey: values.field },
          fields,
        },
        {
          candidates: candidates.map((c) => ({ source: c.ref.source, id: c.ref.id, text: c.text })),
          candidatesCut: cut,
        },
      );
    } catch (error) {
      if (error instanceof AiInputTooLargeError) return { status: "too_many_candidates" };
      throw error;
    }
    switch (result.kind) {
      case "candidates": {
        const ranked = rankedFrom(result, candidates);
        if (ranked.length === 0) return { status: "no_match", usageId: result.usageId };
        return { status: "ranked", usageId: result.usageId, candidates: ranked };
      }
      case "no_match":
        return { status: "no_match", usageId: result.usageId };
      case "disabled":
      case "blocked":
        return { status: "ai_off" };
      default:
        // `error`, og svar som ikke hører til funksjonen (tekst, stoppet): tekstsøket står
        return { status: "ai_error" };
    }
  });
};

/**
 * Avvikets slag, TG og faste kode for utfallet (`spørsmål.utfall`, for eksempel
 * `wet_room.floor.slope_too_small.tg2`; `null` for avvik skrevet fritt). Bare koder, aldri tekst.
 */
async function deviationCodes(orgId: string, reportId: string, deviationId: string) {
  const [row] = await db
    .select({
      kind: deviations.kind,
      tg: deviations.tg,
      questionKey: deviationQuestions.key,
      outcomeKey: outcomes.key,
    })
    .from(deviations)
    .leftJoin(
      outcomes,
      and(eq(outcomes.id, deviations.outcomeId), eq(outcomes.organizationId, orgId)),
    )
    .leftJoin(
      deviationQuestions,
      and(
        eq(deviationQuestions.id, outcomes.deviationQuestionId),
        eq(deviationQuestions.organizationId, orgId),
      ),
    )
    .where(
      and(
        eq(deviations.organizationId, orgId),
        eq(deviations.reportId, reportId),
        eq(deviations.id, deviationId),
        isNull(deviations.deletedAt),
      ),
    );
  if (!row) throw new AccessDeniedError();
  return {
    kind: row.kind,
    tg: row.tg,
    outcomeCode: row.questionKey && row.outcomeKey ? `${row.questionKey}.${row.outcomeKey}` : null,
  };
}

// --- «Bruk» på et fraseforslag ---------------------------------------------------------------

/**
 * Loggraden for forslaget (A470): samme organisasjon, ikke slettet, funksjonen `phrase_suggest`,
 * denne rapporten, og målet et avvik med et felt fra `PHRASE_FIELDS`. Ellers 404.
 */
async function requirePhraseUsageRow(scope: WriteScope, usageId: string) {
  const [row] = await scope.tx
    .select({
      feature: aiUsageLog.feature,
      reportId: aiUsageLog.reportId,
      targetRef: aiUsageLog.targetRef,
    })
    .from(aiUsageLog)
    .where(
      and(
        eq(aiUsageLog.organizationId, scope.orgId),
        eq(aiUsageLog.id, usageId),
        isNull(aiUsageLog.deletedAt),
      ),
    );
  const target = row?.targetRef;
  if (
    !row ||
    row.feature !== "phrase_suggest" ||
    row.reportId !== scope.reportId ||
    !target ||
    target.type !== "deviation" ||
    typeof target.id !== "string" ||
    !isUuid(target.id) ||
    !isPhraseField(target.fieldKey)
  ) {
    throw new AccessDeniedError();
  }
  return { deviationId: target.id, field: target.fieldKey };
}

const DEVIATION_COLUMNS = {
  deviation_text: "deviationText",
  cause_text: "causeText",
  consequence_text: "consequenceText",
} as const;

/**
 * Malens tekst for kandidaten, slått opp på nytt i den låste malversjonen og rommet (aldri fra
 * nettleseren). Utfallstekster til avvik, årsak og konsekvens; standardtiltak bare til
 * `new_measure`. HMS og TG blandes aldri (A463).
 */
async function candidateText(
  scope: WriteScope,
  candidate: { source: string; id: string },
  field: PhraseField,
  deviation: Deviation,
): Promise<string> {
  const sameKind = (kind: string) => (deviation.kind === "hms" ? kind === "hms" : kind !== "hms");
  const inRoom = (checkpointKey: string, questionKey: string, outcomeKey: string) =>
    scope.roomDoc.outcomes.find(
      (o) =>
        o.checkpoint_key === checkpointKey &&
        o.question_key === questionKey &&
        o.key === outcomeKey,
    );
  if (candidate.source === "template_outcome" && field !== "new_measure") {
    const ref = scope.template.outcomeRefById.get(candidate.id);
    const outcome = ref ? inRoom(ref.checkpointKey, ref.questionKey, ref.outcomeKey) : undefined;
    if (!outcome || !sameKind(outcome.kind)) throw new AccessDeniedError();
    const text =
      field === "deviation_text"
        ? outcome.deviation_text
        : field === "cause_text"
          ? outcome.default_cause_text
          : outcome.default_consequence_text;
    if (text === null || text.trim() === "") throw new ReportValidationError("invalid_choice");
    return text;
  }
  if (candidate.source === "template_measure" && field === "new_measure") {
    const [measure] = await scope.tx
      .select({ text: standardMeasures.text, outcomeId: standardMeasures.outcomeId })
      .from(standardMeasures)
      .where(
        and(
          eq(standardMeasures.organizationId, scope.orgId),
          eq(standardMeasures.id, candidate.id),
          isNull(standardMeasures.deletedAt),
        ),
      );
    const ref = measure ? scope.template.outcomeRefById.get(measure.outcomeId) : undefined;
    const outcome = ref ? inRoom(ref.checkpointKey, ref.questionKey, ref.outcomeKey) : undefined;
    if (!measure || !outcome || !sameKind(outcome.kind)) throw new AccessDeniedError();
    return measure.text;
  }
  throw new ReportValidationError("invalid_choice");
}

/** Et nytt tiltak sist på avviket, likt «+ Standardtiltak». Samme id to ganger gir samme tiltak. */
async function insertMeasure(
  scope: WriteScope,
  deviation: Deviation,
  measureId: string,
  text: string,
): Promise<{ id: string; rowVersion: number; created: boolean }> {
  const measureWhere = and(
    eq(deviationMeasures.organizationId, scope.orgId),
    eq(deviationMeasures.reportId, scope.reportId),
  );
  const [existing] = await scope.tx
    .select({
      id: deviationMeasures.id,
      deviationId: deviationMeasures.deviationId,
      rowVersion: deviationMeasures.rowVersion,
      deletedAt: deviationMeasures.deletedAt,
    })
    .from(deviationMeasures)
    .where(and(measureWhere, eq(deviationMeasures.id, measureId)));
  if (existing) {
    if (existing.deviationId !== deviation.id || existing.deletedAt !== null) {
      throw new AccessDeniedError();
    }
    return { id: existing.id, rowVersion: existing.rowVersion, created: false };
  }
  const live = await scope.tx
    .select({ id: deviationMeasures.id })
    .from(deviationMeasures)
    .where(
      and(
        measureWhere,
        eq(deviationMeasures.deviationId, deviation.id),
        isNull(deviationMeasures.deletedAt),
      ),
    );
  if (live.length >= MAX_MEASURES_PER_DEVIATION) {
    throw new ReportValidationError(
      "limit_reached",
      `Avviket har ${MAX_MEASURES_PER_DEVIATION} tiltak, som er grensen.`,
    );
  }
  const [highest] = await scope.tx
    .select({ value: max(deviationMeasures.sortOrder) })
    .from(deviationMeasures)
    .where(and(measureWhere, eq(deviationMeasures.deviationId, deviation.id)));
  const [inserted] = await scope.tx
    .insert(deviationMeasures)
    .values({
      id: measureId,
      organizationId: scope.orgId,
      reportId: scope.reportId,
      deviationId: deviation.id,
      text,
      // Malens tekst: ikke KI-tekst, og merket «utkast» følger malen (A437, D4)
      textSource: "template",
      sortOrder: (highest?.value ?? -1) + 1,
      createdBy: scope.grant.employeeId,
    })
    .onConflictDoNothing()
    .returning({ id: deviationMeasures.id, rowVersion: deviationMeasures.rowVersion });
  // Id-en finnes i en annen organisasjon eller rapport: 404, og den andre raden er urørt
  if (!inserted) throw new AccessDeniedError();
  return { ...inserted, created: true };
}

/** Se `ApplyPhrase` i `./types`. */
export const applyPhrase: ApplyPhrase = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<ApplyPhraseResult> => {
    requireUuid(input?.usageId, input?.candidate?.id);
    if (input?.measureId !== undefined) requireUuid(input.measureId);
    const values = parseOrThrow(applyPhraseInputSchema, input);
    const { deviationId, field } = await requirePhraseUsageRow(scope, values.usageId);
    const { deviation, result } = await requireLiveRoomDeviation(scope, deviationId);
    if ((field === "new_measure") !== (values.measureId !== undefined)) {
      throw new ReportValidationError("invalid_input");
    }

    const checkpointKey = scope.template.checkpointKeyById.get(result.checkpointId) ?? "";
    const raw = await candidateText(scope, values.candidate, field, deviation);
    const mergeValues = await mergeValuesFor(scope, checkpointKey, {
      value: deviation.measurementValue,
      unit: deviation.measurementUnit,
    });
    const text = mergeFieldsText(raw, mergeValues).text;

    let saved: { id: string; rowVersion: number };
    if (field === "new_measure") {
      const measure = await insertMeasure(scope, deviation, values.measureId as string, text);
      if (!measure.created) {
        // Samme trykk to ganger: tiltaket og beslutningen er lagret fra før
        return {
          status: "saved",
          id: measure.id,
          rowVersion: measure.rowVersion,
          text,
          refresh: await refreshOf(scope),
        };
      }
      await auditReport(scope, "deviation_measure", measure.id, "create", {
        deviationId: deviation.id,
        usageId: values.usageId,
      });
      saved = measure;
    } else {
      const column = DEVIATION_COLUMNS[field];
      const current = deviation[column];
      const base = values.base === "" ? null : values.base;
      if (current !== base) {
        // «Endret av andre»: ingenting lagres, og forslaget står åpent
        return { status: "conflict", id: deviation.id, rowVersion: deviation.rowVersion, current };
      }
      const [updated] = await scope.tx
        .update(deviations)
        .set({ [column]: text, updatedBy: scope.grant.employeeId })
        .where(
          and(
            eq(deviations.organizationId, scope.orgId),
            eq(deviations.reportId, scope.reportId),
            eq(deviations.id, deviation.id),
          ),
        )
        .returning({ id: deviations.id, rowVersion: deviations.rowVersion });
      if (!updated) throw new AccessDeniedError();
      await auditReport(scope, "deviation", deviation.id, "update", {
        field,
        usageId: values.usageId,
      });
      saved = updated;
    }

    // Beslutningen i samme transaksjon (A469). Avvises kandidaten, rulles teksten tilbake.
    await recordDecisionIn(scope.tx, scope.grant, values.usageId, "accepted", {
      candidate: values.candidate,
    });
    return {
      status: "saved",
      id: saved.id,
      rowVersion: saved.rowVersion,
      text,
      refresh: await refreshOf(scope),
    };
  });
