import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { baseColumns } from "./common";
import { employees } from "./employees";

/** Utfallet av kallet til leverandøren (ADR 0006 del 5). */
export const AI_OUTCOMES = ["ok", "no_match", "error"] as const;
/** Hva den ansatte gjorde med forslaget. Tom når utfallet ikke er `ok`. */
export const AI_SUGGESTION_STATUSES = ["suggested", "accepted", "edited", "rejected"] as const;
/** Faste feilkoder. Aldri leverandørens egen melding. */
export const AI_ERROR_CODES = [
  "timeout",
  "rate_limited",
  "unavailable",
  "rejected",
  "unknown",
] as const;

export type AiOutcome = (typeof AI_OUTCOMES)[number];
export type AiSuggestionStatus = (typeof AI_SUGGESTION_STATUSES)[number];
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Hvor forslaget gjelder: måltype, id og feltkode. */
export type AiTargetRef = { type: string; id: string; fieldKey: string };

/** `kolonne in ('a', 'b')` fra en fast liste, slik at CHECK og koden har de samme kodene. */
function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

/**
 * Logg over KI-bruk og KI-forslag (docs/05-domenemodell.md 4.12, ADR 0006 del 5). Én rad per
 * kall; det finnes ingen egen forslagstabell. Skrives bare av `src/core/ai`.
 *
 * - `id` er forespørselens UUID (`requestId`) fra kalleren, så et nytt forsøk gir ikke dobbel rad.
 * - `source_fields` og `input_summary` har bare feltkoder og antall tegn, aldri tekst.
 * - `report_id` har ingen fremmednøkkel før `reports` finnes (A158).
 * - Regnes som personopplysninger (A157): myk sletting, `retain_until` settes av tjenesten til
 *   opprettet + 10 år. Ingen ON DELETE CASCADE.
 * - Ingen indeks per ansatt (spørsmål 57).
 */
export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    ...baseColumns,
    /** Hvem som ba om forslaget. */
    employeeId: uuid("employee_id").notNull(),
    /** Fast kode for KI-funksjonen, for eksempel `language_polish`. */
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    assignmentId: uuid("assignment_id"),
    /** Ingen fremmednøkkel ennå (A158). */
    reportId: uuid("report_id"),
    targetRef: jsonb("target_ref").$type<AiTargetRef>().notNull(),
    /** Bare feltkoder, aldri verdier. */
    sourceFields: jsonb("source_fields").$type<string[]>().notNull(),
    /** Bare feltkode → antall tegn, aldri tekst. */
    inputSummary: jsonb("input_summary").$type<Record<string, number>>().notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    /** Forslaget. Tom når utfallet ikke er `ok`. */
    outputText: text("output_text"),
    status: text("status"),
    /** Hvem som avgjorde, fra tilgangssjekken. */
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /** Kostnad per kall. Numeric, ikke flyttall. */
    cost: numeric("cost", { precision: 12, scale: 4 }).notNull().default("0"),
    currency: text("currency").notNull().default("NOK"),
    /** Settes av tjenesten til opprettet + 10 år. */
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("ai_usage_log_organization_id_feature_idx").on(table.organizationId, table.feature),
    // Oppslag av forrige forslag på samme mål
    index("ai_usage_log_organization_id_target_idx").on(
      table.organizationId,
      sql`(${table.targetRef} ->> 'type')`,
      sql`(${table.targetRef} ->> 'id')`,
      sql`(${table.targetRef} ->> 'fieldKey')`,
    ),
    // Ansatt, avgjører og oppdrag må høre til samme organisasjon som raden
    foreignKey({
      name: "ai_usage_log_employee_fk",
      columns: [table.organizationId, table.employeeId],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    foreignKey({
      name: "ai_usage_log_decided_by_fk",
      columns: [table.organizationId, table.decidedBy],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    foreignKey({
      name: "ai_usage_log_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    check("ai_usage_log_outcome_check", inList(table.outcome, AI_OUTCOMES)),
    check(
      "ai_usage_log_status_check",
      sql`${table.status} is null or ${inList(table.status, AI_SUGGESTION_STATUSES)}`,
    ),
    check(
      "ai_usage_log_error_code_check",
      sql`${table.errorCode} is null or ${inList(table.errorCode, AI_ERROR_CODES)}`,
    ),
    check(
      "ai_usage_log_outcome_status_check",
      sql`(${table.outcome} = 'ok' and ${table.status} is not null) or (${table.outcome} <> 'ok' and ${table.status} is null and ${table.outputText} is null)`,
    ),
    check("ai_usage_log_currency_check", sql`${table.currency} = 'NOK'`),
  ],
);
export type AiUsageLogRow = typeof aiUsageLog.$inferSelect;
