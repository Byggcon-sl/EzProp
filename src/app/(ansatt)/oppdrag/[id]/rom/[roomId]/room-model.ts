import type { RuleResult } from "@/core/rules";
import type {
  CheckpointDoc,
  DeviationQuestionDoc,
  OutcomeDoc,
  StandardMeasureDoc,
  TemplateElementDoc,
  TemplateElementOptionDoc,
} from "@/core/templates";
import {
  fillMergeFields,
  warningFix,
  type CheckpointWarning,
  type DecisionState,
  type OutcomeTg,
  type ReasonLabelLookup,
  type WarningFixAction,
} from "@/core/reports/logic";
import type {
  AnswerValue,
  CheckpointView,
  RoomTemplateDocument,
  SuggestionView,
  TgiuDetailsView,
} from "@/core/reports/types";

/*
 * Rene hjelpere for skjermen for badet: rekkefølge, oppslag i maldokumentet, nøkler i
 * lagringskøen, id-er for fokus og neste punkt. Ingen React, ingen database; testet i
 * room-model.test.ts. Importerer bare `@/core/reports/logic` og typer, aldri rapportkjernen.
 * Støtter hovedmål: de ansatte (riktig punkt og felt får fokus) og færre reklamasjoner.
 */

// --- Oppslag i maldokumentet ---------------------------------------------------------------

function bySortOrder<T extends { sort_order: number }>(a: T, b: T): number {
  return a.sort_order - b.sort_order;
}

export type RoomDocumentIndex = {
  checkpoints: CheckpointDoc[];
  checkpoint(key: string): CheckpointDoc | undefined;
  elements(checkpointKey: string): TemplateElementDoc[];
  element(elementKey: string): TemplateElementDoc | undefined;
  options(elementKey: string): TemplateElementOptionDoc[];
  questions(checkpointKey: string): DeviationQuestionDoc[];
  question(checkpointKey: string, questionKey: string): DeviationQuestionDoc | undefined;
  outcomes(checkpointKey: string, questionKey: string): OutcomeDoc[];
  outcome(checkpointKey: string, questionKey: string, outcomeKey: string): OutcomeDoc | undefined;
  measures(checkpointKey: string, questionKey: string, outcomeKey: string): StandardMeasureDoc[];
  labels: ReasonLabelLookup;
};

/** Oppslag i rommets del av den låste malversjonen, i malens rekkefølge. */
export function indexDocument(document: RoomTemplateDocument): RoomDocumentIndex {
  const checkpoints = [...document.checkpoints].sort(bySortOrder);
  const elements = [...document.elements].sort(bySortOrder);
  const options = [...document.element_options].sort(bySortOrder);
  const questions = [...document.deviation_questions].sort(bySortOrder);
  const outcomes = [...document.outcomes].sort(bySortOrder);
  const measures = [...document.standard_measures].sort(bySortOrder);
  const elementByKey = new Map(elements.map((e) => [e.key, e]));
  const optionLabel = (elementKey: string, optionKey: string) =>
    options.find((o) => o.element_key === elementKey && o.key === optionKey)?.label ?? null;
  return {
    checkpoints,
    checkpoint: (key) => checkpoints.find((c) => c.key === key),
    elements: (checkpointKey) => elements.filter((e) => e.checkpoint_key === checkpointKey),
    element: (key) => elementByKey.get(key),
    options: (elementKey) => options.filter((o) => o.element_key === elementKey),
    questions: (checkpointKey) => questions.filter((q) => q.checkpoint_key === checkpointKey),
    question: (checkpointKey, questionKey) =>
      questions.find((q) => q.checkpoint_key === checkpointKey && q.key === questionKey),
    outcomes: (checkpointKey, questionKey) =>
      outcomes.filter((o) => o.checkpoint_key === checkpointKey && o.question_key === questionKey),
    outcome: (checkpointKey, questionKey, outcomeKey) =>
      outcomes.find(
        (o) =>
          o.checkpoint_key === checkpointKey &&
          o.question_key === questionKey &&
          o.key === outcomeKey,
      ),
    measures: (checkpointKey, questionKey, outcomeKey) =>
      measures.filter(
        (m) =>
          m.checkpoint_key === checkpointKey &&
          m.question_key === questionKey &&
          m.outcome_key === outcomeKey,
      ),
    labels: {
      elementLabel: (key) => elementByKey.get(key)?.label ?? null,
      optionLabel,
    },
  };
}

/** Malens TG for utfallet: 2, 3, `choose` («velg TG2 eller TG3») eller `null` (HMS). */
export function outcomeTgOf(kind: OutcomeDoc["kind"]): OutcomeTg | null {
  switch (kind) {
    case "tg2":
      return 2;
    case "tg3":
      return 3;
    case "choose_tg2_tg3":
      return "choose";
    case "hms":
      return null;
  }
}

/** TG som tekst i en knapp: «TG3», «TG2 eller TG3», «HMS». */
export function outcomeTgText(kind: OutcomeDoc["kind"]): string {
  switch (kind) {
    case "tg2":
      return "TG2";
    case "tg3":
      return "TG3";
    case "choose_tg2_tg3":
      return "TG2 eller TG3";
    case "hms":
      return "HMS";
  }
}

/**
 * Utfallets navn: avviksteksten fra malen, med flettefelt vist som «…». Aldri `{…}`. Selve
 * avviket får verdiene fra svarene når det lages (på serveren).
 */
export function outcomeName(outcome: Pick<OutcomeDoc, "deviation_text">): string {
  const text = outcome.deviation_text ?? "";
  return fillMergeFields(text, {})
    .map((segment) => (segment.type === "missing" ? "…" : segment.text))
    .join("");
}

/** Regelsvaret i formen de rene funksjonene for begrunnelsen leser. */
export function suggestionAsRuleResult(suggestion: SuggestionView): RuleResult {
  return {
    rule_key: suggestion.ruleKey,
    // Brukes ikke av begrunnelsen; settes for å fylle formen.
    purpose: suggestion.suggestion?.kind === "tgiu" ? "suggest_tgiu" : "suggest_outcome",
    state: suggestion.state,
    suggestion: suggestion.suggestion,
    code: suggestion.code,
    reasons: suggestion.reasons,
    lifespan_set_key: null,
    threshold_set_key: null,
  };
}

// --- Nøkler i lagringskøen og id-er for fokus ------------------------------------------------

export const answerKey = (elementKey: string) => `answer:${elementKey}`;
export const descriptionKey = (checkpointKey: string) => `checkpoint:${checkpointKey}:description`;
export const deviationFieldKey = (deviationId: string, field: string) =>
  `deviation:${deviationId}:${field}`;
export const deviationPrefix = (deviationId: string) => `deviation:${deviationId}:`;
export const measureFieldKey = (measureId: string, field: "text" | "sort_order") =>
  `measure:${measureId}:${field}`;
export const tgiuFieldKey = (checkpointKey: string, field: string) =>
  `tgiu:${checkpointKey}:${field}`;

/** Id i DOM-en for en nøkkel: bare bokstaver, tall, `-` og `_`. */
export function domId(key: string): string {
  return `f-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}

export const CHECKPOINT_HEADING_ID = "checkpoint-heading";
export const TG_DIRECT_CHOICE_ID = "tg-direct";
export const TGIU_HEADING_ID = "tgiu-heading";
export const WARNINGS_HEADING_ID = "warnings-heading";
export const DONE_BUTTON_ID = "checkpoint-done";
export const SEARCH_INPUT_ID = "deviation-search";
export const ADD_DEVIATION_BUTTON_ID = "add-deviation";
export const ALL_DONE_NOTICE_ID = "all-done";

export const deviationHeadingId = (deviationId: string) => `deviation-${deviationId}-heading`;
export const deviationTgChoiceId = (deviationId: string) =>
  domId(deviationFieldKey(deviationId, "tg"));
export const deviationCostChoiceId = (deviationId: string) =>
  domId(deviationFieldKey(deviationId, "cost"));
export const deviationCauseChoiceId = (deviationId: string) =>
  domId(deviationFieldKey(deviationId, "cause_criterion"));
export const addMeasureButtonId = (deviationId: string) => `deviation-${deviationId}-add-measure`;
export const suggestionId = (ruleKey: string) =>
  `suggestion-${ruleKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;
export const warningId = (index: number) => `warning-${index}`;
export const undoButtonId = (id: string) => `undo-${id}`;

/** Id-en til feltet en «Rett nå» skal legge fokus på (A381). */
export function fixTargetId(
  action: WarningFixAction,
  context: { checkpointKey: string; firstMeasureId: (deviationId: string) => string | null },
): string | null {
  switch (action.kind) {
    case "change_answer":
      return null;
    case "focus_tg_choice":
      return TG_DIRECT_CHOICE_ID;
    case "scroll_to_suggestion":
      return suggestionId(action.ruleKey);
    case "focus_field": {
      if (action.deviationId === null) {
        // TGIU-opplysningene på punktet.
        return domId(tgiuFieldKey(context.checkpointKey, action.field));
      }
      const id = action.deviationId;
      switch (action.field) {
        case "cost":
          return deviationCostChoiceId(id);
        case "cause_criterion":
          return deviationCauseChoiceId(id);
        case "measure": {
          const measureId = context.firstMeasureId(id);
          return measureId ? domId(measureFieldKey(measureId, "text")) : addMeasureButtonId(id);
        }
        default:
          return domId(deviationFieldKey(id, action.field));
      }
    }
  }
}

// --- Beslutninger og advarsler ---------------------------------------------------------------

/**
 * Siste beslutning per regel slik `warningFix` leser dem. `warningFix` bruker bare regelkoden,
 * beslutningen og avviket; forslaget er med for formens skyld.
 */
export function decisionStates(suggestions: readonly SuggestionView[]): DecisionState[] {
  return suggestions.flatMap((s) =>
    s.latestDecision
      ? [
          {
            ruleKey: s.ruleKey,
            decision: s.latestDecision.decision,
            suggestion: s.suggestion ?? { kind: "tg0", checkpoint_key: s.checkpointKey },
            deviationId: s.latestDecision.deviationId,
          },
        ]
      : [],
  );
}

export type WarningWithFix = { warning: CheckpointWarning; fix: WarningFixAction | null };

export function warningsWithFix(
  checkpoint: CheckpointView,
  suggestions: readonly SuggestionView[],
): WarningWithFix[] {
  const decisions = decisionStates(suggestions);
  return checkpoint.warnings.map((warning) => ({
    warning,
    fix: warningFix(warning, { decisions }),
  }));
}

// --- Punktene -------------------------------------------------------------------------------

/**
 * Neste punkt som ikke er ferdig etter `currentKey`, i malens rekkefølge. Går rundt. `null` når
 * alle er ferdige.
 */
export function nextUndoneCheckpoint(
  order: readonly string[],
  checkpoints: readonly Pick<CheckpointView, "checkpointKey" | "done">[],
  currentKey: string,
): string | null {
  const done = new Set(checkpoints.filter((c) => c.done).map((c) => c.checkpointKey));
  const start = order.indexOf(currentKey);
  for (let step = 1; step <= order.length; step++) {
    const key = order[(start + step + order.length) % order.length];
    if (key !== undefined && key !== currentKey && !done.has(key)) return key;
  }
  return null;
}

/** Forrige og neste punkt i rekkefølgen (ikke rundt). */
export function neighbours(
  order: readonly string[],
  currentKey: string,
): { previous: string | null; next: string | null } {
  const index = order.indexOf(currentKey);
  return {
    previous: index > 0 ? (order[index - 1] ?? null) : null,
    next: index >= 0 && index < order.length - 1 ? (order[index + 1] ?? null) : null,
  };
}

/** Punktet fra adressen, eller første punkt når koden er ukjent eller mangler. */
export function initialCheckpointKey(order: readonly string[], requested: string | null): string {
  if (requested && order.includes(requested)) return requested;
  return order[0] ?? "";
}

// --- Svar og TGIU ---------------------------------------------------------------------------

export const EMPTY_ANSWER: AnswerValue = { text: null, number: null, optionKeys: null };

/**
 * TGIU-feltene som vises: de som mangler (advarselen sier hvilke grunnen krever) og de som alt
 * har verdi. Feltene som ikke gjelder grunnen, vises ikke (ingen falske advarsler).
 */
export function visibleTgiuFields(
  details: TgiuDetailsView | null,
  warnings: readonly CheckpointWarning[],
): Set<string> {
  const visible = new Set<string>(["reason", "risk_assessment", "how_to_examine"]);
  for (const warning of warnings) {
    if (warning.code !== "tgiu_details_missing") continue;
    for (const part of warning.missing) visible.add(part);
  }
  if (details) {
    if (details.alternativeCheckMethod !== null) visible.add("alternative_check_method");
    if (details.alternativeCheckResult !== null) visible.add("alternative_check_result");
    if (details.constructionVulnerable !== null) visible.add("construction_vulnerable");
    if (details.ownerInformed !== null) visible.add("owner_informed");
  }
  if (visible.has("alternative_check_method") || visible.has("alternative_check_result")) {
    visible.add("alternative_check_method");
    visible.add("alternative_check_result");
  }
  return visible;
}

/** Elleve sifre på rad ligner et fødselsnummer (samme mønster som serveren). */
const ELEVEN_DIGITS = /\d{11}/u;

/** Grensen for fritekst i rapporten (design avsnitt 15). Serveren har siste ord. */
export const REPORT_TEXT_MAX = 2000;

export const TEXT_MESSAGES = {
  tooLong: `Teksten er for lang. Grensen er ${REPORT_TEXT_MAX.toLocaleString("nb-NO")} tegn.`,
  nationalId: "Teksten ser ut til å inneholde et fødselsnummer. Fjern det.",
} as const;

/** Kontroll av fritekst før lagring. Teksten beholdes i feltet. */
export function checkReportText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > REPORT_TEXT_MAX) return TEXT_MESSAGES.tooLong;
  if (ELEVEN_DIGITS.test(value)) {
    return TEXT_MESSAGES.nationalId;
  }
  return null;
}

/** «1 640 av 2 000 tegn» når 80 % av grensen er brukt, ellers `null`. */
export function characterCountText(length: number, max = REPORT_TEXT_MAX): string | null {
  if (length < max * 0.8) return null;
  const format = (n: number) => n.toLocaleString("nb-NO");
  return `${format(length)} av ${format(max)} tegn`;
}
