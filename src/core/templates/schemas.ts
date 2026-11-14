import { z } from "zod";
import { ROOM_TYPE_GROUPS } from "@/core/buildings";
import {
  CAUSE_CRITERIA,
  CHECKPOINT_GROUPS,
  CHECKPOINT_SCOPES,
  CHECKPOINT_UNIT_SCOPES,
  FIELD_TYPES,
  OUTCOME_KINDS,
  PHRASE_SLOTS,
  RULE_CONDITION_OPERATORS,
  RULE_CONDITION_TYPES,
  RULE_MATCHES,
  RULE_PURPOSES,
  RULE_RESULT_STATES,
  RULE_SEVERITIES,
  RULE_TEST_INSPECTION_YEAR_MAX,
  RULE_TEST_INSPECTION_YEAR_MIN,
  SECTION_REPEATS,
  TEMPLATE_KEY_PATTERN,
  TEMPLATE_REPORT_TYPES,
  TEXT_STATUSES,
  TG_RULE_PURPOSES,
  type TemplateKind,
} from "@/db/schema";
import type { TemplateIssue, TemplateIssueRule } from "./errors";

/*
 * Dokumentformatet for innholdet i én malversjon (docs/funksjoner/fase2a-malmotor.md, Omfang 3).
 * Det samme formatet skal regneark-importen bruke: én liste per tabell, og alt peker på hverandre
 * med faste koder (`key`), aldri med id-er. `organizationId`, `id`, `version_id` og andre ukjente
 * felt tas bort; kjernen setter dem selv.
 *
 * Området en kode gjelder i (A141): tabellen, pluss forelderens kode for valg (felt), spørsmål
 * (kontrollpunkt) og utfall (kontrollpunkt + spørsmål). Derfor peker et utfall på både
 * kontrollpunktet og spørsmålet, og et standardtiltak på kontrollpunkt, spørsmål og utfall.
 *
 * Standardtiltak, betingelser og testtilfeller har ingen kode. De erstattes samlet per forelder
 * når listen er ulik (A142).
 *
 * Regelkoder: feil fra skjemaet har regelkoden i `params.rule` (`key_format`, `outcome_tgiu`);
 * alle andre Zod-feil er `schema`. `parseTemplateDocument` gjør dem om til `TemplateIssue`.
 */

/** Små bokstaver, tall og `_`, delt med punktum. Ikke tom, ikke ledende eller doble punktum. */
export const KEY_PATTERN = TEMPLATE_KEY_PATTERN;
export const KEY_MAX = 100;

export type { TemplateKind };

const SHORT_TEXT_MAX = 500;
const LONG_TEXT_MAX = 10_000;

const SCHEMA_MESSAGE = "Verdien mangler eller er ugyldig.";
const KEY_FORMAT_MESSAGE =
  "Koden kan bare ha små bokstaver (a–z), tall, _ og punktum, og kan ikke starte eller slutte med punktum.";
const TGIU_MESSAGE = "Et utfall kan ikke være TGIU. TGIU settes på kontrollpunktet.";
const UNKNOWN_VALUE_MESSAGE = "Ukjent verdi.";
const REQUIRED_TEXT_MESSAGE = "Teksten mangler.";
const TOO_LONG_MESSAGE = "Teksten er for lang.";

function rule(name: TemplateIssueRule, error: string) {
  return { error, params: { rule: name } };
}

/** Fast kode. Mangler den eller er den ikke tekst, er det `schema`; feil format er `key_format`. */
const keySchema = z
  .string({ error: SCHEMA_MESSAGE })
  .refine((value) => value.length <= KEY_MAX && KEY_PATTERN.test(value), {
    ...rule("key_format", KEY_FORMAT_MESSAGE),
  });

const optionalKey = keySchema.nullable().default(null);

/** En kjent kode fra listen. Ukjent verdi er `schema`. */
function oneOf<const T extends readonly string[]>(values: T) {
  return z.custom<T[number]>(
    (value) => typeof value === "string" && (values as readonly string[]).includes(value),
    { error: UNKNOWN_VALUE_MESSAGE },
  );
}

/** Påkrevd tekst: trimmes, ikke tom. */
function requiredText(max = SHORT_TEXT_MAX) {
  return z
    .string({ error: REQUIRED_TEXT_MESSAGE })
    .transform((value) => value.trim())
    .refine((value) => value.length >= 1, { error: REQUIRED_TEXT_MESSAGE })
    .refine((value) => value.length <= max, { error: TOO_LONG_MESSAGE });
}

/** Valgfri tekst: trimmes, tom blir `null`. */
function optionalText(max = LONG_TEXT_MAX) {
  return z
    .string({ error: SCHEMA_MESSAGE })
    .nullable()
    .default(null)
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    })
    .refine((value) => value === null || value.length <= max, { error: TOO_LONG_MESSAGE });
}

const sortOrder = z.number({ error: SCHEMA_MESSAGE }).int().min(0).default(0);
const optionalNumber = z.number({ error: SCHEMA_MESSAGE }).nullable().default(null);
const keyList = z.array(keySchema).default([]);
const roomTypeGroups = z.array(oneOf(ROOM_TYPE_GROUPS)).default([]);

/** Utfall: `tgiu` har egen regelkode (innspill D1), andre ukjente verdier er `schema`. */
/**
 * Status på fagteksten (ADR 0007). Mangler feltet, er teksten utkast. `approved` godtas i formatet
 * (A209); ukjent verdi er `schema`.
 */
const textStatus = oneOf(TEXT_STATUSES).default("draft");

const outcomeKind = z.unknown().superRefine((value, ctx) => {
  if (value === "tgiu") {
    ctx.addIssue({ code: "custom", message: TGIU_MESSAGE, params: { rule: "outcome_tgiu" } });
  } else if (typeof value !== "string" || !(OUTCOME_KINDS as readonly string[]).includes(value)) {
    ctx.addIssue({ code: "custom", message: UNKNOWN_VALUE_MESSAGE });
  }
}) as unknown as z.ZodType<(typeof OUTCOME_KINDS)[number], unknown>;

const sectionSchema = z.object({
  key: keySchema,
  /** Seksjonen over (underseksjon). */
  parent_key: optionalKey,
  title: requiredText(),
  repeat: oneOf(SECTION_REPEATS).default("once"),
  room_type_groups: roomTypeGroups,
  optional: z.boolean().default(false),
  standard_text: optionalText(),
  help_text: optionalText(),
  sort_order: sortOrder,
});

const elementSchema = z
  .object({
    key: keySchema,
    section_key: keySchema,
    /** Kontrollpunktet feltet hører til (tomt i egne maler). */
    checkpoint_key: optionalKey,
    label: requiredText(),
    field_type: oneOf(FIELD_TYPES),
    multiple: z.boolean().default(false),
    unit: optionalText(SHORT_TEXT_MAX),
    min_value: optionalNumber,
    max_value: optionalNumber,
    decimals: z.number({ error: SCHEMA_MESSAGE }).int().min(0).max(10).nullable().default(null),
    /** Bare grunnsjekk nå: en liste (kortet, «Ikke med»). */
    table_columns: z
      .array(z.json(), { error: "Kolonnene må være en liste." })
      .nullable()
      .default(null),
    phrase_slot: oneOf(PHRASE_SLOTS).nullable().default(null),
    required: z.boolean().default(false),
    default_value: z.json().nullable().default(null),
    help_text: optionalText(),
    show_in_report: z.boolean().default(true),
    sort_order: sortOrder,
  })
  .refine((e) => e.min_value === null || e.max_value === null || e.min_value <= e.max_value, {
    error: "Laveste verdi kan ikke være større enn høyeste verdi.",
    path: ["min_value"],
  });

const optionSchema = z.object({
  element_key: keySchema,
  key: keySchema,
  label: requiredText(),
  material_code: optionalText(SHORT_TEXT_MAX),
  sort_order: sortOrder,
});

const checkpointSchema = z.object({
  key: keySchema,
  section_key: keySchema,
  name: requiredText(),
  group: oneOf(CHECKPOINT_GROUPS),
  mandatory: z.boolean().default(false),
  regulation_ref: optionalText(SHORT_TEXT_MAX),
  gives_tg: z.boolean().default(true),
  scope: oneOf(CHECKPOINT_SCOPES).default("building"),
  room_type_groups: roomTypeGroups,
  applies_to_unit: oneOf(CHECKPOINT_UNIT_SCOPES).default("both"),
  /** «Ses i sammenheng med». */
  related_checkpoint_keys: keyList,
  sort_order: sortOrder,
});

const deviationQuestionSchema = z.object({
  checkpoint_key: keySchema,
  key: keySchema,
  text: requiredText(LONG_TEXT_MAX),
  sort_order: sortOrder,
});

const outcomeSchema = z.object({
  checkpoint_key: keySchema,
  question_key: keySchema,
  key: keySchema,
  kind: outcomeKind,
  deviation_text: optionalText(),
  /** Årsak som tekst (A201). */
  default_cause_text: optionalText(),
  default_cause_criterion: oneOf(CAUSE_CRITERIA).nullable().default(null),
  default_consequence_text: optionalText(),
  /** Kilde i bakgrunnen. Står aldri i rapporten. */
  source_ref: optionalText(SHORT_TEXT_MAX),
  /** Gjelder rapporttekstene på utfallet samlet. */
  text_status: textStatus,
  sort_order: sortOrder,
});

const standardMeasureSchema = z.object({
  checkpoint_key: keySchema,
  question_key: keySchema,
  outcome_key: keySchema,
  text: requiredText(LONG_TEXT_MAX),
  /**
   * TG tiltaket gjelder for (T-0060): `null` = uansett TG, 2 eller 3 = bare den TG-en. Bare lov
   * på utfall av typen `choose_tg2_tg3` (kontrolleres i `document.ts`).
   */
  applies_to_tg: z
    .union([z.literal(2), z.literal(3)])
    .nullable()
    .default(null),
  text_status: textStatus,
  sort_order: sortOrder,
});

/** Et utfall i dokumentet: kontrollpunkt, spørsmål og utfall (A141). */
const outcomeRefSchema = z.object({
  checkpoint_key: keySchema,
  question_key: keySchema,
  outcome_key: keySchema,
});

/** Et avviksspørsmål i dokumentet: kontrollpunkt og spørsmål (A141). */
const questionRefSchema = z.object({
  checkpoint_key: keySchema,
  question_key: keySchema,
});

const ruleSchema = z.object({
  key: keySchema,
  name: requiredText(),
  purpose: oneOf(RULE_PURPOSES),
  match: oneOf(RULE_MATCHES).default("all"),
  target_element_key: optionalKey,
  target_section_key: optionalKey,
  target_checkpoint_key: optionalKey,
  target_question: questionRefSchema.nullable().default(null),
  /** Utfallet som foreslås (for `suggest_outcome`). */
  suggested_outcome: outcomeRefSchema.nullable().default(null),
  validation_code: optionalKey,
  severity: oneOf(RULE_SEVERITIES).nullable().default(null),
  message: optionalText(),
  source_ref: optionalText(SHORT_TEXT_MAX),
  active: z.boolean().default(true),
  sort_order: sortOrder,
});

const ruleConditionSchema = z.object({
  rule_key: keySchema,
  /** Gruppen. Tom = uten gruppe (regelens `match` gjelder). */
  group_no: z.number({ error: SCHEMA_MESSAGE }).int().min(1).nullable().default(null),
  type: oneOf(RULE_CONDITION_TYPES),
  /** Feltet betingelsen leser. */
  element_key: optionalKey,
  /** Kontrollpunktet betingelsen leser (for `checkpoint_tg`). */
  checkpoint_key: optionalKey,
  operator: oneOf(RULE_CONDITION_OPERATORS).nullable().default(null),
  value: z.json().nullable().default(null),
  /** Terskelens faste kode (for `number_vs_limit`). Da er `operator` og `value` tomme. */
  threshold_key: optionalKey,
  /** For `age_vs_lifespan`: feltet med årstallet. */
  age_year_element_key: optionalKey,
  /** For `age_vs_lifespan`: feltet som brukes når årstallet mangler. */
  age_fallback_year_element_key: optionalKey,
  /** For `age_vs_lifespan`: feltet med kilden for alderen (bare til begrunnelsen). */
  age_source_element_key: optionalKey,
  /** For `age_vs_lifespan`: feltet som sier om dokumentasjon finnes. */
  documentation_element_key: optionalKey,
  /** For `age_vs_lifespan`: feltet med materialvalget. */
  material_element_key: optionalKey,
  /** For `number_vs_limit` med terskel: feltet med enheten. */
  unit_element_key: optionalKey,
  /** Snur betingelsen (A237): sann blir usann, usann blir sann, «ikke vurdert» står. */
  negate: z.boolean({ error: SCHEMA_MESSAGE }).default(false),
  sort_order: sortOrder,
});

const ruleTestCaseSchema = z.object({
  rule_key: keySchema,
  name: requiredText(),
  /** Testsvarene: felt (kode) og verdi. */
  input: z.record(z.string(), z.json()).default({}),
  /** Forventet tilstand: slår til, slår ikke til eller ikke vurdert. */
  expected_state: oneOf(RULE_RESULT_STATES),
  /** Befaringsåret testsaken regner alder mot. Tom = regelen bruker ikke alder. */
  inspection_year: z
    .number({ error: SCHEMA_MESSAGE })
    .int()
    .min(RULE_TEST_INSPECTION_YEAR_MIN)
    .max(RULE_TEST_INSPECTION_YEAR_MAX)
    .nullable()
    .default(null),
  expected_outcome: outcomeRefSchema.nullable().default(null),
  sort_order: sortOrder,
});

/** Hele innholdet i én malversjon. Listene kan mangle (tom liste). */
export const templateDocumentSchema = z.object({
  sections: z.array(sectionSchema).default([]),
  elements: z.array(elementSchema).default([]),
  element_options: z.array(optionSchema).default([]),
  checkpoints: z.array(checkpointSchema).default([]),
  deviation_questions: z.array(deviationQuestionSchema).default([]),
  outcomes: z.array(outcomeSchema).default([]),
  standard_measures: z.array(standardMeasureSchema).default([]),
  rules: z.array(ruleSchema).default([]),
  rule_conditions: z.array(ruleConditionSchema).default([]),
  rule_test_cases: z.array(ruleTestCaseSchema).default([]),
});

/** Dokumentet slik det sendes inn (standardverdier kan mangle). */
export type TemplateDocumentInput = z.input<typeof templateDocumentSchema>;
/** Dokumentet etter Zod (alle felt satt). */
export type TemplateDocument = z.output<typeof templateDocumentSchema>;

export type TemplateSectionDoc = TemplateDocument["sections"][number];
export type TemplateElementDoc = TemplateDocument["elements"][number];
export type TemplateElementOptionDoc = TemplateDocument["element_options"][number];
export type CheckpointDoc = TemplateDocument["checkpoints"][number];
export type DeviationQuestionDoc = TemplateDocument["deviation_questions"][number];
export type OutcomeDoc = TemplateDocument["outcomes"][number];
export type StandardMeasureDoc = TemplateDocument["standard_measures"][number];
export type RuleDoc = TemplateDocument["rules"][number];
export type RuleConditionDoc = TemplateDocument["rule_conditions"][number];
export type RuleTestCaseDoc = TemplateDocument["rule_test_cases"][number];

function issueRule(issue: z.core.$ZodIssue): TemplateIssueRule {
  const params = (issue as { params?: { rule?: unknown } }).params;
  const name = params?.rule;
  return name === "key_format" || name === "outcome_tgiu" ? name : "schema";
}

/** Norsk melding for Zod sine egne feil. Meldinger satt i skjemaet over går foran. */
export function norwegianMessage(issue: { code?: string }): string {
  if (issue.code === "too_big") return "Verdien er for stor eller for lang.";
  if (issue.code === "too_small") return "Verdien er for liten.";
  if (issue.code === "invalid_value") return UNKNOWN_VALUE_MESSAGE;
  return SCHEMA_MESSAGE;
}

/** Gjør Zod-feil om til `TemplateIssue` med sti som `sections.0.key`. */
export function toTemplateIssues(error: z.ZodError): TemplateIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    rule: issueRule(issue),
    message: issue.message,
  }));
}

/** Leser dokumentet med Zod. Gir enten dokumentet eller feilene, aldri unntak. */
export function parseTemplateDocument(
  input: unknown,
): { success: true; document: TemplateDocument } | { success: false; issues: TemplateIssue[] } {
  const result = templateDocumentSchema.safeParse(input, { error: norwegianMessage });
  if (result.success) return { success: true, document: result.data };
  return { success: false, issues: toTemplateIssues(result.error) };
}

/**
 * TG-logikk finnes bare i systemmalen (beslutning 27.10.2026). En egen mal (`custom`) kan ikke ha
 * kontrollpunkter eller reglene `suggest_outcome`, `suggest_tgiu` og `suggest_tg0`; `show` og
 * `validate` er lov.
 * Ren funksjon: tom liste = godkjent.
 */
export function checkNoTgLogicInCustom(
  kind: TemplateKind,
  document: Pick<TemplateDocument, "checkpoints" | "rules">,
): TemplateIssue[] {
  if (kind !== "custom") return [];
  const issues: TemplateIssue[] = [];
  document.checkpoints.forEach((_, index) => {
    issues.push({
      path: `checkpoints.${index}`,
      rule: "tg_logic_in_custom",
      message: "Kontrollpunkter kan bare brukes i systemmalen.",
    });
  });
  document.rules.forEach((item, index) => {
    if ((TG_RULE_PURPOSES as readonly string[]).includes(item.purpose)) {
      issues.push({
        path: `rules.${index}.purpose`,
        rule: "tg_logic_in_custom",
        message: "Regler som foreslår TG kan bare brukes i systemmalen.",
      });
    }
  });
  return issues;
}

/**
 * En egen mal (`custom`) kan bare advare, aldri stoppe (Ståle 12.11.2026, F9): `validate`-regler
 * med `severity = blocker` avvises, `warning` godtas. Systemmalen kan ha `blocker`. Ren funksjon:
 * tom liste = godkjent.
 */
export function checkNoBlockerInCustom(
  kind: TemplateKind,
  document: Pick<TemplateDocument, "rules">,
): TemplateIssue[] {
  if (kind !== "custom") return [];
  const issues: TemplateIssue[] = [];
  document.rules.forEach((item, index) => {
    if (item.purpose === "validate" && item.severity === "blocker") {
      issues.push({
        path: `rules.${index}.severity`,
        rule: "schema",
        message: `Regelen «${item.key}» kan bare advare i en egen mal, ikke stoppe.`,
      });
    }
  });
  return issues;
}

/**
 * Ny malfamilie. Bare systemmaler nå (A139): `custom` avvises med en egen melding. Ukjente felt
 * (`organizationId` og andre) tas bort.
 */
export const createTemplateFamilyInputSchema = z.object({
  name: requiredText(),
  kind: z
    .custom<TemplateKind>((value) => value === "system" || value === "custom", {
      error: UNKNOWN_VALUE_MESSAGE,
    })
    .default("system")
    .refine((value) => value === "system", { error: "Egne maler kan ikke lages ennå." }),
  report_type: oneOf(TEMPLATE_REPORT_TYPES).default("condition_report"),
});
export type CreateTemplateFamilyInput = z.input<typeof createTemplateFamilyInputSchema>;

/** Hva som er endret i versjonen. Valgfri; tom blir `null`. */
export const changeNoteSchema = optionalText(2000);
