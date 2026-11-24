import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { AccessDeniedError } from "@/core/access";
import {
  checkpointResults,
  deviationMeasures,
  deviations,
  ruleSuggestionDecisions,
  type CheckpointResult,
  type Deviation,
  type DeviationTg,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { refKey, requireUuid } from "./context";
import { ReportValidationError } from "./errors";
import {
  checkDirectTgConflict,
  MAX_DEVIATIONS_PER_CHECKPOINT,
  MAX_MEASURES_PER_DEVIATION,
  measureForTg,
  mergeFieldsText,
  mergeFieldValues,
  mergeNumberText,
  type MergeValues,
  type OutcomeTg,
} from "./logic";
import { mergeSourcesFor } from "./merge-sources";
import { loadRoomData, ruleAnswersOf } from "./room-view";
import {
  addDeviationInputSchema,
  addMeasureInputSchema,
  parseOrThrow,
  restoreDeviationInputSchema,
} from "./schemas";
import type {
  ActionResult,
  AddDeviation,
  AddMeasure,
  RemoveDeviation,
  RemoveMeasure,
  RestoreDeviation,
  RestoreDeviationResult,
  TgiuChoice,
} from "./types";
import {
  auditReport,
  ensureCheckpointResult,
  liveDeviationsOf,
  refreshOf,
  requireRoomCheckpoint,
  softDeleteDeviations,
  withRoomWrite,
  writeTgDirect,
  type WriteScope,
} from "./write";

/*
 * Avvik og tiltak (docs/funksjoner/fase2a-badet-pc.md Omfang 5 og 7). Badets avvik kommer alltid
 * fra et avviksspørsmål og et utfall i den låste malversjonen, med standardtekstene og
 * standardtiltakene (`text_source = template`). Fjerning er myk, og Angre gir samme rad tilbake.
 * Ingenting her setter TG ut fra reglene: TG kommer fra utfallet eller fra takstmannens valg.
 */

/** Malens TG for utfallet (`OutcomeTg`). HMS gir `null`. */
export function outcomeTgOfKind(kind: string): OutcomeTg | null {
  if (kind === "tg2") return 2;
  if (kind === "tg3") return 3;
  if (kind === "choose_tg2_tg3") return "choose";
  return null;
}

export type CreateDeviationParams = {
  id: string;
  checkpointKey: string;
  questionKey: string;
  outcomeKey: string;
  /** Valgt TG. Må stemme med utfallet når utfallet har fast TG; `null` ved «velg» og HMS. */
  tg: DeviationTg | null;
  /** Endre (A346): TG kan avvike fra utfallets faste TG. Tiltakene følger valgt TG (T-0060). */
  allowOtherTg?: boolean;
  tgiuChoice?: TgiuChoice;
  suggestedByRuleId?: string | null;
  measurement?: { value: number | null; unit: string | null } | null;
};

export type CreateDeviationResult =
  | { status: "created" | "exists"; deviation: Deviation; result: CheckpointResult }
  | { status: "tgiu_conflict" };

/** Utfallet i den låste malversjonen og i rommet, eller `unknown_key`. */
export function requireOutcome(
  scope: WriteScope,
  checkpointKey: string,
  questionKey: string,
  outcomeKey: string,
) {
  requireRoomCheckpoint(scope, checkpointKey);
  const outcome = scope.roomDoc.outcomes.find(
    (o) =>
      o.checkpoint_key === checkpointKey && o.question_key === questionKey && o.key === outcomeKey,
  );
  const outcomeId = scope.template.outcomeIdByRef.get(
    refKey(checkpointKey, questionKey, outcomeKey),
  );
  const questionId = scope.template.questionIdByRef.get(refKey(checkpointKey, questionKey));
  if (!outcome || !outcomeId || !questionId) throw new ReportValidationError("unknown_key");
  const measureDocs = scope.roomDoc.standard_measures.filter(
    (m) =>
      m.checkpoint_key === checkpointKey &&
      m.question_key === questionKey &&
      m.outcome_key === outcomeKey,
  );
  return { outcome, outcomeId, questionId, measureDocs, outcomeTg: outcomeTgOfKind(outcome.kind) };
}

/** TG avviket får: utfallets faste TG, eller valget ved «velg TG2 eller TG3». HMS har aldri TG. */
export function resolveDeviationTg(
  outcomeTg: OutcomeTg | null,
  chosen: DeviationTg | null,
  allowOtherTg = false,
): DeviationTg | null {
  if (outcomeTg === null) {
    if (chosen !== null) throw new ReportValidationError("invalid_choice");
    return null;
  }
  if (outcomeTg === "choose" || (allowOtherTg && chosen !== null)) return chosen;
  if (chosen !== null && chosen !== outcomeTg) throw new ReportValidationError("invalid_choice");
  return outcomeTg;
}

/** Et avvik i rapporten (også slettet), med organisasjon og rapport. Aldri oppslag på id alene. */
async function findReportDeviation(scope: WriteScope, deviationId: string) {
  const [row] = await scope.tx
    .select()
    .from(deviations)
    .where(
      and(
        eq(deviations.organizationId, scope.orgId),
        eq(deviations.reportId, scope.reportId),
        eq(deviations.id, deviationId),
      ),
    );
  return row ?? null;
}

/**
 * Flettefeltene i standardtekstene fylt fra lagrede svar i rommet (Omfang 5). Uten verdi står
 * feltet som «[måleverdi mangler]», aldri som `{…}`. Målingen regelen slo til på, brukes når
 * svaret mangler.
 */
export async function mergeValuesFor(
  scope: WriteScope,
  checkpointKey: string,
  measurement: CreateDeviationParams["measurement"],
): Promise<MergeValues> {
  const data = await loadRoomData(scope.tx, scope.orgId, scope.reportId, scope.context.room.id);
  const answers = ruleAnswersOf(scope.template, data.answers);
  const options = scope.roomDoc.element_options;
  const values = mergeFieldValues(
    mergeSourcesFor(checkpointKey),
    answers,
    (elementKey, optionKey) => {
      const option = options.find((o) => o.element_key === elementKey && o.key === optionKey);
      return option?.label ?? null;
    },
  );
  if (!values.måleverdi && measurement?.value != null) {
    values.måleverdi = mergeNumberText(measurement.value);
  }
  return values;
}

/** Teksten med flettefeltene fylt inn. `null` forblir `null`. */
function merged(text: string | null, values: MergeValues): string | null {
  return text === null ? null : mergeFieldsText(text, values).text;
}

/** Avviket og punktet det står på, når punktet er i rommet. Ellers 404. */
async function requireRoomDeviation(scope: WriteScope, deviationId: string) {
  const [row] = await scope.tx
    .select({ deviation: deviations, result: checkpointResults })
    .from(deviations)
    .innerJoin(
      checkpointResults,
      and(
        eq(checkpointResults.id, deviations.checkpointResultId),
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.roomId, scope.context.room.id),
        isNull(checkpointResults.deletedAt),
      ),
    )
    .where(
      and(
        eq(deviations.organizationId, scope.orgId),
        eq(deviations.reportId, scope.reportId),
        eq(deviations.id, deviationId),
      ),
    );
  if (!row) throw new AccessDeniedError();
  return row;
}

/**
 * Hva som skjer med TG direkte når punktet får et avvik (A395): TG0 og TG1 tømmes, TGIU krever
 * aktivt valg. `false` = takstmannen må velge, ingenting er endret.
 */
async function resolveDirectTg(
  scope: WriteScope,
  result: CheckpointResult,
  kind: Deviation["kind"],
  tgiuChoice: TgiuChoice | undefined,
): Promise<boolean> {
  const conflict = checkDirectTgConflict(result.tgDirect, kind);
  if (conflict === "none") return true;
  if (conflict === "choose_tgiu_or_deviation" && tgiuChoice !== "remove_tgiu") return false;
  await writeTgDirect(scope, result, null);
  return true;
}

/**
 * Lager avviket fra et utfall med standardtekstene og tiltakene for TG-en. Tåler dobbelt trykk og
 * id-kollisjon: finnes id-en alt i rapporten på samme punkt, gis den raden tilbake; finnes den et
 * annet sted (også i en annen organisasjon), er svaret 404 og den andre raden er urørt.
 */
export async function createDeviationFromOutcome(
  scope: WriteScope,
  params: CreateDeviationParams,
): Promise<CreateDeviationResult> {
  const { outcome, outcomeId, questionId, measureDocs, outcomeTg } = requireOutcome(
    scope,
    params.checkpointKey,
    params.questionKey,
    params.outcomeKey,
  );
  const tg = resolveDeviationTg(outcomeTg, params.tg, params.allowOtherTg);
  const kind: Deviation["kind"] = outcome.kind === "hms" ? "hms" : "tg";
  const result = await ensureCheckpointResult(scope, params.checkpointKey);

  const existing = await findReportDeviation(scope, params.id);
  if (existing) {
    if (existing.checkpointResultId !== result.id) throw new AccessDeniedError();
    return { status: "exists", deviation: existing, result };
  }

  const live = await liveDeviationsOf(scope, result.id);
  if (live.length >= MAX_DEVIATIONS_PER_CHECKPOINT) {
    throw new ReportValidationError(
      "limit_reached",
      `Punktet har ${MAX_DEVIATIONS_PER_CHECKPOINT} avvik, som er grensen.`,
    );
  }
  if (!(await resolveDirectTg(scope, result, kind, params.tgiuChoice))) {
    return { status: "tgiu_conflict" };
  }

  const sortOrder = live.reduce((highest, d) => Math.max(highest, d.sortOrder + 1), 0);
  const mergeValues = await mergeValuesFor(scope, params.checkpointKey, params.measurement);
  const [inserted] = await scope.tx
    .insert(deviations)
    .values({
      id: params.id,
      organizationId: scope.orgId,
      reportId: scope.reportId,
      checkpointResultId: result.id,
      deviationQuestionId: questionId,
      outcomeId,
      kind,
      tg,
      deviationText: merged(outcome.deviation_text, mergeValues),
      causeCriterion: outcome.default_cause_criterion,
      causeText: merged(outcome.default_cause_text, mergeValues),
      consequenceText: merged(outcome.default_consequence_text, mergeValues),
      costType: "none",
      measurementValue: params.measurement?.value ?? null,
      measurementUnit: params.measurement?.unit ?? null,
      textSource: "template",
      suggestedByRuleId: params.suggestedByRuleId ?? null,
      sortOrder,
      createdBy: scope.grant.employeeId,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    // Id-en finnes et annet sted. Les tilbake med organisasjonen; ingen rad gir 404.
    const again = await findReportDeviation(scope, params.id);
    if (!again || again.checkpointResultId !== result.id) throw new AccessDeniedError();
    return { status: "exists", deviation: again, result };
  }

  const measures = measureForTg(measureDocs, tg, outcomeTg).measures;
  if (measures.length > 0) {
    await scope.tx.insert(deviationMeasures).values(
      measures.map((measure, index) => ({
        id: uuidv7(),
        organizationId: scope.orgId,
        reportId: scope.reportId,
        deviationId: inserted.id,
        text: mergeFieldsText(measure.text, mergeValues).text,
        textSource: "template" as const,
        sortOrder: index,
        createdBy: scope.grant.employeeId,
      })),
    );
  }
  await auditReport(scope, "deviation", inserted.id, "create", {
    checkpointKey: params.checkpointKey,
    questionKey: params.questionKey,
    outcomeKey: params.outcomeKey,
    kind,
    tg,
    suggestedByRuleId: params.suggestedByRuleId ?? null,
  });
  return { status: "created", deviation: inserted, result };
}

// --- Tjenestene ------------------------------------------------------------------------------

/** Legger til et avvik fra et utfall i malen (`report.edit`). */
export const addDeviation: AddDeviation = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<ActionResult> => {
    requireUuid(input?.id);
    const values = parseOrThrow(addDeviationInputSchema, input);
    const created = await createDeviationFromOutcome(scope, {
      id: values.id,
      checkpointKey: values.checkpointKey,
      questionKey: values.questionKey,
      outcomeKey: values.outcomeKey,
      tg: values.tg,
      tgiuChoice: values.tgiuChoice,
    });
    if (created.status === "tgiu_conflict") return { status: "tgiu_conflict" };
    return { status: "saved", refresh: await refreshOf(scope) };
  });

/**
 * Fjerner avviket og tiltakene mykt (`report.edit`). Beslutningsradene står urørt, og ingen ny rad
 * lages: beslutningen slutter å gjelde, og `refresh` viser forslaget åpent igjen (A491).
 */
export const removeDeviation: RemoveDeviation = (actor, organizationId, room, deviationId) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<ActionResult> => {
    requireUuid(deviationId);
    const { deviation } = await requireRoomDeviation(scope, deviationId);
    if (deviation.deletedAt === null) await softDeleteDeviations(scope, [deviation.id]);
    return { status: "saved", refresh: await refreshOf(scope) };
  });

/**
 * Regelen og punktet når avviket kom fra et regelforslag og det finnes en nyere beslutningsrad for
 * samme regel og punkt enn den siste som peker på avviket (accepted, changed eller rejected). Ellers
 * `null`. Radene leses med organisasjonen og rapporten; sorteringen er den samme som i visningen.
 */
async function newerDecisionFor(
  scope: WriteScope,
  deviation: Deviation,
  result: CheckpointResult,
): Promise<{ ruleKey: string; checkpointKey: string } | null> {
  if (deviation.suggestedByRuleId === null) return null;
  const ruleKey = scope.template.ruleKeyById.get(deviation.suggestedByRuleId);
  const checkpointKey = scope.template.checkpointKeyById.get(result.checkpointId);
  if (!ruleKey || !checkpointKey) return null;
  const rows = await scope.tx
    .select({ id: ruleSuggestionDecisions.id, deviationId: ruleSuggestionDecisions.deviationId })
    .from(ruleSuggestionDecisions)
    .where(
      and(
        eq(ruleSuggestionDecisions.organizationId, scope.orgId),
        eq(ruleSuggestionDecisions.reportId, scope.reportId),
        eq(ruleSuggestionDecisions.checkpointResultId, result.id),
        eq(ruleSuggestionDecisions.ruleKey, ruleKey),
      ),
    )
    .orderBy(asc(ruleSuggestionDecisions.decidedAt), asc(ruleSuggestionDecisions.id));
  const last = rows.findLastIndex((r) => r.deviationId === deviation.id);
  // Ingen rad peker på avviket: gjenopprett som før
  if (last === -1) return null;
  return last < rows.length - 1 ? { ruleKey, checkpointKey } : null;
}

/**
 * Angre etter «Fjern avviket» (`report.edit`): samme rad tilbake, med tiltakene som ble fjernet
 * sammen med det (samme `deleted_at`). Tiltak som var fjernet før, står fjernet.
 */
export const restoreDeviation: RestoreDeviation = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<RestoreDeviationResult> => {
    requireUuid(input?.deviationId);
    const values = parseOrThrow(restoreDeviationInputSchema, input);
    const { deviation, result } = await requireRoomDeviation(scope, values.deviationId);
    if (deviation.deletedAt === null) return { status: "saved", refresh: await refreshOf(scope) };

    // Forslaget er avgjort på nytt etter at avviket ble fjernet (A494): ingenting endres, slik at
    // det aldri står to avvik for samme forslag
    const newer = await newerDecisionFor(scope, deviation, result);
    if (newer) {
      return {
        status: "newer_decision",
        ruleKey: newer.ruleKey,
        checkpointKey: newer.checkpointKey,
        refresh: await refreshOf(scope),
      };
    }

    const live = await liveDeviationsOf(scope, result.id);
    if (live.length >= MAX_DEVIATIONS_PER_CHECKPOINT) {
      throw new ReportValidationError(
        "limit_reached",
        `Punktet har ${MAX_DEVIATIONS_PER_CHECKPOINT} avvik, som er grensen.`,
      );
    }
    const kindForConflict = deviation.kind === "tg" ? "tg" : "hms";
    if (!(await resolveDirectTg(scope, result, kindForConflict, values.tgiuChoice))) {
      return { status: "tgiu_conflict" };
    }

    await scope.tx
      .update(deviationMeasures)
      .set({ deletedAt: null, deletedBy: null, updatedBy: scope.grant.employeeId })
      .where(
        and(
          eq(deviationMeasures.organizationId, scope.orgId),
          eq(deviationMeasures.reportId, scope.reportId),
          eq(deviationMeasures.deviationId, deviation.id),
          // Samme tidspunkt som avviket: tiltakene som ble fjernet sammen med det
          eq(
            deviationMeasures.deletedAt,
            sql`(select ${deviations.deletedAt} from ${deviations} where ${deviations.organizationId} = ${scope.orgId} and ${deviations.id} = ${deviation.id})`,
          ),
        ),
      );
    await scope.tx
      .update(deviations)
      .set({ deletedAt: null, deletedBy: null, updatedBy: scope.grant.employeeId })
      .where(
        and(
          eq(deviations.organizationId, scope.orgId),
          eq(deviations.reportId, scope.reportId),
          eq(deviations.id, deviation.id),
        ),
      );
    await auditReport(scope, "deviation", deviation.id, "restore");
    return { status: "saved", refresh: await refreshOf(scope) };
  });

/** Legger til et tomt tiltak sist på avviket (`report.edit`). */
export const addMeasure: AddMeasure = (actor, organizationId, room, input) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<ActionResult> => {
    requireUuid(input?.id, input?.deviationId);
    const values = parseOrThrow(addMeasureInputSchema, input);
    const { deviation } = await requireRoomDeviation(scope, values.deviationId);
    if (deviation.deletedAt !== null) throw new AccessDeniedError();

    const measureWhere = and(
      eq(deviationMeasures.organizationId, scope.orgId),
      eq(deviationMeasures.reportId, scope.reportId),
    );
    const [existing] = await scope.tx
      .select({ id: deviationMeasures.id, deviationId: deviationMeasures.deviationId })
      .from(deviationMeasures)
      .where(and(measureWhere, eq(deviationMeasures.id, values.id)));
    if (existing) {
      if (existing.deviationId !== deviation.id) throw new AccessDeniedError();
      return { status: "saved", refresh: await refreshOf(scope) };
    }

    const live = await scope.tx
      .select({ sortOrder: deviationMeasures.sortOrder })
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
        id: values.id,
        organizationId: scope.orgId,
        reportId: scope.reportId,
        deviationId: deviation.id,
        text: "",
        textSource: "free",
        sortOrder: (highest?.value ?? -1) + 1,
        createdBy: scope.grant.employeeId,
      })
      .onConflictDoNothing()
      .returning({ id: deviationMeasures.id });
    // Id-en finnes i en annen organisasjon eller rapport: 404, og den andre raden er urørt.
    if (!inserted) throw new AccessDeniedError();
    await auditReport(scope, "deviation_measure", inserted.id, "create", {
      deviationId: deviation.id,
    });
    return { status: "saved", refresh: await refreshOf(scope) };
  });

/** Fjerner tiltaket mykt (`report.edit`). */
export const removeMeasure: RemoveMeasure = (actor, organizationId, room, measureId) =>
  withRoomWrite(actor, organizationId, room, async (scope): Promise<ActionResult> => {
    requireUuid(measureId);
    const [row] = await scope.tx
      .select({ measure: deviationMeasures, deviationId: deviations.id })
      .from(deviationMeasures)
      .innerJoin(
        deviations,
        and(
          eq(deviations.id, deviationMeasures.deviationId),
          eq(deviations.organizationId, scope.orgId),
          eq(deviations.reportId, scope.reportId),
          isNull(deviations.deletedAt),
        ),
      )
      .where(
        and(
          eq(deviationMeasures.organizationId, scope.orgId),
          eq(deviationMeasures.reportId, scope.reportId),
          eq(deviationMeasures.id, measureId),
        ),
      );
    if (!row) throw new AccessDeniedError();
    await requireRoomDeviation(scope, row.deviationId);
    if (row.measure.deletedAt === null) {
      await scope.tx
        .update(deviationMeasures)
        .set({
          deletedAt: scope.now,
          deletedBy: scope.grant.employeeId,
          updatedBy: scope.grant.employeeId,
        })
        .where(
          and(
            eq(deviationMeasures.organizationId, scope.orgId),
            eq(deviationMeasures.id, measureId),
          ),
        );
      await auditReport(scope, "deviation_measure", measureId, "delete", {
        deviationId: row.deviationId,
      });
    }
    return { status: "saved", refresh: await refreshOf(scope) };
  });
