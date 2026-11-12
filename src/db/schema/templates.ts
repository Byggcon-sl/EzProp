import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  type PgTableExtraConfigValue,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Malmotoren (docs/05-domenemodell.md 4.5, docs/funksjoner/fase2a-malmotor.md).
 *
 * Malfamilie → malversjon → seksjon (med underseksjoner) → felt → valg, og kontrollpunkt →
 * avviksspørsmål → utfall → standardtiltak, og regel → betingelser og testtilfeller.
 *
 * - Alle tabeller har `organization_id`, og hver rad peker på forelderen med en sammensatt
 *   fremmednøkkel `(organization_id, parent_id)`. En rad kan aldri peke inn i en annen
 *   organisasjon (som A84–A92).
 * - Faste koder (`key`) har fast format og er unike i sitt område blant aktive rader (delvis unik
 *   indeks `where deleted_at is null`). En kode endres aldri på en rad; den arkiveres (regel 6,
 *   A136–A137, A141).
 * - Publiserte versjoner endres aldri. Det håndheves i `@/core/templates`.
 * - Bare ett utkast per familie (delvis unik indeks).
 * - Utfall kan aldri være `tgiu` (innspill D1). TGIU settes på kontrollpunktet i rapporten.
 *
 * Kolonner som venter (A146, A147): `template_families.company_id`, `archived_at`,
 * `owner_employee_id`; `template_versions.lifespan_table_id`, `threshold_table_id`,
 * `cost_band_set_id`; `rule_conditions.threshold_key` og alder-feltene; `rule_test_cases.last_result`
 * og `last_run_at`.
 *
 * Listene under er de faste kodene. CHECK-reglene bygges fra dem, og `@/core/templates` bruker dem
 * i Zod-skjemaet.
 */

/** Formatet på en fast kode: små bokstaver, tall og `_`, delt med punktum. For eksempel `wet_room.membrane`. */
export const TEMPLATE_KEY_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
const KEY_PATTERN_SQL = "^[a-z0-9_]+(\\.[a-z0-9_]+)*$";

export const TEMPLATE_KINDS = ["system", "custom"] as const;
export const TEMPLATE_REPORT_TYPES = ["condition_report"] as const;
export const TEMPLATE_VERSION_STATUSES = ["draft", "published", "retired"] as const;
export const SECTION_REPEATS = ["once", "per_building", "per_room"] as const;
export const FIELD_TYPES = [
  "text",
  "checkbox",
  "choice",
  "number",
  "date",
  "photo",
  "signature",
  "table",
  "phrase",
] as const;
export const PHRASE_SLOTS = [
  "description",
  "deviation",
  "cause",
  "consequence",
  "measure",
  "cost_text",
  "summary",
] as const;
export const CHECKPOINT_GROUPS = ["exterior", "interior", "room", "technical", "site"] as const;
export const CHECKPOINT_SCOPES = ["building", "room"] as const;
export const CHECKPOINT_UNIT_SCOPES = ["unit", "common", "both"] as const;
/** Utfall. Aldri `tgiu`: TGIU settes på kontrollpunktet (innspill D1). */
export const OUTCOME_KINDS = ["tg2", "tg3", "hms", "choose_tg2_tg3"] as const;
/**
 * Status på en fagtekst (utfall og standardtiltak), ADR 0007 og A200.
 * `draft` = «utkast, ikke godkjent av fagrådet». `approved` = godkjent av fagrådet.
 * Kodene endres aldri (regel 6). Ny status legges til i listen, CHECK-ene følger med.
 */
export const TEXT_STATUSES = ["draft", "approved"] as const;
export const CAUSE_CRITERIA = [
  "symptom_of_damage",
  "age_uncertain_function",
  "significant_deviation",
  "functional_failure",
  "danger_to_life_health",
  "missing_documentation",
  "other",
] as const;
export const RULE_PURPOSES = ["show", "suggest_outcome", "suggest_tgiu", "validate"] as const;
/** Regeltypene som er TG-logikk, og som bare er lov i systemmalen (beslutning 27.10.2026). */
export const TG_RULE_PURPOSES = ["suggest_outcome", "suggest_tgiu"] as const;
export const RULE_MATCHES = ["all", "any"] as const;
export const RULE_SEVERITIES = ["blocker", "warning"] as const;
export const RULE_CONDITION_TYPES = [
  "always",
  "option_selected",
  "number_vs_limit",
  "age_vs_lifespan",
  "build_year",
  "room_type",
  "below_ground",
  "housing_type",
  "ownership_form",
  "field_filled",
  "snow_covered",
  "building_type",
  "checkpoint_tg",
  "photo_missing",
  "tgiu_set",
] as const;
export const RULE_CONDITION_OPERATORS = [
  "eq",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "before",
  "after",
] as const;

export type TemplateKind = (typeof TEMPLATE_KINDS)[number];
export type TemplateVersionStatus = (typeof TEMPLATE_VERSION_STATUSES)[number];
export type SectionRepeat = (typeof SECTION_REPEATS)[number];
export type FieldType = (typeof FIELD_TYPES)[number];
export type PhraseSlot = (typeof PHRASE_SLOTS)[number];
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];
export type TextStatus = (typeof TEXT_STATUSES)[number];
export type RulePurpose = (typeof RULE_PURPOSES)[number];
export type RuleConditionType = (typeof RULE_CONDITION_TYPES)[number];
export type RuleConditionOperator = (typeof RULE_CONDITION_OPERATORS)[number];

/** `kolonne in ('a', 'b')` fra en fast liste, slik at CHECK og koden har de samme kodene. */
function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

function keyFormat(column: AnyPgColumn): SQL {
  return sql`${column} ~ ${sql.raw(`'${KEY_PATTERN_SQL}'`)}`;
}

const sortOrder = () => integer("sort_order").notNull().default(0);
/** Nye og eksisterende fagtekster er utkast til fagrådet har godkjent dem (ADR 0007). */
const textStatus = () => text("text_status").$type<TextStatus>().notNull().default("draft");
const textArray = (name: string) =>
  text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);

// --- Malfamilie og malversjon -----------------------------------------------------------------

export const templateFamilies = pgTable(
  "template_families",
  {
    ...baseColumns,
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    reportType: text("report_type").notNull().default("condition_report"),
  },
  (table) => [
    // Mål for sammensatte fremmednøkler fra versjonene (samme organisasjon)
    uniqueIndex("template_families_organization_id_id_idx").on(table.organizationId, table.id),
    check("template_families_kind_check", inList(table.kind, TEMPLATE_KINDS)),
    check("template_families_report_type_check", inList(table.reportType, TEMPLATE_REPORT_TYPES)),
  ],
);
export type TemplateFamily = typeof templateFamilies.$inferSelect;

export const templateVersions = pgTable(
  "template_versions",
  {
    ...baseColumns,
    familyId: uuid("family_id").notNull(),
    versionNumber: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    validFrom: date("valid_from", { mode: "string" }),
    nsEdition: text("ns_edition"),
    regulationVersion: text("regulation_version"),
    basedOnVersionId: uuid("based_on_version_id"),
    changeNote: text("change_note"),
    /** Den ansatte som publiserte (ansatt-id). */
    publishedBy: uuid("published_by"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("template_versions_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("template_versions_family_id_version_number_idx").on(
      table.familyId,
      table.versionNumber,
    ),
    // Bare ett utkast per familie, også ved samtidige kall
    uniqueIndex("template_versions_one_draft_per_family_idx")
      .on(table.familyId)
      .where(sql`${table.status} = 'draft' and ${table.deletedAt} is null`),
    foreignKey({
      name: "template_versions_family_fk",
      columns: [table.organizationId, table.familyId],
      foreignColumns: [templateFamilies.organizationId, templateFamilies.id],
    }),
    foreignKey({
      name: "template_versions_based_on_fk",
      columns: [table.organizationId, table.basedOnVersionId],
      foreignColumns: [
        templateVersions.organizationId as AnyPgColumn,
        templateVersions.id as AnyPgColumn,
      ],
    }),
    check("template_versions_status_check", inList(table.status, TEMPLATE_VERSION_STATUSES)),
    check("template_versions_version_number_check", sql`${table.versionNumber} >= 1`),
    // Publisert og utgått har alltid vært publisert
    check(
      "template_versions_published_at_check",
      sql`${table.status} = 'draft' or ${table.publishedAt} is not null`,
    ),
  ],
);
export type TemplateVersion = typeof templateVersions.$inferSelect;

// --- Seksjoner -------------------------------------------------------------------------------

export const templateSections = pgTable(
  "template_sections",
  {
    ...baseColumns,
    versionId: uuid("version_id").notNull(),
    key: text("key").notNull(),
    parentSectionId: uuid("parent_section_id"),
    title: text("title").notNull(),
    repeat: text("repeat").notNull().default("once"),
    /** Romgruppene (`ROOM_TYPE_GROUPS`) for `per_room`. Tom liste = alle. */
    roomTypeGroups: textArray("room_type_groups"),
    optional: boolean("optional").notNull().default(false),
    standardText: text("standard_text"),
    helpText: text("help_text"),
    sortOrder: sortOrder(),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("template_sections_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("template_sections_version_id_key_idx")
      .on(table.versionId, table.key)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      name: "template_sections_version_fk",
      columns: [table.organizationId, table.versionId],
      foreignColumns: [templateVersions.organizationId, templateVersions.id],
    }),
    foreignKey({
      name: "template_sections_parent_fk",
      columns: [table.organizationId, table.parentSectionId],
      foreignColumns: [
        templateSections.organizationId as AnyPgColumn,
        templateSections.id as AnyPgColumn,
      ],
    }),
    check("template_sections_key_check", keyFormat(table.key)),
    check("template_sections_repeat_check", inList(table.repeat, SECTION_REPEATS)),
  ],
);
export type TemplateSection = typeof templateSections.$inferSelect;

// --- Kontrollpunkter (bare systemmaler) ------------------------------------------------------

export const checkpoints = pgTable(
  "checkpoints",
  {
    ...baseColumns,
    versionId: uuid("version_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    group: text("group").notNull(),
    mandatory: boolean("mandatory").notNull().default(false),
    regulationRef: text("regulation_ref"),
    givesTg: boolean("gives_tg").notNull().default(true),
    scope: text("scope").notNull().default("building"),
    roomTypeGroups: textArray("room_type_groups"),
    appliesToUnit: text("applies_to_unit").notNull().default("both"),
    /** Faste koder til kontrollpunkter som ses i sammenheng med dette. */
    relatedCheckpointKeys: textArray("related_checkpoint_keys"),
    sortOrder: sortOrder(),
  },
  (table) => [
    uniqueIndex("checkpoints_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("checkpoints_version_id_key_idx")
      .on(table.versionId, table.key)
      .where(sql`${table.deletedAt} is null`),
    index("checkpoints_organization_id_section_id_idx").on(table.organizationId, table.sectionId),
    foreignKey({
      name: "checkpoints_version_fk",
      columns: [table.organizationId, table.versionId],
      foreignColumns: [templateVersions.organizationId, templateVersions.id],
    }),
    foreignKey({
      name: "checkpoints_section_fk",
      columns: [table.organizationId, table.sectionId],
      foreignColumns: [templateSections.organizationId, templateSections.id],
    }),
    check("checkpoints_key_check", keyFormat(table.key)),
    check("checkpoints_group_check", inList(table.group, CHECKPOINT_GROUPS)),
    check("checkpoints_scope_check", inList(table.scope, CHECKPOINT_SCOPES)),
    check("checkpoints_applies_to_unit_check", inList(table.appliesToUnit, CHECKPOINT_UNIT_SCOPES)),
  ],
);
export type Checkpoint = typeof checkpoints.$inferSelect;

// --- Felt og valg ----------------------------------------------------------------------------

export const templateElements = pgTable(
  "template_elements",
  {
    ...baseColumns,
    versionId: uuid("version_id").notNull(),
    sectionId: uuid("section_id").notNull(),
    /** Kontrollpunktet feltet hører til (tomt i egne maler). */
    checkpointId: uuid("checkpoint_id"),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    multiple: boolean("multiple").notNull().default(false),
    unit: text("unit"),
    minValue: numeric("min_value", { mode: "number" }),
    maxValue: numeric("max_value", { mode: "number" }),
    decimals: integer("decimals"),
    /** For `table`: kolonnene (liste). Full kontroll kommer når tabellfelt brukes i rapporten. */
    tableColumns: jsonb("table_columns"),
    phraseSlot: text("phrase_slot"),
    required: boolean("required").notNull().default(false),
    defaultValue: jsonb("default_value"),
    helpText: text("help_text"),
    showInReport: boolean("show_in_report").notNull().default(true),
    sortOrder: sortOrder(),
  },
  (table) => [
    uniqueIndex("template_elements_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("template_elements_version_id_key_idx")
      .on(table.versionId, table.key)
      .where(sql`${table.deletedAt} is null`),
    index("template_elements_organization_id_section_id_idx").on(
      table.organizationId,
      table.sectionId,
    ),
    foreignKey({
      name: "template_elements_version_fk",
      columns: [table.organizationId, table.versionId],
      foreignColumns: [templateVersions.organizationId, templateVersions.id],
    }),
    foreignKey({
      name: "template_elements_section_fk",
      columns: [table.organizationId, table.sectionId],
      foreignColumns: [templateSections.organizationId, templateSections.id],
    }),
    foreignKey({
      name: "template_elements_checkpoint_fk",
      columns: [table.organizationId, table.checkpointId],
      foreignColumns: [checkpoints.organizationId, checkpoints.id],
    }),
    check("template_elements_key_check", keyFormat(table.key)),
    check("template_elements_field_type_check", inList(table.fieldType, FIELD_TYPES)),
    check(
      "template_elements_phrase_slot_check",
      sql`${table.phraseSlot} is null or ${inList(table.phraseSlot, PHRASE_SLOTS)}`,
    ),
    check(
      "template_elements_decimals_check",
      sql`${table.decimals} is null or ${table.decimals} >= 0`,
    ),
    check(
      "template_elements_value_range_check",
      sql`${table.minValue} is null or ${table.maxValue} is null or ${table.minValue} <= ${table.maxValue}`,
    ),
    check(
      "template_elements_table_columns_check",
      sql`${table.tableColumns} is null or jsonb_typeof(${table.tableColumns}) = 'array'`,
    ),
  ],
);
export type TemplateElement = typeof templateElements.$inferSelect;

export const templateElementOptions = pgTable(
  "template_element_options",
  {
    ...baseColumns,
    elementId: uuid("element_id").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    /** Materialkoden mot levetidstabellen. */
    materialCode: text("material_code"),
    sortOrder: sortOrder(),
  },
  (table) => [
    uniqueIndex("template_element_options_element_id_key_idx")
      .on(table.elementId, table.key)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      name: "template_element_options_element_fk",
      columns: [table.organizationId, table.elementId],
      foreignColumns: [templateElements.organizationId, templateElements.id],
    }),
    check("template_element_options_key_check", keyFormat(table.key)),
  ],
);
export type TemplateElementOption = typeof templateElementOptions.$inferSelect;

// --- Avviksspørsmål, utfall og standardtiltak ------------------------------------------------

export const deviationQuestions = pgTable(
  "deviation_questions",
  {
    ...baseColumns,
    checkpointId: uuid("checkpoint_id").notNull(),
    key: text("key").notNull(),
    text: text("text").notNull(),
    sortOrder: sortOrder(),
  },
  (table) => [
    uniqueIndex("deviation_questions_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("deviation_questions_checkpoint_id_key_idx")
      .on(table.checkpointId, table.key)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      name: "deviation_questions_checkpoint_fk",
      columns: [table.organizationId, table.checkpointId],
      foreignColumns: [checkpoints.organizationId, checkpoints.id],
    }),
    check("deviation_questions_key_check", keyFormat(table.key)),
  ],
);
export type DeviationQuestion = typeof deviationQuestions.$inferSelect;

export const outcomes = pgTable(
  "outcomes",
  {
    ...baseColumns,
    deviationQuestionId: uuid("deviation_question_id").notNull(),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    deviationText: text("deviation_text"),
    /** Årsak som tekst (A201). Kriteriet står i `default_cause_criterion`. */
    defaultCauseText: text("default_cause_text"),
    defaultCauseCriterion: text("default_cause_criterion"),
    defaultConsequenceText: text("default_consequence_text"),
    /** Kilde i bakgrunnen. Står aldri i rapporten. */
    sourceRef: text("source_ref"),
    /** Gjelder alle rapporttekstene på utfallet samlet (avvik, årsak, konsekvens). */
    textStatus: textStatus(),
    sortOrder: sortOrder(),
  },
  (table) => [
    uniqueIndex("outcomes_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("outcomes_deviation_question_id_key_idx")
      .on(table.deviationQuestionId, table.key)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      name: "outcomes_deviation_question_fk",
      columns: [table.organizationId, table.deviationQuestionId],
      foreignColumns: [deviationQuestions.organizationId, deviationQuestions.id],
    }),
    check("outcomes_key_check", keyFormat(table.key)),
    // TGIU er aldri et utfall (innspill D1). Egen CHECK, slik at feilen er tydelig.
    check("outcomes_kind_not_tgiu_check", sql`${table.kind} <> 'tgiu'`),
    check("outcomes_kind_check", inList(table.kind, OUTCOME_KINDS)),
    check(
      "outcomes_default_cause_criterion_check",
      sql`${table.defaultCauseCriterion} is null or ${inList(table.defaultCauseCriterion, CAUSE_CRITERIA)}`,
    ),
    check("outcomes_text_status_check", inList(table.textStatus, TEXT_STATUSES)),
  ],
);
export type Outcome = typeof outcomes.$inferSelect;

/** Standardtiltak. Uten fast kode: erstattes samlet per utfall når listen endres (A142). */
export const standardMeasures = pgTable(
  "standard_measures",
  {
    ...baseColumns,
    outcomeId: uuid("outcome_id").notNull(),
    text: text("text").notNull(),
    textStatus: textStatus(),
    sortOrder: sortOrder(),
  },
  (table) => [
    index("standard_measures_organization_id_outcome_id_idx").on(
      table.organizationId,
      table.outcomeId,
    ),
    foreignKey({
      name: "standard_measures_outcome_fk",
      columns: [table.organizationId, table.outcomeId],
      foreignColumns: [outcomes.organizationId, outcomes.id],
    }),
    check("standard_measures_text_status_check", inList(table.textStatus, TEXT_STATUSES)),
  ],
);
export type StandardMeasure = typeof standardMeasures.$inferSelect;

// --- Regler, betingelser og testtilfeller ----------------------------------------------------

export const rules = pgTable(
  "rules",
  {
    ...baseColumns,
    versionId: uuid("version_id").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    purpose: text("purpose").notNull(),
    /** `all` eller `any` for betingelsene uten gruppe. */
    match: text("match").notNull().default("all"),
    targetElementId: uuid("target_element_id"),
    targetQuestionId: uuid("target_question_id"),
    targetSectionId: uuid("target_section_id"),
    targetCheckpointId: uuid("target_checkpoint_id"),
    suggestedOutcomeId: uuid("suggested_outcome_id"),
    validationCode: text("validation_code"),
    severity: text("severity"),
    message: text("message"),
    sourceRef: text("source_ref"),
    active: boolean("active").notNull().default(true),
    sortOrder: sortOrder(),
  },
  (table) => [
    uniqueIndex("rules_organization_id_id_idx").on(table.organizationId, table.id),
    uniqueIndex("rules_version_id_key_idx")
      .on(table.versionId, table.key)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      name: "rules_version_fk",
      columns: [table.organizationId, table.versionId],
      foreignColumns: [templateVersions.organizationId, templateVersions.id],
    }),
    foreignKey({
      name: "rules_target_element_fk",
      columns: [table.organizationId, table.targetElementId],
      foreignColumns: [templateElements.organizationId, templateElements.id],
    }),
    foreignKey({
      name: "rules_target_question_fk",
      columns: [table.organizationId, table.targetQuestionId],
      foreignColumns: [deviationQuestions.organizationId, deviationQuestions.id],
    }),
    foreignKey({
      name: "rules_target_section_fk",
      columns: [table.organizationId, table.targetSectionId],
      foreignColumns: [templateSections.organizationId, templateSections.id],
    }),
    foreignKey({
      name: "rules_target_checkpoint_fk",
      columns: [table.organizationId, table.targetCheckpointId],
      foreignColumns: [checkpoints.organizationId, checkpoints.id],
    }),
    foreignKey({
      name: "rules_suggested_outcome_fk",
      columns: [table.organizationId, table.suggestedOutcomeId],
      foreignColumns: [outcomes.organizationId, outcomes.id],
    }),
    check("rules_key_check", keyFormat(table.key)),
    check("rules_purpose_check", inList(table.purpose, RULE_PURPOSES)),
    check("rules_match_check", inList(table.match, RULE_MATCHES)),
    check(
      "rules_severity_check",
      sql`${table.severity} is null or ${inList(table.severity, RULE_SEVERITIES)}`,
    ),
  ],
);
export type Rule = typeof rules.$inferSelect;

/** Betingelse i en regel. Uten fast kode: erstattes samlet per regel (A142). */
export const ruleConditions = pgTable(
  "rule_conditions",
  {
    ...baseColumns,
    ruleId: uuid("rule_id").notNull(),
    /** Gruppen betingelsen hører til. Tom = uten gruppe (regelens `match` gjelder). */
    groupNo: integer("group_no"),
    type: text("type").notNull(),
    /** Feltet betingelsen leser (fast kode). */
    elementKey: text("element_key"),
    /** For `checkpoint_tg`: kontrollpunktet som leses (fast kode). */
    checkpointKey: text("checkpoint_key"),
    operator: text("operator"),
    value: jsonb("value"),
    sortOrder: sortOrder(),
  },
  (table) => [
    index("rule_conditions_organization_id_rule_id_idx").on(table.organizationId, table.ruleId),
    foreignKey({
      name: "rule_conditions_rule_fk",
      columns: [table.organizationId, table.ruleId],
      foreignColumns: [rules.organizationId, rules.id],
    }),
    check("rule_conditions_type_check", inList(table.type, RULE_CONDITION_TYPES)),
    check(
      "rule_conditions_operator_check",
      sql`${table.operator} is null or ${inList(table.operator, RULE_CONDITION_OPERATORS)}`,
    ),
    check("rule_conditions_group_no_check", sql`${table.groupNo} is null or ${table.groupNo} >= 1`),
    check(
      "rule_conditions_element_key_check",
      sql`${table.elementKey} is null or ${keyFormat(table.elementKey)}`,
    ),
    check(
      "rule_conditions_checkpoint_key_check",
      sql`${table.checkpointKey} is null or ${keyFormat(table.checkpointKey)}`,
    ),
  ],
);
export type RuleCondition = typeof ruleConditions.$inferSelect;

/** Testtilfelle for en regel (P10, P44). Uten fast kode: erstattes samlet per regel (A142). */
export const ruleTestCases = pgTable(
  "rule_test_cases",
  {
    ...baseColumns,
    ruleId: uuid("rule_id").notNull(),
    name: text("name").notNull(),
    /** Testsvarene: fast kode på feltet → verdi. */
    input: jsonb("input").notNull().default({}),
    expectTriggered: boolean("expect_triggered").notNull(),
    expectedOutcomeId: uuid("expected_outcome_id"),
    sortOrder: sortOrder(),
  },
  (table) => [
    index("rule_test_cases_organization_id_rule_id_idx").on(table.organizationId, table.ruleId),
    foreignKey({
      name: "rule_test_cases_rule_fk",
      columns: [table.organizationId, table.ruleId],
      foreignColumns: [rules.organizationId, rules.id],
    }),
    foreignKey({
      name: "rule_test_cases_expected_outcome_fk",
      columns: [table.organizationId, table.expectedOutcomeId],
      foreignColumns: [outcomes.organizationId, outcomes.id],
    }),
    check("rule_test_cases_input_check", sql`jsonb_typeof(${table.input}) = 'object'`),
  ],
);
export type RuleTestCase = typeof ruleTestCases.$inferSelect;
