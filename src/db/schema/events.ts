import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { assignments } from "./assignments";
import { baseColumns } from "./common";

/**
 * Hendelser (docs/05-domenemodell.md 4.9): alt som skjer på et oppdrag. Rutiner og varsler
 * bygges på disse. Raden slettes eller endres aldri, heller ikke mykt: `deleted_at` og
 * `deleted_by` fra `baseColumns` forblir alltid tomme.
 *
 * `assignment_id` har sammensatt fremmednøkkel `(organization_id, assignment_id)` til
 * `assignments`, så en hendelse aldri kan peke på et oppdrag i en annen organisasjon (A33, fase
 * 2a). `report_id` får sin når rapporttabellen kommer. `actor_id` er tom når systemet selv er
 * aktøren.
 */
export const events = pgTable(
  "events",
  {
    ...baseColumns,
    /** Fast kode fra `EVENT_TYPES` i `@/core/events`. */
    type: text("type").notNull(),
    assignmentId: uuid("assignment_id"),
    reportId: uuid("report_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: text("actor_type").notNull(),
    actorId: uuid("actor_id"),
    /** Detaljer. Aldri passord, nøkler eller mer personopplysninger enn nødvendig. */
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("events_organization_id_idx").on(table.organizationId, table.occurredAt),
    index("events_organization_id_assignment_id_idx").on(table.organizationId, table.assignmentId),
    // Oppdraget må høre til samme organisasjon som hendelsen (A33)
    foreignKey({
      name: "events_assignment_fk",
      columns: [table.organizationId, table.assignmentId],
      foreignColumns: [assignments.organizationId, assignments.id],
    }),
    check(
      "events_actor_type_check",
      sql`${table.actorType} in ('employee', 'system', 'integration')`,
    ),
  ],
);
