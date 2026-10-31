import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { baseColumns } from "./common";

/**
 * Hendelser (docs/05-domenemodell.md 4.9): alt som skjer på et oppdrag. Rutiner og varsler
 * bygges på disse. Raden slettes eller endres aldri, heller ikke mykt: `deleted_at` og
 * `deleted_by` fra `baseColumns` forblir alltid tomme.
 *
 * `assignment_id` og `report_id` har ingen fremmednøkkel ennå; den legges til når tabellene
 * kommer i fase 2a (A33). `actor_id` er tom når systemet selv er aktøren.
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
    check(
      "events_actor_type_check",
      sql`${table.actorType} in ('employee', 'system', 'integration')`,
    ),
  ],
);
