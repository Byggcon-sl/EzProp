import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { baseColumns } from "./common";
import { employees } from "./employees";

/**
 * Arbeidsøkter (docs/05-domenemodell.md 4.13): sammenhengende arbeid i én fase på ett oppdrag,
 * målt automatisk mens oppdraget er åpent (docs/funksjoner/fase2a-tidsmaling.md). Brukes bare
 * samlet per fase, aldri per person (arbeidsmiljøloven kapittel 9). Ingenting slettes permanent.
 *
 * `report_id` og `device_id` kommer når tabellene finnes (A120). Fasene står i
 * `@/core/work-sessions` (`WORK_PHASES`); CHECK-regelen under må ha de samme kodene.
 */
export const workSessions = pgTable(
  "work_sessions",
  {
    ...baseColumns,
    assignmentId: uuid("assignment_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    phase: text("phase").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Oppslaget av siste økt og summeringen i statistikken
    index("work_sessions_organization_id_assignment_id_employee_id_ended_at_idx").on(
      table.organizationId,
      table.assignmentId,
      table.employeeId,
      table.endedAt,
    ),
    // Oppdrag og ansatt må høre til samme organisasjon som raden
    foreignKey({
      name: "work_sessions_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    foreignKey({
      name: "work_sessions_employee_fk",
      columns: [table.organizationId, table.employeeId],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    check(
      "work_sessions_phase_check",
      sql`${table.phase} in ('preparation', 'inspection', 'office', 'delivery')`,
    ),
    check("work_sessions_period_check", sql`${table.endedAt} >= ${table.startedAt}`),
  ],
);
export type WorkSession = typeof workSessions.$inferSelect;
