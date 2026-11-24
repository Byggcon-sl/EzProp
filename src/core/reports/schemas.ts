import { z } from "zod";
import {
  CONDITION_REASON_CODES,
  CONDITION_TRUTHS,
  LIFESPAN_OUTCOME_KINDS,
  RULE_REASON_CODES,
  THRESHOLD_COMPARATORS,
} from "@/core/rules";
import {
  CAUSE_CRITERIA,
  CHOSEN_TG_VALUES,
  CONSTRUCTION_VULNERABLE_VALUES,
  COST_TYPES,
  DEVIATION_TG_VALUES,
  OVERRIDE_REASON_CODES,
  RULE_CONDITION_TYPES,
  RULE_PURPOSES,
  RULE_REASONS_MAX_CHARS,
  RULE_RESULT_STATES,
  RULE_SUGGESTION_DECISIONS,
  AI_CANDIDATE_SOURCES,
  REPORT_SUMMARY_BASIS_MAX,
  SUMMARY_FINDING_SOURCES,
  SUMMARY_GROUPS,
  TEMPLATE_KEY_PATTERN,
  TEXT_STATUSES,
  TG_DIRECT_VALUES,
} from "@/db/schema";
import { isUuid } from "@/shared/lib/uuid";
import { containsNationalId, NATIONAL_ID_MESSAGE } from "@/shared/validation/free-text";
import {
  checkOverrideReason,
  containsPiiPlaceholder,
  formatWholeNumber,
  MAX_MEASURES_PER_DEVIATION,
  OVERRIDE_REASON_CHECK_MESSAGES,
  PHRASE_FIELDS,
  SUMMARY_TEXT_MAX_LENGTH,
} from "./logic";
import { ReportValidationError, reportValidationMessage } from "./errors";

/*
 * Zod-skjemaene for rapportkjernen (docs/funksjoner/fase2a-badet-pc.md Omfang 4, 8 og 10). Ligger
 * utenfor `logic/`, som ikke har pakker (ADR 0013), og bruker de rene funksjonene der regelen står
 * ett sted (`checkOverrideReason`).
 *
 * - Alle fritekstfelt har lengdegrense, sperre mot fødselsnummer og sperre mot plassholderne fra
 *   vasken før KI («[adresse]» osv., A466).
 * - Regelsvaret som lagres (`ruleResultSchema`), er strengt: bare kjente nøkler, faste koder og
 *   tall, og en øvre størrelse. Fritekst avvises.
 * - Id-er sjekkes med `requireUuid` i tjenesten før skjemaene kjøres; her sjekkes formen igjen.
 */

// --- Grenser ---------------------------------------------------------------------------------

/** Avvik, årsak, konsekvens, beskrivelse og TGIU-tekstene. Samme grense som tekstene i malen. */
export const REPORT_LONG_TEXT_MAX = 10_000;
/** Tiltak. Samme grense som standardtiltakene i malen. */
export const REPORT_MEASURE_TEXT_MAX = 10_000;
/** Tekstsvar på et felt i malen. */
export const REPORT_ANSWER_TEXT_MAX = 2_000;
/** Kostnad, forklaring. */
export const REPORT_COST_TEXT_MAX = 500;
/** Begrunnelsen ved Endre og Avvis. */
export const REPORT_OVERRIDE_REASON_MAX = 500;
/** Rekkefølge: hvor høyt nummer et avvik eller tiltak kan få. */
export const REPORT_SORT_ORDER_MAX = 10_000;
/** Høyeste tallsvar (absoluttverdi). */
export const REPORT_NUMBER_MAX = 1_000_000_000;
/** Flest valg i ett svar. */
export const REPORT_OPTION_KEYS_MAX = 100;

const KEY_MAX = 100;
const REASONS_MAX = 200;

/** Meldingen når teksten har en plassholder fra vasken (A466). Gir koden `text_has_placeholder`. */
const PLACEHOLDER_MESSAGE = reportValidationMessage("text_has_placeholder");

function tooLongMessage(max: number): string {
  return `Teksten kan ha høyst ${formatWholeNumber(max)} tegn.`;
}

// --- Byggesteiner ----------------------------------------------------------------------------

const keySchema = z.string().max(KEY_MAX).regex(TEMPLATE_KEY_PATTERN);
const uuidSchema = z.string().refine(isUuid);

/**
 * Fritekst som kan være tom (`null`). Tom tekst blir `null`, slik at tom og ikke svart er det
 * samme ved sammenligningen. Teksten trimmes ikke: det den ansatte skriver, lagres som det er.
 */
export function freeTextSchema(max: number) {
  return z
    .string()
    .nullable()
    .transform((value) => (value === null || value === "" ? null : value))
    .refine((value) => value === null || value.length <= max, { error: tooLongMessage(max) })
    .refine((value) => !containsNationalId(value), { error: NATIONAL_ID_MESSAGE })
    .refine((value) => !containsPiiPlaceholder(value), { error: PLACEHOLDER_MESSAGE });
}

/** Fritekst som alltid er en tekst (tiltak). Tom tekst er lov. */
export function requiredFreeTextSchema(max: number) {
  return z
    .string()
    .refine((value) => value.length <= max, { error: tooLongMessage(max) })
    .refine((value) => !containsNationalId(value), { error: NATIONAL_ID_MESSAGE })
    .refine((value) => !containsPiiPlaceholder(value), { error: PLACEHOLDER_MESSAGE });
}

const nullableKey = keySchema.nullable();
const finiteNumber = z.number().refine(Number.isFinite);

// --- Regelsvaret som lagres --------------------------------------------------------------------

/** Forslaget fra regelmotoren. Bare faste koder. */
export const ruleSuggestionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("outcome"),
      checkpoint_key: keySchema,
      question_key: keySchema,
      outcome_key: keySchema,
    })
    .strict(),
  z.object({ kind: z.literal("tgiu"), checkpoint_key: keySchema }).strict(),
  z.object({ kind: z.literal("tg0"), checkpoint_key: keySchema }).strict(),
]);

const reasonBase = {
  group_no: z.number().int().min(1).max(1000).nullable(),
  negated: z.boolean(),
  truth: z.enum(CONDITION_TRUTHS),
  code: z.enum(CONDITION_REASON_CODES).nullable(),
};

/** Begrunnelsen per betingelse (`RuleReason`). Ukjente nøkler og fritekst avvises. */
export const ruleReasonSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...reasonBase,
      type: z.literal("option_selected"),
      element_key: nullableKey,
      selected_option_keys: z.array(keySchema).max(REPORT_OPTION_KEYS_MAX),
    })
    .strict(),
  z
    .object({
      ...reasonBase,
      type: z.literal("number_vs_limit"),
      element_key: nullableKey,
      value: finiteNumber.nullable(),
      unit: nullableKey,
      threshold_key: nullableKey,
      limit: finiteNumber.nullable(),
      comparator: z.enum([...THRESHOLD_COMPARATORS, "eq"]).nullable(),
      threshold_status: z.enum(TEXT_STATUSES).nullable(),
    })
    .strict(),
  z
    .object({
      ...reasonBase,
      type: z.literal("age_vs_lifespan"),
      year: z.number().int().nullable(),
      year_element_key: nullableKey,
      year_source: nullableKey,
      inspection_year: z.number().int().nullable(),
      age: z.number().int().nullable(),
      material_code: nullableKey,
      documentation: z.enum(["with", "without"]).nullable(),
      lifespan_entry_key: nullableKey,
      lifespan_outcome_kind: z.enum(LIFESPAN_OUTCOME_KINDS).nullable(),
      lifespan_min_age: z.number().int().nullable(),
      lifespan_status: z.enum(TEXT_STATUSES).nullable(),
    })
    .strict(),
  z
    .object({
      ...reasonBase,
      type: z.literal("unsupported"),
      condition_type: z.enum(RULE_CONDITION_TYPES),
    })
    .strict(),
]);

/** `reasons` slik den lagres: en liste med øvre størrelse (samme grense som CHECK-regelen). */
export const ruleReasonsSchema = z
  .array(ruleReasonSchema)
  .max(REASONS_MAX)
  .refine((reasons) => JSON.stringify(reasons).length <= RULE_REASONS_MAX_CHARS);

/**
 * Hele regelsvaret fra serveren (`RuleResult`), kontrollert før det lagres i beslutningsraden.
 * Strengt: ukjente nøkler, fritekst og for store svar avvises.
 */
export const ruleResultSchema = z
  .object({
    rule_key: keySchema,
    purpose: z.enum(RULE_PURPOSES),
    state: z.enum(RULE_RESULT_STATES),
    suggestion: ruleSuggestionSchema.nullable(),
    code: z.enum(RULE_REASON_CODES).nullable(),
    reasons: ruleReasonsSchema,
    lifespan_set_key: nullableKey,
    threshold_set_key: nullableKey,
  })
  .strict();

// --- Begrunnelsen ved Endre og Avvis -----------------------------------------------------------

/**
 * Beslutningen med begrunnelsen (A380, A398). Regelen står ett sted (`checkOverrideReason` i
 * `logic/`); skjermen, dette skjemaet og CHECK-regelen sier det samme.
 */
export const overrideReasonSchema = z
  .object({
    decision: z.enum(RULE_SUGGESTION_DECISIONS),
    overrideReasonCode: z.enum(OVERRIDE_REASON_CODES).nullish(),
    overrideReason: freeTextSchema(REPORT_OVERRIDE_REASON_MAX).nullish(),
  })
  .transform((value) => ({
    decision: value.decision,
    overrideReasonCode: value.overrideReasonCode ?? null,
    overrideReason: value.overrideReason ?? null,
  }))
  .superRefine((value, ctx) => {
    const check = checkOverrideReason({
      decision: value.decision,
      code: value.overrideReasonCode,
      text: value.overrideReason,
    });
    if (check !== "ok") {
      ctx.addIssue({ code: "custom", message: OVERRIDE_REASON_CHECK_MESSAGES[check] });
    }
  });

// --- Inndata til handlingene -----------------------------------------------------------------

const deviationTg = z.union(
  DEVIATION_TG_VALUES.map((tg) => z.literal(tg)) as [z.ZodLiteral<2>, z.ZodLiteral<3>],
);

export const addDeviationInputSchema = z
  .object({
    id: uuidSchema,
    checkpointKey: keySchema,
    questionKey: keySchema,
    outcomeKey: keySchema,
    tg: deviationTg.nullable(),
    tgiuChoice: z.literal("remove_tgiu").optional(),
  })
  .strict();

export const setTgDirectInputSchema = z
  .object({
    checkpointKey: keySchema,
    tgDirect: z.enum(TG_DIRECT_VALUES).nullable(),
    base: z.enum(TG_DIRECT_VALUES).nullable(),
    tgDeviationChoice: z.literal("remove_tg_deviations").optional(),
  })
  .strict();

export const restoreDeviationInputSchema = z
  .object({ deviationId: uuidSchema, tgiuChoice: z.literal("remove_tgiu").optional() })
  .strict();

export const addMeasureInputSchema = z.object({ id: uuidSchema, deviationId: uuidSchema }).strict();

export const setCheckpointDoneInputSchema = z
  .object({ checkpointKey: keySchema, done: z.boolean() })
  .strict();

const decisionCommon = {
  id: uuidSchema,
  ruleKey: keySchema,
  tgiuChoice: z.literal("remove_tgiu").optional(),
  tgDeviationChoice: z.literal("remove_tg_deviations").optional(),
};

const overrideFields = {
  overrideReasonCode: z.enum(OVERRIDE_REASON_CODES).optional(),
  overrideReason: z.string().optional(),
};

/**
 * Det klienten sender ved Godta, Endre og Avvis. Aldri forslaget eller begrunnelsen fra reglene:
 * serveren regner dem selv. Godta har ingen begrunnelse (felt for den avvises).
 */
export const decideSuggestionInputSchema = z.discriminatedUnion("decision", [
  z
    .object({
      ...decisionCommon,
      decision: z.literal("accepted"),
      deviationId: uuidSchema.optional(),
      chosenTg: deviationTg.optional(),
      ...overrideFields,
    })
    .strict(),
  z
    .object({
      ...decisionCommon,
      decision: z.literal("changed"),
      chosenTg: z.enum(CHOSEN_TG_VALUES),
      chosenOutcome: z
        .object({ questionKey: keySchema, outcomeKey: keySchema })
        .strict()
        .optional(),
      deviationId: uuidSchema.optional(),
      ...overrideFields,
    })
    .strict(),
  z.object({ ...decisionCommon, decision: z.literal("rejected"), ...overrideFields }).strict(),
]);

/**
 * TG-bytte på et avvik fra et regelforslag (A490). TG og grunn kommer i ett kall. Om grunnen
 * kreves, avgjør serveren (`suggestedTgChangeDecision` og `checkOverrideReason`), ikke klienten.
 */
export const changeSuggestedDeviationTgInputSchema = z
  .object({
    id: uuidSchema,
    deviationId: uuidSchema,
    tg: deviationTg.nullable(),
    base: deviationTg.nullable(),
    ...overrideFields,
  })
  .strict();

// --- Lagring per felt ------------------------------------------------------------------------

const answerValueSchema = z
  .object({
    text: z.string().nullable(),
    number: finiteNumber.nullable(),
    optionKeys: z.array(keySchema).max(REPORT_OPTION_KEYS_MAX).nullable(),
  })
  .strict();

const longText = freeTextSchema(REPORT_LONG_TEXT_MAX);
const costTextSchema = freeTextSchema(REPORT_COST_TEXT_MAX);
const sortOrderSchema = z.number().int().min(0).max(REPORT_SORT_ORDER_MAX);

const deviationCostSchema = z
  .object({
    type: z.enum(COST_TYPES),
    bandKey: keySchema.nullable(),
    amount: z.number().nullable(),
  })
  .strict();

const deviationChange = (field: z.ZodType, value: z.ZodType, base: z.ZodType) =>
  z.object({ table: z.literal("deviations"), id: uuidSchema, field, value, base }).strict();

const tgiuChange = (field: z.ZodType, value: z.ZodType, base: z.ZodType) =>
  z
    .object({ table: z.literal("tgiu_details"), checkpointKey: keySchema, field, value, base })
    .strict();

/**
 * Én endring av ett felt (`ReportFieldChange`). `base` er verdien klienten så; den får samme
 * normalisering som `value`, men ikke lengdesjekken (en gammel verdi skal kunne sammenlignes).
 * `ai_usage_id` finnes ikke her: den kommer aldri fra klienten.
 */
export const reportFieldChangeSchema = z.union([
  z
    .object({
      table: z.literal("field_answers"),
      id: uuidSchema,
      elementKey: keySchema,
      field: z.literal("value"),
      value: answerValueSchema,
      base: answerValueSchema,
    })
    .strict(),
  z
    .object({
      table: z.literal("checkpoint_results"),
      checkpointKey: keySchema,
      field: z.literal("description_text"),
      value: longText,
      base: z.string().nullable(),
    })
    .strict(),
  deviationChange(z.literal("tg"), deviationTg.nullable(), deviationTg.nullable()),
  deviationChange(
    z.enum(["deviation_text", "cause_text", "consequence_text"]),
    longText,
    z.string().nullable(),
  ),
  deviationChange(z.literal("cost_text"), costTextSchema, z.string().nullable()),
  deviationChange(
    z.literal("cause_criterion"),
    z.enum(CAUSE_CRITERIA).nullable(),
    z.enum(CAUSE_CRITERIA).nullable(),
  ),
  deviationChange(z.literal("cost"), deviationCostSchema, deviationCostSchema),
  deviationChange(z.literal("sort_order"), sortOrderSchema, z.number().int()),
  z
    .object({
      table: z.literal("deviation_measures"),
      id: uuidSchema,
      field: z.literal("text"),
      value: requiredFreeTextSchema(REPORT_MEASURE_TEXT_MAX),
      base: z.string(),
    })
    .strict(),
  z
    .object({
      table: z.literal("deviation_measures"),
      id: uuidSchema,
      field: z.literal("sort_order"),
      value: sortOrderSchema,
      base: z.number().int(),
    })
    .strict(),
  tgiuChange(
    z.enum([
      "reason",
      "alternative_check_method",
      "alternative_check_result",
      "risk_assessment",
      "how_to_examine",
    ]),
    longText,
    z.string().nullable(),
  ),
  tgiuChange(z.literal("owner_informed"), z.boolean().nullable(), z.boolean().nullable()),
  tgiuChange(
    z.literal("construction_vulnerable"),
    z.enum(CONSTRUCTION_VULNERABLE_VALUES).nullable(),
    z.enum(CONSTRUCTION_VULNERABLE_VALUES).nullable(),
  ),
]);

// --- KI i veien: fraseforslag, språkvask og sammendrag (docs/funksjoner/fase2a-ki-i-veien.md) --

/**
 * Teksten nettleseren sender med en forespørsel til KI. Lagres ikke her, men har samme grense som
 * feltene i rapporten, så en for lang tekst gir en tydelig melding før noe sendes.
 */
const aiInputText = z.string().max(REPORT_LONG_TEXT_MAX);

/** «Forslag» ved et felt i avvikskortet. Bare `requestId`, avviket, feltet og egen tekst. */
export const suggestPhrasesInputSchema = z
  .object({
    requestId: uuidSchema,
    deviationId: uuidSchema,
    field: z.enum(PHRASE_FIELDS),
    text: aiInputText,
  })
  .strict();

const aiCandidateRefSchema = z
  .object({ source: z.enum(AI_CANDIDATE_SOURCES), id: uuidSchema })
  .strict();

/** Valgt kandidat. Målet og feltet leses fra loggraden, aldri herfra. */
export const applyPhraseInputSchema = z
  .object({
    usageId: uuidSchema,
    candidate: aiCandidateRefSchema,
    base: z.string().nullable(),
    measureId: uuidSchema.optional(),
  })
  .strict();

/**
 * «Behold min», «Lukk» og «Angre» på et KI-forslag i rommet. «Bruk» går alltid med teksten.
 * `undo_and_reject` er «Angre» etter «Bruk» på et fraseforslag: forslaget blir avvist.
 */
export const decideAiTextInputSchema = z
  .object({
    usageId: uuidSchema,
    decision: z.enum(["rejected", "undo", "undo_and_reject"]),
  })
  .strict();

/** Feltene i avvikskortet som kan språkvaskes (A350, A356). */
export const POLISH_DEVIATION_FIELDS = [
  "deviation_text",
  "cause_text",
  "consequence_text",
] as const;

const polishTarget = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("deviation"),
      id: uuidSchema,
      fieldKey: z.enum(POLISH_DEVIATION_FIELDS),
    })
    .strict(),
  z
    .object({ type: z.literal("deviation_measure"), id: uuidSchema, fieldKey: z.literal("text") })
    .strict(),
]);

/** «Språkvask avviket»: ett trykk, ett kall til serveren, én forespørsel per felt. */
export const polishDeviationInputSchema = z
  .object({
    deviationId: uuidSchema,
    items: z
      .array(z.object({ requestId: uuidSchema, target: polishTarget, text: aiInputText }).strict())
      .min(1)
      .max(POLISH_DEVIATION_FIELDS.length + MAX_MEASURES_PER_DEVIATION),
  })
  .strict();

/** «Språkvask» på beskrivelsen ved punktet. */
export const polishDescriptionInputSchema = z
  .object({ requestId: uuidSchema, checkpointKey: keySchema, text: aiInputText })
  .strict();

/** Beslutningen som følger med «Bruk» på et språkvasket felt (lagres med `saveField`). */
export const saveFieldAiDecisionSchema = z
  .object({ usageId: uuidSchema, decision: z.enum(["accepted", "edited"]) })
  .strict();

const rowVersionSchema = z.number().int().min(0);

/**
 * Ett funn i `summary_basis` slik det kommer tilbake fra nettleseren (A470): bare UUID, faste
 * koder og heltall, ingen ekstra nøkler, og høyst `MAX_MEASURES_PER_DEVIATION` deler per funn.
 * `group` brukes ikke: serveren setter den fra dagens funn.
 */
export const summaryBasisEntrySchema = z
  .object({
    source: z.enum(SUMMARY_FINDING_SOURCES),
    id: uuidSchema,
    group: z.enum(SUMMARY_GROUPS),
    rowVersion: rowVersionSchema,
    parts: z
      .array(z.object({ id: uuidSchema, rowVersion: rowVersionSchema }).strict())
      .max(MAX_MEASURES_PER_DEVIATION),
  })
  .strict();

export const summaryBasisSchema = z.array(summaryBasisEntrySchema).max(REPORT_SUMMARY_BASIS_MAX);

/**
 * Lagring av sammendraget. Teksten har samme kontroll som andre lange tekstfelt: øvre lengde,
 * sperre mot fødselsnummer og mot plassholderne fra vasken (A466). Tom tekst er lov.
 */
export const saveSummaryInputSchema = z
  .object({
    text: freeTextSchema(SUMMARY_TEXT_MAX_LENGTH),
    baseRowVersion: rowVersionSchema,
    draft: z
      .object({ usageId: uuidSchema.nullable(), basis: summaryBasisSchema, edited: z.boolean() })
      .strict()
      .optional(),
  })
  .strict();

export const draftSummaryInputSchema = z.object({ requestId: uuidSchema }).strict();

// --- Felles kjøring ----------------------------------------------------------------------------

/**
 * Kjører skjemaet og gir `ReportValidationError` ved feil. Meldingen er vår egen norske tekst når
 * en kontroll her har gitt den (lengde, fødselsnummer, begrunnelse), ellers en fast melding.
 * Verdien som ble sendt, står aldri i feilen.
 */
export function parseOrThrow<T extends z.ZodType>(
  schema: T,
  input: unknown,
  code: "invalid_input" | "override_reason" = "invalid_input",
): z.output<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const custom = parsed.error.issues.find((issue) => issue.code === "custom" && issue.message);
  if (custom?.message === PLACEHOLDER_MESSAGE) {
    throw new ReportValidationError("text_has_placeholder");
  }
  const known =
    custom &&
    (custom.message === NATIONAL_ID_MESSAGE ||
      custom.message.startsWith("Teksten kan ha høyst") ||
      Object.values(OVERRIDE_REASON_CHECK_MESSAGES).includes(custom.message));
  throw new ReportValidationError(code, known ? custom.message : undefined);
}
