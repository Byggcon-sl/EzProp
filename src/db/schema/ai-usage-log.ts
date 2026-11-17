import { sql } from "drizzle-orm";
import {
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
import { AI_CANDIDATE_REFS_MAX } from "@/shared/config/ai-targets";
import { assignments } from "./assignments";
import { baseColumns } from "./common";
import { employees } from "./employees";
import { reports } from "./reports";

/**
 * KI-loggen (docs/adr/0006-ki-i-bunnen.md del 5, docs/funksjoner/fase2a-ki-modul-logg.md).
 * Én rad per kall til KI gjennom `@/core/ai`: hvem som ba om forslaget, funksjon, leverandør,
 * mål, utfall, forslaget, hvem som avgjorde det og når, mengde og kostnad.
 *
 * Personopplysninger (A157, endret av K7/A272): myk sletting. `retain_until` settes av tjenesten
 * ved ny rad og ved hver statusendring: avviste får `created_at` + innstillingen
 * `ai.rejected_retention_years` (1–10, standard 10), alle andre `created_at` + 10 år.
 * `source_fields` har bare feltkoder og `input_summary` bare feltnavn og antall tegn, aldri tekst.
 * `report_id` peker på rapporten i samme organisasjon (sammensatt fremmednøkkel fra migrering
 * `0036_badet-pc`, A158). `reports.ts` og denne filen importerer hverandre; det går bra fordi tabellene
 * bare leses inne i funksjonen som bygger nøkler og indekser.
 *
 * Kodene under er faste (regel 6). CHECK-reglene må ha de samme kodene.
 */
/**
 * `blocked`: forespørselen ble sperret av modulen (ad-1), leverandøren ble ikke kalt. Skilt fra
 * «KI er av», som ikke gir noen rad.
 *
 * `stopped`: leverandøren svarte, men en vakt i kjernen stoppet svaret før det ble vist (A431).
 * Kallet har kostet, så mengde og kostnad beholdes. `status` er tom, `error_code` sier hvilken
 * vakt (`AI_GUARD_CODES`), og det stoppede svaret kan stå i `output_text`.
 */
export const AI_OUTCOMES = ["ok", "no_match", "error", "blocked", "stopped"] as const;
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

/**
 * Vaktene som kan stoppe et svar (utfallet `stopped`, A431, A440, A461 og A466). Står i
 * `error_code`, men er egne koder: en leverandør kan aldri svare med dem. Rekkefølgen her er
 * rekkefølgen vaktene kjøres i, og den første som slår til, står på raden (A471).
 *
 * - `tg_guard`: svaret la til eller endret TG.
 * - `coverage_guard`: utkastet til sammendrag manglet et funn, hadde et tomt funn eller et funn
 *   som ikke ble sendt.
 * - `number_guard`: svaret hadde tall som ikke ble sendt.
 * - `placeholder_guard`: plassholderne fra vasken kunne ikke byttes entydig tilbake.
 */
export const AI_GUARD_CODES = [
  "tg_guard",
  "coverage_guard",
  "number_guard",
  "placeholder_guard",
] as const;
export type AiGuardCode = (typeof AI_GUARD_CODES)[number];

/**
 * Hvor en kandidat kommer fra (A432). `template_outcome` = tekst på et utfall i rapportens låste
 * malversjon (`outcomes.id`), `template_measure` = standardtiltak i malversjonen
 * (`standard_measures.id`), `phrase` = frase i frasebanken (reservert til 2a-3, brukes ikke før).
 */
export const AI_CANDIDATE_SOURCES = ["template_outcome", "template_measure", "phrase"] as const;
export type AiCandidateSource = (typeof AI_CANDIDATE_SOURCES)[number];

/** Én kandidat slik den lagres i loggen: bare kilde og id, aldri tekst. */
export type AiCandidateRef = { source: AiCandidateSource; id: string };

/**
 * Høyeste antall kandidater som vises og lagres i `candidate_refs`. Samme grense i CHECK-regelen.
 * Tallet står i `@/shared/config/ai-targets`, slik at nettleseren kan lese det uten databasen.
 */
export { AI_CANDIDATE_REFS_MAX };

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
    /** Rapporten forslaget gjelder. Samme organisasjon (sammensatt fremmednøkkel). */
    reportId: uuid("report_id"),
    targetRef: jsonb("target_ref").$type<AiTargetRef>().notNull(),
    /** Bare feltkoder, aldri verdier. */
    sourceFields: jsonb("source_fields").$type<string[]>().notNull(),
    /** Feltnavn og antall tegn, aldri tekst. */
    inputSummary: jsonb("input_summary").$type<Record<string, number>>().notNull(),
    outcome: text("outcome").$type<AiOutcome>().notNull(),
    /** Feilkode ved `error`, vaktkode ved `stopped`. */
    errorCode: text("error_code").$type<AiErrorCode | AiGuardCode>(),
    /** Forslaget ved `ok`. Det stoppede svaret ved `stopped`: vises aldri og logges aldri. */
    outputText: text("output_text"),
    /**
     * Kandidatene som ble vist, i rangert rekkefølge (A432). Bare for funksjoner som velger blant
     * kandidater, og bare når utfallet er `ok`. Aldri tekst.
     */
    candidateRefs: jsonb("candidate_refs").$type<AiCandidateRef[]>(),
    /** Kandidaten den ansatte valgte. Må stå i `candidate_refs`; satt bare mens status er `accepted`. */
    chosenCandidate: jsonb("chosen_candidate").$type<AiCandidateRef>(),
    status: text("status").$type<AiSuggestionStatus>(),
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    /** Aldri flyttall. */
    cost: numeric("cost", { precision: 12, scale: 4 }).notNull().default("0"),
    currency: text("currency").notNull().default("NOK"),
    /** Antall treff som ble vasket bort før kallet. Aldri verdiene. */
    redactedCount: integer("redacted_count").notNull().default(0),
    retainUntil: timestamp("retain_until", { withTimezone: true }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    index("ai_usage_log_organization_id_idx").on(table.organizationId),
    // Mål for `ai_usage_id` på svar (samme organisasjon)
    uniqueIndex("ai_usage_log_organization_id_id_idx").on(table.organizationId, table.id),
    // Alle KI-forslag i en rapport (publiseringssperren og KI-merket per tekstfelt, A355)
    index("ai_usage_log_organization_id_report_id_idx")
      .on(table.organizationId, table.reportId)
      .where(sql`${table.reportId} is not null`),
    // Forrige forslag på samme mål som fortsatt venter på avgjørelse
    index("ai_usage_log_open_target_idx")
      .on(table.organizationId, table.feature, table.targetRef)
      .where(sql`${table.status} = 'suggested' and ${table.deletedAt} is null`),
    // Alle rader på ett mål, også avgjorte (KI-merket per felt og gjennomgang av tekstene)
    index("ai_usage_log_target_idx")
      .on(table.organizationId, table.feature, table.targetRef)
      .where(sql`${table.deletedAt} is null`),
    // Radene med valgt kandidat: tellingen «Mest brukt» for hele organisasjonen (A468)
    index("ai_usage_log_chosen_candidate_idx")
      .on(table.organizationId, table.feature)
      .where(sql`${table.chosenCandidate} is not null and ${table.deletedAt} is null`),
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
    foreignKey({
      name: "ai_usage_log_report_fk",
      columns: [table.organizationId, table.reportId],
      foreignColumns: [reports.organizationId, reports.id],
    }),
    check("ai_usage_log_outcome_check", sql`${table.outcome} in (${sqlList(AI_OUTCOMES)})`),
    check(
      "ai_usage_log_status_check",
      sql`${table.status} is null or ${table.status} in (${sqlList(AI_SUGGESTION_STATUSES)})`,
    ),
    check(
      "ai_usage_log_error_code_check",
      sql`${table.errorCode} is null or (${table.outcome} = 'error' and ${table.errorCode} in (${sqlList(AI_ERROR_CODES)})) or (${table.outcome} = 'stopped' and ${table.errorCode} in (${sqlList(AI_GUARD_CODES)}))`,
    ),
    // Status bare når utfallet er ok. Tekst bare ved ok, og ved stopped (svaret som ble stoppet).
    check(
      "ai_usage_log_outcome_status_check",
      sql`(${table.outcome} = 'ok' and ${table.status} is not null) or (${table.outcome} = 'stopped' and ${table.status} is null) or (${table.outcome} not in ('ok', 'stopped') and ${table.status} is null and ${table.outputText} is null)`,
    ),
    // Et stoppet svar har alltid koden til vakten som stoppet det
    check(
      "ai_usage_log_stopped_check",
      sql`${table.outcome} <> 'stopped' or ${table.errorCode} is not null`,
    ),
    // Viste kandidater: en liste med 1 til 5, bare når utfallet er ok
    check(
      "ai_usage_log_candidate_refs_check",
      sql`${table.candidateRefs} is null or (${table.outcome} = 'ok' and jsonb_typeof(${table.candidateRefs}) = 'array' and jsonb_array_length(${table.candidateRefs}) between 1 and ${sql.raw(String(AI_CANDIDATE_REFS_MAX))})`,
    ),
    // Valgt kandidat: et objekt med akkurat `source` (fast kode) og `id` (tekst), blant de viste,
    // og bare mens forslaget er godtatt. Uten formkravet ville `{}` stått «i» enhver liste (`@>`).
    // `coalesce` fordi en CHECK slipper gjennom NULL: en manglende nøkkel skal gi usann, ikke NULL.
    check(
      "ai_usage_log_chosen_candidate_check",
      sql`${table.chosenCandidate} is null or (${table.status} = 'accepted' and jsonb_typeof(${table.chosenCandidate}) = 'object' and ${table.chosenCandidate} - 'source' - 'id' = '{}'::jsonb and coalesce(${table.chosenCandidate} ->> 'source', '') in (${sqlList(AI_CANDIDATE_SOURCES)}) and coalesce(jsonb_typeof(${table.chosenCandidate} -> 'id'), '') = 'string' and ${table.candidateRefs} is not null and ${table.candidateRefs} @> jsonb_build_array(${table.chosenCandidate}))`,
    ),
    check(
      "ai_usage_log_tokens_check",
      sql`${table.tokensIn} >= 0 and ${table.tokensOut} >= 0 and ${table.cost} >= 0`,
    ),
    check("ai_usage_log_redacted_count_check", sql`${table.redactedCount} >= 0`),
    // Sperret forespørsel: intet kall, så ingen forslag, status eller feilkode
    check(
      "ai_usage_log_blocked_check",
      sql`${table.outcome} <> 'blocked' or (${table.status} is null and ${table.outputText} is null and ${table.errorCode} is null)`,
    ),
  ],
);
export type AiUsageLogRow = typeof aiUsageLog.$inferSelect;
