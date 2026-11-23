import { and, desc, eq, isNull, max } from "drizzle-orm";
import { AccessDeniedError } from "@/core/access";
import type { TemplateElementDoc } from "@/core/templates";
import {
  checkpointResults,
  deviationMeasures,
  deviations,
  fieldAnswers,
  ruleSuggestionDecisions,
  tgiuDetails,
  type CheckpointResult,
  type Deviation,
  type DeviationTg,
  type RuleSuggestionDecisionRow,
} from "@/db/schema";
import { uuidv7 } from "@/shared/lib/uuid";
import { requireUuid } from "./context";
import { ReportValidationError } from "./errors";
import { checkCostAmount, COST_BANDS, isEffectiveDecision } from "./logic";
import { answerValueOf } from "./room-view";
import {
  freeTextSchema,
  parseOrThrow,
  REPORT_ANSWER_TEXT_MAX,
  REPORT_NUMBER_MAX,
  reportFieldChangeSchema,
} from "./schemas";
import type {
  AnswerValue,
  DeviationCost,
  ReportFieldChange,
  SaveFieldResult,
  SaveReportField,
} from "./types";
import {
  auditReport,
  ensureCheckpointResult,
  findCheckpointResult,
  refreshOf,
  requireRoomCheckpoint,
  withRoomWrite,
  writeTgDirect,
  type WriteScope,
} from "./write";

/*
 * Lagring per felt (docs/funksjoner/fase2a-badet-pc.md Omfang 8, ADR 0013 punkt 12). Én endring
 * av ett felt: serveren sammenligner verdien klienten så (`base`) med feltets nåverdi
 * (`is not distinct from`). Er de ulike, lagres ingenting, og svaret er «Endret av andre» med
 * nyeste verdi. To faner som endrer ulike felt på samme rad, gir ingen konflikt. `row_version`
 * øker ved hver lagring, men brukes ikke som konfliktsjekk.
 *
 * Lagring av et svar lager aldri avvik og setter aldri TG: reglene kjøres på nytt, og forslagene
 * følger med i svaret. `field_answers.ai_usage_id` settes og tømmes bare her, ett sted
 * (`ANSWER_AI_USAGE_ON_CHANGE`), og kommer aldri fra klienten. Revisjonsloggen får feltkoden, aldri
 * tekstverdien.
 */

type Change = ReportFieldChange;

const EMPTY_ANSWER: AnswerValue = { text: null, number: null, optionKeys: null };

/** Lik verdi for JSON-data (svar og kostnad). Rekkefølgen på nøklene spiller ingen rolle. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.hasOwn(b, key) &&
      sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** Tom tekst og tom liste er det samme som ikke svart. */
function normalizeAnswer(value: AnswerValue): AnswerValue {
  return {
    text: value.text === "" ? null : value.text,
    number: value.number,
    optionKeys: value.optionKeys && value.optionKeys.length > 0 ? value.optionKeys : null,
  };
}

function emptyToNull(value: string | null): string | null {
  return value === "" ? null : value;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kontrollerer svaret mot feltet i malen. Bare verdien som passer felttypen kan være satt. Valg
 * må finnes på feltet, tall må ligge innenfor grensene, og tekst har lengdegrense og sperre mot
 * fødselsnummer.
 */
function validateAnswer(scope: WriteScope, element: TemplateElementDoc, value: AnswerValue) {
  const onlyText = value.number === null && value.optionKeys === null;
  const onlyNumber = value.text === null && value.optionKeys === null;
  const onlyOptions = value.text === null && value.number === null;
  switch (element.field_type) {
    case "choice": {
      if (!onlyOptions) throw new ReportValidationError("invalid_value");
      const keys = value.optionKeys ?? [];
      const allowed = new Set(
        scope.roomDoc.element_options
          .filter((o) => o.element_key === element.key)
          .map((o) => o.key),
      );
      if (keys.some((key) => !allowed.has(key))) throw new ReportValidationError("invalid_value");
      if (new Set(keys).size !== keys.length) throw new ReportValidationError("invalid_value");
      if (!element.multiple && keys.length > 1) throw new ReportValidationError("invalid_value");
      return;
    }
    case "number": {
      if (!onlyNumber) throw new ReportValidationError("invalid_value");
      const n = value.number;
      if (n === null) return;
      const tooBig = Math.abs(n) > REPORT_NUMBER_MAX;
      const belowMin = element.min_value !== null && n < element.min_value;
      const aboveMax = element.max_value !== null && n > element.max_value;
      if (tooBig || belowMin || aboveMax) throw new ReportValidationError("invalid_value");
      return;
    }
    case "checkbox": {
      // Avkrysning lagres som tall: 1 = krysset av, 0 = ikke krysset av, tom = ikke svart
      if (!onlyNumber) throw new ReportValidationError("invalid_value");
      if (value.number !== null && value.number !== 0 && value.number !== 1) {
        throw new ReportValidationError("invalid_value");
      }
      return;
    }
    case "date": {
      if (!onlyText) throw new ReportValidationError("invalid_value");
      if (value.text !== null && !ISO_DATE.test(value.text)) {
        throw new ReportValidationError("invalid_value");
      }
      return;
    }
    case "text":
    case "phrase": {
      if (!onlyText) throw new ReportValidationError("invalid_value");
      parseOrThrow(freeTextSchema(REPORT_ANSWER_TEXT_MAX), value.text);
      return;
    }
    default:
      // Bilde, signatur og tabell lagres ikke som svar her
      throw new ReportValidationError("not_applicable");
  }
}

function conflict(id: string, rowVersion: number, current: Change["value"]): SaveFieldResult {
  return { status: "conflict", id, rowVersion, current };
}

async function saved(scope: WriteScope, id: string, rowVersion: number): Promise<SaveFieldResult> {
  return { status: "saved", id, rowVersion, refresh: await refreshOf(scope) };
}

// --- Svar på felt ------------------------------------------------------------------------------

/** Verdien `ai_usage_id` får når takstmannen endrer et svar (ADR 0013 punkt 13). */
const ANSWER_AI_USAGE_ON_CHANGE = null;

async function saveAnswer(
  scope: WriteScope,
  change: Extract<Change, { table: "field_answers" }>,
): Promise<SaveFieldResult> {
  const element = scope.roomDoc.elements.find((e) => e.key === change.elementKey);
  const elementId = scope.template.elementIdByKey.get(change.elementKey);
  if (!element || !elementId) throw new ReportValidationError("unknown_key");
  const value = normalizeAnswer(change.value);
  const base = normalizeAnswer(change.base);
  validateAnswer(scope, element, value);

  // Romfelt har fast form: rom satt, bygning og kontrollpunktresultat tomme, nummer 0
  const placeWhere = and(
    eq(fieldAnswers.organizationId, scope.orgId),
    eq(fieldAnswers.reportId, scope.reportId),
    eq(fieldAnswers.elementId, elementId),
    eq(fieldAnswers.roomId, scope.context.room.id),
    isNull(fieldAnswers.reportBuildingId),
    isNull(fieldAnswers.checkpointResultId),
    eq(fieldAnswers.repeatIndex, 0),
    isNull(fieldAnswers.deletedAt),
  );
  const [row] = await scope.tx.select().from(fieldAnswers).where(placeWhere);
  const current = row ? normalizeAnswer(answerValueOf(row)) : EMPTY_ANSWER;
  if (!sameValue(current, base))
    return conflict(row?.id ?? change.id, row?.rowVersion ?? 0, current);
  if (row && sameValue(current, value)) return saved(scope, row.id, row.rowVersion);

  if (row) {
    const [updated] = await scope.tx
      .update(fieldAnswers)
      .set({
        valueText: value.text,
        valueNumber: value.number,
        valueOptionKeys: value.optionKeys,
        // Det eneste stedet `ai_usage_id` skrives (B4.13): en endret verdi kom ikke fra KI.
        // «KI i veien» setter den her når et godtatt forslag lagres.
        aiUsageId: ANSWER_AI_USAGE_ON_CHANGE,
        updatedBy: scope.grant.employeeId,
      })
      .where(and(placeWhere, eq(fieldAnswers.id, row.id)))
      .returning({ id: fieldAnswers.id, rowVersion: fieldAnswers.rowVersion });
    if (!updated) throw new Error("kunne ikke lagre svaret");
    await auditReport(scope, "field_answer", updated.id, "update", {
      elementKey: change.elementKey,
    });
    return saved(scope, updated.id, updated.rowVersion);
  }

  requireUuid(change.id);
  const [inserted] = await scope.tx
    .insert(fieldAnswers)
    .values({
      id: change.id,
      organizationId: scope.orgId,
      reportId: scope.reportId,
      elementId,
      roomId: scope.context.room.id,
      repeatIndex: 0,
      valueText: value.text,
      valueNumber: value.number,
      valueOptionKeys: value.optionKeys,
      createdBy: scope.grant.employeeId,
    })
    .onConflictDoNothing()
    .returning({ id: fieldAnswers.id, rowVersion: fieldAnswers.rowVersion });
  // Id-en finnes et annet sted (også i en annen organisasjon): 404, og den andre raden er urørt
  if (!inserted) throw new AccessDeniedError();
  await auditReport(scope, "field_answer", inserted.id, "create", {
    elementKey: change.elementKey,
  });
  return saved(scope, inserted.id, inserted.rowVersion);
}

// --- Beskrivelse på punktet --------------------------------------------------------------------

async function saveDescription(
  scope: WriteScope,
  change: Extract<Change, { table: "checkpoint_results" }>,
): Promise<SaveFieldResult> {
  const { checkpointId } = requireRoomCheckpoint(scope, change.checkpointKey);
  const value = emptyToNull(change.value);
  const base = emptyToNull(change.base);
  const existing = await findCheckpointResult(scope, checkpointId);
  const current = existing?.descriptionText ?? null;
  if (current !== base)
    return conflict(existing?.id ?? checkpointId, existing?.rowVersion ?? 0, current);
  const result = existing ?? (await ensureCheckpointResult(scope, change.checkpointKey));
  if (current === value) return saved(scope, result.id, result.rowVersion);
  const [updated] = await scope.tx
    .update(checkpointResults)
    .set({ descriptionText: value, updatedBy: scope.grant.employeeId })
    .where(
      and(
        eq(checkpointResults.organizationId, scope.orgId),
        eq(checkpointResults.reportId, scope.reportId),
        eq(checkpointResults.id, result.id),
      ),
    )
    .returning({ rowVersion: checkpointResults.rowVersion });
  await auditReport(scope, "checkpoint_result", result.id, "update", { field: "description_text" });
  return saved(scope, result.id, updated?.rowVersion ?? result.rowVersion + 1);
}

// --- Avvik -----------------------------------------------------------------------------------

/** Avviket (ikke slettet) på et punkt i rommet, med punktet. Ellers 404. */
export async function requireLiveRoomDeviation(scope: WriteScope, deviationId: string) {
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
        isNull(deviations.deletedAt),
      ),
    );
  if (!row) throw new AccessDeniedError();
  return row;
}

function costOf(row: Deviation): DeviationCost {
  return { type: row.costType, bandKey: row.costBandKey, amount: row.costAmount };
}

/** Kostnaden: intervall med kode, eget beløp over 0 i hele kroner, eller ingen. Rundes aldri. */
function validateCost(cost: DeviationCost): void {
  if (cost.type === "band") {
    const band = COST_BANDS.find((b) => b.key === cost.bandKey);
    if (!band || band.archived || cost.amount !== null)
      throw new ReportValidationError("invalid_value");
    return;
  }
  if (cost.type === "approx") {
    if (
      cost.bandKey !== null ||
      cost.amount === null ||
      checkCostAmount(cost.amount) === "invalid"
    ) {
      throw new ReportValidationError(
        "invalid_value",
        "Skriv et helt beløp over 0 kroner, uten øre.",
      );
    }
    return;
  }
  if (cost.bandKey !== null || cost.amount !== null)
    throw new ReportValidationError("invalid_value");
}

/**
 * Bytter standardtiltakene når avviket får ny TG (T-0060): tiltak fra malen for den andre TG-en
 * fjernes mykt, og malens tiltak for den nye TG-en legges til. Tiltak takstmannen har skrevet
 * eller endret, står.
 */
async function swapMeasuresForTg(scope: WriteScope, deviation: Deviation, tg: DeviationTg | null) {
  if (tg === null || deviation.outcomeId === null) return;
  const ref = scope.template.outcomeRefById.get(deviation.outcomeId);
  if (!ref) return;
  const tgSpecific = scope.roomDoc.standard_measures.filter(
    (m) =>
      m.checkpoint_key === ref.checkpointKey &&
      m.question_key === ref.questionKey &&
      m.outcome_key === ref.outcomeKey &&
      m.applies_to_tg !== null,
  );
  if (tgSpecific.length === 0) return;
  const measureWhere = and(
    eq(deviationMeasures.organizationId, scope.orgId),
    eq(deviationMeasures.reportId, scope.reportId),
    eq(deviationMeasures.deviationId, deviation.id),
  );
  const live = await scope.tx
    .select()
    .from(deviationMeasures)
    .where(and(measureWhere, isNull(deviationMeasures.deletedAt)));
  const otherTexts = new Set(tgSpecific.filter((m) => m.applies_to_tg !== tg).map((m) => m.text));
  const remove = live.filter((m) => m.textSource === "template" && otherTexts.has(m.text));
  for (const measure of remove) {
    await scope.tx
      .update(deviationMeasures)
      .set({
        deletedAt: scope.now,
        deletedBy: scope.grant.employeeId,
        updatedBy: scope.grant.employeeId,
      })
      .where(and(measureWhere, eq(deviationMeasures.id, measure.id)));
  }
  const kept = live.filter((m) => !remove.includes(m));
  const add = tgSpecific
    .filter((m) => m.applies_to_tg === tg && !kept.some((k) => k.text === m.text))
    .sort((a, b) => a.sort_order - b.sort_order);
  if (add.length === 0) return;
  const [highest] = await scope.tx
    .select({ value: max(deviationMeasures.sortOrder) })
    .from(deviationMeasures)
    .where(measureWhere);
  const start = (highest?.value ?? -1) + 1;
  await scope.tx.insert(deviationMeasures).values(
    add.map((measure, index) => ({
      id: uuidv7(),
      organizationId: scope.orgId,
      reportId: scope.reportId,
      deviationId: deviation.id,
      text: measure.text,
      textSource: "template" as const,
      sortOrder: start + index,
      createdBy: scope.grant.employeeId,
    })),
  );
}

/**
 * Den gjeldende beslutningen som laget dette avviket (A490, ADR 0013 punkt 9b), eller `null`.
 * Bare avvik fra et regelforslag (`suggested_by_rule_id`) kan ha en. Siste rad for regelen på
 * punktet vinner; den er gjeldende for avviket bare når den peker på det, og avviket står
 * (`isEffectiveDecision`). Oppslaget filtrerer på organisasjonen og rapporten fra tilgangssjekken.
 */
export async function effectiveDecisionForDeviation(
  scope: WriteScope,
  deviation: Deviation,
  result: CheckpointResult,
): Promise<RuleSuggestionDecisionRow | null> {
  if (deviation.suggestedByRuleId === null || deviation.deletedAt !== null) return null;
  const ruleKey = scope.template.ruleKeyById.get(deviation.suggestedByRuleId);
  if (!ruleKey) return null;
  const [latest] = await scope.tx
    .select()
    .from(ruleSuggestionDecisions)
    .where(
      and(
        eq(ruleSuggestionDecisions.organizationId, scope.orgId),
        eq(ruleSuggestionDecisions.reportId, scope.reportId),
        eq(ruleSuggestionDecisions.checkpointResultId, deviation.checkpointResultId),
        eq(ruleSuggestionDecisions.ruleKey, ruleKey),
      ),
    )
    .orderBy(desc(ruleSuggestionDecisions.decidedAt), desc(ruleSuggestionDecisions.id))
    .limit(1);
  if (!latest || latest.deviationId !== deviation.id) return null;
  const effective = isEffectiveDecision(
    {
      ruleKey: latest.ruleKey,
      decision: latest.decision,
      suggestion: latest.suggestion,
      chosenTg: latest.chosenTg,
      madeDeviation: true,
      deviationId: deviation.id,
    },
    { tgDirect: result.tgDirect },
  );
  return effective ? latest : null;
}

/** Meldingen når TG byttes på et avvik fra et forslag uten grunn (A490). */
export const SUGGESTED_TG_REASON_MESSAGE = "Velg en grunn for å endre TG fra forslaget.";

/**
 * Skriver ny TG på avviket med følgene: TGIU på punktet stopper TG (A395), TG0/TG1 tømmes, og
 * standardtiltakene byttes (T-0060). Revisjonsloggen får gammel og ny TG. Brukes av lagring per
 * felt og av `changeSuggestedDeviationTg`. Gir ny `row_version`.
 */
export async function writeDeviationTg(
  scope: WriteScope,
  deviation: Deviation,
  result: CheckpointResult,
  tg: DeviationTg | null,
): Promise<number> {
  if (deviation.kind !== "tg") throw new ReportValidationError("invalid_choice");
  if (tg !== null) {
    // Avvik med TG kan ikke stå sammen med TGIU uten aktivt valg (A395); TG0/TG1 tømmes
    if (result.tgDirect === "IU") throw new ReportValidationError("tgiu_on_checkpoint");
    if (result.tgDirect !== null) await writeTgDirect(scope, result, null);
  }
  await swapMeasuresForTg(scope, deviation, tg);
  const [updated] = await scope.tx
    .update(deviations)
    .set({ tg, updatedBy: scope.grant.employeeId })
    .where(
      and(
        eq(deviations.organizationId, scope.orgId),
        eq(deviations.reportId, scope.reportId),
        eq(deviations.id, deviation.id),
      ),
    )
    .returning({ rowVersion: deviations.rowVersion });
  await auditReport(scope, "deviation", deviation.id, "update", {
    field: "tg",
    from: deviation.tg,
    to: tg,
  });
  return updated?.rowVersion ?? deviation.rowVersion + 1;
}

const DEVIATION_TEXT_COLUMNS = {
  deviation_text: "deviationText",
  cause_text: "causeText",
  consequence_text: "consequenceText",
} as const;

async function saveDeviationField(
  scope: WriteScope,
  change: Extract<Change, { table: "deviations" }>,
): Promise<SaveFieldResult> {
  requireUuid(change.id);
  const { deviation, result } = await requireLiveRoomDeviation(scope, change.id);
  const where = and(
    eq(deviations.organizationId, scope.orgId),
    eq(deviations.reportId, scope.reportId),
    eq(deviations.id, deviation.id),
  );
  const write = async (
    values: Partial<typeof deviations.$inferInsert>,
    changes: Record<string, string | number | null>,
  ) => {
    const [updated] = await scope.tx
      .update(deviations)
      .set({ ...values, updatedBy: scope.grant.employeeId })
      .where(where)
      .returning({ rowVersion: deviations.rowVersion });
    await auditReport(scope, "deviation", deviation.id, "update", {
      field: change.field,
      ...changes,
    });
    return saved(scope, deviation.id, updated?.rowVersion ?? deviation.rowVersion + 1);
  };

  switch (change.field) {
    case "tg": {
      // Avvik fra et forslag med gjeldende beslutning bytter TG bare med grunn, gjennom
      // `changeSuggestedDeviationTg` (A490). Avvises alltid her, og ingenting lagres.
      if (await effectiveDecisionForDeviation(scope, deviation, result)) {
        throw new ReportValidationError("override_reason", SUGGESTED_TG_REASON_MESSAGE);
      }
      if (deviation.tg !== change.base)
        return conflict(deviation.id, deviation.rowVersion, deviation.tg);
      if (deviation.tg === change.value) return saved(scope, deviation.id, deviation.rowVersion);
      const rowVersion = await writeDeviationTg(scope, deviation, result, change.value);
      return saved(scope, deviation.id, rowVersion);
    }
    case "deviation_text":
    case "cause_text":
    case "consequence_text": {
      const column = DEVIATION_TEXT_COLUMNS[change.field];
      const current = deviation[column];
      const base = emptyToNull(change.base);
      const value = emptyToNull(change.value);
      if (current !== base) return conflict(deviation.id, deviation.rowVersion, current);
      if (current === value) return saved(scope, deviation.id, deviation.rowVersion);
      return write(
        {
          [column]: value,
          textSource: deviation.textSource === "template" ? "edited" : deviation.textSource,
        },
        {},
      );
    }
    case "cost_text": {
      const base = emptyToNull(change.base);
      const value = emptyToNull(change.value);
      if (deviation.costText !== base) {
        return conflict(deviation.id, deviation.rowVersion, deviation.costText);
      }
      if (deviation.costText === value) return saved(scope, deviation.id, deviation.rowVersion);
      return write({ costText: value }, {});
    }
    case "cause_criterion": {
      if (deviation.causeCriterion !== change.base) {
        return conflict(deviation.id, deviation.rowVersion, deviation.causeCriterion);
      }
      if (deviation.causeCriterion === change.value) {
        return saved(scope, deviation.id, deviation.rowVersion);
      }
      return write(
        { causeCriterion: change.value },
        { from: deviation.causeCriterion, to: change.value },
      );
    }
    case "cost": {
      const current = costOf(deviation);
      if (!sameValue(current, change.base))
        return conflict(deviation.id, deviation.rowVersion, current);
      if (sameValue(current, change.value)) return saved(scope, deviation.id, deviation.rowVersion);
      validateCost(change.value);
      return write(
        {
          costType: change.value.type,
          costBandKey: change.value.bandKey,
          costAmount: change.value.amount,
        },
        {
          costType: change.value.type,
          costBandKey: change.value.bandKey,
          costAmount: change.value.amount,
        },
      );
    }
    case "sort_order": {
      if (deviation.sortOrder !== change.base) {
        return conflict(deviation.id, deviation.rowVersion, deviation.sortOrder);
      }
      if (deviation.sortOrder === change.value)
        return saved(scope, deviation.id, deviation.rowVersion);
      return write({ sortOrder: change.value }, { from: deviation.sortOrder, to: change.value });
    }
  }
}

// --- Tiltak ----------------------------------------------------------------------------------

async function saveMeasureField(
  scope: WriteScope,
  change: Extract<Change, { table: "deviation_measures" }>,
): Promise<SaveFieldResult> {
  requireUuid(change.id);
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
        eq(deviationMeasures.id, change.id),
        isNull(deviationMeasures.deletedAt),
      ),
    );
  if (!row) throw new AccessDeniedError();
  await requireLiveRoomDeviation(scope, row.deviationId);
  const measure = row.measure;
  const where = and(
    eq(deviationMeasures.organizationId, scope.orgId),
    eq(deviationMeasures.reportId, scope.reportId),
    eq(deviationMeasures.id, measure.id),
  );

  let values: Partial<typeof deviationMeasures.$inferInsert>;
  let changes: Record<string, number> = {};
  if (change.field === "text") {
    if (measure.text !== change.base) return conflict(measure.id, measure.rowVersion, measure.text);
    if (measure.text === change.value) return saved(scope, measure.id, measure.rowVersion);
    values = {
      text: change.value,
      textSource: measure.textSource === "template" ? "edited" : measure.textSource,
    };
  } else {
    if (measure.sortOrder !== change.base) {
      return conflict(measure.id, measure.rowVersion, measure.sortOrder);
    }
    if (measure.sortOrder === change.value) return saved(scope, measure.id, measure.rowVersion);
    values = { sortOrder: change.value };
    changes = { from: measure.sortOrder, to: change.value };
  }
  const [updated] = await scope.tx
    .update(deviationMeasures)
    .set({ ...values, updatedBy: scope.grant.employeeId })
    .where(where)
    .returning({ rowVersion: deviationMeasures.rowVersion });
  await auditReport(scope, "deviation_measure", measure.id, "update", {
    field: change.field,
    deviationId: row.deviationId,
    ...changes,
  });
  return saved(scope, measure.id, updated?.rowVersion ?? measure.rowVersion + 1);
}

// --- Opplysninger ved TGIU ---------------------------------------------------------------------

const TGIU_COLUMNS = {
  reason: "reason",
  alternative_check_method: "alternativeCheckMethod",
  alternative_check_result: "alternativeCheckResult",
  risk_assessment: "riskAssessment",
  how_to_examine: "howToExamine",
  owner_informed: "ownerInformed",
  construction_vulnerable: "constructionVulnerable",
} as const;

async function saveTgiuField(
  scope: WriteScope,
  change: Extract<Change, { table: "tgiu_details" }>,
): Promise<SaveFieldResult> {
  const { checkpointId } = requireRoomCheckpoint(scope, change.checkpointKey);
  const result = await findCheckpointResult(scope, checkpointId);
  if (!result || result.tgDirect !== "IU") throw new ReportValidationError("not_applicable");
  const where = and(
    eq(tgiuDetails.organizationId, scope.orgId),
    eq(tgiuDetails.reportId, scope.reportId),
    eq(tgiuDetails.checkpointResultId, result.id),
    isNull(tgiuDetails.deletedAt),
  );
  const [row] = await scope.tx.select().from(tgiuDetails).where(where);
  if (!row) throw new ReportValidationError("not_applicable");

  const column = TGIU_COLUMNS[change.field];
  const current = row[column];
  const isText = change.field !== "owner_informed" && change.field !== "construction_vulnerable";
  const base = isText ? emptyToNull(change.base as string | null) : change.base;
  const value = isText ? emptyToNull(change.value as string | null) : change.value;
  if (current !== base) return conflict(row.id, row.rowVersion, current);
  if (current === value) return saved(scope, row.id, row.rowVersion);

  const values: Partial<typeof tgiuDetails.$inferInsert> = { [column]: value };
  const changes: Record<string, string | boolean | null> = { field: change.field };
  if (change.field === "owner_informed") {
    // Tidspunktet settes av serveren når eier er informert, og tømmes ellers
    values.ownerInformedAt = value === true ? scope.now : null;
    changes.to = value as boolean | null;
  }
  if (change.field === "construction_vulnerable") changes.to = value as string | null;
  const [updated] = await scope.tx
    .update(tgiuDetails)
    .set({ ...values, updatedBy: scope.grant.employeeId })
    .where(and(where, eq(tgiuDetails.id, row.id)))
    .returning({ rowVersion: tgiuDetails.rowVersion });
  await auditReport(scope, "tgiu_details", row.id, "update", changes);
  return saved(scope, row.id, updated?.rowVersion ?? row.rowVersion + 1);
}

// --- Tjenesten -------------------------------------------------------------------------------

/** Lagrer ett felt (`report.edit`). Se `SaveReportField` i `./types`. */
export const saveField: SaveReportField = (actor, organizationId, room, change) =>
  withRoomWrite(actor, organizationId, room, async (scope) => {
    // Id-er før Zod: ugyldig id gir 404 (B5.6)
    if (change && typeof change === "object" && "id" in change) requireUuid(change.id);
    const values = parseOrThrow(reportFieldChangeSchema, change) as Change;
    switch (values.table) {
      case "field_answers":
        return saveAnswer(scope, values);
      case "checkpoint_results":
        return saveDescription(scope, values);
      case "deviations":
        return saveDeviationField(scope, values);
      case "deviation_measures":
        return saveMeasureField(scope, values);
      case "tgiu_details":
        return saveTgiuField(scope, values);
    }
  });
