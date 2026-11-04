import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { baseColumns } from "./common";
import { employees } from "./employees";

/**
 * Teamet på oppdraget (docs/05-domenemodell.md 4.3): ansvarlig, medansvarlig, befaringstakstmann,
 * sidemann og saksbehandler. Én aktiv person per rolle (A61). Et bytte avslutter den gamle raden
 * (`to_at`, valgfri grunn) og lager en ny; ingenting skrives over eller slettes, så historikken
 * kan vises ved reklamasjon.
 *
 * Faste koder står i `@/core/assignments/codes`. CHECK-regelen under må ha de samme kodene.
 */
export const assignmentTeamMembers = pgTable(
  "assignment_team_members",
  {
    ...baseColumns,
    assignmentId: uuid("assignment_id").notNull(),
    employeeId: uuid("employee_id").notNull(),
    teamRole: text("team_role").notNull(),
    fromAt: timestamp("from_at", { withTimezone: true }).notNull(),
    /** Tom = aktiv. */
    toAt: timestamp("to_at", { withTimezone: true }),
    /** Grunnen ved bytte, for eksempel ferie. Aldri personopplysninger. */
    handedOverReason: text("handed_over_reason"),
  },
  (table) => [
    index("assignment_team_members_organization_id_assignment_id_idx").on(
      table.organizationId,
      table.assignmentId,
    ),
    // Én aktiv person per rolle per oppdrag (A61)
    uniqueIndex("assignment_team_members_active_role_idx")
      .on(table.organizationId, table.assignmentId, table.teamRole)
      .where(sql`${table.toAt} is null and ${table.deletedAt} is null`),
    // Oppdrag og ansatt må høre til samme organisasjon som raden
    foreignKey({
      name: "assignment_team_members_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    foreignKey({
      name: "assignment_team_members_employee_fk",
      columns: [table.organizationId, table.employeeId],
      foreignColumns: [employees.organizationId, employees.id],
    }),
    check(
      "assignment_team_members_team_role_check",
      sql`${table.teamRole} in ('responsible', 'co_responsible', 'inspector', 'peer_reviewer', 'office')`,
    ),
    check(
      "assignment_team_members_period_check",
      sql`${table.toAt} is null or ${table.toAt} >= ${table.fromAt}`,
    ),
    check(
      "assignment_team_members_reason_length_check",
      sql`${table.handedOverReason} is null or length(${table.handedOverReason}) <= 300`,
    ),
  ],
);
export type AssignmentTeamMember = typeof assignmentTeamMembers.$inferSelect;
