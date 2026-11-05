import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { baseColumns } from "./common";

/**
 * Fellesdeler for leilighet (docs/05-domenemodell.md 4.4), per oppdrag til rapportene finnes
 * (A66): forretningsfører, om det finnes tilstandsrapport og vedlikeholdsplan for fellesdelene,
 * og hva som er sett. Én aktiv rad per oppdrag. `association_firm_id` kommer med
 * kontaktregisteret.
 *
 * Faste koder (`yes`, `no`, `unknown`) står i `@/core/properties/codes`.
 */
export const commonAreas = pgTable(
  "common_areas",
  {
    ...baseColumns,
    assignmentId: uuid("assignment_id").notNull(),
    /** Forretningsfører. */
    managingAgent: text("managing_agent"),
    conditionReportStatus: text("condition_report_status").notNull().default("unknown"),
    maintenancePlanStatus: text("maintenance_plan_status").notNull().default("unknown"),
    /** Hva som er sett av fellesdelene, og hvordan. */
    notes: text("notes"),
  },
  (table) => [
    // Én aktiv rad per oppdrag
    uniqueIndex("common_areas_active_assignment_idx")
      .on(table.organizationId, table.assignmentId)
      .where(sql`${table.deletedAt} is null`),
    // Oppdraget må høre til samme organisasjon som raden
    foreignKey({
      name: "common_areas_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    check(
      "common_areas_condition_report_status_check",
      sql`${table.conditionReportStatus} in ('yes', 'no', 'unknown')`,
    ),
    check(
      "common_areas_maintenance_plan_status_check",
      sql`${table.maintenancePlanStatus} in ('yes', 'no', 'unknown')`,
    ),
  ],
);
export type CommonAreas = typeof commonAreas.$inferSelect;
