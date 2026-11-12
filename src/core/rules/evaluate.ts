import type { TemplateDocument } from "@/core/templates";
import type { RuleConditionType, RuleResultState } from "@/db/schema";
import { LIFESPAN_OUTCOME_KINDS, SUPPORTED_CONDITION_TYPES } from "./codes";
import type {
  AgeVsLifespanReason,
  ConditionReasonCode,
  ConditionTruth,
  EvaluateRules,
  EvaluateRulesInput,
  JsonValue,
  LifespanEntry,
  LifespanOutcomeKind,
  NumberComparator,
  NumberVsLimitReason,
  OptionSelectedReason,
  RuleReason,
  RuleResult,
  RuleSuggestion,
  ThresholdComparator,
} from "./types";

/**
 * Regelmotoren (docs/adr/0009-regelmotoren.md). Ren funksjon: ingen database, ingen dato, ingen
 * KI. Feltkoder og valgkoder kommer bare fra maldokumentet, aldri skrevet inn her.
 */

type Rule = TemplateDocument["rules"][number];
type Condition = TemplateDocument["rule_conditions"][number];

type Context = Omit<EvaluateRulesInput, "template">;

const COMPARATORS: readonly ThresholdComparator[] = ["gt", "gte", "lt", "lte"];
/** Gyldig tall som tekst: punktum som desimaltegn, ikke komma. */
const NUMERIC_TEXT = /^-?(\d+(\.\d*)?|\.\d+)$/;

// --- Hjelpere ------------------------------------------------------------------------------

function byOrderThenKey<T extends { sort_order: number; key: string }>(a: T, b: T): number {
  return a.sort_order - b.sort_order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

function isEmpty(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Tall fra et svar: `number` eller tekst som er et gyldig tall. Ellers `null`. */
function toNumber(value: JsonValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const text = value.trim();
    return NUMERIC_TEXT.test(text) ? Number(text) : null;
  }
  return null;
}

function optionKeysFor(context: Context, elementKey: string): Set<string> {
  return new Set(
    context.document.element_options.filter((o) => o.element_key === elementKey).map((o) => o.key),
  );
}

/** Valgkodene i svaret som finnes som valg på feltet. Fritekst tas aldri med. */
function selectedOptions(context: Context, elementKey: string): string[] {
  const answer = context.answers[elementKey];
  const raw = Array.isArray(answer) ? answer : [answer];
  const options = optionKeysFor(context, elementKey);
  const selected: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && options.has(item) && !selected.includes(item)) {
      selected.push(item);
    }
  }
  return selected;
}

function isStringList(value: JsonValue | null): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** En rad gjelder bare når den ikke er slått av og ikke er slettet. Leses defensivt. */
function isLive(row: object): boolean {
  const { active, deleted_at: deletedAt } = row as { active?: unknown; deleted_at?: unknown };
  if (active === false) return false;
  return deletedAt === null || deletedAt === undefined;
}

function compare(value: number, comparator: NumberComparator, limit: number): boolean {
  switch (comparator) {
    case "eq":
      return value === limit;
    case "gt":
      return value > limit;
    case "gte":
      return value >= limit;
    case "lt":
      return value < limit;
    case "lte":
      return value <= limit;
  }
}

function isComparator(value: unknown): value is ThresholdComparator {
  return COMPARATORS.includes(value as ThresholdComparator);
}

function strictness(kind: LifespanOutcomeKind): number {
  return LIFESPAN_OUTCOME_KINDS.indexOf(kind);
}

function isLifespanKind(value: unknown): value is LifespanOutcomeKind {
  return LIFESPAN_OUTCOME_KINDS.includes(value as LifespanOutcomeKind);
}

/** Treverdilogikk: `all` og `any` over sannhetsverdier. */
function combine(match: Rule["match"], truths: ConditionTruth[]): ConditionTruth {
  if (match === "any") {
    if (truths.includes("true")) return "true";
    if (truths.includes("unknown")) return "unknown";
    return "false";
  }
  if (truths.includes("false")) return "false";
  if (truths.includes("unknown")) return "unknown";
  return "true";
}

// --- Betingelsene --------------------------------------------------------------------------

function optionSelected(condition: Condition, context: Context): OptionSelectedReason {
  const reason = (
    truth: ConditionTruth,
    code: ConditionReasonCode | null,
    selected: string[] = [],
  ): OptionSelectedReason => ({
    type: "option_selected",
    group_no: condition.group_no,
    negated: condition.negate,
    truth,
    code,
    element_key: condition.element_key,
    selected_option_keys: selected,
  });

  const { element_key: elementKey, operator, value } = condition;
  if (!elementKey) return reason("unknown", "condition_incomplete");
  let wanted: string[];
  if (operator === "eq" && typeof value === "string") wanted = [value];
  else if (operator === "in" && isStringList(value) && value.length > 0) wanted = value;
  else return reason("unknown", "condition_incomplete");

  // Et svar uten gyldig valgkode regnes som tomt: fritekst eller en kode som ikke er et valg
  // kan ikke vurderes, og gir aldri en stille «slår ikke til».
  const selected = selectedOptions(context, elementKey);
  if (selected.length === 0) return reason("unknown", "field_empty");
  const truth = selected.some((key) => wanted.includes(key)) ? "true" : "false";
  return reason(truth, null, selected);
}

function numberVsLimit(condition: Condition, context: Context): NumberVsLimitReason {
  const base: NumberVsLimitReason = {
    type: "number_vs_limit",
    group_no: condition.group_no,
    negated: condition.negate,
    truth: "unknown",
    code: null,
    element_key: condition.element_key,
    value: null,
    unit: null,
    threshold_key: condition.threshold_key,
    limit: null,
    comparator: null,
    threshold_status: null,
  };
  const unknown = (code: ConditionReasonCode): NumberVsLimitReason => ({ ...base, code });

  const elementKey = condition.element_key;
  if (!elementKey) return unknown("condition_incomplete");

  let threshold: { unit: string } | null = null;
  let limit: number;
  let comparator: NumberComparator;
  if (condition.threshold_key) {
    const entry = context.thresholds.entries.find((t) => t.key === condition.threshold_key);
    if (!entry) return unknown("threshold_unknown");
    if (!condition.unit_element_key) return unknown("condition_incomplete");
    limit = entry.value;
    comparator = entry.comparator;
    base.threshold_status = entry.status;
    threshold = { unit: entry.unit };
  } else {
    const fixed = typeof condition.value === "number" ? condition.value : null;
    const operator = condition.operator;
    if (
      !(isComparator(operator) || operator === "eq") ||
      fixed === null ||
      !Number.isFinite(fixed)
    ) {
      return unknown("condition_incomplete");
    }
    limit = fixed;
    comparator = operator;
  }
  base.limit = limit;
  base.comparator = comparator;

  if (condition.unit_element_key) {
    const [unit] = selectedOptions(context, condition.unit_element_key);
    base.unit = unit ?? null;
  }

  const answer = context.answers[elementKey];
  if (isEmpty(answer)) return unknown("field_empty");
  const value = toNumber(answer);
  if (value === null) return unknown("value_not_number");
  base.value = value;
  if (value < 0) return unknown("value_negative");

  if (threshold && condition.unit_element_key) {
    if (isEmpty(context.answers[condition.unit_element_key])) return unknown("unit_missing");
    if (base.unit !== threshold.unit) return unknown("unit_not_supported");
  }

  const truth = compare(value, comparator, limit) ? "true" : "false";
  return { ...base, truth };
}

/** Årstallet fra et felt: `undefined` = tomt, `null` = ugyldig. */
function readYear(context: Context, elementKey: string | null): number | null | undefined {
  if (!elementKey) return undefined;
  const answer = context.answers[elementKey];
  if (isEmpty(answer)) return undefined;
  const year = toNumber(answer);
  return year !== null && Number.isInteger(year) && year > 0 ? year : null;
}

function ageVsLifespan(rule: Rule, condition: Condition, context: Context): AgeVsLifespanReason {
  const base: AgeVsLifespanReason = {
    type: "age_vs_lifespan",
    group_no: condition.group_no,
    negated: condition.negate,
    truth: "unknown",
    code: null,
    year: null,
    year_element_key: null,
    year_source: null,
    inspection_year: context.inspectionYear,
    age: null,
    material_code: null,
    documentation: null,
    lifespan_entry_key: null,
    lifespan_outcome_kind: null,
    lifespan_min_age: null,
    lifespan_status: null,
  };
  const unknown = (code: ConditionReasonCode): AgeVsLifespanReason => ({ ...base, code });

  if (!condition.age_year_element_key || !condition.material_element_key) {
    return unknown("condition_incomplete");
  }
  if (condition.documentation_element_key && !isStringList(condition.value)) {
    return unknown("condition_incomplete");
  }

  // Kilden for alderen vises i begrunnelsen, men stopper aldri forslaget.
  if (condition.age_source_element_key) {
    base.year_source = selectedOptions(context, condition.age_source_element_key)[0] ?? null;
  }

  // Materialet: bare en kode som finnes som valg på feltet.
  const material = selectedOptions(context, condition.material_element_key)[0] ?? null;
  base.material_code = material;

  // Dokumentasjon: tomt felt gir trinnene for «uten» (forsiktig side).
  let documentationNotStated = false;
  if (condition.documentation_element_key) {
    const documentation = selectedOptions(context, condition.documentation_element_key)[0];
    if (documentation === undefined) {
      base.documentation = "without";
      documentationNotStated = true;
    } else {
      base.documentation = (condition.value as string[]).includes(documentation)
        ? "without"
        : "with";
    }
  } else {
    base.documentation = "without";
    documentationNotStated = true;
  }

  // Årstallet: først årstallfeltet, så reservefeltet.
  let year = readYear(context, condition.age_year_element_key);
  let yearKey: string | null = condition.age_year_element_key;
  if (year === undefined) {
    year = readYear(context, condition.age_fallback_year_element_key);
    yearKey = condition.age_fallback_year_element_key;
  }
  if (year === undefined) return unknown("year_missing");
  base.year_element_key = yearKey;
  if (year === null) return unknown("year_invalid");
  base.year = year;
  if (context.inspectionYear === null) return unknown("inspection_year_missing");
  if (year > context.inspectionYear) return unknown("year_after_inspection");
  const age = context.inspectionYear - year;
  base.age = age;

  // Utfallet regelen foreslår avgjør hvilket trinn som gir «sann».
  const target = rule.suggested_outcome;
  const targetKind = target
    ? context.document.outcomes.find(
        (o) =>
          o.checkpoint_key === target.checkpoint_key &&
          o.question_key === target.question_key &&
          o.key === target.outcome_key,
      )?.kind
    : undefined;
  if (!isLifespanKind(targetKind)) return unknown("condition_incomplete");

  const documentation = base.documentation;
  const entries = context.lifespans.entries;
  const candidates = entries.filter(
    (e) =>
      (e.material_code === null || e.material_code === material) &&
      (e.from_year === null || year >= e.from_year) &&
      (e.to_year === null || year <= e.to_year) &&
      (e.min_age === null || age >= e.min_age) &&
      (e.documentation === "any" || e.documentation === documentation),
  );
  const winner = candidates.reduce<LifespanEntry | null>((best, entry) => {
    if (!best) return entry;
    const diff = strictness(entry.outcome_kind) - strictness(best.outcome_kind);
    if (diff !== 0) return diff > 0 ? entry : best;
    return entry.sort_order < best.sort_order ? entry : best;
  }, null);

  const notStated: ConditionReasonCode | null = documentationNotStated
    ? "documentation_not_stated"
    : null;

  if (!winner) {
    // Materialet er ukjent når settet ikke har trinn for det. Da kan bare regler som har trinn per
    // materiale for sitt utfall, ikke vurderes. Regler som bare har trinn uten materiale (som
    // «før 2000»), er vurdert fullt ut og slår ikke til.
    const materialKnown = material !== null && entries.some((e) => e.material_code === material);
    const dependsOnMaterial = entries.some(
      (e) => e.material_code !== null && e.outcome_kind === targetKind,
    );
    if (!materialKnown && dependsOnMaterial) return unknown("material_unknown");
    return { ...base, truth: "false", code: notStated };
  }

  const withWinner: AgeVsLifespanReason = {
    ...base,
    lifespan_entry_key: winner.key,
    lifespan_outcome_kind: winner.outcome_kind,
    lifespan_min_age: winner.min_age,
    lifespan_status: winner.status,
  };
  if (winner.outcome_kind === targetKind) {
    return { ...withWinner, truth: "true", code: notStated };
  }
  const stricter = strictness(winner.outcome_kind) > strictness(targetKind);
  return { ...withWinner, truth: "false", code: stricter ? "stricter_step_applies" : notStated };
}

function evaluateCondition(rule: Rule, condition: Condition, context: Context): RuleReason {
  const type = condition.type;
  if (!(SUPPORTED_CONDITION_TYPES as readonly RuleConditionType[]).includes(type)) {
    return {
      type: "unsupported",
      group_no: condition.group_no,
      negated: condition.negate,
      truth: "unknown",
      code: "condition_type_not_supported",
      condition_type: type,
    };
  }
  let reason: RuleReason;
  if (type === "option_selected") reason = optionSelected(condition, context);
  else if (type === "number_vs_limit") reason = numberVsLimit(condition, context);
  else reason = ageVsLifespan(rule, condition, context);
  // `negate` (A237): sann og usann snus, «ikke vurdert» står. Ett sted, likt for alle typer.
  if (condition.negate && reason.truth !== "unknown") {
    return { ...reason, truth: reason.truth === "true" ? "false" : "true" };
  }
  return reason;
}

// --- Regelen -------------------------------------------------------------------------------

function notEvaluated(rule: Rule, code: RuleResult["code"]): RuleResult {
  return {
    rule_key: rule.key,
    purpose: rule.purpose,
    state: "not_evaluated",
    suggestion: null,
    code,
    reasons: [],
    lifespan_set_key: null,
    threshold_set_key: null,
  };
}

function evaluateRule(rule: Rule, tgLogicAllowed: boolean, context: Context): RuleResult {
  if (rule.purpose !== "suggest_outcome" && rule.purpose !== "suggest_tgiu") {
    return notEvaluated(rule, "purpose_not_supported");
  }
  if (!tgLogicAllowed) return notEvaluated(rule, "tg_logic_not_allowed");

  let suggestion: RuleSuggestion;
  if (rule.purpose === "suggest_outcome") {
    if (!rule.suggested_outcome) return notEvaluated(rule, "target_missing");
    const { checkpoint_key, question_key, outcome_key } = rule.suggested_outcome;
    suggestion = { kind: "outcome", checkpoint_key, question_key, outcome_key };
  } else {
    if (!rule.target_checkpoint_key) return notEvaluated(rule, "target_missing");
    suggestion = { kind: "tgiu", checkpoint_key: rule.target_checkpoint_key };
  }

  const conditions = context.document.rule_conditions
    .map((condition, index) => ({ condition, index }))
    .filter(({ condition }) => condition.rule_key === rule.key && isLive(condition))
    .sort((a, b) => a.condition.sort_order - b.condition.sort_order || a.index - b.index)
    .map(({ condition }) => condition);
  if (conditions.length === 0) return notEvaluated(rule, "no_conditions");

  const reasons = conditions.map((condition) => evaluateCondition(rule, condition, context));

  // Betingelser i samme gruppe slås sammen først, deretter gruppene og betingelsene uten gruppe.
  const groups = new Map<number, ConditionTruth[]>();
  const truths: ConditionTruth[] = [];
  for (const reason of reasons) {
    if (reason.group_no === null) {
      truths.push(reason.truth);
    } else {
      const group = groups.get(reason.group_no) ?? [];
      group.push(reason.truth);
      groups.set(reason.group_no, group);
    }
  }
  for (const group of groups.values()) truths.push(combine(rule.match, group));
  const truth = combine(rule.match, truths);
  const state: RuleResultState =
    truth === "true" ? "triggered" : truth === "false" ? "not_triggered" : "not_evaluated";

  return {
    rule_key: rule.key,
    purpose: rule.purpose,
    state,
    suggestion: state === "triggered" ? suggestion : null,
    code: null,
    reasons,
    lifespan_set_key: conditions.some((c) => c.type === "age_vs_lifespan")
      ? context.lifespans.key
      : null,
    threshold_set_key: conditions.some((c) => c.type === "number_vs_limit" && c.threshold_key)
      ? context.thresholds.key
      : null,
  };
}

export const evaluateRules: EvaluateRules = (input) => {
  const { template, ...context } = input;
  const tgLogicAllowed = template.kind === "system" && template.reportType === "condition_report";
  return context.document.rules
    .filter(isLive)
    .slice()
    .sort(byOrderThenKey)
    .map((rule) => evaluateRule(rule, tgLogicAllowed, context));
};
