import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aiUsageLog } from "./ai-usage-log";
import { baseColumns } from "./common";
import { employees } from "./employees";

/**
 * Lederens månedsoppsummering av overstyrte sperrer (docs/funksjoner/fase2a-overstyringer-leder.md,
 * A567, ADR 0006 tillegg 24.11.2026 og ADR 0015 punkt 18). Én rad per organisasjon og måned.
 *
 * Raden er målet for KI-funksjonen `override_summary` (`target_ref = { type: "override_summary",
 * id, fieldKey: "text" }`), og stedet teksten leder har godtatt, endret eller skrevet selv, ligger.
 * KI-forslaget står i `ai_usage_log.output_text` og skrives aldri over; denne tabellen har bare
 * teksten som gjelder.
 *
 * `status` sier hvor `text` kommer fra:
 * - `empty`: raden er laget (leder trykket «Lag oppsummering»), ingen tekst er avgjort.
 * - `accepted`: teksten er KI-forslaget, godtatt uendret.
 * - `edited`: teksten bygger på et KI-forslag og er endret av leder.
 * - `manual`: leder skrev teksten selv, uten KI.
 * - `rejected`: forslaget i `ai_usage_log_id` ble avvist, og måneden har ingen tekst.
 *
 * `text` er lederens tekst. Den skal ikke ha navn eller andre personopplysninger (kontrolleres i
 * tjenesten før lagring, A574), og den logges aldri: revisjonslogg, hendelser og applikasjonslogg
 * får bare id, måned og status. `month` er kalendermåneden i norsk tid (`YYYY-MM`).
 *
 * Kodene under er faste (regel 6). CHECK-reglene bygges fra dem.
 */
export const OVERRIDE_SUMMARY_STATUSES = [
  "empty",
  "accepted",
  "edited",
  "manual",
  "rejected",
] as const;
export type OverrideSummaryStatus = (typeof OVERRIDE_SUMMARY_STATUSES)[number];

export const OVERRIDE_SUMMARY_SOURCES = ["ai", "manual"] as const;
export type OverrideSummarySource = (typeof OVERRIDE_SUMMARY_SOURCES)[number];

/** Høyeste lengde på teksten. Samme tall i CHECK-regelen og i Zod-skjemaet i tjenesten. */
export const OVERRIDE_SUMMARY_TEXT_MAX_CHARS = 2000;

/** Formatet på `month`: `YYYY-MM`. Samme mønster i CHECK-regelen og i Zod-skjemaet. */
export const OVERRIDE_SUMMARY_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_PATTERN_SQL = "^[0-9]{4}-(0[1-9]|1[0-2])$";

function sqlList(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

export const overrideSummaries = pgTable(
  "override_summaries",
  {
    ...baseColumns,
    month: text("month").notNull(),
    text: text("text"),
    status: text("status").$type<OverrideSummaryStatus>().notNull().default("empty"),
    /** Tom bare når `status` er `empty`. */
    source: text("source").$type<OverrideSummarySource>(),
    /** Forslaget teksten bygger på, eller forslaget som ble avvist. Samme organisasjon. */
    aiUsageLogId: uuid("ai_usage_log_id"),
    /** Den ansatte som tok siste beslutning (godta, endre, avvise eller skrive selv). */
    decidedBy: uuid("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    // Én rad per organisasjon og måned. Dekker også oppslaget på organisasjon.
    uniqueIndex("override_summaries_organization_id_month_idx")
      .on(table.organizationId, table.month)
      .where(sql`${table.deletedAt} is null`),
    // Forslaget og den ansatte må høre til samme organisasjon som raden
    foreignKey({
      name: "override_summaries_ai_usage_log_fk",
      columns: [table.organizationId, table.aiUsageLogId],
      foreignColumns: [aiUsageLog.organizationId, aiUsageLog.id],
    }),
    foreignKey({
      name: "override_summaries_decided_by_fk",
      columns: [table.organizationId, table.decidedBy],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    check(
      "override_summaries_month_check",
      sql`${table.month} ~ ${sql.raw(`'${MONTH_PATTERN_SQL}'`)}`,
    ),
    check(
      "override_summaries_status_check",
      sql`${table.status} in (${sqlList(OVERRIDE_SUMMARY_STATUSES)})`,
    ),
    check(
      "override_summaries_source_check",
      sql`${table.source} is null or ${table.source} in (${sqlList(OVERRIDE_SUMMARY_SOURCES)})`,
    ),
    // Teksten er aldri blank og høyst 2000 tegn
    check(
      "override_summaries_text_check",
      sql`${table.text} is null or (length(btrim(${table.text})) > 0 and length(${table.text}) <= ${sql.raw(String(OVERRIDE_SUMMARY_TEXT_MAX_CHARS))})`,
    ),
    // Tekst finnes når, og bare når, den er godtatt, endret eller skrevet selv
    check(
      "override_summaries_status_text_check",
      sql`(${table.status} in ('accepted', 'edited', 'manual')) = (${table.text} is not null)`,
    ),
    // Statusen binder kilden og forslaget: `empty` har ingen av delene, `manual` har ikke forslag,
    // og de tre andre peker alltid på forslaget de gjelder.
    check(
      "override_summaries_status_source_check",
      sql`(${table.status} = 'empty' and ${table.source} is null and ${table.aiUsageLogId} is null) or (${table.status} = 'manual' and ${table.source} is not distinct from 'manual' and ${table.aiUsageLogId} is null) or (${table.status} in ('accepted', 'edited', 'rejected') and ${table.source} is not distinct from 'ai' and ${table.aiUsageLogId} is not null)`,
    ),
    // En beslutning har alltid hvem og når; en rad uten beslutning har ingen av delene
    check(
      "override_summaries_decided_check",
      sql`(${table.status} = 'empty' and ${table.decidedBy} is null and ${table.decidedAt} is null) or (${table.status} <> 'empty' and ${table.decidedBy} is not null and ${table.decidedAt} is not null)`,
    ),
  ],
);
export type OverrideSummaryRow = typeof overrideSummaries.$inferSelect;
