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
import { aiUsageLog } from "./ai-usage-log";
import { assignments } from "./assignments";
import { certifications } from "./certifications";
import { baseColumns, KEY_PATTERN_SQL } from "./common";
import { employees } from "./employees";
import { companies } from "./organization-structure";
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
 *
 * Sier bare forholdet til malen, aldri om teksten kom fra KI eller frasebanken (A357): KI-opphav
 * står bare i `ai_usage_log`. Listen får aldri en kode for KI eller frase.
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

/**
 * Grunnen når takstmannen endrer eller avviser et regelforslag (A380): ett trykk i stedet for
 * fritekst. `other` krever tekst i `override_reason`. Etikettene står i oversettelsesfilen.
 */
export const OVERRIDE_REASON_CODES = [
  "documentation_present",
  "visible_damage",
  "measured_again",
  "age_known_otherwise",
  "other",
] as const;
export type OverrideReasonCode = (typeof OVERRIDE_REASON_CODES)[number];

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

// --- Sjekken før publisering (ADR 0015, docs/funksjoner/fase2a-publisering-badet.md) -----------

/** `blocker` = sperre som må rettes eller krysses bort, `warning` = advarsel. */
export const PUBLISH_CHECK_SEVERITIES = ["blocker", "warning"] as const;
export type PublishCheckSeverity = (typeof PUBLISH_CHECK_SEVERITIES)[number];

/** Hvem som fant mangelen. `ai` kommer i 2a-3 og kan bare gi advarsel (CHECK). */
export const PUBLISH_CHECK_SOURCES = ["rule", "ai"] as const;
export type PublishCheckSource = (typeof PUBLISH_CHECK_SOURCES)[number];

/**
 * De sju sperrene (domenemodellen 4.7, beslutning 25.10.2026). `bra_missing` og
 * `electrical_missing` regnes ikke ut før 2a-3, men står her så 2a-3 slipper ny migrering.
 * En kode er sperre for alltid: skal noe bli advarsel, lages en ny kode (regel 6).
 */
export const PUBLISH_BLOCKER_CODES = [
  "mandatory_without_tg",
  "tg2_tg3_missing_cause_or_consequence",
  "tg3_missing_cost",
  "wet_or_below_ground_missing_hole",
  "bra_missing",
  "electrical_missing",
  "inspection_date_missing",
] as const;
export type PublishBlockerCode = (typeof PUBLISH_BLOCKER_CODES)[number];

/**
 * Advarslene i sjekken: punktadvarslene fra «Badet på PC» (samme koder som
 * `CHECKPOINT_WARNING_CODES`, uten de to som sperren `mandatory_without_tg` erstatter), og de to
 * nye `ai_suggestion_pending` (A454) og `hole_reading_missing` (A446).
 */
export const PUBLISH_WARNING_CODES = [
  "tg2_tg3_missing_measure",
  "cost_amount_not_rounded",
  "hms_missing_consequence_or_measure",
  "tgiu_details_missing",
  "tgiu_suggested_not_set",
  "no_findings_with_reading_over_limit",
  "suggestion_no_longer_applies",
  "texts_written_for_other_tg",
  "tg3_on_age_only",
  "ai_suggestion_pending",
  "hole_reading_missing",
] as const;
export type PublishWarningCode = (typeof PUBLISH_WARNING_CODES)[number];

/** Alle kodene i `publish_check_results.check_code`, sperrene først. Rekkefølgen er sorteringen. */
export const PUBLISH_CHECK_CODES = [...PUBLISH_BLOCKER_CODES, ...PUBLISH_WARNING_CODES] as const;
export type PublishCheckCode = (typeof PUBLISH_CHECK_CODES)[number];

/**
 * Grunnen når en sperre krysses bort (A521, A449): ett trykk. `other` krever tekst. Egen liste,
 * skilt fra `OVERRIDE_REASON_CODES` (regelforslag). Etikettene står i oversettelsesfilen.
 */
export const PUBLISH_OVERRIDE_REASON_CODES = [
  "no_access_or_refused",
  "not_applicable_to_room",
  "described_elsewhere",
  "other",
] as const;
export type PublishOverrideReasonCode = (typeof PUBLISH_OVERRIDE_REASON_CODES)[number];

/** Øvre lengde på begrunnelsen ved overstyring. Samme grense i Zod-skjemaet og i CHECK. */
export const PUBLISH_OVERRIDE_REASON_MAX_CHARS = 1000;

/**
 * Hvor mangelen er (`publish_check_results.target_ref`). Bare id-er og faste koder, aldri tekst
 * eller romnavn. Punktet kan mangle rad i `checkpoint_results`, så målet er malens
 * kontrollpunkt (`checkpointId` + `checkpointKey`) og rommet, aldri resultatradens id.
 * `missing` er faste koder (`PUBLISH_CHECK_MISSING_PARTS` i `@/core/reports/logic`).
 */
export type StoredPublishCheckTarget = {
  /** `null` = hele rapporten (`inspection_date_missing`). */
  roomId: string | null;
  checkpointId: string | null;
  checkpointKey: string | null;
  deviationId: string | null;
  ruleKey: string | null;
  /** KI-forslaget som venter (`ai_suggestion_pending`). Aldri forslagsteksten. */
  aiUsageId: string | null;
  missing: string[];
};

/** Gjeldende `schema_version` i `report_releases.snapshot`. */
export const REPORT_SNAPSHOT_SCHEMA_VERSION = 1;
/**
 * Gruppene i sammendraget, i fast rekkefølge (A434): TG3, TG2, TGIU og til slutt HMS uten TG.
 * Koden lager gruppene og overskriftene; KI skriver aldri TG.
 */
export const SUMMARY_GROUPS = ["tg3", "tg2", "tgiu", "hms"] as const;
export type SummaryGroup = (typeof SUMMARY_GROUPS)[number];

/** Hva slags rad et funn i sammendraget er: avvik (TG2, TG3, HMS) eller kontrollpunkt med TGIU. */
export const SUMMARY_FINDING_SOURCES = ["deviation", "checkpoint_result"] as const;
export type SummaryFindingSource = (typeof SUMMARY_FINDING_SOURCES)[number];

/**
 * Ett funn sammendraget bygde på (A435). Bare id-er, faste koder og `row_version`, aldri tekst.
 * `parts` er radene under funnet som også gikk inn i utkastet: tiltakene til et avvik
 * (`deviation_measures`) og opplysningene ved TGIU (`tgiu_details`). Slik gir også et endret
 * tiltak advarselen «Funnene er endret etter sammendraget».
 */
export type SummaryBasisEntry = {
  source: SummaryFindingSource;
  id: string;
  group: SummaryGroup;
  rowVersion: number;
  parts: { id: string; rowVersion: number }[];
};

/** Øvre lengde på `reports.summary_text` (tegn). Samme grense i Zod-skjemaet og CHECK-regelen. */
export const REPORT_SUMMARY_MAX_LENGTH = 10000;
/** Øvre antall funn i `reports.summary_basis`. Samme grense i CHECK-regelen. */
export const REPORT_SUMMARY_BASIS_MAX = 200;

/** Øvre størrelse på `reasons` (tegn som JSON). Samme grense i Zod-skjemaet. */
export const RULE_REASONS_MAX_CHARS = 16000;

/** Rimelig befaringsår. Samme grenser som testsakene i malen. */
export const REPORT_INSPECTION_YEAR_MIN = 1900;
export const REPORT_INSPECTION_YEAR_MAX = 2200;

/** Tom plass i unike indekser med kolonner som kan være tomme. Er aldri en ekte id. */
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

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
    /**
     * Sammendraget for hele rapporten (A483). Fritekst fra takstmannen, eventuelt etter et
     * KI-utkast han har godtatt. KI-opphav står bare i `ai_usage_log` (mål `report` / `summary_text`).
     */
    summaryText: text("summary_text"),
    /**
     * Funnene sammendraget bygde på da et utkast sist ble brukt (A435). Tom når sammendraget er
     * skrevet for hånd uten utkast. Kommer tilbake fra nettleseren ved «Bruk» og kontrolleres av
     * serveren før den lagres (A470): strengt skjema, hver id må være et funn i rapporten, `group`
     * settes av serveren, og `rowVersion` kan ikke være høyere enn dagens.
     */
    summaryBasis: jsonb("summary_basis").$type<SummaryBasisEntry[]>(),
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
    check(
      "reports_summary_text_check",
      sql`${table.summaryText} is null or char_length(${table.summaryText}) <= ${sql.raw(String(REPORT_SUMMARY_MAX_LENGTH))}`,
    ),
    check(
      "reports_summary_basis_check",
      sql`${table.summaryBasis} is null or (jsonb_typeof(${table.summaryBasis}) = 'array' and jsonb_array_length(${table.summaryBasis}) <= ${sql.raw(String(REPORT_SUMMARY_BASIS_MAX))})`,
    ),
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
    // Ingen `ai_usage_id` her (A355): avviket har tre KI-tekster, og `ai_usage_log`
    // (`report_id` + `target_ref`) er eneste fasit for hvilken tekst som kom fra KI.
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
 * Begrunnelsen er en fast kode (`override_reason_code`), en tekst eller begge (A380, A398).
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
    /** Grunnen som fast kode. Tom ved `accepted`. */
    overrideReasonCode: text("override_reason_code").$type<OverrideReasonCode>(),
    /** Fritekst. Påkrevd når koden er `other`, ellers valgfri. Står bare her, aldri i logger. */
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
    check(
      "rule_suggestion_decisions_override_reason_code_check",
      nullOrInList(table.overrideReasonCode, OVERRIDE_REASON_CODES),
    ),
    // Godtatt har verken kode eller tekst. Å gå bort fra forslaget krever kode eller tekst, og
    // koden `other` krever tekst (A398).
    check(
      "rule_suggestion_decisions_override_reason_check",
      sql`(${table.decision} = 'accepted' and ${table.overrideReasonCode} is null and ${table.overrideReason} is null) or (${table.decision} <> 'accepted' and (${table.overrideReasonCode} is not null or length(btrim(coalesce(${table.overrideReason}, ''))) > 0) and (${table.overrideReasonCode} is distinct from 'other' or length(btrim(coalesce(${table.overrideReason}, ''))) > 0))`,
    ),
    // Avvist forslag gir verken TG, utfall eller avvik
    check(
      "rule_suggestion_decisions_rejected_check",
      sql`${table.decision} <> 'rejected' or (${table.chosenTg} is null and ${table.chosenOutcomeKey} is null and ${table.deviationId} is null)`,
    ),
  ],
);
export type RuleSuggestionDecisionRow = typeof ruleSuggestionDecisions.$inferSelect;

// --- Utgivelser og sjekken før publisering ---------------------------------------------------

/**
 * En utgivelse (versjon) av rapporten (ADR 0015, domenemodellen 4.7). Låst for alltid: ingen
 * tjeneste oppdaterer raden eller setter `deleted_at`, og papirkurven tar den ikke. Skrives bare
 * av `publishReport`, i samme transaksjon som sjekkradene og `reports.status = published`.
 *
 * - `released_by` og `signed_by_employee_id` er ansatt-id (`grant.employeeId`), aldri fra skjemaet.
 * - `certification_id` er sertifiseringen som var gyldig for den som signerte, den dagen i norsk
 *   tid. `company_id` er oppdragets selskap den dagen. Begge er øyeblikksbilder.
 * - `original_release_date` og `valid_until` er rene datoer i norsk tid. `valid_until` er
 *   befaringsdato + ett år (regel 12), og tom når befaringsdatoen manglet og sperren ble krysset
 *   bort (A523); den regnes aldri fra publiseringsdagen. Versjon 2 og senere kopierer begge fra
 *   versjon 1.
 * - `snapshot` er en selvstendig kopi (`ReportSnapshot` i `@/core/reports`, A452): ingen parter,
 *   navn, e-post, telefon, adresse, matrikkel eller reklamasjonsdata. Logges aldri.
 * - `content_hash` er SHA-256 (hex) av kanonisk snapshot, regnet på serveren.
 * - `retain_until` er utgivelsen + 10 år, satt på serveren (regel 3).
 *
 * Kommer senere som nye kolonner som kan være tomme (A455): `pdf_file_id`,
 * `report_profile_version`, `co_signed_by_employee_id`, `revision_note`.
 */
export const reportReleases = pgTable(
  "report_releases",
  {
    ...baseColumns,
    reportId: uuid("report_id").notNull(),
    /** 1, 2, 3 … per rapport. */
    versionNumber: integer("version_number").notNull(),
    /** Serverens tid. */
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull(),
    releasedBy: uuid("released_by").notNull(),
    signedByEmployeeId: uuid("signed_by_employee_id").notNull(),
    certificationId: uuid("certification_id").notNull(),
    companyId: uuid("company_id").notNull(),
    originalReleaseDate: date("original_release_date", { mode: "string" }).notNull(),
    validUntil: date("valid_until", { mode: "string" }),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    contentHash: text("content_hash").notNull(),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Mål for fremmednøkkelen fra sjekkradene (samme rapport). Ikke delvis: utgivelser slettes aldri.
    uniqueIndex("report_releases_organization_id_report_id_id_idx").on(
      table.organizationId,
      table.reportId,
      table.id,
    ),
    // Ett versjonsnummer per rapport, også ved to samtidige publiseringer. Er også indeksen for
    // oppslag per rapport og for «siste utgivelse» (høyeste versjon).
    uniqueIndex("report_releases_organization_id_report_id_version_number_idx").on(
      table.organizationId,
      table.reportId,
      table.versionNumber,
    ),
    foreignKey({
      name: "report_releases_report_fk",
      columns: [table.organizationId, table.reportId],
      foreignColumns: [reports.organizationId, reports.id],
    }),
    foreignKey({
      name: "report_releases_released_by_fk",
      columns: [table.organizationId, table.releasedBy],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    foreignKey({
      name: "report_releases_signed_by_employee_fk",
      columns: [table.organizationId, table.signedByEmployeeId],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    foreignKey({
      name: "report_releases_certification_fk",
      columns: [table.organizationId, table.certificationId],
      foreignColumns: [certifications.organizationId, certifications.id],
    }),
    foreignKey({
      name: "report_releases_company_fk",
      columns: [table.organizationId, table.companyId],
      foreignColumns: [companies.organizationId, companies.id],
    }),
    check("report_releases_version_number_check", sql`${table.versionNumber} >= 1`),
    check(
      "report_releases_snapshot_check",
      sql`jsonb_typeof(${table.snapshot}) = 'object' and coalesce(jsonb_typeof(${table.snapshot}->'schema_version'), 'missing') = 'number'`,
    ),
    check(
      "report_releases_content_hash_check",
      sql`${table.contentHash} ~ ${sql.raw("'^[0-9a-f]{64}$'")}`,
    ),
    check("report_releases_retain_until_check", sql`${table.retainUntil} > ${table.releasedAt}`),
  ],
);
export type ReportRelease = typeof reportReleases.$inferSelect;

/**
 * Funnene fra sjekken før publisering, slik de var da utgivelsen ble laget (ADR 0015, A448).
 * Bare nye rader, aldri endret eller slettet. Skrives bare av `publishReport`, aldri ved visning:
 * alle funn lagres (også advarsler), og hver sperre i en utgivelse er krysset bort (CHECK).
 *
 * - Teksten som vises, lages fra `check_code` og `target_ref` ved visning. `message` lagres ikke,
 *   så romnavn og fritekst står ikke to steder.
 * - `overridden_by` er `grant.employeeId`, `overridden_at` er serverens tid.
 * - `override_reason` er fritekst fra den ansatte. Den står bare her: aldri i revisjonsloggen,
 *   hendelser, applikasjonsloggen eller feilmeldinger, og sendes aldri til KI uten vasken i
 *   `src/core/ai` og en egen vurdering. Oversikter og KI bruker `check_code`,
 *   `override_reason_code` og `target_ref`. Kontor får ikke teksten (`canSeeOverrideReasons`).
 * - Rapporten sikres av fremmednøkkelen mot utgivelsen (tre kolonner): raden kan ikke peke på en
 *   utgivelse i en annen rapport eller organisasjon.
 */
export const publishCheckResults = pgTable(
  "publish_check_results",
  {
    ...baseColumns,
    reportId: uuid("report_id").notNull(),
    releaseId: uuid("release_id").notNull(),
    checkCode: text("check_code").$type<PublishCheckCode>().notNull(),
    severity: text("severity").$type<PublishCheckSeverity>().notNull(),
    source: text("source").$type<PublishCheckSource>().notNull().default("rule"),
    targetRef: jsonb("target_ref").$type<StoredPublishCheckTarget>().notNull(),
    overridden: boolean("overridden").notNull().default(false),
    overriddenBy: uuid("overridden_by"),
    overriddenAt: timestamp("overridden_at", { withTimezone: true }),
    overrideReasonCode: text("override_reason_code").$type<PublishOverrideReasonCode>(),
    overrideReason: text("override_reason"),
  },
  (table) => [
    // Funnene per rapport og per utgivelse
    index("publish_check_results_organization_id_report_id_release_id_idx").on(
      table.organizationId,
      table.reportId,
      table.releaseId,
    ),
    // Lederoversikten over overstyringer (eget planpunkt)
    index("publish_check_results_overridden_idx")
      .on(table.organizationId, table.createdAt)
      .where(sql`${table.overridden}`),
    foreignKey({
      name: "publish_check_results_release_fk",
      columns: [table.organizationId, table.reportId, table.releaseId],
      foreignColumns: [reportReleases.organizationId, reportReleases.reportId, reportReleases.id],
    }),
    foreignKey({
      name: "publish_check_results_overridden_by_fk",
      columns: [table.organizationId, table.overriddenBy],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    check("publish_check_results_check_code_check", inList(table.checkCode, PUBLISH_CHECK_CODES)),
    check("publish_check_results_severity_check", inList(table.severity, PUBLISH_CHECK_SEVERITIES)),
    check("publish_check_results_source_check", inList(table.source, PUBLISH_CHECK_SOURCES)),
    // En kode er enten sperre eller advarsel, for alltid (regel 6)
    check(
      "publish_check_results_severity_code_check",
      sql`(${table.severity} = 'blocker') = (${inList(table.checkCode, PUBLISH_BLOCKER_CODES)})`,
    ),
    // KI kan aldri lage en sperre
    check(
      "publish_check_results_ai_warning_only_check",
      sql`${table.source} <> 'ai' or ${table.severity} = 'warning'`,
    ),
    check(
      "publish_check_results_target_ref_check",
      sql`jsonb_typeof(${table.targetRef}) = 'object'`,
    ),
    // En sperre i en utgivelse er alltid krysset bort; en advarsel kan ikke krysses bort
    check(
      "publish_check_results_overridden_check",
      sql`${table.overridden} = (${table.severity} = 'blocker')`,
    ),
    // Krysset bort har hvem, når og grunn; ellers er alle fire tomme
    check(
      "publish_check_results_override_fields_check",
      sql`(${table.overridden} and ${table.overriddenBy} is not null and ${table.overriddenAt} is not null and ${table.overrideReasonCode} is not null) or (not ${table.overridden} and ${table.overriddenBy} is null and ${table.overriddenAt} is null and ${table.overrideReasonCode} is null and ${table.overrideReason} is null)`,
    ),
    check(
      "publish_check_results_override_reason_code_check",
      nullOrInList(table.overrideReasonCode, PUBLISH_OVERRIDE_REASON_CODES),
    ),
    // `other` krever tekst. Teksten er aldri blank og høyst 1000 tegn.
    check(
      "publish_check_results_override_reason_check",
      sql`(${table.overrideReasonCode} is distinct from 'other' or ${table.overrideReason} is not null) and (${table.overrideReason} is null or (length(btrim(${table.overrideReason})) > 0 and length(${table.overrideReason}) <= ${sql.raw(String(PUBLISH_OVERRIDE_REASON_MAX_CHARS))}))`,
    ),
  ],
);
export type PublishCheckResultRow = typeof publishCheckResults.$inferSelect;
