import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  grantHasPermission,
  requireOrganizationAccess,
  type Actor,
  type EmployeeGrant,
} from "@/core/access";
import { evaluateRules, type JsonValue, type RuleAnswers, type RuleResult } from "@/core/rules";
import { WET_ROOM_LIFESPANS } from "@/core/rules/data/lifespans";
import { WET_ROOM_THRESHOLDS } from "@/core/rules/data/thresholds";
import type { TemplateDocument } from "@/core/templates";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db, type DbExecutor } from "@/db/client";
import {
  checkpointResults,
  deviationMeasures,
  deviations,
  fieldAnswers,
  ruleSuggestionDecisions,
  tgiuDetails,
  type CheckpointResult,
  type Deviation,
  type DeviationMeasure,
  type FieldAnswer,
  type RuleSuggestionDecisionRow,
  type DeviationTg,
  type StoredRuleSuggestion,
  type TgDirect,
  type TextStatus,
  type TgiuDetails,
} from "@/db/schema";
import { isEffectiveDecision, latestDecisionPerRule } from "./logic/effective-decision";
import {
  computeCheckpointStatus,
  computeCheckpointTg,
  computeCheckpointWarnings,
  countDoneCheckpoints,
  hasMeasuresForTg,
  suggestionStillApplies,
  templateTextStatusMatcher,
  tgiuRequirementsFor,
  type CheckpointState,
  type DecisionState,
  type DeviationState,
  type OutcomeTg,
  type SuggestionTg,
} from "./logic";
import {
  inspectionYearOf,
  loadLockedTemplate,
  loadRoomContext,
  requireUuid,
  roomDocumentOf,
  ruleCheckpointKey,
  type LockedTemplate,
  type RoomContext,
} from "./context";
import { guardReportErrors } from "./errors";
import { phraseUsageForDocument } from "./phrase-source";
import { NO_FINDINGS_OVER_LIMIT_SIGNAL, OWNER_REFUSED_SIGNAL, publishCheckRoomOf } from "./signals";
import type {
  AnswerValue,
  AnswerView,
  CheckpointView,
  DecisionView,
  DeviationSuggestionLink,
  DeviationView,
  GetRoomReport,
  InspectionYear,
  RoomRef,
  RoomRefresh,
  RoomReportView,
  RoomTemplateDocument,
  SuggestionView,
  TgiuDetailsView,
} from "./types";

/*
 * Visningen av badet (docs/funksjoner/fase2a-badet-pc.md Omfang 7 og 13). Lesingen skriver aldri,
 * heller ikke når rapporten ikke er startet. Antall spørringer er fast: ett oppslag per tabell for
 * hele rommet, uansett hvor mange punkter, avvik og tiltak (B4.33). TG, status, advarsler og
 * forslag regnes av de rene funksjonene hver gang (A342); ingenting av det lagres.
 */

// --- Data for rommet ---------------------------------------------------------------------------

export type RoomData = {
  answers: FieldAnswer[];
  results: CheckpointResult[];
  deviations: Deviation[];
  measures: DeviationMeasure[];
  tgiu: TgiuDetails[];
  decisions: DecisionRow[];
};

/**
 * En beslutningsrad med om avviket den laget, står (A491). `deviationLive` er `false` når raden
 * ikke har avvik, eller avviket er mykt slettet.
 */
export type DecisionRow = RuleSuggestionDecisionRow & { deviationLive: boolean };

/**
 * Alle radene for rommet i rapporten, i seks spørringer (tiltakene etter avvikene). Svar, punkter, avvik, tiltak og TGIU som
 * ikke er slettet; beslutningene er bare tillegg og slettes aldri.
 */
export async function loadRoomData(
  ex: DbExecutor,
  orgId: string,
  reportId: string,
  roomId: string,
): Promise<RoomData> {
  const resultJoin = (checkpointResultId: AnyPgColumn) =>
    and(
      eq(checkpointResults.id, checkpointResultId),
      eq(checkpointResults.organizationId, orgId),
      eq(checkpointResults.reportId, reportId),
      eq(checkpointResults.roomId, roomId),
      isNull(checkpointResults.deletedAt),
    );

  const [answers, results, deviationRows, tgiuRows, decisionRows] = await Promise.all([
    ex
      .select()
      .from(fieldAnswers)
      .where(
        and(
          eq(fieldAnswers.organizationId, orgId),
          eq(fieldAnswers.reportId, reportId),
          eq(fieldAnswers.roomId, roomId),
          isNull(fieldAnswers.reportBuildingId),
          isNull(fieldAnswers.checkpointResultId),
          eq(fieldAnswers.repeatIndex, 0),
          isNull(fieldAnswers.deletedAt),
        ),
      ),
    ex
      .select()
      .from(checkpointResults)
      .where(
        and(
          eq(checkpointResults.organizationId, orgId),
          eq(checkpointResults.reportId, reportId),
          eq(checkpointResults.roomId, roomId),
          isNull(checkpointResults.deletedAt),
        ),
      ),
    ex
      .select({ row: deviations })
      .from(deviations)
      .innerJoin(checkpointResults, resultJoin(deviations.checkpointResultId))
      .where(
        and(
          eq(deviations.organizationId, orgId),
          eq(deviations.reportId, reportId),
          isNull(deviations.deletedAt),
        ),
      )
      .orderBy(asc(deviations.sortOrder), asc(deviations.id)),
    ex
      .select({ row: tgiuDetails })
      .from(tgiuDetails)
      .innerJoin(checkpointResults, resultJoin(tgiuDetails.checkpointResultId))
      .where(
        and(
          eq(tgiuDetails.organizationId, orgId),
          eq(tgiuDetails.reportId, reportId),
          isNull(tgiuDetails.deletedAt),
        ),
      ),
    // Med avvikets `deleted_at`, slik at gjeldende beslutning regnes på samme oppslag (ADR 0013
    // punkt 9b). Avviket slås opp med organisasjonen.
    ex
      .select({
        row: ruleSuggestionDecisions,
        joinedDeviationId: deviations.id,
        deviationDeletedAt: deviations.deletedAt,
      })
      .from(ruleSuggestionDecisions)
      .innerJoin(checkpointResults, resultJoin(ruleSuggestionDecisions.checkpointResultId))
      .leftJoin(
        deviations,
        and(
          eq(deviations.id, ruleSuggestionDecisions.deviationId),
          eq(deviations.organizationId, orgId),
          eq(deviations.reportId, reportId),
        ),
      )
      .where(
        and(
          eq(ruleSuggestionDecisions.organizationId, orgId),
          eq(ruleSuggestionDecisions.reportId, reportId),
        ),
      )
      .orderBy(asc(ruleSuggestionDecisions.decidedAt), asc(ruleSuggestionDecisions.id)),
  ]);

  // Tiltakene etter avvikene, med id-ene derfra: ett oppslag på indeksen (organisasjon, avvik),
  // uansett hvor mange avvik rommet har
  const deviationIds = deviationRows.map((r) => r.row.id);
  const measureRows = await ex
    .select()
    .from(deviationMeasures)
    .where(
      and(
        eq(deviationMeasures.organizationId, orgId),
        eq(deviationMeasures.reportId, reportId),
        inArray(deviationMeasures.deviationId, deviationIds),
        isNull(deviationMeasures.deletedAt),
      ),
    )
    .orderBy(asc(deviationMeasures.sortOrder), asc(deviationMeasures.id));

  return {
    answers,
    results,
    deviations: deviationRows.map((r) => r.row),
    measures: measureRows,
    tgiu: tgiuRows.map((r) => r.row),
    decisions: decisionRows.map((r) => ({
      ...r.row,
      deviationLive: r.joinedDeviationId !== null && r.deviationDeletedAt === null,
    })),
  };
}

// --- Reglene -----------------------------------------------------------------------------------

export function answerValueOf(
  row: Pick<FieldAnswer, "valueText" | "valueNumber" | "valueOptionKeys">,
): AnswerValue {
  return {
    text: row.valueText,
    number: row.valueNumber,
    optionKeys: row.valueOptionKeys,
  };
}

/** Svaret slik regelmotoren leser det: valgkoder, tall eller tekst. Tomt svar tas ikke med. */
function ruleValueOf(value: AnswerValue): JsonValue | undefined {
  if (value.optionKeys && value.optionKeys.length > 0) return value.optionKeys;
  if (value.number !== null) return value.number;
  if (value.text !== null && value.text.trim() !== "") return value.text;
  return undefined;
}

/** Svarene i rommet med feltkoden som nøkkel (egne nøkler, ikke arvede). */
export function ruleAnswersOf(
  template: LockedTemplate,
  answers: readonly FieldAnswer[],
): RuleAnswers {
  const result: Record<string, JsonValue> = Object.create(null);
  for (const answer of answers) {
    const key = template.elementKeyById.get(answer.elementId);
    if (!key) continue;
    const value = ruleValueOf(answerValueOf(answer));
    if (value !== undefined) result[key] = value;
  }
  return result;
}

/** Reglene som gjelder kontrollpunktene i rommet. */
export function roomRules(document: TemplateDocument, roomDoc: RoomTemplateDocument) {
  const keys = new Set(roomDoc.checkpoints.map((c) => c.key));
  return document.rules.filter((rule) => {
    const checkpointKey = ruleCheckpointKey(rule);
    return checkpointKey !== null && keys.has(checkpointKey);
  });
}

/**
 * Kjører reglene for rommet på serveren, på lagrede svar (A341, A346). Gir bare forslag; setter
 * aldri TG og lager aldri avvik. Levetider og terskler er kodedata for våtrom (ADR 0009).
 */
export function evaluateRoomRules(
  template: LockedTemplate,
  roomDoc: RoomTemplateDocument,
  answers: RuleAnswers,
  inspectionYear: number,
): RuleResult[] {
  return evaluateRules({
    template: { kind: template.kind, reportType: template.reportType },
    document: {
      rules: roomRules(template.document, roomDoc),
      rule_conditions: template.document.rule_conditions,
      outcomes: template.document.outcomes,
      element_options: template.document.element_options,
    },
    answers,
    inspectionYear,
    lifespans: WET_ROOM_LIFESPANS,
    thresholds: WET_ROOM_THRESHOLDS,
  });
}

// --- Byggingen av visningen ----------------------------------------------------------------------

function outcomeTgOf(kind: string | undefined): OutcomeTg | null {
  if (kind === "tg2") return 2;
  if (kind === "tg3") return 3;
  if (kind === "choose_tg2_tg3") return "choose";
  return null;
}

function isBlank(text: string | null): boolean {
  return text === null || text.trim() === "";
}

function hasAnswer(value: AnswerValue): boolean {
  return ruleValueOf(value) !== undefined;
}

function optionSelected(
  template: LockedTemplate,
  answers: readonly FieldAnswer[],
  elementKey: string,
  optionKey: string,
): boolean {
  const elementId = template.elementIdByKey.get(elementKey);
  const answer = answers.find((a) => a.elementId === elementId);
  return answer?.valueOptionKeys?.includes(optionKey) ?? false;
}

/** Beslutningsraden slik de rene funksjonene ser den. `deviationId` er `null` når avviket er borte. */
export function toDecisionState(row: DecisionRow): DecisionState {
  return {
    ruleKey: row.ruleKey,
    decision: row.decision,
    suggestion: row.suggestion,
    chosenTg: row.chosenTg,
    madeDeviation: row.deviationId !== null,
    deviationId: row.deviationLive ? row.deviationId : null,
  };
}

/**
 * Den gjeldende beslutningen per regel på punktet (ADR 0013 punkt 9b): siste rad per regel, og
 * bare når den står ved lag. En regel uten oppføring har et åpent forslag.
 */
export function effectiveDecisionsOf(
  rows: readonly DecisionRow[],
  checkpointResultId: string,
  tgDirect: TgDirect | null,
): Map<string, { row: DecisionRow; state: DecisionState }> {
  // Radene er sortert eldst først; siste rad per regel vinner
  const latest = latestDecisionPerRule(
    rows.filter((row) => row.checkpointResultId === checkpointResultId),
  );
  const effective = new Map<string, { row: DecisionRow; state: DecisionState }>();
  for (const row of latest) {
    const state = toDecisionState(row);
    if (isEffectiveDecision(state, { tgDirect })) effective.set(row.ruleKey, { row, state });
  }
  return effective;
}

function toDecisionView(row: DecisionRow, suggestionTg: SuggestionTg | null): DecisionView {
  return {
    suggestionTg,
    id: row.id,
    decision: row.decision,
    chosenTg: row.chosenTg,
    chosenOutcomeKey: row.chosenOutcomeKey,
    overrideReasonCode: row.overrideReasonCode,
    overrideReason: row.overrideReason,
    deviationId: row.deviationLive ? row.deviationId : null,
    decidedAt: row.decidedAt.toISOString(),
  };
}

function toTgiuView(row: TgiuDetails): TgiuDetailsView {
  return {
    id: row.id,
    reason: row.reason,
    ownerInformed: row.ownerInformed,
    ownerInformedAt: row.ownerInformedAt?.toISOString() ?? null,
    alternativeCheckMethod: row.alternativeCheckMethod,
    alternativeCheckResult: row.alternativeCheckResult,
    riskAssessment: row.riskAssessment,
    constructionVulnerable: row.constructionVulnerable,
    howToExamine: row.howToExamine,
    rowVersion: row.rowVersion,
  };
}

export type RoomState = RoomRefresh & {
  answers: AnswerView[];
  ruleResults: RuleResult[];
  /** Tilstanden per punkt i malens rekkefølge. Sjekken før publisering bygger på den (ADR 0015). */
  checkpointStates: { checkpointKey: string; state: CheckpointState }[];
};

/**
 * Regner hele rommet: punktene med TG, status og advarsler, forslagene og fremdriften. Ren
 * funksjon over radene som er lest; kalles etter hver lagring, slik at skjermen alltid får det
 * serveren regner.
 */
export function buildRoomState(input: {
  template: LockedTemplate;
  roomDoc: RoomTemplateDocument;
  roomId: string;
  data: RoomData;
  inspectionYear: number;
}): RoomState {
  const { template, roomDoc, data } = input;
  const ruleResults = evaluateRoomRules(
    template,
    roomDoc,
    ruleAnswersOf(template, data.answers),
    input.inspectionYear,
  );
  const rulesByKey = new Map(template.document.rules.map((r) => [r.key, r]));

  // Punktene med en regel som foreslår TGIU, krever annen fuktkontroll ved TGIU (A349). Hentes fra
  // malen, så ingen punktkode står her.
  const alternativeCheckCheckpointKeys = template.document.rules
    .filter((r) => r.purpose === "suggest_tgiu" && r.active)
    .map(ruleCheckpointKey)
    .filter((key): key is string => key !== null);
  const ownerRefusedInspection = optionSelected(
    template,
    data.answers,
    OWNER_REFUSED_SIGNAL.elementKey,
    OWNER_REFUSED_SIGNAL.optionKey,
  );
  const noFindings = optionSelected(
    template,
    data.answers,
    NO_FINDINGS_OVER_LIMIT_SIGNAL.elementKey,
    NO_FINDINGS_OVER_LIMIT_SIGNAL.optionKey,
  );

  const outcomeDocs = new Map(
    template.document.outcomes.map((o) => [`${o.checkpoint_key}|${o.question_key}|${o.key}`, o]),
  );
  /** TG-en det lagrede forslaget gjelder: malens TG for utfallet, `IU` eller `0`. */
  const suggestionTgOf = (suggestion: StoredRuleSuggestion): SuggestionTg | null => {
    if (suggestion.kind === "tgiu") return "IU";
    if (suggestion.kind === "tg0") return "0";
    return outcomeTgOf(
      outcomeDocs.get(
        `${suggestion.checkpoint_key}|${suggestion.question_key}|${suggestion.outcome_key}`,
      )?.kind,
    );
  };
  /**
   * Koblingen fra et avvik til den gjeldende beslutningen som laget det (A490). TG-valgene uten
   * grunn er utfallets faste TG, eller alle valg ved «velg TG2 eller TG3», bare når avviket har
   * forslagets utfall. Alt annet krever grunn.
   */
  const suggestionLinkOf = (
    decision: DecisionRow | undefined,
    outcomeRef: { checkpointKey: string; questionKey: string; outcomeKey: string } | undefined,
  ): DeviationSuggestionLink | null => {
    if (!decision) return null;
    const suggestion = decision.suggestion;
    const suggestionTg = suggestionTgOf(suggestion);
    const sameOutcome =
      suggestion.kind === "outcome" &&
      outcomeRef !== undefined &&
      outcomeRef.checkpointKey === suggestion.checkpoint_key &&
      outcomeRef.questionKey === suggestion.question_key &&
      outcomeRef.outcomeKey === suggestion.outcome_key;
    let tgWithoutReason: (DeviationTg | null)[] = [];
    if (sameOutcome && suggestionTg === "choose") tgWithoutReason = [2, 3, null];
    else if (sameOutcome && (suggestionTg === 2 || suggestionTg === 3)) {
      tgWithoutReason = [suggestionTg];
    }
    return { ruleKey: decision.ruleKey, decisionId: decision.id, suggestionTg, tgWithoutReason };
  };
  const measureDocsFor = (checkpointKey: string, questionKey: string, outcomeKey: string) =>
    template.document.standard_measures.filter(
      (m) =>
        m.checkpoint_key === checkpointKey &&
        m.question_key === questionKey &&
        m.outcome_key === outcomeKey,
    );

  // «Utkast»-merket per felt (D4): teksten er en av malens tekster for samme felttype i rommet
  const statusOf = (texts: { text: string | null; textStatus: TextStatus }[]) =>
    templateTextStatusMatcher(
      texts.filter((t): t is { text: string; textStatus: TextStatus } => t.text !== null),
    );
  const deviationTextStatus = statusOf(
    roomDoc.outcomes.map((o) => ({ text: o.deviation_text, textStatus: o.text_status })),
  );
  const causeTextStatus = statusOf(
    roomDoc.outcomes.map((o) => ({ text: o.default_cause_text, textStatus: o.text_status })),
  );
  const consequenceTextStatus = statusOf(
    roomDoc.outcomes.map((o) => ({ text: o.default_consequence_text, textStatus: o.text_status })),
  );
  const measureTextStatus = statusOf(
    roomDoc.standard_measures.map((m) => ({ text: m.text, textStatus: m.text_status })),
  );

  const measuresByDeviation = new Map<string, DeviationMeasure[]>();
  for (const measure of data.measures) {
    const list = measuresByDeviation.get(measure.deviationId) ?? [];
    list.push(measure);
    measuresByDeviation.set(measure.deviationId, list);
  }

  const answersView: AnswerView[] = data.answers
    .filter((a) => template.elementKeyById.has(a.elementId))
    .map((a) => ({
      id: a.id,
      elementKey: template.elementKeyById.get(a.elementId) as string,
      value: answerValueOf(a),
      aiUsageId: a.aiUsageId,
      rowVersion: a.rowVersion,
    }));

  const checkpointViews: CheckpointView[] = [];
  const checkpointStates: RoomState["checkpointStates"] = [];
  const latestDecisionByRule = new Map<string, { view: DecisionView; state: DecisionState }>();

  for (const checkpoint of roomDoc.checkpoints) {
    const checkpointId = template.checkpointIdByKey.get(checkpoint.key);
    const result = data.results.find((r) => r.checkpointId === checkpointId) ?? null;
    const deviationRows = result
      ? data.deviations.filter((d) => d.checkpointResultId === result.id)
      : [];
    const tgiuRow = result
      ? (data.tgiu.find((t) => t.checkpointResultId === result.id) ?? null)
      : null;
    const pointRuleResults = ruleResults.filter((r) => {
      const rule = rulesByKey.get(r.rule_key);
      return rule !== undefined && ruleCheckpointKey(rule) === checkpoint.key;
    });

    // Bare gjeldende beslutninger (A491, A495). Ikke gjeldende = forslaget er åpent igjen.
    const effective = result
      ? effectiveDecisionsOf(data.decisions, result.id, result.tgDirect)
      : new Map<string, { row: DecisionRow; state: DecisionState }>();
    const decisions: DecisionState[] = [...effective.values()].map((e) => e.state);
    const effectiveByDeviation = new Map<string, DecisionRow>();
    for (const { row, state: decisionState } of effective.values()) {
      latestDecisionByRule.set(row.ruleKey, {
        view: toDecisionView(row, suggestionTgOf(row.suggestion)),
        state: decisionState,
      });
      if (row.deviationLive && row.deviationId) effectiveByDeviation.set(row.deviationId, row);
    }

    const deviationViews: DeviationView[] = [];
    const deviationStates: DeviationState[] = [];
    for (const row of deviationRows) {
      const questionRef = row.deviationQuestionId
        ? template.questionRefById.get(row.deviationQuestionId)
        : undefined;
      const outcomeRef = row.outcomeId ? template.outcomeRefById.get(row.outcomeId) : undefined;
      const outcomeDoc = outcomeRef
        ? outcomeDocs.get(
            `${outcomeRef.checkpointKey}|${outcomeRef.questionKey}|${outcomeRef.outcomeKey}`,
          )
        : undefined;
      const measureDocs = outcomeRef
        ? measureDocsFor(outcomeRef.checkpointKey, outcomeRef.questionKey, outcomeRef.outcomeKey)
        : [];
      const measures = measuresByDeviation.get(row.id) ?? [];
      deviationViews.push({
        id: row.id,
        questionKey: questionRef?.questionKey ?? null,
        outcomeKey: outcomeRef?.outcomeKey ?? null,
        kind: row.kind,
        tg: row.tg,
        deviationText: row.deviationText,
        causeCriterion: row.causeCriterion,
        causeText: row.causeText,
        consequenceText: row.consequenceText,
        cost: { type: row.costType, bandKey: row.costBandKey, amount: row.costAmount },
        costText: row.costText,
        measurementValue: row.measurementValue,
        measurementUnit: row.measurementUnit,
        textSource: row.textSource,
        textStatus: {
          deviationText: deviationTextStatus(row.deviationText),
          causeText: causeTextStatus(row.causeText),
          consequenceText: consequenceTextStatus(row.consequenceText),
        },
        suggestedByRuleKey: row.suggestedByRuleId
          ? (template.ruleKeyById.get(row.suggestedByRuleId) ?? null)
          : null,
        suggestion: suggestionLinkOf(effectiveByDeviation.get(row.id), outcomeRef),
        sortOrder: row.sortOrder,
        rowVersion: row.rowVersion,
        measures: measures.map((m) => ({
          id: m.id,
          text: m.text,
          textSource: m.textSource,
          textStatus: measureTextStatus(m.text),
          sortOrder: m.sortOrder,
          rowVersion: m.rowVersion,
        })),
      });
      deviationStates.push({
        id: row.id,
        kind: row.kind,
        tg: row.tg,
        causeCriterion: row.causeCriterion,
        causeText: row.causeText,
        consequenceText: row.consequenceText,
        costType: row.costType,
        costAmount: row.costAmount,
        measureCount: measures.filter((m) => !isBlank(m.text)).length,
        outcomeTg: outcomeTgOf(outcomeDoc?.kind),
        hasMeasuresForTg: hasMeasuresForTg(measureDocs, row.tg),
      });
    }

    const checkpointElementIds = new Set(
      roomDoc.elements
        .filter((e) => e.checkpoint_key === checkpoint.key)
        .map((e) => template.elementIdByKey.get(e.key)),
    );
    const hasContent =
      data.answers.some(
        (a) => checkpointElementIds.has(a.elementId) && hasAnswer(answerValueOf(a)),
      ) || !isBlank(result?.descriptionText ?? null);

    const state: CheckpointState = {
      tgDirect: result?.tgDirect ?? null,
      done: result?.done ?? false,
      hasContent,
      deviations: deviationStates,
      tgiu: tgiuRow
        ? {
            reason: tgiuRow.reason,
            riskAssessment: tgiuRow.riskAssessment,
            howToExamine: tgiuRow.howToExamine,
            alternativeCheckMethod: tgiuRow.alternativeCheckMethod,
            alternativeCheckResult: tgiuRow.alternativeCheckResult,
            constructionVulnerable: tgiuRow.constructionVulnerable,
            ownerInformed: tgiuRow.ownerInformed,
          }
        : null,
      tgiuRequirements: tgiuRequirementsFor({
        checkpointKey: checkpoint.key,
        alternativeCheckCheckpointKeys,
        ownerRefusedInspection,
      }),
      ruleResults: pointRuleResults,
      decisions,
      noFindingsWithReadingOverLimit:
        noFindings &&
        pointRuleResults.some(
          (r) => r.rule_key === NO_FINDINGS_OVER_LIMIT_SIGNAL.ruleKey && r.state === "triggered",
        ),
    };

    checkpointStates.push({ checkpointKey: checkpoint.key, state });
    checkpointViews.push({
      checkpointKey: checkpoint.key,
      resultId: result?.id ?? null,
      tgDirect: state.tgDirect,
      tg: computeCheckpointTg(state),
      status: computeCheckpointStatus(state),
      descriptionText: result?.descriptionText ?? null,
      done: state.done,
      rowVersion: result?.rowVersion ?? null,
      deviations: deviationViews,
      tgiuDetails: tgiuRow ? toTgiuView(tgiuRow) : null,
      warnings: computeCheckpointWarnings(state),
    });
  }

  const suggestions: SuggestionView[] = ruleResults.map((result) => {
    const rule = rulesByKey.get(result.rule_key);
    // Bare den gjeldende beslutningen; ellers er forslaget åpent (`latestDecision = null`)
    const latest = latestDecisionByRule.get(result.rule_key) ?? null;
    const stale = latest !== null && !suggestionStillApplies(latest.state, ruleResults);
    return {
      ruleKey: result.rule_key,
      checkpointKey: (rule && ruleCheckpointKey(rule)) ?? "",
      state: result.state,
      suggestion: result.suggestion,
      code: result.code,
      reasons: result.reasons,
      sourceRef: rule?.source_ref ?? null,
      latestDecision: latest?.view ?? null,
      stale,
    };
  });

  return {
    checkpoints: checkpointViews,
    suggestions,
    progress: {
      done: countDoneCheckpoints(checkpointViews),
      total: checkpointViews.length,
    },
    publishRoom: publishCheckRoomOf({
      template,
      roomDoc,
      roomId: input.roomId,
      position: 0,
      answers: data.answers,
      checkpointStates,
    }),
    answers: answersView,
    ruleResults,
    checkpointStates,
  };
}

/** Rommet regnet på nytt etter en lagring (`RoomRefresh`). Leser med samme forbindelse. */
export async function computeRoomRefresh(
  ex: DbExecutor,
  orgId: string,
  context: RoomContext & { report: NonNullable<RoomContext["report"]> },
  template: LockedTemplate,
  now: Date = new Date(),
): Promise<RoomState> {
  const roomDoc = roomDocumentOf(template.document, context.room.group);
  const data = await loadRoomData(ex, orgId, context.report.id, context.room.id);
  return buildRoomState({
    template,
    roomDoc,
    roomId: context.room.id,
    data,
    inspectionYear: inspectionYearOf(context.inspectionAt, now).year,
  });
}

/** Bare det skjermen trenger etter en lagring. */
export function toRefresh(state: RoomState): RoomRefresh {
  return {
    checkpoints: state.checkpoints,
    suggestions: state.suggestions,
    progress: state.progress,
    publishRoom: state.publishRoom,
  };
}

// --- Tjenesten -------------------------------------------------------------------------------

/**
 * Leser badet (`organization.read`). Skriver aldri: uten rapport er svaret «ikke startet», også
 * for den som kan starte den. Nettleseren får bare maldokumentet for rommet og svarene, ingen
 * parter, adresse eller matrikkel.
 */
export const getRoomView: GetRoomReport = async (actor: Actor, organizationId, room) => {
  const grant = await requireOrganizationAccess(actor, organizationId, "organization.read");
  requireUuid(room?.assignmentId, room?.roomId);
  return guardReportErrors("read", () => readRoom(actor, grant, room));
};

async function readRoom(
  actor: Actor,
  grant: EmployeeGrant,
  room: RoomRef,
): Promise<RoomReportView> {
  const context = await loadRoomContext(db, grant, room, { lock: false });
  const canEdit = grantHasPermission(grant, "report.edit");
  if (!context.report) return { state: "not_started", canStart: canEdit };

  const template = await loadLockedTemplate(db, actor, grant, context.report.templateVersionId);
  const roomDoc = roomDocumentOf(template.document, context.room.group);
  const inspectionYear: InspectionYear = inspectionYearOf(context.inspectionAt);
  const [data, phraseUsage] = await Promise.all([
    loadRoomData(db, grant.organizationId, context.report.id, context.room.id),
    phraseUsageForDocument(db, grant.organizationId, roomDoc),
  ]);
  const state = buildRoomState({
    template,
    roomDoc,
    roomId: context.room.id,
    data,
    inspectionYear: inspectionYear.year,
  });

  return {
    state: "started",
    reportId: context.report.id,
    reportStatus: context.report.status,
    canEdit: canEdit && context.report.status === "draft",
    room: { id: context.room.id, name: context.room.name, roomType: context.room.roomType },
    inspectionYear,
    document: roomDoc,
    answers: state.answers,
    checkpoints: state.checkpoints,
    suggestions: state.suggestions,
    progress: state.progress,
    publishRoom: state.publishRoom,
    // «Mest brukt» (A468): samme telling som `LoadPhraseUsage`, for rommets del av malen
    phraseUsage,
  };
}
