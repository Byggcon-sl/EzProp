import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
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
import { aiUsageLog } from "./ai-usage-log";
import { assignments } from "./assignments";
import { baseColumns } from "./common";
import { employees } from "./employees";
import { reportBuildings } from "./report-buildings";
import { rooms } from "./rooms";
import {
  CAUSE_CRITERIA,
  TEMPLATE_REPORT_TYPES,
  checkpoints,
  deviationQuestions,
  outcomes,
  rules,
  templateElements,
  templateVersions,
} from "./templates";

/**
 * Rapporten (docs/05-domenemodell.md 4.7, docs/adr/0013-rapportens-datamodell.md,
 * docs/funksjoner/fase2a-badet-pc.md).
 *
 * Rapport → svar per felt og resultat per kontrollpunkt → avvik → tiltak, opplysninger ved TGIU,
 * og beslutningene om forslag fra reglene.
 *
 * - Alle tabeller har `organization_id` og peker på forelderen med sammensatt fremmednøkkel, slik
 *   at en rad aldri kan peke inn i en annen organisasjon. Barn av rapporten har i tillegg
 *   `report_id`, og nøkkelen mot forelderen er `(organization_id, report_id, parent_id)`: et avvik
 *   kan ikke henge på et kontrollpunkt i en annen rapport.
 * - Myk sletting (`deleted_at`), aldri `ON DELETE CASCADE`. `row_version` øker ved hver endring.
 * - Id-er lages i nettleseren (UUID v7). `organization_id` settes alltid fra grant.
 * - TG for kontrollpunktet lagres ikke: den regnes fra avvikene og `tg_direct` når den leses
 *   (`computeCheckpointTg` i `@/core/reports/logic`, A342).
 * - `rule_suggestion_decisions` er eneste fasit for hva takstmannen gjorde med et regelforslag.
 *   Tabellen er bare tillegg: en ny beslutning er en ny rad, aldri en oppdatering (A345).
 * - Unike nøkler med kolonner som kan være tomme, bruker `coalesce` mot `NIL_UUID` i indeksen,
 *   slik at to rader med tom bygning og samme rom regnes som like.
 *
 * Kommer senere som nye kolonner som kan være tomme: `field_clock` og `text_crdt` (2b),
 * `not_applicable` (2a-3), `ns_edition` og ansvarlig på rapporten (2a-3), `inspection_id`.
 *
 * Listene under er faste koder (regel 6). CHECK-reglene bygges fra dem.
 */

/** `draft` = under arbeid, `published` = utgitt, `superseded` = erstattet av ny rapport. */
export const REPORT_STATUSES = ["draft", "published", "superseded"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** TG satt direkte på kontrollpunktet. TG2 og TG3 settes bare på avvik. */
export const TG_DIRECT_VALUES = ["0", "1", "IU"] as const;
export type TgDirect = (typeof TG_DIRECT_VALUES)[number];

/**
 * Avvikets art. `tg` = avvik med tilstandsgrad (TG2 eller TG3 i `tg`; tom `tg` betyr at
 * takstmannen ikke har valgt ennå, og gir advarsel). `hms` = HMS-avvik, alltid uten TG.
 */
export const DEVIATION_KINDS = ["tg", "hms"] as const;
export type DeviationKind = (typeof DEVIATION_KINDS)[number];

/** TG på et avvik. */
export const DEVIATION_TG_VALUES = [2, 3] as const;
export type DeviationTg = (typeof DEVIATION_TG_VALUES)[number];

/** `band` = intervall, `approx` = eget beløp i stedet for intervall, `none` = ingen kostnad. */
export const COST_TYPES = ["band", "approx", "none"] as const;
export type CostType = (typeof COST_TYPES)[number];

/**
 * Hvor teksten kom fra: `template` = standardteksten fra malen, urørt; `edited` = standardteksten
 * endret av takstmannen; `free` = skrevet fritt. Gjelder tekstene på raden samlet.
 */
export const TEXT_SOURCES = ["template", "edited", "free"] as const;
export type TextSource = (typeof TEXT_SOURCES)[number];

/** Utsatt konstruksjon ved TGIU. */
export const CONSTRUCTION_VULNERABLE_VALUES = ["yes", "no", "unknown"] as const;
export type ConstructionVulnerable = (typeof CONSTRUCTION_VULNERABLE_VALUES)[number];

/**
 * Beslutning om et regelforslag. Egne koder, skilt fra KI-forslag (`AI_SUGGESTION_STATUSES`):
 * `changed` betyr alltid regelforslag, `edited` alltid KI-tekst.
 */
export const RULE_SUGGESTION_DECISIONS = ["accepted", "changed", "rejected"] as const;
export type RuleSuggestionDecision = (typeof RULE_SUGGESTION_DECISIONS)[number];

/** Forslagstypene som kan lagres. Samme koder som `RuleSuggestion["kind"]` i regelmotoren. */
export const RULE_SUGGESTION_KINDS = ["outcome", "tgiu", "tg0"] as const;
export type RuleSuggestionKind = (typeof RULE_SUGGESTION_KINDS)[number];

/** TG takstmannen endte på da han avgjorde forslaget. */
export const CHOSEN_TG_VALUES = ["0", "1", "2", "3", "IU"] as const;
export type ChosenTg = (typeof CHOSEN_TG_VALUES)[number];

/**
 * Forslaget slik serveren regnet det. Samme form som `RuleSuggestion` i `@/core/rules` (ADR 0009);
 * `@/core/reports/types` har en typesjekk som holder de to like. Bare faste koder.
 */
export type StoredRuleSuggestion =
  | { kind: "outcome"; checkpoint_key: string; question_key: string; outcome_key: string }
  | { kind: "tgiu"; checkpoint_key: string }
  | { kind: "tg0"; checkpoint_key: string };

/** Øvre størrelse på `reasons` (tegn som JSON). Samme grense i Zod-skjemaet. */
export const RULE_REASONS_MAX_CHARS = 16000;

/** Rimelig befaringsår. Samme grenser som testsakene i malen. */
export const REPORT_INSPECTION_YEAR_MIN = 1900;
export const REPORT_INSPECTION_YEAR_MAX = 2200;

/** Tom plass i unike indekser med kolonner som kan være tomme. Er aldri en ekte id. */
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const KEY_PATTERN_SQL = "^[a-z0-9_]+(\\.[a-z0-9_]+)*$";

function inList(column: AnyPgColumn, values: readonly (string | number)[]): SQL {
  const list = values.map((value) => (typeof value === "number" ? String(value) : `'${value}'`));
  return sql`${column} in (${sql.raw(list.join(", "))})`;
}

function nullOrInList(column: AnyPgColumn, values: readonly (string | number)[]): SQL {
  return sql`${column} is null or ${inList(column, values)}`;
}

function nullOrKeyFormat(column: AnyPgColumn): SQL {
  return sql`${column} is null or ${column} ~ ${sql.raw(`'${KEY_PATTERN_SQL}'`)}`;
}

function orNil(column: AnyPgColumn): SQL {
  return sql`coalesce(${column}, ${sql.raw(`'${NIL_UUID}'`)}::uuid)`;
}

const sortOrder = () => integer("sort_order").notNull().default(0);

// --- Rapporten -------------------------------------------------------------------------------

export const reports = pgTable(
  "reports",
  {
    ...baseColumns,
    assignmentId: uuid("assignment_id").notNull(),
    /** Malversjonen rapporten er låst til. Endres aldri etter at rapporten er startet. */
    templateVersionId: uuid("template_version_id").notNull(),
    reportType: text("report_type").notNull(),
    status: text("status").$type<ReportStatus>().notNull().default("draft"),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("reports_organization_id_id_idx").on(table.organizationId, table.id),
    // Én gjeldende rapport per oppdrag, også ved to samtidige kall (`on conflict do nothing`)
    uniqueIndex("reports_one_current_per_assignment_idx")
      .on(table.organizationId, table.assignmentId)
      .where(sql`${table.deletedAt} is null and ${table.status} <> 'superseded'`),
    foreignKey({
      name: "reports_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    foreignKey({
      name: "reports_template_version_fk",
      columns: [table.organizationId, table.templateVersionId],
      foreignColumns: [templateVersions.organizationId, templateVersions.id],
    }),
    check("reports_report_type_check", inList(table.reportType, TEMPLATE_REPORT_TYPES)),
    check("reports_status_check", inList(table.status, REPORT_STATUSES)),
  ],
);
export type Report = typeof reports.$inferSelect;

// --- Resultat per kontrollpunkt --------------------------------------------------------------

export const checkpointResults = pgTable(
  "checkpoint_results",
  {
    ...baseColumns,
    reportId: uuid("report_id").notNull(),
    /** Kontrollpunktet i rapportens låste malversjon. */
    checkpointId: uuid("checkpoint_id").notNull(),
    /** Satt for kontrollpunkt per bygning. Nøyaktig én av bygning og rom er satt. */
    reportBuildingId: uuid("report_building_id"),
    /** Satt for kontrollpunkt per rom. */
    roomId: uuid("room_id"),
    /** TG uten avvik: `0`, `1` eller `IU`. TGIU registreres bare her (innspill D1). */
    tgDirect: text("tg_direct").$type<TgDirect>(),
    descriptionText: text("description_text"),
    done: boolean("done").notNull().default(false),
    /** Den ansatte som merket punktet ferdig (ansatt-id). */
    doneBy: uuid("done_by"),
    doneAt: timestamp("done_at", { withTimezone: true }),
  },
  (table) => [
    // Mål for fremmednøklene fra svar, avvik, TGIU og beslutninger (samme rapport)
    uniqueIndex("checkpoint_results_organization_id_report_id_id_idx").on(
      table.organizationId,
      table.reportId,
      table.id,
    ),
    // Ett resultat per kontrollpunkt og sted, også når bygning eller rom er tom
    uniqueIndex("checkpoint_results_place_idx")
      .on(
        table.organizationId,
        table.reportId,
        table.checkpointId,
        orNil(table.reportBuildingId),
        orNil(table.roomId),
      )
      .where(sql`${table.deletedAt} is null`),
    index("checkpoint_results_organization_id_room_id_idx").on(table.organizationId, table.roomId),
    foreignKey({
      name: "checkpoint_results_report_fk",
      columns: [table.organizationId, table.reportId],
      foreignColumns: [reports.organizationId, reports.id],
    }),
    foreignKey({
      name: "checkpoint_results_checkpoint_fk",
      columns: [table.organizationId, table.checkpointId],
      foreignColumns: [checkpoints.organizationId, checkpoints.id],
    }),
    foreignKey({
      name: "checkpoint_results_report_building_fk",
      columns: [table.organizationId, table.reportBuildingId],
      foreignColumns: [reportBuildings.organizationId, reportBuildings.id],
    }),
    foreignKey({
      name: "checkpoint_results_room_fk",
      columns: [table.organizationId, table.roomId],
      foreignColumns: [rooms.organizationId, rooms.id],
    }),
    foreignKey({
      name: "checkpoint_results_done_by_fk",
      columns: [table.organizationId, table.doneBy],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    check("checkpoint_results_tg_direct_check", nullOrInList(table.tgDirect, TG_DIRECT_VALUES)),
    check(
      "checkpoint_results_place_check",
      sql`num_nonnulls(${table.reportBuildingId}, ${table.roomId}) = 1`,
    ),
    // Ferdig har alltid hvem og når; ikke ferdig har ingen av delene
    check(
      "checkpoint_results_done_check",
      sql`(${table.done} and ${table.doneBy} is not null and ${table.doneAt} is not null) or (not ${table.done} and ${table.doneBy} is null and ${table.doneAt} is null)`,
    ),
  ],
);
export type CheckpointResult = typeof checkpointResults.$inferSelect;

// --- Svar per felt ---------------------------------------------------------------------------

export const fieldAnswers = pgTable(
  "field_answers",
  {
    ...baseColumns,
    reportId: uuid("report_id").notNull(),
    /** Feltet i rapportens låste malversjon. */
    elementId: uuid("element_id").notNull(),
    reportBuildingId: uuid("report_building_id"),
    roomId: uuid("room_id"),
    checkpointResultId: uuid("checkpoint_result_id"),
    /** Nummer for seksjoner som gjentas uten rom (0, 1, 2 …). */
    repeatIndex: integer("repeat_index").notNull().default(0),
    valueText: text("value_text"),
    valueNumber: numeric("value_number", { mode: "number" }),
    /** Valgte valg (faste koder). Tom = ikke svart. */
    valueOptionKeys: text("value_option_keys").array(),
    /**
     * Satt når teksten kom fra et KI-forslag som er godtatt (ADR 0006). Settes og tømmes bare av
     * serveren, aldri fra klienten.
     */
    aiUsageId: uuid("ai_usage_id"),
  },
  (table) => [
    uniqueIndex("field_answers_organization_id_report_id_id_idx").on(
      table.organizationId,
      table.reportId,
      table.id,
    ),
    // Ett svar per felt og sted (innspill D3), også når koblingene er tomme
    uniqueIndex("field_answers_place_idx")
      .on(
        table.organizationId,
        table.reportId,
        table.elementId,
        orNil(table.reportBuildingId),
        orNil(table.roomId),
        orNil(table.checkpointResultId),
        table.repeatIndex,
      )
      .where(sql`${table.deletedAt} is null`),
    index("field_answers_organization_id_room_id_idx").on(table.organizationId, table.roomId),
    foreignKey({
      name: "field_answers_report_fk",
      columns: [table.organizationId, table.reportId],
      foreignColumns: [reports.organizationId, reports.id],
    }),
    foreignKey({
      name: "field_answers_element_fk",
      columns: [table.organizationId, table.elementId],
      foreignColumns: [templateElements.organizationId, templateElements.id],
    }),
    foreignKey({
      name: "field_answers_report_building_fk",
      columns: [table.organizationId, table.reportBuildingId],
      foreignColumns: [reportBuildings.organizationId, reportBuildings.id],
    }),
    foreignKey({
      name: "field_answers_room_fk",
      columns: [table.organizationId, table.roomId],
      foreignColumns: [rooms.organizationId, rooms.id],
    }),
    foreignKey({
      name: "field_answers_checkpoint_result_fk",
      columns: [table.organizationId, table.reportId, table.checkpointResultId],
      foreignColumns: [
        checkpointResults.organizationId,
        checkpointResults.reportId,
        checkpointResults.id,
      ],
    }),
    foreignKey({
      name: "field_answers_ai_usage_fk",
      columns: [table.organizationId, table.aiUsageId],
      foreignColumns: [aiUsageLog.organizationId, aiUsageLog.id],
    }),
    check("field_answers_repeat_index_check", sql`${table.repeatIndex} >= 0`),
  ],
);
export type FieldAnswer = typeof fieldAnswers.$inferSelect;

// --- Avvik og tiltak -------------------------------------------------------------------------

export const deviations = pgTable(
  "deviations",
  {
    ...baseColumns,
    reportId: uuid("report_id").notNull(),
    checkpointResultId: uuid("checkpoint_result_id").notNull(),
    /** Spørsmål og utfall i den låste malversjonen. Tomme for avvik skrevet fritt (2a-3). */
    deviationQuestionId: uuid("deviation_question_id"),
    outcomeId: uuid("outcome_id"),
    kind: text("kind").$type<DeviationKind>().notNull(),
    /** 2 eller 3. Tom for HMS, og for `tg` til takstmannen har valgt («velg TG2 eller TG3»). */
    tg: integer("tg").$type<DeviationTg>(),
    deviationText: text("deviation_text"),
    causeCriterion: text("cause_criterion").$type<(typeof CAUSE_CRITERIA)[number]>(),
    causeText: text("cause_text"),
    consequenceText: text("consequence_text"),
    costType: text("cost_type").$type<CostType>().notNull().default("none"),
    /** Fast kode på kostnadsintervallet (`COST_BANDS` i `@/core/reports/logic`). */
    costBandKey: text("cost_band_key"),
    /** Eget beløp i hele kroner. Rundes aldri av automatisk. */
    costAmount: integer("cost_amount"),
    costText: text("cost_text"),
    /** Målingen som utløste avviket, og enheten (valgkode). */
    measurementValue: numeric("measurement_value", { mode: "number" }),
    measurementUnit: text("measurement_unit"),
    textSource: text("text_source").$type<TextSource>().notNull(),
    /** Regelen som foreslo avviket. Slås opp fra regelkoden i den låste malversjonen. */
    suggestedByRuleId: uuid("suggested_by_rule_id"),
    /** Som på `field_answers`: settes og tømmes bare av serveren. */
    aiUsageId: uuid("ai_usage_id"),
    sortOrder: sortOrder(),
  },
  (table) => [
    // Mål for fremmednøklene fra tiltak og beslutninger (samme rapport)
    uniqueIndex("deviations_organization_id_report_id_id_idx").on(
      table.organizationId,
      table.reportId,
      table.id,
    ),
    index("deviations_organization_id_checkpoint_result_id_idx").on(
      table.organizationId,
      table.checkpointResultId,
    ),
    foreignKey({
      name: "deviations_report_fk",
      columns: [table.organizationId, table.reportId],
      foreignColumns: [reports.organizationId, reports.id],
    }),
    foreignKey({
      name: "deviations_checkpoint_result_fk",
      columns: [table.organizationId, table.reportId, table.checkpointResultId],
      foreignColumns: [
        checkpointResults.organizationId,
        checkpointResults.reportId,
        checkpointResults.id,
      ],
    }),
    foreignKey({
      name: "deviations_deviation_question_fk",
      columns: [table.organizationId, table.deviationQuestionId],
      foreignColumns: [deviationQuestions.organizationId, deviationQuestions.id],
    }),
    foreignKey({
      name: "deviations_outcome_fk",
      columns: [table.organizationId, table.outcomeId],
      foreignColumns: [outcomes.organizationId, outcomes.id],
    }),
    foreignKey({
      name: "deviations_suggested_by_rule_fk",
      columns: [table.organizationId, table.suggestedByRuleId],
      foreignColumns: [rules.organizationId, rules.id],
    }),
    foreignKey({
      name: "deviations_ai_usage_fk",
      columns: [table.organizationId, table.aiUsageId],
      foreignColumns: [aiUsageLog.organizationId, aiUsageLog.id],
    }),
    check("deviations_kind_check", inList(table.kind, DEVIATION_KINDS)),
    // HMS har aldri TG. Avvik med TG har 2, 3 eller tom (ikke valgt ennå).
    check(
      "deviations_tg_check",
      sql`(${table.kind} = 'hms' and ${table.tg} is null) or (${table.kind} = 'tg' and (${nullOrInList(table.tg, DEVIATION_TG_VALUES)}))`,
    ),
    // Utfall krever spørsmål
    check(
      "deviations_outcome_question_check",
      sql`${table.outcomeId} is null or ${table.deviationQuestionId} is not null`,
    ),
    check("deviations_cause_criterion_check", nullOrInList(table.causeCriterion, CAUSE_CRITERIA)),
    check("deviations_cost_type_check", inList(table.costType, COST_TYPES)),
    check(
      "deviations_cost_check",
      sql`(${table.costType} = 'band' and ${table.costBandKey} is not null and ${table.costAmount} is null) or (${table.costType} = 'approx' and ${table.costAmount} is not null and ${table.costAmount} > 0 and ${table.costBandKey} is null) or (${table.costType} = 'none' and ${table.costBandKey} is null and ${table.costAmount} is null)`,
    ),
    check("deviations_cost_band_key_check", nullOrKeyFormat(table.costBandKey)),
    check("deviations_measurement_unit_check", nullOrKeyFormat(table.measurementUnit)),
    check("deviations_text_source_check", inList(table.textSource, TEXT_SOURCES)),
  ],
);
export type Deviation = typeof deviations.$inferSelect;

export const deviationMeasures = pgTable(
  "deviation_measures",
  {
    ...baseColumns,
    reportId: uuid("report_id").notNull(),
    deviationId: uuid("deviation_id").notNull(),
    text: text("text").notNull().default(""),
    textSource: text("text_source").$type<TextSource>().notNull(),
    /** Rekkefølgen (vises som nummerert liste). */
    sortOrder: sortOrder(),
  },
  (table) => [
    uniqueIndex("deviation_measures_organization_id_report_id_id_idx").on(
      table.organizationId,
      table.reportId,
      table.id,
    ),
    index("deviation_measures_organization_id_deviation_id_idx").on(
      table.organizationId,
      table.deviationId,
    ),
    foreignKey({
      name: "deviation_measures_report_fk",
      columns: [table.organizationId, table.reportId],
      foreignColumns: [reports.organizationId, reports.id],
    }),
    foreignKey({
      name: "deviation_measures_deviation_fk",
      columns: [table.organizationId, table.reportId, table.deviationId],
      foreignColumns: [deviations.organizationId, deviations.reportId, deviations.id],
    }),
    check("deviation_measures_text_source_check", inList(table.textSource, TEXT_SOURCES)),
  ],
);
export type DeviationMeasure = typeof deviationMeasures.$inferSelect;

// --- Opplysninger ved TGIU -------------------------------------------------------------------

export const tgiuDetails = pgTable(
  "tgiu_details",
  {
    ...baseColumns,
    reportId: uuid("report_id").notNull(),
    checkpointResultId: uuid("checkpoint_result_id").notNull(),
    /** Hva som ikke er undersøkt, og hvorfor. */
    reason: text("reason"),
    /** Eier er informert om utvidet ansvar. Tom = ikke svart. */
    ownerInformed: boolean("owner_informed"),
    /** Settes av serveren når `owner_informed` blir sann, og tømmes ellers. */
    ownerInformedAt: timestamp("owner_informed_at", { withTimezone: true }),
    alternativeCheckMethod: text("alternative_check_method"),
    alternativeCheckResult: text("alternative_check_result"),
    riskAssessment: text("risk_assessment"),
    constructionVulnerable: text("construction_vulnerable").$type<ConstructionVulnerable>(),
    /** Hva som må til for å kunne undersøke. */
    howToExamine: text("how_to_examine"),
  },
  (table) => [
    uniqueIndex("tgiu_details_organization_id_report_id_id_idx").on(
      table.organizationId,
      table.reportId,
      table.id,
    ),
    // Ett sett per kontrollpunkt. Fjernet TGIU slettes mykt, og et nytt sett kan lages.
    uniqueIndex("tgiu_details_one_per_checkpoint_result_idx")
      .on(table.organizationId, table.checkpointResultId)
      .where(sql`${table.deletedAt} is null`),
    foreignKey({
      name: "tgiu_details_report_fk",
      columns: [table.organizationId, table.reportId],
      foreignColumns: [reports.organizationId, reports.id],
    }),
    foreignKey({
      name: "tgiu_details_checkpoint_result_fk",
      columns: [table.organizationId, table.reportId, table.checkpointResultId],
      foreignColumns: [
        checkpointResults.organizationId,
        checkpointResults.reportId,
        checkpointResults.id,
      ],
    }),
    check(
      "tgiu_details_construction_vulnerable_check",
      nullOrInList(table.constructionVulnerable, CONSTRUCTION_VULNERABLE_VALUES),
    ),
    check(
      "tgiu_details_owner_informed_at_check",
      sql`${table.ownerInformedAt} is null or ${table.ownerInformed} is true`,
    ),
  ],
);
export type TgiuDetails = typeof tgiuDetails.$inferSelect;

// --- Beslutninger om regelforslag ------------------------------------------------------------

/**
 * Hva takstmannen gjorde med et forslag fra reglene (ikke KI). Bare tillegg. `suggestion`,
 * `reasons`, settkodene og befaringsåret er serverens eget regelsvar da beslutningen ble tatt,
 * aldri noe klienten har sendt. Bare faste koder og tall; fritekst står bare i `override_reason`.
 */
export const ruleSuggestionDecisions = pgTable(
  "rule_suggestion_decisions",
  {
    ...baseColumns,
    reportId: uuid("report_id").notNull(),
    checkpointResultId: uuid("checkpoint_result_id").notNull(),
    /** Regelens faste kode i den låste malversjonen. */
    ruleKey: text("rule_key").notNull(),
    suggestion: jsonb("suggestion").$type<StoredRuleSuggestion>().notNull(),
    /** `RuleResult.reasons` fra regelmotoren: én begrunnelse per betingelse. */
    reasons: jsonb("reasons").$type<unknown[]>().notNull(),
    lifespanSetKey: text("lifespan_set_key"),
    thresholdSetKey: text("threshold_set_key"),
    /** Befaringsåret reglene ble kjørt med. */
    inspectionYear: integer("inspection_year").notNull(),
    decision: text("decision").$type<RuleSuggestionDecision>().notNull(),
    /** TG takstmannen endte på. Tom ved avvist, og ved HMS-utfall. */
    chosenTg: text("chosen_tg").$type<ChosenTg>(),
    /** Utfallet takstmannen endte på (fast kode). Tom når det ikke ble et avvik. */
    chosenOutcomeKey: text("chosen_outcome_key"),
    /** Fritekst. Påkrevd ved `changed` og `rejected`. Står bare her, aldri i logger. */
    overrideReason: text("override_reason"),
    /** Avviket som ble laget, når beslutningen ga et avvik. */
    deviationId: uuid("deviation_id"),
    /** Den ansatte som avgjorde (ansatt-id). */
    decidedBy: uuid("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rule_suggestion_decisions_organization_id_report_id_id_idx").on(
      table.organizationId,
      table.reportId,
      table.id,
    ),
    // Siste beslutning per regel på et kontrollpunkt
    index("rule_suggestion_decisions_checkpoint_result_rule_idx").on(
      table.organizationId,
      table.checkpointResultId,
      table.ruleKey,
      table.decidedAt,
    ),
    foreignKey({
      name: "rule_suggestion_decisions_report_fk",
      columns: [table.organizationId, table.reportId],
      foreignColumns: [reports.organizationId, reports.id],
    }),
    foreignKey({
      name: "rule_suggestion_decisions_checkpoint_result_fk",
      columns: [table.organizationId, table.reportId, table.checkpointResultId],
      foreignColumns: [
        checkpointResults.organizationId,
        checkpointResults.reportId,
        checkpointResults.id,
      ],
    }),
    foreignKey({
      name: "rule_suggestion_decisions_deviation_fk",
      columns: [table.organizationId, table.reportId, table.deviationId],
      foreignColumns: [deviations.organizationId, deviations.reportId, deviations.id],
    }),
    foreignKey({
      name: "rule_suggestion_decisions_decided_by_fk",
      columns: [table.organizationId, table.decidedBy],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    check(
      "rule_suggestion_decisions_rule_key_check",
      sql`${table.ruleKey} ~ ${sql.raw(`'${KEY_PATTERN_SQL}'`)}`,
    ),
    check(
      "rule_suggestion_decisions_suggestion_check",
      sql`jsonb_typeof(${table.suggestion}) = 'object' and ${table.suggestion}->>'kind' in (${sql.raw(RULE_SUGGESTION_KINDS.map((kind) => `'${kind}'`).join(", "))})`,
    ),
    check(
      "rule_suggestion_decisions_reasons_check",
      sql`jsonb_typeof(${table.reasons}) = 'array' and length(${table.reasons}::text) <= ${sql.raw(String(RULE_REASONS_MAX_CHARS))}`,
    ),
    check(
      "rule_suggestion_decisions_inspection_year_check",
      sql`${table.inspectionYear} between ${sql.raw(String(REPORT_INSPECTION_YEAR_MIN))} and ${sql.raw(String(REPORT_INSPECTION_YEAR_MAX))}`,
    ),
    check(
      "rule_suggestion_decisions_decision_check",
      inList(table.decision, RULE_SUGGESTION_DECISIONS),
    ),
    check(
      "rule_suggestion_decisions_chosen_tg_check",
      nullOrInList(table.chosenTg, CHOSEN_TG_VALUES),
    ),
    check(
      "rule_suggestion_decisions_chosen_outcome_key_check",
      nullOrKeyFormat(table.chosenOutcomeKey),
    ),
    check(
      "rule_suggestion_decisions_lifespan_set_key_check",
      nullOrKeyFormat(table.lifespanSetKey),
    ),
    check(
      "rule_suggestion_decisions_threshold_set_key_check",
      nullOrKeyFormat(table.thresholdSetKey),
    ),
    // Å gå bort fra forslaget krever begrunnelse
    check(
      "rule_suggestion_decisions_override_reason_check",
      sql`${table.decision} = 'accepted' or length(btrim(coalesce(${table.overrideReason}, ''))) > 0`,
    ),
    // Avvist forslag gir verken TG, utfall eller avvik
    check(
      "rule_suggestion_decisions_rejected_check",
      sql`${table.decision} <> 'rejected' or (${table.chosenTg} is null and ${table.chosenOutcomeKey} is null and ${table.deviationId} is null)`,
    ),
  ],
);
export type RuleSuggestionDecisionRow = typeof ruleSuggestionDecisions.$inferSelect;
