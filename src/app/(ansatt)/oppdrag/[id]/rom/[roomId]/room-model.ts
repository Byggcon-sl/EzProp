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
  computePublishCheck,
  containsPiiPlaceholder,
  fillMergeFields,
  sortReviewWarnings,
  listPhraseCandidates,
  mergeFieldValues,
  mergeNumberText,
  mostUsedPhraseCandidate,
  phraseCandidateOtherTg,
  phraseCandidateText,
  searchPhraseCandidates,
  summarizePublishCheck,
  warningFix,
  type CheckpointWarning,
  type PublishCheckRoom,
  type DecisionState,
  type MergeFieldKey,
  type MergeFieldSources,
  type MergeValues,
  type PhraseCandidate,
  type PhraseField,
  type PhraseUsageCount,
  type OutcomeTg,
  type ReasonLabelLookup,
  type SuggestionTg,
  type WarningFixAction,
  type WarningTextContext,
} from "@/core/reports/logic";
import type {
  AnswerValue,
  CheckpointView,
  DeviationView,
  ReportSummaryView,
  RoomTemplateDocument,
  SuggestionView,
  TgiuDetailsView,
} from "@/core/reports/types";
import type { AiCandidateRef, DeviationTg } from "@/db/schema";
import {
  AI_CANDIDATE_REFS_MAX,
  OUTCOME_MATCH_MAX,
  OUTCOME_MATCH_NOTE_MAX,
} from "@/shared/config/ai-targets";
import { TG_BADGE_SHORT, tgBadgeFullText } from "@/shared/ui/tg-badge";
import { OUTCOME_MATCH_TEXTS } from "./room-messages";

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

/**
 * Teksten i TG-merket på et treff i «+ Avvik» (skisse for «Skriv det du ser», avsnitt 4.3), og
 * lang form for skjermleseren. TG står alltid med tekst; «Velg TG2 eller TG3» og «HMS» har ingen
 * TG-farge (`tg` er `null`), fordi ingen TG er valgt.
 */
export function outcomeTgLabel(kind: OutcomeDoc["kind"]): {
  text: string;
  long: string;
  tg: "2" | "3" | null;
} {
  switch (kind) {
    case "tg2":
      return { text: TG_BADGE_SHORT["2"], long: tgBadgeFullText("2"), tg: "2" };
    case "tg3":
      return { text: TG_BADGE_SHORT["3"], long: tgBadgeFullText("3"), tg: "3" };
    case "choose_tg2_tg3":
      return { text: OUTCOME_MATCH_TEXTS.chooseTg, long: OUTCOME_MATCH_TEXTS.chooseTg, tg: null };
    case "hms":
      return { text: OUTCOME_MATCH_TEXTS.hms, long: OUTCOME_MATCH_TEXTS.hms, tg: null };
  }
}

/** Høyst så mange treff fra KI og i «Nærmeste treff (uten KI)» (samme grense som serveren). */
export const OUTCOME_HITS_MAX = OUTCOME_MATCH_MAX;
/** Høyst så mange tegn i notatet til «Finn med KI» (A560). */
export const OUTCOME_NOTE_MAX = OUTCOME_MATCH_NOTE_MAX;

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
            chosenTg: s.latestDecision.chosenTg,
            madeDeviation: s.latestDecision.deviationId !== null,
            deviationId: s.latestDecision.deviationId,
          },
        ]
      : [],
  );
}

/**
 * Forslagets TG slik «Å se over» og meldingene viser den: 2, 3, `choose`, `0` eller `IU`. `null`
 * for HMS-utfall og når utfallet ikke finnes i malen. Utfallets TG står i malen, ikke i regelsvaret.
 */
export function suggestionTgOf(
  suggestion: Pick<SuggestionView, "suggestion">,
  doc: Pick<RoomDocumentIndex, "outcome">,
): SuggestionTg | null {
  const s = suggestion.suggestion;
  if (!s) return null;
  if (s.kind === "tgiu") return "IU";
  if (s.kind === "tg0") return "0";
  const outcome = doc.outcome(s.checkpoint_key, s.question_key, s.outcome_key);
  return outcome ? outcomeTgOf(outcome.kind) : null;
}

/** Forslaget står åpent med Godta, Endre og Avvis (utløst, ikke foreldet, uten gjeldende beslutning). */
export function isOpenSuggestion(
  suggestions: readonly SuggestionView[],
  ruleKey: string,
  checkpointKey: string | undefined,
): boolean {
  return suggestions.some(
    (s) =>
      s.ruleKey === ruleKey &&
      (checkpointKey === undefined || s.checkpointKey === checkpointKey) &&
      s.state === "triggered" &&
      !s.stale &&
      s.latestDecision === null,
  );
}

export type WarningWithFix = {
  warning: CheckpointWarning;
  fix: WarningFixAction | null;
  /** Det `warningText` trenger: forslagets TG eller valgt TG i beslutningen. */
  context: WarningTextContext;
  /**
   * Det åpne forslaget advarselen gjelder (`open_suggestion_on_done_checkpoint`), slik at «Å se
   * over» kan vise Godta, Endre og Avvis. Ellers `null`.
   */
  openSuggestion: SuggestionView | null;
};

/**
 * «Å se over» for punktet: advarslene med «Rett nå», teksten sin og det åpne forslaget. Åpne
 * forslag på ferdig punkt står øverst, TG3 først (forbedreren, FA-L23).
 */
export function warningsWithFix(
  checkpoint: CheckpointView,
  suggestions: readonly SuggestionView[],
  doc: Pick<RoomDocumentIndex, "outcome">,
): WarningWithFix[] {
  const decisions = decisionStates(suggestions);
  const byRule = new Map(
    suggestions
      .filter((s) => s.checkpointKey === checkpoint.checkpointKey)
      .map((s) => [s.ruleKey, s] as const),
  );
  const suggestionOf = (warning: CheckpointWarning) =>
    warning.ruleKey === null ? undefined : byRule.get(warning.ruleKey);
  const tgOf = (warning: CheckpointWarning) => {
    const suggestion = suggestionOf(warning);
    return suggestion ? suggestionTgOf(suggestion, doc) : null;
  };
  return sortReviewWarnings(checkpoint.warnings, tgOf).map((warning) => {
    const suggestion = suggestionOf(warning);
    const context: WarningTextContext = {};
    let openSuggestion: SuggestionView | null = null;
    if (warning.code === "open_suggestion_on_done_checkpoint" && suggestion) {
      context.suggestionTg = suggestionTgOf(suggestion, doc);
      if (isOpenSuggestion([suggestion], suggestion.ruleKey, undefined))
        openSuggestion = suggestion;
    }
    if (
      warning.code === "suggestion_no_longer_applies" &&
      warning.deviationId === null &&
      suggestion?.latestDecision
    ) {
      context.chosenTg = suggestion.latestDecision.chosenTg;
    }
    return { warning, fix: warningFix(warning, { decisions }), context, openSuggestion };
  });
}

/**
 * «Rett nå» for T-0059 (A381): valget for hulltaking endres til «Utført med funn». Badets egne
 * koder står her i skjermen for badet, ikke i de generelle funksjonene i `logic/`.
 */
export const T0059_FIX = {
  elementKey: "wet_room.hole_drilling",
  optionKey: "done_with_findings",
} as const;

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
/** Mellomrom, punktum og bindestrek mellom sifre («010190 12345» stoppes også). */
const DIGIT_SEPARATORS = /(?<=\d)[\s.-]+(?=\d)/gu;

/**
 * Grensene for fritekst i rapporten, de samme som serveren bruker (`src/core/reports`). Serveren
 * har siste ord; skjermen sier fra før lagring, så teksten aldri går tapt.
 */
export const REPORT_TEXT_LIMITS = {
  /** Avvik, årsak, konsekvens, tiltak, beskrivelse og TGIU-feltene. */
  long: 10_000,
  /** Tekstsvar i registreringen. */
  answer: 2_000,
  /** Kostnad, forklaring. */
  costText: 500,
} as const;

const formatCount = (n: number) => n.toLocaleString("nb-NO");

export const TEXT_MESSAGES = {
  tooLong: (max: number) => `Teksten er for lang. Grensen er ${formatCount(max)} tegn.`,
  nationalId: "Teksten ser ut til å inneholde et fødselsnummer. Fjern det.",
  /** A466: samme melding som serveren gir (`text_has_placeholder`). */
  placeholder: "Teksten har en plassholder fra KI, for eksempel [adresse]. Skriv inn riktig verdi.",
} as const;

/** Kontroll av fritekst før lagring. Teksten beholdes i feltet. */
export function reportTextValidator(max: number): (value: unknown) => string | null {
  return (value) => {
    if (typeof value !== "string") return null;
    if (value.length > max) return TEXT_MESSAGES.tooLong(max);
    if (ELEVEN_DIGITS.test(value.replace(DIGIT_SEPARATORS, ""))) return TEXT_MESSAGES.nationalId;
    if (containsPiiPlaceholder(value)) return TEXT_MESSAGES.placeholder;
    return null;
  };
}

/** «1 640 av 2 000 tegn» når 80 % av grensen er brukt, ellers `null`. */
export function characterCountText(length: number, max: number): string | null {
  if (length < max * 0.8) return null;
  return `${formatCount(length)} av ${formatCount(max)} tegn`;
}

// --- Tall ---------------------------------------------------------------------------------

export const NUMBER_MESSAGE = "Skriv et tall, for eksempel 14,9.";

/** «14,9» og «14.9» godtas. Tomt felt er tomt svar. */
export function parseNumberInput(raw: string): { ok: true; value: number | null } | { ok: false } {
  const compact = raw
    .trim()
    .replace(/[\s  ]/g, "")
    .replace(",", ".");
  if (compact === "") return { ok: true, value: null };
  if (!/^[-−]?\d+(\.\d+)?$/u.test(compact)) return { ok: false };
  return { ok: true, value: Number(compact.replace("−", "-")) };
}

// --- Tellemerket «Se over og publiser» (docs/funksjoner/fase2a-publisering-badet-design.md 14) --

/** Tellemerket for hele rapporten: rommet regnet lokalt pluss resten fra serveren. */
export function publishCounts(
  publishRoom: PublishCheckRoom,
  outside: { blockers: number; warnings: number },
): { blockers: number; warnings: number } {
  // Befaringsdatoen og KI-forslagene står i `outside`; her bare rommet.
  const own = summarizePublishCheck(
    computePublishCheck({
      hasInspectionDate: true,
      rooms: [publishRoom],
      pendingAiSuggestions: [],
    }),
  );
  return {
    blockers: own.blockers + outside.blockers,
    warnings: own.warnings + outside.warnings,
  };
}

// --- KI i veien: forslag fra frasebanken (A485, A433, A437, A468) ------------------------------

/** Høyst så mange kandidater i listen, samme tall som serveren bruker (A433). */
export const PHRASE_LIST_MAX = AI_CANDIDATE_REFS_MAX;

/** Svaret i rommet som verdi for flettefeltene (samme form som reglene leser). */
function mergeAnswerValue(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value.trim() === "" ? undefined : value;
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  if (typeof value === "object") {
    const answer = value as Partial<AnswerValue>;
    if (answer.optionKeys && answer.optionKeys.length > 0) return answer.optionKeys;
    if (typeof answer.number === "number") return answer.number;
    if (typeof answer.text === "string" && answer.text.trim() !== "") return answer.text;
  }
  return undefined;
}

/**
 * Verdiene til flettefeltene i nettleseren, fra svarene slik de står nå (lagringskøen først, så
 * serveren). Samme regler som serveren (`mergeFieldValues`); kildene per punkt kommer fra siden.
 * Målingen på avviket brukes når svaret mangler, som ved Godta.
 */
export function clientMergeValues(input: {
  sources: MergeFieldSources;
  answerOf(elementKey: string): unknown;
  optionLabel(elementKey: string, optionKey: string): string | null;
  measurementValue: number | null;
}): MergeValues {
  const keys = new Set<string>();
  for (const source of Object.values(input.sources)) {
    for (const key of source?.keys ?? []) keys.add(key);
  }
  const answers: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const value = mergeAnswerValue(input.answerOf(key));
    if (value !== undefined) answers[key] = value;
  }
  const values = mergeFieldValues(input.sources, answers, input.optionLabel);
  if (!values.måleverdi && input.measurementValue !== null) {
    values.måleverdi = mergeNumberText(input.measurementValue);
  }
  return values;
}

/** Hvordan en kandidat havner i feltet: «Sett inn», «Bytt ut teksten» eller «Legg til som tiltak». */
export type PhraseAction = "insert" | "replace" | "add_measure";

/**
 * Handlingsordet (avsnitt 4): tiltak legges alltid til; et tomt felt eller malens egen tekst får
 * «Sett inn», og egen tekst fra takstmannen får «Bytt ut teksten».
 */
export function phraseActionFor(
  field: PhraseField,
  current: string,
  currentIsTemplateText: boolean,
): PhraseAction {
  if (field === "new_measure") return "add_measure";
  if (current.trim() === "" || currentIsTemplateText) return "insert";
  return "replace";
}

/** En kandidat slik listen viser den: teksten som havner i feltet og det som står i metalinjen. */
export type PhraseItem = {
  /** Fast nøkkel i listen, samme for tekstsøket og KI-rekkefølgen (fokus beholdes ved bytte). */
  key: string;
  ref: AiCandidateRef | null;
  text: string;
  missing: MergeFieldKey[];
  checkpointName: string;
  outcomeName: string;
  /** TG teksten hører til, eller `null` for «velg TG2 eller TG3» og HMS. */
  tg: DeviationTg | null;
  hms: boolean;
  draft: boolean;
  mostUsed: boolean;
  /** TG teksten hører til når den er en annen enn avvikets (advarsel etter valg). */
  otherTg: DeviationTg | null;
};

/** Nøkkelen for en kandidat: malens faste koder, så tekstsøket og KI-svaret peker på samme rad. */
export function phraseItemKey(candidate: PhraseCandidate): string {
  return [
    candidate.checkpointKey,
    candidate.questionKey,
    candidate.outcomeKey,
    candidate.measureSortOrder ?? "",
    candidate.text,
  ].join("|");
}

function candidateTg(candidate: PhraseCandidate): DeviationTg | null {
  if (candidate.appliesToTg !== null) return candidate.appliesToTg;
  if (candidate.outcomeKind === "tg2") return 2;
  if (candidate.outcomeKind === "tg3") return 3;
  return null;
}

/** Kandidatene som listeelementer, med flettefeltene satt inn og merket «Mest brukt» (A468). */
export function phraseItems(
  candidates: readonly PhraseCandidate[],
  context: {
    doc: Pick<RoomDocumentIndex, "outcome">;
    mergeValues: MergeValues;
    deviationTg: DeviationTg | null;
  },
): PhraseItem[] {
  const mostUsed = mostUsedPhraseCandidate(candidates);
  return candidates.map((candidate) => {
    const filled = phraseCandidateText(candidate, context.mergeValues);
    const outcome = context.doc.outcome(
      candidate.checkpointKey,
      candidate.questionKey,
      candidate.outcomeKey,
    );
    return {
      key: phraseItemKey(candidate),
      ref: candidate.ref,
      text: filled.text,
      missing: filled.missing,
      checkpointName: candidate.checkpointName,
      outcomeName: outcome ? outcomeName(outcome) : "",
      tg: candidateTg(candidate),
      hms: candidate.outcomeKind === "hms",
      draft: candidate.textStatus === "draft",
      mostUsed: mostUsed === candidate,
      otherTg: phraseCandidateOtherTg(candidate, context.deviationTg),
    };
  });
}

/** Tekstene som står i feltet nå, så kandidatene med samme tekst tas ut (A433). */
export function phraseCurrentTexts(
  field: PhraseField,
  deviation: Pick<DeviationView, "measures">,
  current: string,
): string[] {
  if (field === "new_measure") return deviation.measures.map((m) => m.text);
  return current.trim() === "" ? [] : [current];
}

/**
 * Tekstsøket uten KI (A485): kandidatene som er lastet med badet, søkt med teksten som står i
 * feltet. Malens egen tekst i feltet gir de første kandidatene, ikke null treff. Ingen kall og
 * ingen logg.
 */
export function phraseTextSearch(input: {
  document: RoomTemplateDocument;
  field: PhraseField;
  deviation: Pick<DeviationView, "kind" | "tg" | "measures" | "questionKey" | "outcomeKey">;
  checkpointKey: string;
  current: string;
  currentIsTemplateText: boolean;
  usage: readonly PhraseUsageCount[];
}): PhraseCandidate[] {
  const candidates = listPhraseCandidates(input.document, {
    field: input.field,
    checkpointKey: input.checkpointKey,
    questionKey: input.deviation.questionKey,
    outcomeKey: input.deviation.outcomeKey,
    kind: input.deviation.kind,
    tg: input.deviation.tg,
    usage: input.usage,
    currentTexts: phraseCurrentTexts(input.field, input.deviation, input.current),
  });
  const query = input.field === "new_measure" || input.currentIsTemplateText ? "" : input.current;
  return searchPhraseCandidates(candidates, query, PHRASE_LIST_MAX);
}

/** Hvor en kandidat står etter et bytte av listen; første når den ikke finnes lenger (avsnitt 4). */
export function focusIndexAfterSwap(
  previousKey: string | null,
  next: readonly Pick<PhraseItem, "key">[],
): number {
  if (previousKey === null) return 0;
  const index = next.findIndex((item) => item.key === previousKey);
  return index === -1 ? 0 : index;
}

/** Ny plass for flyttbar `tabindex` etter en tast (piltaster, Home, End). `null` = ikke vår tast. */
export function listKeyTarget(key: string, index: number, length: number): number | null {
  if (length === 0) return null;
  switch (key) {
    case "ArrowDown":
      return Math.min(length - 1, index + 1);
    case "ArrowUp":
      return Math.max(0, index - 1);
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}

// --- KI i veien: sammendraget (A434, A435, A462, A465) ------------------------------------------

export type SummaryWarningItem = {
  id: string;
  text: string;
  roomId: string | null;
  checkpointKey: string | null;
};

const SUMMARY_GROUP_TG: Readonly<Record<string, string | null>> = {
  tg3: "TG3",
  tg2: "TG2",
  tgiu: "TGIU",
  hms: null,
};

/** Linjene under «Funnene er endret etter sammendraget.» Fjernede funn har bare antallet. */
export function summaryChangeItems(
  view: Pick<ReportSummaryView, "changedSinceDraft">,
  texts: {
    added(checkpoint: string): string;
    changed(checkpoint: string, tg: string | null): string;
    removed(n: number): string;
  },
): SummaryWarningItem[] {
  const changes = view.changedSinceDraft;
  if (!changes) return [];
  const items: SummaryWarningItem[] = [
    ...changes.changed.map((f) => ({
      id: `changed-${f.id}`,
      text: texts.changed(f.checkpointName, SUMMARY_GROUP_TG[f.group] ?? null),
      roomId: f.roomId,
      checkpointKey: f.checkpointKey,
    })),
    ...changes.added.map((f) => ({
      id: `added-${f.id}`,
      text: texts.added(f.checkpointName),
      roomId: f.roomId,
      checkpointKey: f.checkpointKey,
    })),
  ];
  if (changes.removedCount > 0) {
    items.push({
      id: "removed",
      text: texts.removed(changes.removedCount),
      roomId: null,
      checkpointKey: null,
    });
  }
  return items;
}
