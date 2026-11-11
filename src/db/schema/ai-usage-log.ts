import { sql } from "drizzle-orm";
import {
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

/**
 * KI-loggen (docs/adr/0006-ki-i-bunnen.md del 5, docs/funksjoner/fase2a-ki-modul-logg.md).
 * Én rad per kall til KI gjennom `@/core/ai`: hvem som ba om forslaget, funksjon, leverandør,
 * mål, utfall, forslaget, hvem som avgjorde det og når, mengde og kostnad.
 *
 * Personopplysninger (A157): myk sletting, `retain_until` settes av tjenesten til opprettet + 10 år.
 * `source_fields` har bare feltkoder og `input_summary` bare feltnavn og antall tegn, aldri tekst.
 * `report_id` har ingen fremmednøkkel før `reports` finnes (A158).
 *
 * Kodene under er faste (regel 6). CHECK-reglene må ha de samme kodene.
 * `blocked` (ad-1, A171): forespørselen ble sperret før leverandøren ble kalt. Skilt fra «KI er av»,
 * som ikke gir noen rad. Som `no_match` har den tom `status`, `output_text` og `error_code`.
 */
export const AI_OUTCOMES = ["ok", "no_match", "error", "blocked"] as const;
export type AiOutcome = (typeof AI_OUTCOMES)[number];

export const AI_SUGGESTION_STATUSES = ["suggested", "accepted", "edited", "rejected"] as const;
export type AiSuggestionStatus = (typeof AI_SUGGESTION_STATUSES)[number];

export const AI_ERROR_CODES = [
  "timeout",
  "rate_limited",
  "unavailable",
  "rejected",
  "unknown",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Målet for forslaget: hva slags rad, hvilken rad og hvilket felt. */
export type AiTargetRef = { type: string; id: string; fieldKey: string };

/** `'a', 'b'` til CHECK-reglene. Kodene er faste og inneholder bare a–z og _. */
function sqlList(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

export const aiUsageLog = pgTable(
  "ai_usage_log",
  {
    ...baseColumns,
    /** Forespørselens id fra kalleren (`requestId`). Ingen standardverdi. */
    id: uuid("id").primaryKey(),
    employeeId: uuid("employee_id").notNull(),
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    assignmentId: uuid("assignment_id"),
    /** Ingen fremmednøkkel før `reports` finnes (A158). */
    reportId: uuid("report_id"),
    targetRef: jsonb("target_ref").$type<AiTargetRef>().notNull(),
    /** Bare feltkoder, aldri verdier. */
    sourceFields: jsonb("source_fields").$type<string[]>().notNull(),
    /** Feltnavn og antall tegn, aldri tekst. */
    inputSummary: jsonb("input_summary").$type<Record<string, number>>().notNull(),
    outcome: text("outcome").$type<AiOutcome>().notNull(),
    errorCode: text("error_code").$type<AiErrorCode>(),
    outputText: text("output_text"),
    status: text("status").$type<AiSuggestionStatus>(),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /** Aldri flyttall. */
    cost: numeric("cost", { precision: 12, scale: 4 }).notNull().default("0"),
    currency: text("currency").notNull().default("NOK"),
    /** Antall vaskede treff i teksten som ble sendt (A172). Aldri verdiene. */
    redactedCount: integer("redacted_count").notNull().default(0),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("ai_usage_log_organization_id_idx").on(table.organizationId),
    // Forrige forslag på samme mål som fortsatt venter på avgjørelse
    index("ai_usage_log_open_target_idx")
      .on(table.organizationId, table.feature, table.targetRef)
      .where(sql`${table.status} = 'suggested' and ${table.deletedAt} is null`),
    // Ansatte og oppdrag må høre til samme organisasjon som raden
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
    check("ai_usage_log_outcome_check", sql`${table.outcome} in (${sqlList(AI_OUTCOMES)})`),
    check(
      "ai_usage_log_status_check",
      sql`${table.status} is null or ${table.status} in (${sqlList(AI_SUGGESTION_STATUSES)})`,
    ),
    check(
      "ai_usage_log_error_code_check",
      sql`${table.errorCode} is null or (${table.outcome} = 'error' and ${table.errorCode} in (${sqlList(AI_ERROR_CODES)}))`,
    ),
    // Forslag og status bare når utfallet er ok. Gjelder også `blocked`: tom status og tekst.
    // `error_code` er bare satt når utfallet er `error` (sjekken over).
    check(
      "ai_usage_log_outcome_status_check",
      sql`(${table.outcome} = 'ok' and ${table.status} is not null) or (${table.outcome} <> 'ok' and ${table.status} is null and ${table.outputText} is null)`,
    ),
    check(
      "ai_usage_log_tokens_check",
      sql`${table.tokensIn} >= 0 and ${table.tokensOut} >= 0 and ${table.cost} >= 0`,
    ),
    check("ai_usage_log_redacted_count_check", sql`${table.redactedCount} >= 0`),
  ],
);
export type AiUsageLogRow = typeof aiUsageLog.$inferSelect;
